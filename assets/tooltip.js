/* ============================================================
   Jays Tracker — stat tooltip (v2 / #114 Phase 1)

   Restores v1's stat-tooltip behavior on v2's existing `.term[data-stat]`
   affordances (the dotted underline + `cursor: help` that v2 inherited
   but never wired). Content comes from stat_school.json via
   JaysStatRegistry, so the tooltip's voice matches the Stat School tab.

   Design choices:
   - One singleton tooltip element, repositioned per trigger (vs. one
     per term in v1 — saves memory + simplifies focus management).
   - Event delegation at document level, so per-tab re-renders don't
     need to re-attach. Renderers only need `data-stat="<slug>"` on a
     wrappable element with class `.term`.
   - Hover-with-delay on (hover: hover) devices; click toggles
     everywhere; keyboard via Tab → focus → Enter/Space toggle, Esc
     closes. Matches W3C tooltip-aria-pattern guidance.
   - aria-describedby is wired only when open and removed on close, so
     screen readers don't announce stale tooltip ids.
   - "Read more →" deep-links to #stat-<slug> via the existing Stat
     School hash router (assets/stat-school.js tryOpenFromHash).

   Failure modes:
   - JSON load fails / slug not in registry → tooltip silently no-ops
     (no DOM mutation, no JS error). The .term still shows its cursor:
     help but does nothing — same as today. The probe asserts the
     happy path is wired; this preserves degrade-gracefully behavior.
   ============================================================ */
(function () {
  'use strict';

  const HOVER_OPEN_MS = 180;
  const HOVER_CLOSE_MS = 120;
  const SUPPORTS_HOVER = window.matchMedia
    ? window.matchMedia('(hover: hover)').matches
    : true;
  const TIP_ID = 'jays-tooltip';

  let tip = null;          // The singleton tooltip element.
  let currentTrigger = null;
  let openTimer = null;
  let closeTimer = null;
  // 'hover' | 'click' | 'focus' — set on every openOn() and cleared on
  // close(). hover-opens auto-close on pointerout; click- and focus-opens
  // are sticky (only Esc / click-outside / re-clicking the trigger
  // dismisses). Without this, clicking a term and reading the tooltip
  // ends as soon as you move the mouse away — the bug T3/T5/T7 caught.
  let openSource = null;

  // ---- Element factory -----------------------------------------------------

  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.id = TIP_ID;
    tip.className = 'tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    // Don't close when hovering the tooltip body itself.
    tip.addEventListener('pointerenter', cancelClose);
    tip.addEventListener('pointerleave', scheduleClose);
    document.body.appendChild(tip);
    return tip;
  }

  // ---- Content -------------------------------------------------------------

  // Build tooltip HTML for a stat slug. Returns '' when the registry has
  // no entry (caller no-ops). The "Read more" link points at the existing
  // Stat School deep-link route, so a click navigates without us needing
  // to reach into stat-school.js.
  function buildContent(slug) {
    const stat = window.JaysStatRegistry.get(slug);
    if (!stat) return '';
    const escapeHtml = window.JaysFormat.escapeHtml;
    const abbr = escapeHtml(stat.abbr || slug);
    const name = escapeHtml(stat.name || '');
    const statcastChip = stat.statcast
      ? ' <span class="tip-sc">Statcast</span>'
      : '';
    let html = '<div class="tip-head">'
      + '<span class="tip-abbr">' + abbr + '</span>'
      + (name ? ' <span class="tip-name">' + name + '</span>' : '')
      + statcastChip
      + '</div>';
    if (stat.definition_md) {
      html += '<p class="tip-def">' + stat.definition_md + '</p>';
    }
    if (stat.scale_low_label || stat.scale_high_label) {
      const low = escapeHtml(stat.scale_low_label || '');
      const high = escapeHtml(stat.scale_high_label || '');
      const dir = stat.direction === 'higher_better' ? '▲'
        : stat.direction === 'lower_better' ? '▼' : '·';
      html += '<p class="tip-scale">'
        + '<span>' + low + '</span>'
        + '<span class="tip-dir">' + dir + '</span>'
        + '<span>' + high + '</span>'
        + '</p>';
    }
    // Stat School deep-link. Uses the canonical slug (the JSON's own key),
    // falling back to the input slug if get() resolved via alias.
    const targetSlug = encodeURIComponent(slug);
    html += '<a class="tip-more" href="#stat-' + targetSlug + '">'
      + 'Read more in Stat School →</a>';
    return html;
  }

  // ---- Positioning ---------------------------------------------------------

  // Place tip above trigger, centered. Flip below if no room. Clamp
  // horizontally to the viewport with an 8px margin so the bubble never
  // hangs off-screen on narrow widths.
  function position(trigger) {
    const t = ensureTip();
    const tr = trigger.getBoundingClientRect();
    // Force layout to read width/height post-content-update.
    t.style.left = '0px';
    t.style.top = '0px';
    const tw = t.offsetWidth;
    const th = t.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;

    let left = tr.left + tr.width / 2 - tw / 2;
    left = Math.max(margin, Math.min(left, vw - tw - margin));

    let top = tr.top - th - 10;
    let arrow = 'tip-below';   // arrow on top of bubble (pointing down to trigger)
    if (top < margin) {
      top = tr.bottom + 10;
      arrow = 'tip-above';     // arrow on bottom of bubble (pointing up)
      if (top + th > vh - margin) top = vh - th - margin;
    }
    t.style.left = (left + window.scrollX) + 'px';
    t.style.top = (top + window.scrollY) + 'px';
    t.classList.remove('tip-above', 'tip-below');
    t.classList.add(arrow);
  }

  // ---- Open / close --------------------------------------------------------

  function openOn(trigger, source) {
    const slug = trigger.getAttribute('data-stat');
    if (!slug) return;
    const html = buildContent(slug);
    if (!html) return;                       // unknown slug → silent no-op
    const t = ensureTip();
    t.innerHTML = html;
    t.hidden = false;
    // Two paint frames before positioning so width settles after content swap.
    requestAnimationFrame(function () { position(trigger); });
    trigger.setAttribute('aria-describedby', TIP_ID);
    currentTrigger = trigger;
    openSource = source || 'click';
    cancelClose();
  }

  function close() {
    if (!tip) return;
    tip.hidden = true;
    tip.innerHTML = '';
    if (currentTrigger) {
      currentTrigger.removeAttribute('aria-describedby');
      currentTrigger = null;
    }
    openSource = null;
    // Cancel any pending hover-open timer so a click-driven close isn't
    // undone 180ms later when the orphan timer fires.
    cancelOpen();
  }

  function scheduleOpen(trigger) {
    cancelOpen();
    cancelClose();
    openTimer = setTimeout(function () {
      openTimer = null;
      openOn(trigger, 'hover');
    }, HOVER_OPEN_MS);
  }

  function scheduleClose() {
    // Click- and focus-opens are sticky: a hover-out doesn't dismiss them.
    // Only hover-opens auto-close. The user explicitly clicked or
    // keyboard-focused, so they're "reading" — wait for Esc / click-outside.
    if (openSource && openSource !== 'hover') return;
    cancelClose();
    closeTimer = setTimeout(function () {
      closeTimer = null;
      close();
    }, HOVER_CLOSE_MS);
  }

  function cancelOpen()  { if (openTimer)  { clearTimeout(openTimer);  openTimer = null; } }
  function cancelClose() { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } }

  // ---- Trigger lookup ------------------------------------------------------

  function triggerFromEvent(e) {
    const el = e.target;
    if (!el || !el.closest) return null;
    return el.closest('.term[data-stat]');
  }

  // ---- Event delegation ----------------------------------------------------
  //
  // All listeners are document-level so the wiring survives per-tab re-renders
  // without any attach/detach dance. The trigger element only needs class
  // `term` + a `data-stat` slug + `tabindex="0"` for keyboard.

  function init() {
    if (!window.JaysFormat || !window.JaysStatRegistry) return;
    window.JaysStatRegistry.load();

    // Hover (desktop only — touch devices stay on click via the same handler).
    if (SUPPORTS_HOVER) {
      document.addEventListener('pointerover', function (e) {
        const trigger = triggerFromEvent(e);
        if (!trigger) return;
        scheduleOpen(trigger);
      });
      document.addEventListener('pointerout', function (e) {
        const trigger = triggerFromEvent(e);
        if (!trigger) return;
        // Only close if the pointer left the trigger entirely (not just moved
        // into a child node). The tooltip's own enter/leave handlers cover
        // the case where the pointer is on the tooltip itself.
        if (e.relatedTarget && trigger.contains(e.relatedTarget)) return;
        cancelOpen();
        scheduleClose();
      });
    }

    // Click — toggle. Works on touch and desktop.
    //
    // A focusable `.term` gets a focus event before its click (mousedown →
    // focus → mouseup → click), so focusin runs openOn('focus') first.
    // Without special handling, click would then see currentTrigger ===
    // trigger and close the tooltip the same gesture just opened — the
    // user clicks once and sees nothing. Treat a focus-opened tooltip as
    // "promote to click and stay open"; only a *second* click (with
    // openSource already 'click') is a true toggle-close.
    document.addEventListener('click', function (e) {
      const trigger = triggerFromEvent(e);
      if (trigger) {
        e.preventDefault();
        if (currentTrigger === trigger && tip && !tip.hidden) {
          if (openSource === 'focus' || openSource === 'hover') {
            openSource = 'click';
            return;
          }
          close();
        } else {
          openOn(trigger, 'click');
        }
        return;
      }
      // Click outside trigger + outside tooltip → close.
      if (tip && !tip.hidden && (!e.target || !e.target.closest('#' + TIP_ID))) {
        close();
      }
    });

    // Keyboard. Esc must `stopImmediatePropagation` so the modal's own
    // Esc handler doesn't ALSO fire and dismiss the dialog under the
    // tooltip — when the tooltip is open and the user presses Esc, the
    // clear intent is to close the inner overlay (the tooltip), not the
    // outer one (the modal). We register on document at capture phase so
    // we sit above modal.js's bubble-phase handler.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && tip && !tip.hidden) {
        e.stopImmediatePropagation();
        const restore = currentTrigger;
        close();
        if (restore) try { restore.focus(); } catch (_) {}
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        const trigger = triggerFromEvent(e);
        if (!trigger || document.activeElement !== trigger) return;
        e.preventDefault();
        if (currentTrigger === trigger && tip && !tip.hidden) close();
        else openOn(trigger, 'focus');
      }
    }, true);

    // Focus / blur — open on Tab-focus, close on blur (when leaving entirely).
    document.addEventListener('focusin', function (e) {
      const trigger = triggerFromEvent(e);
      if (trigger) openOn(trigger, 'focus');
    });
    document.addEventListener('focusout', function (e) {
      if (!currentTrigger) return;
      const next = e.relatedTarget;
      if (next && (currentTrigger.contains(next) || (tip && tip.contains(next)))) return;
      close();
    });

    // Make every existing `.term[data-stat]` keyboard-focusable. A MutationObserver
    // keeps later renders covered without each module having to call us.
    function makeFocusable(root) {
      const nodes = (root || document).querySelectorAll('.term[data-stat]');
      for (let i = 0; i < nodes.length; i++) {
        if (!nodes[i].hasAttribute('tabindex')) nodes[i].setAttribute('tabindex', '0');
      }
    }
    makeFocusable(document);
    const obs = new MutationObserver(function (records) {
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        if (r.type !== 'childList') continue;
        for (let j = 0; j < r.addedNodes.length; j++) {
          const n = r.addedNodes[j];
          if (n.nodeType === 1) makeFocusable(n);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.JaysTooltip = {
    openOn: openOn,
    close: close,
    // Exposed for the probe — lets it verify the singleton without
    // duplicating the id constant.
    _elementId: TIP_ID,
  };
})();
