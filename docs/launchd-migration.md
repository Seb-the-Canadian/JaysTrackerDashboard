# launchd migration — running the daily refresh from your Mac

This is a fallback. The primary runner in this repo is the GitHub Actions cron defined in `.github/workflows/daily-refresh.yml`. Use this guide when one of the following applies:

- You want the refresh to live entirely on your machine, with no external scheduler.
- Your fork is a private repo on a plan without Actions minutes, and you don't want to use the Claude Code Routine either.
- You're hitting quota / token pressure on Claude Code and don't want to use Actions for some other reason.
- You're moving off Claude Code entirely and prefer local control over a GitHub-hosted workflow.

The cost: your laptop has to be on (or able to wake) at the scheduled time. macOS `launchd` will run missed jobs on next wake, so a sleeping laptop catches up — but a laptop that's off all day misses that day's refresh.

---

## What you're switching to

A launchd `LaunchAgent` that fires `scripts/update_and_push.sh` once a day from a local clone of the repo. The script does the same thing the routine does: fetch fresh MLB data, commit, push to `main`. GitHub Pages picks up the new `data.json` within a few minutes.

---

## Before you start — disable the other schedulers

> Disable both the Claude Code Routine AND the GitHub Actions workflow before enabling launchd, or all three will commit daily. You'll get duplicate `Daily data refresh: YYYY-MM-DD` commits from up to three different identities and a confused history.

Specifically:
- The Routine path uses Claude's auth via the connected-repo integration.
- The GitHub Actions cron uses the built-in `GITHUB_TOKEN` and fires on its own schedule independent of your laptop.
- launchd uses your local Mac.

All three would race to commit `data.json` daily.

Before completing step 5 below:
- In the Claude Code UI: disable or delete the routine for this repo (if you ever set one up).
- In GitHub: disable the `Daily data refresh` workflow (Actions tab → workflow → "Disable workflow"), or comment out the `schedule` block in `.github/workflows/daily-refresh.yml` and commit.

---

## Step 1 — Clone to a stable location

Pick a path you won't move:

```
git clone git@github.com:seb-the-canadian/jaystrackerdashboard.git ~/code/jaystrackerdashboard
```

(SSH URL — the auth section below explains why.)

Whatever path you choose, you'll paste it into the plist twice in step 4.

---

## Step 2 — Python environment

The script does `python3 -m pip install -r requirements.txt --quiet` on each run. On modern macOS, installing into the system Python is blocked by default, so use a venv.

```
cd ~/code/jaystrackerdashboard
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

You then need launchd to invoke the venv's `python3`, not the system one. Two ways:

**Option A — let the script find the venv (one-line edit, recommended).** Add this line to the top of `scripts/update_and_push.sh` (and `scripts/fetch_only.sh` if you want it for manual runs too) right after the `cd` line:

```bash
[ -f .venv/bin/activate ] && source .venv/bin/activate
```

Now any time you run the script from a clone that has a `.venv/`, the script uses it. This is a local change to your clone; don't push it back upstream unless we decide to make it the default.

**Option B — adjust the plist PATH.** Prepend the venv's `bin/` to the `PATH` in the plist's `EnvironmentVariables` dict:

```xml
<key>PATH</key>
<string>/Users/YOU/code/jaystrackerdashboard/.venv/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
```

Either option works. Option A keeps the plist generic.

---

## Step 3 — Auth (the gotcha)

The Claude Code Routine has implicit GitHub auth via the connected-repo integration. launchd does not. You need to give the local clone permission to push.

Three options, in order of recommendation:

### 3a. Deploy key (recommended)

A keypair scoped to **this one repo**, with write access. Doesn't affect any other repo. Doesn't expire unless you revoke it.

1. Generate a keypair specifically for this:

   ```
   ssh-keygen -t ed25519 -f ~/.ssh/jays-tracker-deploy -C "jays-tracker-deploy-key" -N ""
   ```

2. Add the public key to the repo:
   - Copy `~/.ssh/jays-tracker-deploy.pub` to your clipboard: `pbcopy < ~/.ssh/jays-tracker-deploy.pub`
   - GitHub: **Settings → Deploy keys → Add deploy key**. Paste. **Check "Allow write access".** Save.

3. Tell git to use this key for this repo only. Edit `~/.ssh/config` (create if missing):

   ```
   Host github-jays-tracker
       HostName github.com
       User git
       IdentityFile ~/.ssh/jays-tracker-deploy
       IdentitiesOnly yes
   ```

4. Point the repo's `origin` at the alias:

   ```
   cd ~/code/jaystrackerdashboard
   git remote set-url origin git@github-jays-tracker:seb-the-canadian/jaystrackerdashboard.git
   ```

5. Verify: `git fetch origin && git push origin main --dry-run` should succeed without prompting.

### 3b. Personal Access Token

If deploy keys feel like too much ceremony, you can use a fine-grained PAT. Trade-off: the PAT's scope is broader than this one repo (or as narrow as you choose), it expires (you'll need to rotate), and it sits in plaintext in your git config or keychain.

Sketch:
- GitHub: **Settings → Developer settings → Personal access tokens → Fine-grained** → create one with **Contents: read & write** scoped to just `jaystrackerdashboard`.
- `git remote set-url origin https://<TOKEN>@github.com/seb-the-canadian/jaystrackerdashboard.git`

Don't go this route if 3a is workable.

### 3c. `gh` CLI session

If `gh` is installed and authenticated as your user, it sets up a git credential helper that handles pushes invisibly. The tradeoff is that the launchd job depends on your gh auth state being valid — if you re-auth or revoke, the daily refresh quietly stops working until you notice.

`gh auth status` to check; `gh auth login` if needed; then `gh auth setup-git` to wire the credential helper.

---

## Step 4 — Install the plist

The template lives in the repo at `scripts/com.jays-tracker.refresh.plist`.

```
cp scripts/com.jays-tracker.refresh.plist ~/Library/LaunchAgents/
```

Edit the copy in `~/Library/LaunchAgents/com.jays-tracker.refresh.plist`:

- Replace **both** `REPLACE_WITH_REPO_PATH` placeholders with the absolute path to your clone (no trailing slash). E.g., `/Users/sebastianlathangue/code/jaystrackerdashboard`.
- If you chose Option B in step 2 (venv PATH in the plist), update `PATH` there now.
- The `<Hour>8</Hour>` is 8:00 **system local time**. The GitHub Actions workflow fires at 09:00 UTC (05:00 ET); the original Routine fired at 12:00 UTC (08:00 ET). Pick a local time that gives you boxscores from the previous day's late games. If you're in another timezone and want to match ET morning, adjust: PT → 5, MT → 6, CT → 7.

Load the job:

```
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.jays-tracker.refresh.plist
```

`launchctl bootstrap` is the modern replacement for the deprecated `launchctl load`. If you're on an older macOS, the equivalent is `launchctl load ~/Library/LaunchAgents/com.jays-tracker.refresh.plist`.

---

## Step 5 — Test before relying on it

Trigger the job manually:

```
launchctl kickstart -p gui/$UID/com.jays-tracker.refresh
```

Check what happened:

```
tail -n 50 /tmp/jays-tracker-refresh.log
tail -n 50 /tmp/jays-tracker-refresh.err
```

You should see "pushed daily refresh" (or "no changes" if the data is identical) in the log. The err file should be empty or contain only pip install progress lines.

Then verify in GitHub: there should be a new commit on `main` by `jays-tracker-bot`.

Once you've confirmed it works:

- Disable both the Claude Code Routine AND the GitHub Actions workflow if you haven't already, or all three will commit daily. See the "Before you start" section above for the specific steps for each.
- The next scheduled fire will be at the time set in `StartCalendarInterval`.

---

## Operations

**Check status:** `launchctl print gui/$UID/com.jays-tracker.refresh`

**Stop temporarily (without removing):** `launchctl bootout gui/$UID/com.jays-tracker.refresh` — re-`bootstrap` to start again.

**Remove entirely:** `launchctl bootout gui/$UID/com.jays-tracker.refresh` then `rm ~/Library/LaunchAgents/com.jays-tracker.refresh.plist`.

**Change the schedule:** edit the plist in `~/Library/LaunchAgents/`, then `bootout` and `bootstrap` to reload.

**Logs grow forever:** `/tmp/jays-tracker-refresh.{log,err}` are not rotated. macOS clears `/tmp` on reboot, which usually handles it. If you reboot rarely, add a `find /tmp/jays-tracker-refresh.* -mtime +30 -delete` to your shell startup or another launchd job.

---

## Going back to GitHub Actions (or the Routine)

Reverse: `launchctl bootout`, remove the plist, then re-enable the GitHub Actions workflow (Actions tab → "Enable workflow", or restore the `schedule:` block if you commented it out) or re-enable the Claude Code Routine. Don't run more than one at a time.
