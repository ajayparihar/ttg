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
import { ZOOM_STEP, MAX_ZOOM, GOOGLE_SIGNIN_ENABLED } from './constants.js';
import { createGrid } from './grid.js';
import { clearTimers, triggerAI, endGame } from './game.js';
import { clamp, hapticFeedback, hapticPattern, HapticPresets } from './utils.js';
import { clampPan } from './zoom.js';
import { Multiplayer } from './multiplayer.js';
import { Tutorial } from './tutorial.js';

export const App = {

  /**
   * ID of the currently visible screen (without the `-screen` suffix).
   * @type {string}
   */
  currentScreen: 'login',

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

    // Handle offline-mode UI restrictions on the menu
    if (id === 'menu') {
      const multiBtn = document.querySelector('[data-i18n="play_friend"]');
      if (multiBtn) {
        // When Google Sign-in is disabled but anonymous play is allowed,
        // the multiplayer button should still work (uses anonymous auth)
        if (!GOOGLE_SIGNIN_ENABLED) {
          multiBtn.classList.remove('btn-disabled');
          multiBtn.title = "";
          multiBtn.onclick = () => { this.showScreen('multiplayer-lobby'); };
        } else if (State.loginSkipped) {
          multiBtn.classList.add('btn-disabled');
          multiBtn.title = "Login with Google to play online.";
          // Instead of just toast, now trigger the LOGIN popup!
          multiBtn.onclick = (e) => {
            e.stopPropagation();
            Multiplayer.loginWithGoogle();
          };
        } else {
          multiBtn.classList.remove('btn-disabled');
          multiBtn.title = "";
          multiBtn.onclick = () => { this.showScreen('multiplayer-lobby'); };
        }
      }
    }
  },

  /**
   * Starts a local game (single vs AI or dual player).
   * Goes directly to the name-input screen.
   *
   * @param {'single'|'dual'} mode - `'single'` for AI, `'dual'` for local PvP.
   */
  startLocalGame(mode) {
    this.selectedMode = mode;

    // Hide the O-name field when playing against the AI
    document.getElementById('name-o-group').style.display =
      mode === 'single' ? 'none' : '';

    this.showScreen('name');
  },

  /**
   * Wires up the 4-digit OTP input fields for joining rooms.
   * Handles auto-focus, backspace, and automatic joining on completion.
   */
  initOTPInputs() {
    const inputs = document.querySelectorAll('.otp-input');
    inputs.forEach((input, index) => {
      // Focus next on input
      input.addEventListener('input', (e) => {
        const val = e.target.value.toUpperCase();
        e.target.value = val; // Force uppercase

        if (val.length === 1 && index < inputs.length - 1) {
          inputs[index + 1].focus();
        }
        // Auto-join if last box filled
        if (index === inputs.length - 1 && val.length === 1) {
          Multiplayer.joinRoom();
        }
      });

      // Handle backspace
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && index > 0) {
          inputs[index - 1].focus();
        }
        if (e.key === 'Enter' && index === inputs.length - 1 && input.value) {
          Multiplayer.joinRoom();
        }
      });

      // Paste support
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const data = e.clipboardData.getData('text').toUpperCase().trim().slice(0, 4);
        [...data].forEach((char, i) => {
          if (inputs[i]) {
            inputs[i].value = char;
            if (i < inputs.length - 1) inputs[i+1].focus();
          }
        });
        if (data.length === 4) Multiplayer.joinRoom();
      });
    });
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
   * Reads the name inputs, commits the chosen mode to
   * {@link State}, and initialises a new game.
   * Duration is always unlimited (0).
   *
   * Default names are used when the player leaves the input blank:
   *  - Player X → `"Xi"`.
   *  - Player O → `"AI"` (single-player) or `"Om"` (dual).
   */
  startGame() {
    const sanitize = (str) => str.replace(/[<>&"']/g, '');
    const nameX = sanitize(document.getElementById('name-x').value.trim()) || 'Xi';
    const nameO = this.selectedMode === 'single'
      ? 'AI'
      : (sanitize(document.getElementById('name-o').value.trim()) || 'Om');

    State.mode     = this.selectedMode;
    State.duration = 0;
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
   *  4. Sync the HUD (scores, badges).
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
    State.scoredChains  = new Set();
    State.scoredLines   = [];
    State.zoomLevel     = 1.0;
    State.panX          = 0;
    State.panY          = 0;
    State.paused        = false;
    State.lastGridSize  = 3;
    State.lastMove      = null;
    State.isProcessing  = false; // Ensure input is unlocked at game start

    // ── Sync HUD with new State ──────────────────────────────────────
    Render.updateScore('X');
    Render.updateScore('O');

    // Show/hide multiplayer-only reactions
    const reactContainer = document.getElementById('reaction-container');
    if (reactContainer) {
      reactContainer.style.display = State.isMultiplayer ? 'flex' : 'none';
      if (State.isMultiplayer) this.updateReactionTray();
    }

    this.showScreen('game');

    // ── Build grid immediately ─────────
    Render.buildGrid(3);
    Render.setZoomDisplay(1.0);
    Render.updateTurnIndicator();

    // If the AI was randomly chosen to go first, trigger it immediately
    if (State.mode === 'single' && State.currentPlayer === 'O') {
      triggerAI();
    }

    this.showToast(`${State.names[State.currentPlayer]} goes first!`, 1500);
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
    const prevZoom = State.zoomLevel;
    State.zoomLevel = clamp(State.zoomLevel + dir * ZOOM_STEP, 1.0, MAX_ZOOM);

    // Haptic feedback when zoom level actually changes
    if (State.zoomLevel !== prevZoom) {
      hapticFeedback(HapticPresets.BUTTON);
    }

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

    // Haptic feedback for reset zoom
    hapticFeedback(HapticPresets.BUTTON);
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
  async quitGame() {
    await this._exitToMenu();
    document.getElementById('pause-overlay').style.display = 'none';
    document.getElementById('pause-modal').style.display   = 'none';
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Post-game actions
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Starts a new game with the same settings (from the game-over screen).
   *
   * In multiplayer, sends a rematch request to the opponent.
   * Both players must approve before the game starts.
   */
  rematch() {
    if (State.isMultiplayer) {
      // Send rematch request to opponent
      Multiplayer.requestRematch();
    } else {
      this.initGame();
    }
  },

  /**
   * Shows the rematch request popup with themed styling.
   * Called when the opponent requests a rematch.
   * @param {string} opponentName - Name of the opponent requesting rematch.
   */
  showRematchPopup(opponentName) {
    if (State.rematchPopupOpen) return;
    State.rematchPopupOpen = true;

    const overlay = document.getElementById('rematch-overlay');
    const modal = document.getElementById('rematch-modal');
    const title = document.getElementById('rematch-title');
    const subtitle = document.getElementById('rematch-subtitle');
    const status = document.getElementById('rematch-status');

    if (title) title.textContent = 'Rematch Request';
    if (subtitle) subtitle.textContent = `${opponentName} wants a rematch!`;
    if (status) status.textContent = '';
    if (modal) modal.classList.remove('waiting');

    if (overlay) overlay.style.display = 'block';
    if (modal) modal.style.display = 'flex';
  },

  /**
   * Shows the waiting for opponent popup after requesting a rematch.
   */
  showRematchWaiting() {
    if (State.rematchPopupOpen) return;
    State.rematchPopupOpen = true;

    const overlay = document.getElementById('rematch-overlay');
    const modal = document.getElementById('rematch-modal');
    const title = document.getElementById('rematch-title');
    const subtitle = document.getElementById('rematch-subtitle');
    const acceptBtn = document.getElementById('rematch-accept-btn');
    const declineBtn = document.getElementById('rematch-decline-btn');
    const status = document.getElementById('rematch-status');

    if (title) title.textContent = 'Rematch Requested';
    if (subtitle) subtitle.textContent = 'Waiting for opponent to accept...';
    if (status) status.textContent = '';
    if (modal) modal.classList.add('waiting');

    // Hide buttons in waiting state
    if (acceptBtn) acceptBtn.style.display = 'none';
    if (declineBtn) declineBtn.style.display = 'none';

    if (overlay) overlay.style.display = 'block';
    if (modal) modal.style.display = 'flex';
  },

  /**
   * Hides the rematch popup and resets its state.
   */
  hideRematchPopup() {
    State.rematchPopupOpen = false;

    const overlay = document.getElementById('rematch-overlay');
    const modal = document.getElementById('rematch-modal');
    const acceptBtn = document.getElementById('rematch-accept-btn');
    const declineBtn = document.getElementById('rematch-decline-btn');

    if (overlay) overlay.style.display = 'none';
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('waiting');
    }

    // Restore buttons for next time
    if (acceptBtn) acceptBtn.style.display = '';
    if (declineBtn) declineBtn.style.display = '';
  },

  /**
   * Updates the rematch popup status text.
   * @param {string} message - Status message to display.
   */
  updateRematchStatus(message) {
    const status = document.getElementById('rematch-status');
    if (status) status.textContent = message;
  },

  /**
   * Returns to the main menu from any screen.
   * Cleans up timers and leaves the multiplayer room if active.
   */
  async goHome() {
    await this._exitToMenu();
  },

  /**
   * Shared cleanup for quitGame and goHome — stops timers,
   * deactivates the game, and navigates to menu or leaves room.
   * @private
   */
  async _exitToMenu() {
    State.gameActive = false;
    clearTimers();
    Tutorial.clear(); // Clean up any active tutorial timeouts
    if (State.isMultiplayer) await Multiplayer.leaveRoom();
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
  openSettings() {
    this._togglePanel('settings-panel', 'settings-overlay', true);
    this._updateSoundButton(); // Ensure sound button shows current state
    this._updateStatsUI(); // Update meta-progression stats
  },

  _updateStatsUI() {
    try {
      const saved = JSON.parse(localStorage.getItem('ttg_stats') || '{}');
      const elPlayed = document.getElementById('stat-games-played');
      const elScore = document.getElementById('stat-highest-score');
      const elGrid = document.getElementById('stat-largest-grid');

      const played = saved.gamesPlayed || 0;
      const hscore = saved.highestScore || 0;

      if (elPlayed) elPlayed.textContent = played;
      if (elScore) elScore.textContent = hscore;
      if (elGrid) elGrid.textContent = saved.largestGrid ? `${saved.largestGrid}×${saved.largestGrid}` : 'N/A';

    } catch (err) {
      console.warn('Stats UI update failed:', err);
      this.showToast('Failed to load statistics.');
    }
  },

  /** Slides the settings panel out. */
  closeSettings() { this._togglePanel('settings-panel', 'settings-overlay', false); },

  // ─────────────────────────────────────────────────────────────────────
  //  User Profile & Auth Flow
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Proceeds to the main menu without a Google account.
   * Uses anonymous auth for online play without Google profile.
   */
  skipLogin() {
    State.loginSkipped = true;
    Multiplayer.initId(); // Initialize anonymous auth
    this.showScreen('menu');
  },

  /**
   * Escapes HTML special characters to prevent XSS injection.
   * @param {string} str - Raw string that may contain HTML.
   * @returns {string} Escaped string safe for HTML insertion.
   * @private
   */
  _escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  /** Updates the menu UI with Google profile data if logged in. */
  updateUserUI() {
    const container = document.getElementById('user-auth');
    if (!container) return;

    // When Google Sign-in is disabled, hide the auth UI entirely
    if (!GOOGLE_SIGNIN_ENABLED) {
      container.style.display = 'none';
      return;
    }

    if (State.loginSkipped) {
      container.innerHTML = `
        <div class="user-profile guest" onclick="Multiplayer.loginWithGoogle()">
          <div class="user-avatar guest-avatar">
            <i class="fa-solid fa-user-secret"></i>
          </div>
          <div class="user-info">
            <span class="user-name">Guest Player</span>
            <span class="user-action-link">Connect Google</span>
          </div>
        </div>
      `;
      return;
    }

    if (!State.userProfile) return;

    // Build DOM safely to prevent XSS from malicious profile data
    const profile = State.userProfile;
    const wrapper = document.createElement('div');
    wrapper.className = 'user-profile';

    const img = document.createElement('img');
    img.src = profile.photo || '';
    img.alt = 'Profile';
    img.className = 'user-avatar';
    // Validate image URL scheme to prevent javascript: protocol injection
    if (img.src && !img.src.match(/^https?:\/\//i)) {
      img.src = '';
    }

    const info = document.createElement('div');
    info.className = 'user-info';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'user-name';
    nameSpan.textContent = profile.name || 'User';

    const btn = document.createElement('button');
    btn.className = 'user-logout-btn';
    btn.textContent = 'Sign Out';
    btn.onclick = () => Multiplayer.logout();

    info.appendChild(nameSpan);
    info.appendChild(btn);
    wrapper.appendChild(img);
    wrapper.appendChild(info);

    container.innerHTML = '';
    container.appendChild(wrapper);

    // Hide login button on other screens if needed
    const loginBtn = document.getElementById('google-login-btn');
    if (loginBtn) loginBtn.style.display = 'none';
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Emoji Customization
  // ─────────────────────────────────────────────────────────────────────

  /** Opens the emoji customization panel. */
  openEmojiPanel() {
    this._togglePanel('emoji-panel', 'emoji-overlay', true);
    this.updateEmojiUI();
  },

  /** Closes the emoji panel. */
  closeEmojiPanel() {
    this._togglePanel('emoji-panel', 'emoji-overlay', false);
    // Refresh the in-game tray in case they changed during a match
    this.updateReactionTray();
  },

  /**
   * Re-renders the active slots and storage grid in the customization panel.
   */
  updateEmojiUI() {
    const slotsCont = document.getElementById('emoji-active-slots');
    const storageCont = document.getElementById('emoji-storage-grid');
    if (!slotsCont || !storageCont) return;

    // Render 5 Slots
    slotsCont.innerHTML = '';
    State.activeEmojis.forEach((emoji, i) => {
      const slot = document.createElement('div');
      slot.className = `emoji-slot ${this._selectedEmojiSlot === i ? 'selected' : ''}`;
      slot.textContent = emoji;
      slot.onclick = () => {
        hapticFeedback(HapticPresets.BUTTON);
        this._selectedEmojiSlot = i;
        this.updateEmojiUI();
      };
      slotsCont.appendChild(slot);
    });

    // Render Storage
    storageCont.innerHTML = '';
    State.emojiPack.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'storage-item';
      btn.textContent = emoji;
      // Add 'equipped' class if this emoji is in activeEmojis
      if (State.activeEmojis.includes(emoji)) btn.classList.add('equipped');
      
      btn.onclick = () => this.equipEmoji(emoji);
      storageCont.appendChild(btn);
    });
  },

  /**
   * Places the chosen emoji into the currently selected customization slot.
   * @param {string} emoji - The emoji character to equip.
   */
  equipEmoji(emoji) {
    if (this._selectedEmojiSlot === undefined) {
      hapticFeedback(HapticPresets.ERROR);
      this.showToast("Select a slot first!");
      return;
    }

    // Haptic feedback for equipping emoji
    hapticFeedback(HapticPresets.TAP);
    
    // Replace emoji in the active array
    State.activeEmojis[this._selectedEmojiSlot] = emoji;
    
    // Save to localStorage
    try {
      localStorage.setItem('ttg_emojis', JSON.stringify(State.activeEmojis));
    } catch (err) {
      console.warn('Failed to save emojis:', err);
      this.showToast('Failed to save emoji preferences.');
    }

    this.updateEmojiUI();
    this.showToast("Emoji Equipped!");
  },

  /**
   * Rebuilds the in-game reaction tray using the player's 5 active emojis.
   */
  updateReactionTray() {
    const tray = document.getElementById('reaction-tray');
    if (!tray) return;

    tray.innerHTML = '';
    State.activeEmojis.forEach(emoji => {
      const btn = document.createElement('button');
      btn.textContent = emoji;
      btn.onclick = () => {
        hapticFeedback(HapticPresets.TAP);
        Multiplayer.sendReaction(emoji);
      };
      tray.appendChild(btn);
    });
  },

  _selectedEmojiSlot: 0,

  // ─────────────────────────────────────────────────────────────────────
  //  How-to-play panel
  // ─────────────────────────────────────────────────────────────────────

  /** Opens the how-to-play help panel. */
  showHowToPlay() { this._togglePanel('help-panel', 'help-overlay', true); },

  /** Closes the help panel. */
  closeHelp() { this._togglePanel('help-panel', 'help-overlay', false); },

  /** Starts interactive tutorial */
  startTutorial() {
    this.closeHelp();
    this.selectedMode = 'dual';
    State.names = { X: 'You', O: 'Tutor' };
    State.mode = 'dual';
    State.duration = 0;
    this.initGame();
    setTimeout(() => {
      Tutorial.start();
    }, 200);
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Theming
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Sets the default game mode preference and persists it.
   * @param {'single'|'dual'} mode - The preferred game mode.
   */
  setGameMode(mode) {
    // Haptic feedback for mode selection
    hapticFeedback(HapticPresets.BUTTON);

    // Update button active states
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Save preference
    try {
      localStorage.setItem('ttg_gamemode', mode);
      this.showToast(`Default mode: ${mode === 'single' ? 'Single Player' : 'Dual Player'}`);
    } catch (err) {
      console.warn('Failed to save game mode:', err);
      this.showToast('Failed to save game mode preference.');
    }
  },

  /**
   * Applies a colour theme to the document root and persists the choice.
   * Checks locks first.
   * @param {string} name - Theme key.
   * @param {boolean} [silent=false] - If true, skip haptic feedback (for init).
   */
  setTheme(name, silent = false) {
    // Haptic feedback for theme selection (skip during initialization)
    if (!silent) hapticFeedback(HapticPresets.BUTTON);

    document.documentElement.dataset.theme = name;

    // Highlight the active theme button
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === name);
    });

    try { localStorage.setItem('ttg_theme', name); } catch (err) {
      console.warn('Failed to save theme:', err);
      this.showToast('Failed to save theme preference.');
    }
    this.showToast(`Theme: ${name.charAt(0).toUpperCase() + name.slice(1)}`);
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Sound toggle
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Toggles sound effects on/off and persists the setting.
   */
  toggleSound() {
    // Haptic feedback for sound toggle
    hapticFeedback(HapticPresets.BUTTON);

    State.soundEnabled = !State.soundEnabled;
    this._updateSoundButton();

    try { localStorage.setItem('ttg_sound', State.soundEnabled ? 'on' : 'off'); } catch (err) {
      console.warn('Failed to save sound setting:', err);
      this.showToast('Failed to save sound preference.');
    }
    this.showToast(State.soundEnabled ? 'Sound On' : 'Sound Muted');
  },

  /**
   * Updates the sound toggle button UI to reflect current state.
   * @private
   */
  _updateSoundButton() {
    const btn = document.getElementById('sound-toggle-btn');
    const icon = document.getElementById('sound-icon');
    const label = document.getElementById('sound-label');

    if (!btn || !icon || !label) return;

    if (State.soundEnabled) {
      btn.classList.remove('muted');
      icon.className = 'fa-solid fa-volume-high';
      label.textContent = 'Sound On';
    } else {
      btn.classList.add('muted');
      icon.className = 'fa-solid fa-volume-xmark';
      label.textContent = 'Sound Off';
    }
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

    // Also announce to screen readers
    this.announceToScreenReader(msg);

    // Smooth fade out
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 500);
    }, dur);
  },

  /**
   * Announces a message to screen readers via the aria-live region.
   * @param {string} msg - Message to announce.
   */
  announceToScreenReader(msg) {
    const srEl = document.getElementById('sr-announce');
    if (srEl) {
      srEl.textContent = msg;
      // Clear after announcement to avoid repetition
      setTimeout(() => { srEl.textContent = ''; }, 1000);
    }
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
   * Restores persisted user preferences (e.g. theme, sound) on application
   * startup.  Silently swallows any storage errors.
   * Auto-detects system dark/light preference if no saved theme.
   */
  loadSaved() {
    try {
      const savedTheme = localStorage.getItem('ttg_theme');
      if (savedTheme) {
        this.setTheme(savedTheme, true); // silent: no haptic during init
      } else {
        // Auto-detect system preference on first visit
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;

        if (prefersLight) {
          // Use DAG Light for light mode preference
          this.setTheme('dag-light', true); // silent: no haptic during init
        } else {
          // Use DAG Dark as default (also for dark mode or no preference)
          this.setTheme('dag-dark', true); // silent: no haptic during init
        }
      }
    } catch (err) {
      console.warn('Failed to load theme:', err);
    }

    try {
      const savedMode = localStorage.getItem('ttg_gamemode');
      if (savedMode) {
        this.setGameMode(savedMode);
      }
    } catch (err) {
      console.warn('Failed to load game mode:', err);
    }

    // First visit tutorial check
    try {
      const tutorialDone = localStorage.getItem('ttg_tutorial_done');
      if (!tutorialDone) {
        // Quietly wait for user to find it themselves or use a subtle hint later
      }
    } catch (err) {
      console.warn('Failed to load tutorial state:', err);
    }

    try {
      const sound = localStorage.getItem('ttg_sound');
      if (sound === 'off') {
        State.soundEnabled = false;
      }
      this._updateSoundButton();
    } catch (err) {
      console.warn('Failed to load sound setting:', err);
    }

    try {
      const savedEmojis = localStorage.getItem('ttg_emojis');
      if (savedEmojis) {
        State.activeEmojis = JSON.parse(savedEmojis);
      }
      this.updateReactionTray();
    } catch (err) {
      console.warn('Failed to load emojis:', err);
    }

    // Init OTP input behavior for Ring ID
    App.initOtpInputs();
  },

  /**
   * Initialize OTP-style input behavior for the Ring ID input
   * - Auto-advance to next input on character entry
   * - Backspace moves to previous input when empty
   * - Paste support to fill all 4 boxes
   * - Only allows alphanumeric characters
   */
  initOtpInputs() {
    const container = document.getElementById('otp-container');
    if (!container) return;

    const inputs = container.querySelectorAll('.otp-input');

    inputs.forEach((input, index) => {
      // Handle character input
      input.addEventListener('input', (e) => {
        const value = e.target.value;

        // Only allow alphanumeric, auto-convert to uppercase
        if (!/^[a-zA-Z0-9]$/.test(value)) {
          e.target.value = value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 1).toUpperCase();
          return;
        }

        e.target.value = value.toUpperCase();
        e.target.classList.add('filled');

        // Auto-advance to next input
        if (e.target.value && index < inputs.length - 1) {
          inputs[index + 1].focus();
        }

        // Auto-join when all 4 digits filled (optional - can be enabled)
        // const allFilled = Array.from(inputs).every(i => i.value);
        // if (allFilled) Multiplayer.joinRoom();
      });

      // Handle keyboard navigation
      input.addEventListener('keydown', (e) => {
        // Backspace on empty input moves focus to previous
        if (e.key === 'Backspace' && !e.target.value && index > 0) {
          e.preventDefault();
          inputs[index - 1].focus();
          inputs[index - 1].value = '';
          inputs[index - 1].classList.remove('filled');
        }

        // Left arrow moves to previous input
        if (e.key === 'ArrowLeft' && index > 0) {
          e.preventDefault();
          inputs[index - 1].focus();
        }

        // Right arrow moves to next input
        if (e.key === 'ArrowRight' && index < inputs.length - 1) {
          e.preventDefault();
          inputs[index + 1].focus();
        }

        // Enter triggers join
        if (e.key === 'Enter') {
          e.preventDefault();
          Multiplayer.joinRoom();
        }
      });

      // Handle paste event
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasteData = (e.clipboardData || window.clipboardData).getData('text');
        const cleaned = pasteData.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4);

        // Fill inputs with pasted characters
        cleaned.split('').forEach((char, i) => {
          if (inputs[i]) {
            inputs[i].value = char;
            inputs[i].classList.add('filled');
          }
        });

        // Focus the appropriate input
        if (cleaned.length < 4 && inputs[cleaned.length]) {
          inputs[cleaned.length].focus();
        } else if (cleaned.length === 4) {
          inputs[3].focus();
        }
      });

      // Focus handling - select all text when focused for easy replacement
      input.addEventListener('focus', () => {
        input.select();
      });
    });
  },
};
