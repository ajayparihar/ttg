/**
 * @file app.js — Application controller for Tic Tac Grow.
 *
 * Owns all screen navigation, user-facing controls, and ancillary
 * features that are **not** part of the core move-processing loop
 * (which lives in {@link module:game}).
 *
 * Responsibilities:
 *  - **Screen navigation**  — show/hide screen panels.
 *  - **Game lifecycle**     — startGame, initGame, rematch, quit.
 *  - **Countdown timer**    — start, tick, and timeout handling.
 *  - **Undo**               — one-shot rewind of the last human move.
 *  - **Zoom**               — button-driven zoom in/out/reset.
 *  - **Pause modal**        — pause, resume, quit.
 *  - **Settings & themes**  — colour theme selection and persistence.
 *  - **Toast notifications** — transient feedback messages.
 *  - **Screenshot & share**  — html2canvas capture and Web Share API.
 *  - **Persistence**         — save/restore user preferences.
 *
 * @module app
 */

import { State } from './state.js';
import { Render } from './render.js';
import { MODE, ZOOM_STEP, MAX_ZOOM } from './constants.js';
import { createGrid } from './grid.js';
import { clearTimers, triggerAI, endGame } from './game.js';
import { clamp } from './utils.js';
import { clampPan } from './zoom.js';
import { Multiplayer } from './multiplayer.js';

export const App = {

  /**
   * ID of the currently visible screen (without the `-screen` suffix).
   * @type {string}
   */
  currentScreen: 'menu',

  /**
   * Duration (in seconds) chosen on the menu but not yet committed
   * to {@link State.duration}.
   * @type {number}
   */
  selectedDuration: 180,

  // ─────────────────────────────────────────────────────────────────────
  //  Mode defaults
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Pre-loads mode-specific settings before navigating to the next screen.
   *
   * When the {@link MODE} feature flag is `false`, the duration selection
   * screen is skipped entirely and the game defaults to unlimited time.
   *
   * @param {'single'|'dual'} mode - The chosen game mode.
   */
  setupModeDefaults(mode) {
    this.selectedMode = mode;
    if (!MODE) {
      this.selectedDuration = 0;
    }
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Screen navigation
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Shows the screen with the given id and hides all others.
   *
   * Screens are `<div>` elements with class `screen`; the active one
   * receives the `active` class.
   *
   * @param {string} id - Screen name without the `-screen` suffix
   *   (e.g. `'menu'`, `'game'`, `'gameover'`).
   */
  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`${id}-screen`).classList.add('active');
    this.currentScreen = id;
  },

  /**
   * Navigates to the mode/duration selection screen and labels it with
   * the chosen game mode.
   *
   * When {@link MODE} is `false`, skips the duration screen and goes
   * straight to the name-input screen with unlimited duration.
   *
   * @param {'single'|'dual'} mode - `'single'` for AI, `'dual'` for local PvP.
   */
  goToMode(mode) {
    this.setupModeDefaults(mode);

    if (MODE) {
      // Show the duration selection screen with a descriptive title
      const label = mode === 'single' ? 'Single Player' : 'Dual Player';
      document.getElementById('mode-screen-title').textContent = `${label} — Duration`;
      this.showScreen('mode');
    } else {
      // Skip duration selection — go straight to name input
      // Hide the O-name field when playing against the AI
      document.getElementById('name-o-group').style.display =
        this.selectedMode === 'single' ? 'none' : '';

      this.showScreen('name');
    }
  },

  /**
   * Highlights the chosen duration button and advances to the name-input
   * screen.  Also hides the Player O field when playing against the AI.
   *
   * @param {number} dur - Duration in seconds; `0` = unlimited.
   */
  selectDuration(dur) {
    this.selectedDuration = dur;

    // Highlight the selected duration button
    document.querySelectorAll('.duration-btn').forEach(btn => {
      btn.classList.toggle('selected', parseInt(btn.dataset.dur, 10) === dur);
    });

    // Short delay lets the selection highlight show before the transition
    setTimeout(() => this.showScreen('name'), 150);

    // Hide the O-name field in single-player mode
    document.getElementById('name-o-group').style.display =
      this.selectedMode === 'single' ? 'none' : '';
  },

  /**
   * Navigates back to a previous screen.
   * @param {string} to - Target screen id (e.g. `'menu'`).
   */
  goBack(to) {
    this.showScreen(to);
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Game lifecycle
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Reads the name inputs, commits the chosen mode and duration to
   * {@link State}, and initialises a new game.
   *
   * Default names are used when the player leaves the input blank:
   *  - Player X → `"Xi"`.
   *  - Player O → `"AI"` (single-player) or `"Om"` (dual).
   */
  startGame() {
    const nameX = document.getElementById('name-x').value.trim() || 'Xi';
    const nameO = this.selectedMode === 'single'
      ? 'AI'
      : (document.getElementById('name-o').value.trim() || 'Om');

    State.mode     = this.selectedMode;
    State.duration = this.selectedDuration;
    State.names    = { X: nameX, O: nameO };

    this.initGame();
  },

  /**
   * Resets all game state to fresh initial values, rebuilds the board,
   * and starts the countdown timer.
   *
   * Called by both {@link startGame} (new game from menu) and
   * {@link rematch} (replay from the game-over screen).
   *
   * **Initialisation steps:**
   *  1. Clear any running timers.
   *  2. Reset all State properties to defaults.
   *  3. Randomise the first mover with a coin flip.
   *  4. Sync the HUD (scores, badges, undo button).
   *  5. Switch to the game screen.
   *  6. After a 100 ms layout delay, build the grid, set zoom, update
   *     the turn indicator, start the timer, and trigger the AI if needed.
   */
  initGame() {
    clearTimers();

    // ── Reset all mutable State properties ───────────────────────────
    State.gridSize      = 3;
    State.grid          = createGrid(3);
    State.currentPlayer = Math.random() < 0.5 ? 'X' : 'O';   // Coin-flip first mover
    State.scores        = { X: 0, O: 0 };
    State.timeLeft      = State.duration;
    State.gameActive    = true;
    State.undoUsed      = false;
    State.undoSnapshot  = null;
    State.scoredChains  = new Set();
    State.scoredLines   = [];
    State.zoomLevel     = 1.0;
    State.panX          = 0;
    State.panY          = 0;
    State.paused        = false;
    State.lastGridSize  = 3;

    // ── Sync HUD with new State ──────────────────────────────────────
    Render.updateScore('X');
    Render.updateScore('O');
    document.getElementById('mode-badge').textContent =
      State.isMultiplayer ? 'Online' : (State.mode === 'single' ? 'AI' : 'Local');

    // Reset the one-shot undo button
    const undoBtn = document.getElementById('undo-btn');
    undoBtn.disabled = false;
    undoBtn.classList.remove('used');
    undoBtn.title = 'Undo last move (1 use)';
    undoBtn.style.visibility = State.isMultiplayer ? 'hidden' : 'visible';

    document.getElementById('ai-thinking').style.display = 'none';

    this.showScreen('game');

    // ── Deferred grid build (allows screen layout to settle) ─────────
    setTimeout(() => {
      Render.buildGrid(3);
      Render.setZoomDisplay(1.0);
      Render.updateTurnIndicator();
      Render.updateTimer();
      this.startTimer();

      // If the AI was randomly chosen to go first, trigger it immediately
      if (State.mode === 'single' && State.currentPlayer === 'O') {
        triggerAI();
      }

      this.showToast(`${State.names[State.currentPlayer]} goes first!`, 1500);
    }, 100);
  },

  /**
   * Starts the countdown interval that ticks every second.
   *
   * When the timer reaches zero, the game ends:
   *  - On a clean 3×3 with both scores at 0 → draw.
   *  - Otherwise → the player with the higher score wins.
   *
   * No-ops for unlimited (`duration === 0`) games.
   */
  startTimer() {
    if (State.duration === 0) {
      document.getElementById('timer-display').classList.add('hidden');
      return;
    }

    document.getElementById('timer-display').classList.remove('hidden');
    Render.updateTimer();

    State.timerInterval = setInterval(() => {
      // Don't tick while the game is paused or already over
      if (!State.gameActive || State.paused) return;

      State.timeLeft--;
      Render.updateTimer();

      if (State.timeLeft <= 0) {
        clearInterval(State.timerInterval);

        // Determine the winner when time expires
        const noScore = State.gridSize === 3 && State.scores.X === 0 && State.scores.O === 0;
        if (noScore) {
          // Clean 3×3 board with no points scored → fair draw
          endGame('draw', 'timeout');
        } else {
          const winner =
            State.scores.X > State.scores.O ? 'X'    :
            State.scores.O > State.scores.X ? 'O'    : 'draw';
          endGame(winner === 'draw' ? 'draw' : winner, 'timeout');
        }
      }
    }, 1000);
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Undo (one-shot per game)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Reverts the board to the snapshot taken before the last human move.
   *
   * **Restrictions:**
   *  - Limited to one use per game.
   *  - Disabled during the AI's turn.
   *  - Disabled in multiplayer mode.
   *
   * Cancels any pending AI move, restores the snapshot, greys out the
   * undo button, and rebuilds the board.
   */
  undo() {
    if (State.undoUsed || !State.undoSnapshot || !State.gameActive) return;
    if (State.isMultiplayer) return;                                         // Undo is disabled online
    if (State.mode === 'single' && State.currentPlayer === 'O') return;     // Can't undo during AI's turn

    // Cancel any pending AI move
    clearTimeout(State.aiTimeout);
    document.getElementById('ai-thinking').style.display = 'none';

    // Restore the pre-move snapshot
    const snap          = State.undoSnapshot;
    State.grid          = snap.grid;
    State.scores        = { ...snap.scores };
    State.currentPlayer = snap.currentPlayer;
    State.scoredChains  = new Set(snap.scoredChains);
    State.scoredLines   = [...snap.scoredLines];
    State.gridSize      = snap.gridSize;
    State.undoUsed      = true;
    State.undoSnapshot  = null;

    // Grey out the undo button — one use only
    const undoBtn = document.getElementById('undo-btn');
    undoBtn.disabled = true;
    undoBtn.classList.add('used');

    // Rebuild the board and re-sync the HUD
    Render.buildGrid(State.gridSize);
    Render.updateScore('X');
    Render.updateScore('O');
    Render.updateTurnIndicator();
    Render.setZoomDisplay(State.zoomLevel);

    this.showToast('Undo used!');
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Zoom controls
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Adjusts the zoom level by one step in the given direction.
   * Resets pan to origin when zooming back to 100 %.
   *
   * @param {1|-1} dir - `+1` to zoom in, `−1` to zoom out.
   */
  zoom(dir) {
    State.zoomLevel = clamp(State.zoomLevel + dir * ZOOM_STEP, 1.0, MAX_ZOOM);

    // Reset pan when fully zoomed out (prevents off-centre at 100 %)
    if (State.zoomLevel === 1.0) {
      State.panX = 0;
      State.panY = 0;
    }

    clampPan();
    Render.setZoomDisplay(State.zoomLevel);
  },

  /**
   * Resets zoom to 100 % and centres the grid.
   */
  resetZoom() {
    State.zoomLevel = 1.0;
    State.panX = 0;
    State.panY = 0;
    Render.setZoomDisplay(State.zoomLevel);
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Pause modal
  // ─────────────────────────────────────────────────────────────────────

  /** Opens the pause modal overlay and halts the timer and AI. */
  pauseConfirm() {
    State.paused = true;
    document.getElementById('pause-overlay').style.display = 'block';
    document.getElementById('pause-modal').style.display   = 'flex';
  },

  /** Closes the pause modal and resumes gameplay. */
  resumeGame() {
    State.paused = false;
    document.getElementById('pause-overlay').style.display = 'none';
    document.getElementById('pause-modal').style.display   = 'none';
  },

  /**
   * Quits the current game, cleans up timers, and returns to the
   * main menu (or leaves the multiplayer room).
   */
  quitGame() {
    this._exitToMenu();
    document.getElementById('pause-overlay').style.display = 'none';
    document.getElementById('pause-modal').style.display   = 'none';
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Post-game actions
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Starts a new game with the same settings (from the game-over screen).
   *
   * In multiplayer, only the host can trigger a rematch; the guest
   * sees a "Waiting for host…" toast.
   */
  rematch() {
    if (State.isMultiplayer) {
      if (State.playerRole === 'X') {
        Multiplayer.hostStartGame();
      } else {
        App.showToast("Waiting for host to rematch...");
      }
    } else {
      this.initGame();
    }
  },

  /**
   * Returns to the main menu from any screen.
   * Cleans up timers and leaves the multiplayer room if active.
   */
  goHome() {
    this._exitToMenu();
  },

  /**
   * Shared cleanup for quitGame and goHome — stops timers,
   * deactivates the game, and navigates to menu or leaves room.
   * @private
   */
  _exitToMenu() {
    State.gameActive = false;
    clearTimers();
    if (State.isMultiplayer) Multiplayer.leaveRoom();
    else this.showScreen('menu');
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Settings panel
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Toggles a slide-in panel's open/close state.
   *
   * @param {string} panelId   - ID of the panel element.
   * @param {string} overlayId - ID of the backdrop overlay element.
   * @param {boolean} open     - `true` to open, `false` to close.
   * @private
   */
  _togglePanel(panelId, overlayId, open) {
    document.getElementById(panelId).classList.toggle('open', open);
    document.getElementById(overlayId).classList.toggle('visible', open);
  },

  /** Slides the settings panel in from the right. */
  openSettings() { this._togglePanel('settings-panel', 'settings-overlay', true); },

  /** Slides the settings panel out. */
  closeSettings() { this._togglePanel('settings-panel', 'settings-overlay', false); },

  // ─────────────────────────────────────────────────────────────────────
  //  How-to-play panel
  // ─────────────────────────────────────────────────────────────────────

  /** Opens the how-to-play help panel. */
  showHowToPlay() { this._togglePanel('help-panel', 'help-overlay', true); },

  /** Closes the help panel. */
  closeHelp() { this._togglePanel('help-panel', 'help-overlay', false); },

  // ─────────────────────────────────────────────────────────────────────
  //  Theming
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Applies a colour theme to the document root and persists the choice
   * to localStorage.
   *
   * Themes are activated by setting `data-theme` on `<html>`.  CSS
   * custom properties defined under `[data-theme="…"]` selectors
   * override the defaults.
   *
   * @param {string} name - Theme key (e.g. `'ocean'`, `'neon'`).
   *   `'default'` removes the `data-theme` attribute.
   */
  setTheme(name) {
    document.documentElement.dataset.theme = name === 'default' ? '' : name;

    // Highlight the active theme button
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === name);
    });

    try { localStorage.setItem('ttg_theme', name); } catch (_) {}
    this.showToast(`Theme: ${name.charAt(0).toUpperCase() + name.slice(1)}`);
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Toast notifications
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Displays a transient notification toast at the bottom of the screen.
   * The toast auto-removes after the specified duration.
   *
   * @param {string} msg        - Message text.
   * @param {number} [dur=2300] - Milliseconds before auto-removal.
   */
  showToast(msg, dur = 2300) {
    const container = document.getElementById('toast-container');
    const toast     = document.createElement('div');
    toast.className   = 'toast';
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), dur);
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Screenshot & sharing
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Captures a high-resolution screenshot of the game-over card using
   * html2canvas at 3× scale.
   *
   * @param {object} [opts]         - html2canvas overrides.
   * @param {Function} [opts.onclone] - Optional onclone callback.
   * @returns {Promise<HTMLCanvasElement|null>} The captured canvas.
   * @private
   */
  async _captureCard(opts = {}) {
    await document.fonts.ready;
    const card = document.querySelector('.gameover-card');
    if (!card) return null;

    const bgColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg-primary').trim() || '#0a0a0a';

    return html2canvas(card, {
      scale: 3,
      useCORS: true,
      allowTaint: true,
      backgroundColor: bgColor,
      logging: false,
      ...opts
    });
  },

  /**
   * Captures a high-resolution screenshot of the game-over card and
   * triggers a PNG download.
   *
   * Uses html2canvas at 3× scale to preserve the hand-drawn aesthetic,
   * shadows, and theme colours.  Animations and transforms are stripped
   * from the cloned card to prevent rendering artefacts.
   */
  async downloadScreenshot() {
    try {
      const canvas = await this._captureCard({
        onclone: (clonedDoc) => {
          // Strip animations/transforms that can cause rendering glitches
          const clonedCard = clonedDoc.querySelector('.gameover-card');
          if (clonedCard) {
            clonedCard.style.transform  = 'none';
            clonedCard.style.animation  = 'none';
            clonedCard.style.boxShadow  = 'none';
            clonedCard.style.margin     = '0';

            // Force crisp text rendering
            clonedCard.querySelectorAll('*').forEach(el => {
              el.style.textRendering      = 'optimizeLegibility';
              el.style.webkitFontSmoothing = 'antialiased';
            });
          }
        }
      });
      if (!canvas) return;

      // Trigger the download via a temporary <a> element
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const link = document.createElement('a');
      link.download = `TicTacGrow-Result-${State.names.X}-vs-${State.names.O}.png`;
      link.href = dataUrl;
      link.click();

      this.showToast('Result saved!');
    } catch (err) {
      console.error('Screenshot capture failed:', err);
      this.showToast('Failed to generate screenshot.');
    }
  },

  /**
   * Captures the game-over card and opens the native share sheet
   * (Web Share API).
   *
   * Falls back to {@link downloadScreenshot} on platforms that don't
   * support file sharing.  Share text is contextualised to the outcome
   * (win, loss, or draw).
   */
  async shareResult() {
    try {
      const canvas = await this._captureCard();
      if (!canvas) return;

      canvas.toBlob(async (blob) => {
        if (!blob) {
          this.showToast('Could not generate share image.');
          return;
        }

        const file = new File([blob], 'TicTacGrow-Result.png', { type: 'image/png' });

        // Choose share text based on the outcome
        const isWin  = State.scores.X > State.scores.O;
        const isLoss = State.mode === 'single' && State.scores.O > State.scores.X;
        const isDraw = State.scores.X === State.scores.O;

        let shareText = `I just dominated in Tic Tac Grow! Check out the score:`;
        if (isLoss) shareText = `Tough battle in Tic Tac Grow! Check out the score:`;
        if (isDraw) shareText = `A close draw in Tic Tac Grow! Check out the score:`;

        // Attempt native sharing with the image file
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              title: 'Tic Tac Grow',
              text: shareText,
              files: [file]
            });
          } catch (sErr) {
            // User cancelled the share sheet — not an error
            if (sErr.name !== 'AbortError') {
              console.error('Share failed:', sErr);
              this.showToast('Share failed.');
            }
          }
        } else {
          // Fallback: download the image instead
          this.downloadScreenshot();
        }
      }, 'image/png', 1.0);

    } catch (err) {
      console.error('Share capture failed:', err);
      this.showToast('Share failed.');
    }
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Persistence
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Restores persisted user preferences (e.g. theme) on application
   * startup.  Silently swallows any storage errors.
   */
  loadSaved() {
    try {
      const theme = localStorage.getItem('ttg_theme') || 'default';
      this.setTheme(theme);
    } catch (_) {}
  },
};
