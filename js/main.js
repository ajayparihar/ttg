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
import { makeMove } from './game.js';
import { i18n } from './i18n.js';
import { hapticFeedback, HapticPresets } from './utils.js';
import { GOOGLE_SIGNIN_ENABLED } from './constants.js';

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

  /* ---- 1. Handle splash screen dismissal ---- */
  const splash = document.getElementById('splash-screen');
  if (splash) {
    // Update aria progress during load
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress = Math.min(progress + 5, 90);
      splash.setAttribute('aria-valuenow', progress.toString());
    }, 100);

    // Wait for at least 2.5 seconds (animation duration)
    // Also wait for the font to be ready for the best look
    const splashTimeout = new Promise(resolve => setTimeout(resolve, 2500));
    const fontReady = document.fonts ? document.fonts.ready : Promise.resolve();

    Promise.all([splashTimeout, fontReady]).then(() => {
      clearInterval(progressInterval);
      splash.setAttribute('aria-valuenow', '100');
      splash.classList.add('fade-out');
      // Remove from DOM after fade animation to keep it clean
      setTimeout(() => splash.remove(), 800);
    });
  }

  /* ---- 2. Initialize Multiplayer Identity (anonymous auth always) ---- */
  Multiplayer.initId();

  /* ---- 2a. Skip Google login screen when disabled ---- */
  if (!GOOGLE_SIGNIN_ENABLED) {
    State.loginSkipped = true;
    App.showScreen('menu');
  }

  /* ---- 3. Restore user preferences (e.g. theme) from localStorage ---- */
  App.loadSaved();

  /* ---- 4. Attach pinch-to-zoom and one-finger pan listeners ---- */
  initZoomPan(Render);

  /* ---- 5. Handle deep-link multiplayer invites (?room=XXXX) ---- */
  const urlParams = new URLSearchParams(window.location.search);
  const roomCode = urlParams.get('room');
  if (roomCode && roomCode.length === 4) {
    // Pre-fill the OTP inputs and immediately attempt to join the room
    const otpInputs = document.querySelectorAll('.otp-input');
    otpInputs.forEach((input, index) => {
      input.value = roomCode[index] || '';
    });
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
      return;
    }

    // Grid keyboard navigation (only when game is active and not typing in an input)
    const activeTag = document.activeElement?.tagName;
    const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA';
    if (App.currentScreen === 'game' && State.gameActive && !State.paused && !isTyping) {
      handleGridNavigation(e);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Grid Keyboard Navigation
// ═══════════════════════════════════════════════════════════════════════════

/** Current keyboard-focused cell position. Null when not using keyboard nav. */
let focusedCell = null;

/**
 * Handles arrow key navigation and Enter to place marks.
 * @param {KeyboardEvent} e
 */
function handleGridNavigation(e) {
  const size = State.gridSize;

  // Initialize focus to center if not set
  if (!focusedCell) {
    const mid = Math.floor(size / 2);
    focusedCell = { r: mid, c: mid };
    updateFocusIndicator();
    return;
  }

  let moved = false;

  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault();
      focusedCell.r = Math.max(0, focusedCell.r - 1);
      moved = true;
      break;
    case 'ArrowDown':
      e.preventDefault();
      focusedCell.r = Math.min(size - 1, focusedCell.r + 1);
      moved = true;
      break;
    case 'ArrowLeft':
      e.preventDefault();
      focusedCell.c = Math.max(0, focusedCell.c - 1);
      moved = true;
      break;
    case 'ArrowRight':
      e.preventDefault();
      focusedCell.c = Math.min(size - 1, focusedCell.c + 1);
      moved = true;
      break;
    case 'Enter':
    case ' ': // Space also works for placement
      e.preventDefault();
      // Only place if cell is empty and it's player's turn
      if (isValidMove(focusedCell.r, focusedCell.c)) {
        makeMove(focusedCell.r, focusedCell.c);
      } else {
        hapticFeedback(HapticPresets.ERROR); // Feedback for invalid move
      }
      return;
  }

  if (moved) {
    // Subtle haptic feedback for keyboard navigation
    hapticFeedback(HapticPresets.BUTTON);
    updateFocusIndicator();
    scrollCellIntoView(focusedCell.r, focusedCell.c);
  }
}

/**
 * Checks if a move is valid at the given position.
 */
function isValidMove(r, c) {
  if (!State.gameActive || State.paused || State.isProcessing) return false;
  if (State.grid[r][c]) return false; // Already occupied
  if (State.mode === 'single' && State.currentPlayer === 'O') return false;
  if (State.isMultiplayer && State.currentPlayer !== State.playerRole) return false;
  return true;
}

/**
 * Updates the visual focus indicator on cells.
 */
function updateFocusIndicator() {
  // Remove existing focus indicators
  document.querySelectorAll('.cell-focus').forEach(el => el.classList.remove('cell-focus'));

  if (!focusedCell) return;

  const cell = Render.getCell(focusedCell.r, focusedCell.c);
  if (cell && !cell.classList.contains('marked')) {
    cell.classList.add('cell-focus');
    cell.setAttribute('aria-selected', 'true');
  }
}

/**
 * Scrolls the focused cell into view if zoomed/panned.
 */
function scrollCellIntoView(r, c) {
  const cell = Render.getCell(r, c);
  if (cell) {
    cell.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
}

/**
 * Resets keyboard focus (call when grid rebuilds or game ends).
 */
export function resetKeyboardFocus() {
  focusedCell = null;
  document.querySelectorAll('.cell-focus').forEach(el => {
    el.classList.remove('cell-focus');
    el.removeAttribute('aria-selected');
  });
}

// Expose for other modules
window.resetKeyboardFocus = resetKeyboardFocus;
