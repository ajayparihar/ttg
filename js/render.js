'use strict';

/* ============================================================
   RENDER ENGINE
   All DOM reads/writes live here. Game logic must never touch
   the DOM directly — it calls Render methods instead.
   ============================================================ */

const Render = {

  /** Pixel size of each cell on the current board, set during buildGrid(). */
  cellSize: 0,

  /* ---- Grid construction ---- */

  /**
   * Builds (or rebuilds) the full grid in the DOM to match State.grid.
   * Existing marks are stamped in without animation; newly added cells
   * (from grid expansion) get the cellAppear animation.
   *
   * @param {number} gridSize - Target board dimension.
   * @param {number} [oldSize=0] - Previous board size; cells outside this
   *   range receive the new-cell entrance animation.
   */
  buildGrid(gridSize, oldSize = 0) {
    const gridEl    = document.getElementById('game-grid');
    const wrapperEl = document.getElementById('grid-wrapper');

    // Fit the grid inside the available space, respecting a minimum cell size
    const maxW   = wrapperEl.clientWidth  - 32;
    const maxH   = wrapperEl.clientHeight - 80;
    const maxDim = Math.min(maxW, maxH, 640);
    this.cellSize = Math.max(MIN_CELL_PX, Math.floor(maxDim / gridSize));

    // Apply grid layout
    gridEl.style.gridTemplateColumns = `repeat(${gridSize}, ${this.cellSize}px)`;
    gridEl.style.width               = `${this.cellSize * gridSize}px`;
    gridEl.style.height              = `${this.cellSize * gridSize}px`;

    // Rebuild all cells from scratch
    gridEl.innerHTML = '';

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const cell  = document.createElement('div');
        cell.className   = 'cell';
        cell.dataset.r   = r;
        cell.dataset.c   = c;

        // Mark cells that are new due to board expansion
        const isNew = (r >= oldSize || c >= oldSize);
        if (isNew && oldSize > 0) cell.classList.add('new-cell');

        const val = State.grid[r][c];

        if (val === 'X') {
          // Pre-existing X — stamp without draw animation
          cell.classList.add('x-marked', 'marked');
          cell.innerHTML = makeXSvg();
          if (!isNew) this._removeMarkAnimation(cell);

        } else if (val === 'O') {
          // Pre-existing O — stamp without draw animation
          cell.classList.add('o-marked', 'marked');
          cell.innerHTML = makeOSvg();
          if (!isNew) this._removeMarkAnimation(cell);

        } else {
          // Empty cell — add ghost preview and click handler
          const ghost = document.createElement('div');
          ghost.className = 'cell-ghost';
          ghost.innerHTML = State.currentPlayer === 'X' ? makeGhostX() : makeGhostO();
          cell.appendChild(ghost);
          cell.addEventListener('click', handleCellClick);
        }

        gridEl.appendChild(cell);
      }
    }

    this.updateGridBorder();
    this.updateGridSizeBadge();
  },

  /**
   * Removes the draw-on CSS animation from all .mark-path elements inside a cell.
   * Called for pre-existing marks when the board is rebuilt after expansion.
   * @param {HTMLElement} cell
   */
  _removeMarkAnimation(cell) {
    cell.querySelectorAll('.mark-path').forEach(path => {
      path.style.animation       = 'none';
      path.style.strokeDashoffset = '0';
    });
  },

  /* ---- Single cell update ---- */

  /**
   * Updates a single cell after a move without rebuilding the whole board.
   * @param {number} r
   * @param {number} c
   * @param {'X'|'O'} player
   */
  updateCell(r, c, player) {
    const cell = this.getCell(r, c);
    if (!cell) return;

    cell.classList.remove('cell-ghost');
    cell.classList.add(`${player.toLowerCase()}-marked`, 'marked');
    cell.innerHTML = player === 'X' ? makeXSvg() : makeOSvg();

    // Detach click listener — this cell is now occupied
    cell.removeEventListener('click', handleCellClick);
  },

  /* ---- DOM helpers ---- */

  /**
   * Returns the cell element at (r, c) using data attributes.
   * @param {number} r
   * @param {number} c
   * @returns {HTMLElement|null}
   */
  getCell(r, c) {
    return document.querySelector(`[data-r="${r}"][data-c="${c}"]`);
  },

  /* ---- HUD updates ---- */

  /**
   * Applies the current player's colour class to the grid border and
   * the turn indicator pill.
   */
  updateGridBorder() {
    const gridEl  = document.getElementById('game-grid');
    const turnInd = document.getElementById('turn-indicator');
    const cls     = State.currentPlayer === 'X' ? 'turn-x' : 'turn-o';

    gridEl.className  = `game-grid ${cls}`;
    turnInd.className = `turn-indicator ${cls}`;
  },

  /**
   * Updates the "X's Turn / O's Turn" text and refreshes ghost previews
   * on all empty cells to show the new current player's mark.
   */
  updateTurnIndicator() {
    const ti = document.getElementById('turn-indicator');
    ti.textContent = `${State.names[State.currentPlayer]}'s Turn`;
    this.updateGridBorder();

    // Refresh ghost previews for the new current player
    document.querySelectorAll('.cell:not(.marked) .cell-ghost').forEach(ghost => {
      ghost.innerHTML = State.currentPlayer === 'X' ? makeGhostX() : makeGhostO();
    });
  },

  /**
   * Syncs the score display for one player and triggers the pop animation.
   * @param {'X'|'O'} player
   */
  updateScore(player) {
    const key   = player.toLowerCase();
    const val   = document.getElementById(`score-${key}-val`);
    const block = document.getElementById(`score-${key}-block`);

    val.textContent = State.scores[player];

    // Restart the flash animation by forcing a reflow
    block.classList.remove('score-flash');
    void block.offsetWidth; // reflow
    block.classList.add('score-flash');
  },

  /**
   * Formats and renders the countdown timer.
   * Adds the warning class once 30 seconds or fewer remain.
   */
  updateTimer() {
    const el = document.getElementById('timer-display');

    if (State.duration === 0) {
      el.classList.add('hidden');
      return;
    }

    el.classList.remove('hidden');
    const m = Math.floor(State.timeLeft / 60);
    const s = State.timeLeft % 60;
    el.textContent = `${m}:${s.toString().padStart(2, '0')}`;

    if (State.timeLeft <= 30) el.classList.add('warning');
    else                      el.classList.remove('warning');
  },

  /**
   * Updates the grid-size badge (e.g. "4×4") in the HUD.
   */
  updateGridSizeBadge() {
    document.getElementById('grid-size-badge').textContent =
      `${State.gridSize}×${State.gridSize}`;
  },

  /* ---- Win strike overlay ---- */

  /**
   * Draws the animated strike-through line over the winning cells.
   * Removes any previously drawn strike first.
   *
   * @param {number[][]} cells - Array of [row, col] pairs in the winning line.
   * @param {'X'|'O'} player
   */
  drawWinStrike(cells, player) {
    const gridEl = document.getElementById('game-grid');

    // Clear old strikes
    gridEl.querySelectorAll('.win-strike-svg').forEach(s => s.remove());

    const cs    = this.cellSize;
    const total = cs * State.gridSize;

    // Build the SVG overlay
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
    svg.setAttribute('width',  total);
    svg.setAttribute('height', total);
    svg.classList.add('win-strike-svg');
    svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';

    // Compute centre coordinates for the first and last cells in the win line
    const [r0, c0] = cells[0];
    const [r1, c1] = cells[cells.length - 1];
    const x1 = c0 * cs + cs / 2;
    const y1 = r0 * cs + cs / 2;
    const x2 = c1 * cs + cs / 2;
    const y2 = r1 * cs + cs / 2;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', player === 'X' ? 'var(--color-x)' : 'var(--color-o)');
    line.classList.add('win-strike-line');

    svg.appendChild(line);
    gridEl.style.position = 'relative';
    gridEl.appendChild(svg);

    // Highlight the winning cells
    cells.forEach(([r, c]) => this.getCell(r, c)?.classList.add('win-cell'));
  },

  /* ---- Expansion animation ---- */

  /**
   * Briefly animates the grid element when the board size increases.
   */
  animateGridExpand() {
    const gridEl = document.getElementById('game-grid');
    gridEl.classList.add('grid-expanding');
    setTimeout(() => gridEl.classList.remove('grid-expanding'), 500);
  },

  /* ---- Zoom / Pan ---- */

  /**
   * Applies the current zoom level and pan offset to the zoom container,
   * updates the zoom% label, and toggles the "zoom out to play" overlay.
   *
   * @param {number} level - Zoom multiplier (e.g. 1.5 = 150 %).
   */
  setZoomDisplay(level) {
    document.getElementById('zoom-display').textContent = `${Math.round(level * 100)}%`;

    const container = document.getElementById('grid-zoom-container');
    container.style.transform = `translate(${State.panX}px,${State.panY}px) scale(${level})`;

    const lockOverlay = document.getElementById('zoom-lock');
    if (level > 1.0) lockOverlay.classList.add('visible');
    else             lockOverlay.classList.remove('visible');
  },
};
