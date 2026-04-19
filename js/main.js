import { App } from './app.js';
import { State } from './state.js';
import { Render } from './render.js';
import { initZoomPan } from './zoom.js';

// Bridge for remaining inline onclicks if any (gradual migration)
window.App = App;

document.addEventListener('DOMContentLoaded', () => {

  /* ---- Restore user preferences ---- */
  App.loadSaved();

  /* ---- Touch zoom/pan ---- */
  initZoomPan(Render);

  /* ---- Event Delegation for Main Menu ---- */
  // (We'll keep some onclicks for now for simplicity, but let's shift name inputs to listeners)

  /* ---- Name input fields ---- */

  // Clear any browser-autofilled values on load
  const nameX = document.getElementById('name-x');
  const nameO = document.getElementById('name-o');

  if (nameX) {
    nameX.value = '';
    nameX.addEventListener('keydown', e => {
      if (e.key === 'Enter') nameO.focus();
    });
  }

  if (nameO) {
    nameO.value = '';
    nameO.addEventListener('keydown', e => {
      if (e.key === 'Enter') App.startGame();
    });
  }

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
