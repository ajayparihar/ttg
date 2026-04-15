'use strict';

/* ============================================================
   MAIN — ENTRY POINT
   Runs once the DOM is fully parsed.  Wires up global event
   listeners and kicks off the app.  All one-time setup that
   does not belong to a specific module lives here.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ---- Restore user preferences ---- */
  App.loadSaved();

  /* ---- Touch zoom/pan ---- */
  initZoomPan();

  /* ---- Name input fields ---- */

  // Clear any browser-autofilled values on load
  document.getElementById('name-x').value = '';
  document.getElementById('name-o').value = '';

  // Tab through name inputs with Enter; submit with Enter on the last field
  document.getElementById('name-x').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('name-o').focus();
  });

  document.getElementById('name-o').addEventListener('keydown', e => {
    if (e.key === 'Enter') App.startGame();
  });

  /* ---- Keyboard shortcuts (desktop) ---- */
  document.addEventListener('keydown', e => {

    // Ctrl/Cmd + '+' or '=' → zoom in
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      App.zoom(1);
    }

    // Ctrl/Cmd + '−' → zoom out
    if ((e.ctrlKey || e.metaKey) && e.key === '-') {
      e.preventDefault();
      App.zoom(-1);
    }

    // Ctrl/Cmd + '0' → reset zoom and pan
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      State.zoomLevel = 1;
      State.panX      = 0;
      State.panY      = 0;
      Render.setZoomDisplay(1);
    }

    // Escape → pause (only during an active, unpaused game)
    if (e.key === 'Escape' && App.currentScreen === 'game' && !State.paused) {
      App.pauseConfirm();
    }
  });
});
