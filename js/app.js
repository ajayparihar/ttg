'use strict';

/* ============================================================
   APP CONTROLLER
   High-level navigation and settings — the bridge between
   the HTML onclick handlers and the game/render layers.
   Everything a button or screen transition needs lives here.
   ============================================================ */

const App = {

  /** Currently visible screen id (without the '-screen' suffix). */
  currentScreen: 'menu',

  /** Mode chosen on the menu but not yet committed to State. */
  selectedMode: 'dual',

  /** Duration chosen on the mode screen but not yet committed to State. */
  selectedDuration: 180,

  /* ---- Screen navigation ---- */

  /**
   * Shows the screen with the given id and hides all others.
   * @param {string} id - Screen name without '-screen' suffix (e.g. 'menu').
   */
  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(`${id}-screen`).classList.add('active');
    this.currentScreen = id;
  },

  /**
   * Navigates to the mode/duration selection screen and labels it
   * with the chosen game mode.
   * @param {'single'|'dual'} mode
   */
  goToMode(mode) {
    this.selectedMode = mode;
    const label = mode === 'single' ? '🤖 Single Player' : '👥 Dual Player';
    document.getElementById('mode-screen-title').textContent = `${label} — Duration`;
    this.showScreen('mode');
  },

  /**
   * Highlights the chosen duration button and advances to the name-input screen.
   * Also hides the Player O field when playing against the AI.
   * @param {number} dur - Duration in seconds; 0 = unlimited.
   */
  selectDuration(dur) {
    this.selectedDuration = dur;

    // Highlight the selected duration button
    document.querySelectorAll('.duration-btn').forEach(btn => {
      btn.classList.toggle('selected', parseInt(btn.dataset.dur, 10) === dur);
    });

    // Short delay lets the selection highlight show before the transition
    setTimeout(() => this.showScreen('name'), 150);

    // Hide the O name field in single-player mode
    document.getElementById('name-o-group').style.display =
      this.selectedMode === 'single' ? 'none' : '';
  },

  /**
   * Navigates back to a previous screen.
   * @param {string} to - Target screen id.
   */
  goBack(to) {
    this.showScreen(to);
  },

  /* ---- Game lifecycle ---- */

  /**
   * Reads the name inputs and commits the chosen mode/duration to State,
   * then initialises a new game.
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
   * Resets all game state to initial values, rebuilds the board, and
   * starts the timer.  Called by startGame() and rematch().
   */
  initGame() {
    clearTimers();

    // Reset State
    State.gridSize      = 3;
    State.grid          = createGrid(3);
    State.currentPlayer = Math.random() < 0.5 ? 'X' : 'O'; // coin-flip first mover
    State.scores        = { X: 0, O: 0 };
    State.timeLeft      = State.duration;
    State.gameActive    = true;
    State.undoUsed      = false;
    State.undoSnapshot  = null;
    State.scoredChains  = new Set();
    State.zoomLevel     = 1.0;
    State.panX          = 0;
    State.panY          = 0;
    State.paused        = false;
    State.lastGridSize  = 3;

    // Sync HUD elements with the new State
    document.getElementById('score-x-name').textContent = State.names.X;
    document.getElementById('score-o-name').textContent = State.names.O;
    document.getElementById('score-x-val').textContent  = '0';
    document.getElementById('score-o-val').textContent  = '0';
    document.getElementById('mode-badge').textContent   =
      State.mode === 'single' ? '🤖 AI' : '👥 Local';

    // Reset undo button
    const undoBtn = document.getElementById('undo-btn');
    undoBtn.disabled = false;
    undoBtn.classList.remove('used');
    undoBtn.title = 'Undo last move (1 use)';

    document.getElementById('ai-thinking').style.display = 'none';

    this.showScreen('game');

    // Defer grid build until the screen layout has settled
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
   * Starts the countdown interval.
   * When the timer expires, ends the game and determines the winner by score.
   * No-ops for unlimited (duration === 0) games.
   */
  startTimer() {
    if (State.duration === 0) {
      document.getElementById('timer-display').classList.add('hidden');
      return;
    }

    document.getElementById('timer-display').classList.remove('hidden');
    Render.updateTimer();

    State.timerInterval = setInterval(() => {
      if (!State.gameActive || State.paused) return;

      State.timeLeft--;
      Render.updateTimer();

      if (State.timeLeft <= 0) {
        clearInterval(State.timerInterval);

        // If still on a clean 3×3 with no points, call it a draw
        const noScore = State.gridSize === 3 && State.scores.X === 0 && State.scores.O === 0;
        if (noScore) {
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

  /* ---- Undo ---- */

  /**
   * Reverts to the snapshot taken before the last human move.
   * Limited to one use per game; disabled during the AI's turn.
   */
  undo() {
    if (State.undoUsed || !State.undoSnapshot || !State.gameActive) return;
    if (State.mode === 'single' && State.currentPlayer === 'O')      return; // AI's turn

    // Cancel any pending AI move
    clearTimeout(State.aiTimeout);
    document.getElementById('ai-thinking').style.display = 'none';

    // Restore snapshot
    const snap          = State.undoSnapshot;
    State.grid          = copyGrid(snap.grid);
    State.scores        = { ...snap.scores };
    State.currentPlayer = snap.currentPlayer;
    State.scoredChains  = new Set(snap.scoredChains);
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

    this.showToast('Undo used! ↩');
  },

  /* ---- Zoom ---- */

  /**
   * Adjusts the zoom level by one step in the given direction.
   * Resets pan to origin when zooming back to 100 %.
   * @param {1|-1} dir - +1 to zoom in, -1 to zoom out.
   */
  zoom(dir) {
    State.zoomLevel = clamp(State.zoomLevel + dir * ZOOM_STEP, 1.0, MAX_ZOOM);

    if (State.zoomLevel === 1.0) {
      State.panX = 0;
      State.panY = 0;
    }

    clampPan();
    Render.setZoomDisplay(State.zoomLevel);
  },

  /* ---- Pause modal ---- */

  /** Opens the pause modal and halts timer/AI. */
  pauseConfirm() {
    State.paused = true;
    document.getElementById('pause-overlay').style.display = 'block';
    document.getElementById('pause-modal').style.display   = 'flex';
  },

  /** Closes the pause modal and resumes the game. */
  resumeGame() {
    State.paused = false;
    document.getElementById('pause-overlay').style.display = 'none';
    document.getElementById('pause-modal').style.display   = 'none';
  },

  /** Quits the current game and returns to the main menu. */
  quitGame() {
    State.gameActive = false;
    clearTimers();
    document.getElementById('pause-overlay').style.display = 'none';
    document.getElementById('pause-modal').style.display   = 'none';
    this.showScreen('menu');
  },

  /* ---- Post-game actions ---- */

  /** Starts a new game with the same settings (from the game-over screen). */
  rematch() {
    this.initGame();
  },

  /** Returns to the main menu from anywhere. */
  goHome() {
    State.gameActive = false;
    clearTimers();
    this.showScreen('menu');
  },

  /* ---- Settings panel ---- */

  /** Slides the settings panel in from the right. */
  openSettings() {
    document.getElementById('settings-panel').classList.add('open');
    document.getElementById('settings-overlay').classList.add('visible');
  },

  /** Slides the settings panel out. */
  closeSettings() {
    document.getElementById('settings-panel').classList.remove('open');
    document.getElementById('settings-overlay').classList.remove('visible');
  },

  /* ---- How-to-play panel ---- */

  /** Opens the how-to-play panel. */
  showHowToPlay() {
    document.getElementById('help-panel').classList.add('open');
    document.getElementById('help-overlay').classList.add('visible');
  },

  /** Closes the how-to-play panel. */
  closeHelp() {
    document.getElementById('help-panel').classList.remove('open');
    document.getElementById('help-overlay').classList.remove('visible');
  },

  /* ---- Theming ---- */

  /**
   * Applies a colour theme to the document root and persists the choice.
   * @param {string} name - Theme key; 'default' removes the data-theme attribute.
   */
  setTheme(name) {
    document.documentElement.dataset.theme = name === 'default' ? '' : name;

    // Mark the active theme button
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === name);
    });

    try { localStorage.setItem('ttg_theme', name); } catch (_) {}
    this.showToast(`Theme: ${name.charAt(0).toUpperCase() + name.slice(1)} 🎨`);
  },

  /* ---- Toast notifications ---- */

  /**
   * Displays a transient notification toast at the bottom of the screen.
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

  /* ---- Persistence ---- */

  /**
   * Restores persisted user preferences (theme) on startup.
   * Silently swallows any storage errors.
   */
  loadSaved() {
    try {
      const theme = localStorage.getItem('ttg_theme') || 'default';
      this.setTheme(theme);
    } catch (_) {}
  },
};
