/* ============================================================
   Jays Tracker — modal lifecycle (v2)
   Antifragile pass — Commit 4. The B4 class: a new modal type
   needs bespoke hashchange logic because each per-tab module
   owned its own open/close/back-button code, and the URL was a
   side-effect of click handlers instead of the source of truth.

   Root principle: the URL hash is the source of truth for modal
   state. "Is the modal open?" is a function of window.location.hash,
   nothing else. Open via click → set hash → hashchange → render.
   Close via X / Escape / scrim click → set hash → hashchange →
   render. Browser back/forward = hash history = "just works".

   Module-level state is read-only cache for state.data + last
   focus trigger. All transitions flow through render(state).
   ============================================================ */

(function () {
  'use strict';

  // ---- Cached state (set by render(state)) ----
  let cachedState = null;
  let listenerInstalled = false;
  let lastTrigger = null;
  let escHandler = null;
  // PR-E: focus-trap state. We install a single keydown handler at scrim
  // level on open(); it intercepts Tab and Shift+Tab to keep the user
  // inside the dialog until they Esc / X / scrim-click out. W3C ARIA
  // dialog-modal pattern: <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>
  let trapHandler = null;
  const FOCUSABLE_SEL = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  // ---- Discriminator: hash → modal intent ----
  //
  // The single function that decides what (if any) modal the URL
  // wants open. Add a new case here to add a new modal type — all
  // lifecycle code below is type-agnostic.
  function modalState(hash) {
    const h = (hash || '').replace(/^#/, '');
    const m = h.match(/^player-(.+)$/);
    if (m) return { type: 'player', target: m[1] };
    return { type: null, target: null };
  }

  // ---- Scrim (one per page, lazily created) ----
  function ensureScrim() {
    let scrim = document.getElementById('player-modal-scrim');
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.id = 'player-modal-scrim';
      scrim.className = 'modal-scrim';
      scrim.setAttribute('role', 'dialog');
      scrim.setAttribute('aria-modal', 'true');
      scrim.addEventListener('click', function (e) {
        if (e.target === scrim) closeViaUi();
      });
      document.body.appendChild(scrim);
    }
    return scrim;
  }

  // ---- Open / close primitives ----
  //
  // PR-E (audit H11/H12 + A1): the scrim now carries `aria-labelledby`
  // pointing at the modal's <h3 id="player-modal-title">, so screen
  // readers announce "Vladimir Guerrero Jr., dialog" instead of an
  // anonymous dialog. Tab/Shift+Tab wrap inside the dialog via the
  // trapHandler.

  function getFocusable(scrim) {
    return Array.prototype.slice.call(scrim.querySelectorAll(FOCUSABLE_SEL))
      .filter(function (el) { return el.offsetParent !== null; });
  }

  function open(content, openId) {
    const scrim = ensureScrim();
    scrim.innerHTML = '';
    scrim.appendChild(content);
    scrim.classList.add('show');
    scrim.dataset.openId = String(openId || '');
    document.body.style.overflow = 'hidden';

    // Wire aria-labelledby to the just-mounted h3 (if present).
    const title = scrim.querySelector('#player-modal-title');
    if (title) {
      scrim.setAttribute('aria-labelledby', 'player-modal-title');
    } else {
      // Fallback: name the dialog generically rather than leave it
      // nameless (worse than no aria-modal for a screen reader).
      scrim.setAttribute('aria-label', 'Player details');
    }

    if (!escHandler) {
      escHandler = function (e) {
        if (e.key === 'Escape') closeViaUi();
      };
      document.addEventListener('keydown', escHandler);
    }
    if (!trapHandler) {
      trapHandler = function (e) {
        if (e.key !== 'Tab') return;
        const focusable = getFocusable(scrim);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
        // For everything in between, native Tab order handles it.
      };
      scrim.addEventListener('keydown', trapHandler);
    }
    const x = scrim.querySelector('.modal-x');
    if (x) x.focus();
  }

  function close() {
    const scrim = document.getElementById('player-modal-scrim');
    if (scrim) {
      scrim.classList.remove('show');
      scrim.innerHTML = '';
      scrim.dataset.openId = '';
      scrim.removeAttribute('aria-labelledby');
      scrim.removeAttribute('aria-label');
      if (trapHandler) {
        scrim.removeEventListener('keydown', trapHandler);
        trapHandler = null;
      }
    }
    document.body.style.overflow = '';
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
    if (lastTrigger) {
      try { lastTrigger.focus(); } catch (_) {}
      lastTrigger = null;
    }
  }

  // Close paths that originate in the UI (X click, scrim click,
  // Escape) revert the hash to the parent tab so back-button history
  // stays clean. Close paths that originate in the hash (back button,
  // direct nav away) call close() directly — hash is already correct.
  function closeViaUi() {
    if (window.location.hash.indexOf('#player-') === 0) {
      history.pushState({}, '', '#players');
      // pushState doesn't fire hashchange — call render to actually close.
      if (cachedState) render(cachedState);
    } else {
      close();
    }
  }

  // ---- Per-type mounting ----
  //
  // Each modal type has a builder registered below. The lifecycle code
  // above doesn't know about player vs. stat etc. — it just calls the
  // registered builder.
  const BUILDERS = {
    player: function (target, state) {
      if (!window.JaysPlayers || !window.JaysPlayers.findPlayer) return null;
      const player = window.JaysPlayers.findPlayer(target, state);
      if (!player) return null;
      const content = window.JaysPlayers.buildModalContent(
        player, !!player.__isHitter, state);
      return { content: content, openId: player.id };
    },
  };

  // ---- Main render — single source of truth ----
  function render(state) {
    cachedState = state;
    const want = modalState(window.location.hash);
    const scrim = document.getElementById('player-modal-scrim');
    const scrimOpen = !!(scrim && scrim.classList.contains('show'));

    if (want.type && BUILDERS[want.type]) {
      const built = BUILDERS[want.type](want.target, state);
      const currentOpenId = scrim ? (scrim.dataset.openId || '') : '';
      if (!built) {
        // Hash references a target that doesn't exist (e.g. retired
        // player ID still in someone's bookmark). Close any open modal.
        if (scrimOpen) close();
      } else if (!scrimOpen || currentOpenId !== String(built.openId)) {
        open(built.content, built.openId);
      }
      // else: already showing the same target — no-op (idempotent).
    } else if (scrimOpen) {
      close();
    }

    if (!listenerInstalled) {
      window.addEventListener('hashchange', function () {
        if (cachedState) render(cachedState);
      });
      listenerInstalled = true;
    }
  }

  // ---- Click adapter for per-tab renderers ----
  //
  // Per-tab code calls openFromClick(player, triggerEl) on row clicks.
  // We push the hash via history.pushState (no hashchange fires) and
  // call render() synchronously. Two reasons:
  //  1. Symmetric with closeViaUi() — both transitions are pushState +
  //     explicit render(), no asynchronous hashchange round-trip.
  //  2. Synchronous open means rapid click→Esc cycles can't race the
  //     pending hashchange microtask. Browser back/forward still fire
  //     hashchange (the listener below handles those).
  function openFromClick(player, triggerEl) {
    if (!player || player.id == null) return;
    lastTrigger = triggerEl || null;
    const newHash = '#player-' + player.id;
    if (window.location.hash !== newHash) {
      history.pushState({}, '', newHash);
    }
    if (cachedState) render(cachedState);
  }

  window.JaysModal = {
    render: render,
    openFromClick: openFromClick,
    // UI-originated close (X button, custom dismiss controls). Reverts
    // the hash so back-button history stays clean. Esc and scrim click
    // are wired internally; this is for controls inside builder content.
    requestClose: closeViaUi,
    modalState: modalState,
  };
})();
