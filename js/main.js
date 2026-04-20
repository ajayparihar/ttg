/**
 * @file main.js — Application entry point for Tic Tac Grow.
 *
 * Bootstraps the game after the DOM is ready:
 *  1. Restores persisted user preferences (theme).
 *  2. Initialises touch-based zoom and pan on the game grid.
 *  3. Checks the URL for a multiplayer room invite link.
 *  4. Wires up name-input field behaviour.
 *  5. Registers global keyboard shortcuts (zoom, reset, pause).
 *
 * This module also bridges App and Multiplayer onto `window` so that
 * any remaining inline `onclick` handlers in the HTML can resolve them.
 *
 * @module main
 */

import { App } from './app.js';
import { State } from './state.js';
import { Render } from './render.js';
import { initZoomPan } from './zoom.js';
import { Multiplayer } from './multiplayer.js';

// ---------------------------------------------------------------------------
// Bridge for remaining inline `onclick` handlers in the HTML.
// Once all handlers have been migrated to addEventListener, these can be
// removed.
// ---------------------------------------------------------------------------
window.App = App;
window.Multiplayer = Multiplayer;

// ---------------------------------------------------------------------------
// Bootstrap — runs once after all DOM elements are available.
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {

  /* ---- 1. Restore user preferences (e.g. theme) from localStorage ---- */
  App.loadSaved();

  /* ---- 2. Attach pinch-to-zoom and one-finger pan listeners ---- */
  initZoomPan(Render);

  /* ---- 3. Handle deep-link multiplayer invites (?room=XXXX) ---- */
  const urlParams = new URLSearchParams(window.location.search);
  const roomCode = urlParams.get('room');
  if (roomCode) {
    // Pre-fill the join input and immediately attempt to join the room
    document.getElementById('join-code-input').value = roomCode;
    Multiplayer.joinRoom();
  }

  /* ---- 4. Name-input field behaviour ---- */

  // Clear any browser-autofilled values so the placeholder text shows
  const nameX = document.getElementById('name-x');
  const nameO = document.getElementById('name-o');

  if (nameX) {
    nameX.value = '';
    // Pressing Enter in the X-name field focuses the O-name field
    nameX.addEventListener('keydown', e => {
      if (e.key === 'Enter') nameO.focus();
    });
  }

  if (nameO) {
    nameO.value = '';
    // Pressing Enter in the O-name field starts the game
    nameO.addEventListener('keydown', e => {
      if (e.key === 'Enter') App.startGame();
    });
  }

  /* ---- 5. Global keyboard shortcuts (desktop) ---- */
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

    // Ctrl/Cmd + '0' → reset zoom and pan to default (100 %, centred)
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault();
      State.zoomLevel = 1;
      State.panX      = 0;
      State.panY      = 0;
      Render.setZoomDisplay(1);
    }

    // Escape → open the pause dialog (only while the game is actively running)
    if (e.key === 'Escape' && App.currentScreen === 'game' && !State.paused) {
      App.pauseConfirm();
    }
  });
});
