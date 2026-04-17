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
    
    // New Grid Padding and Gap
    const gap = 6;
    const padding = 6;
    const availableForCells = maxDim - (gap * (gridSize - 1)) - (padding * 2);
    
    this.cellSize = Math.max(MIN_CELL_PX, Math.floor(availableForCells / gridSize));

    // Apply grid layout
    const totalSize = (this.cellSize * gridSize) + (gap * (gridSize - 1)) + (padding * 2);
    gridEl.style.gap                 = `${gap}px`;
    gridEl.style.padding             = `${padding}px`;
    gridEl.style.gridTemplateColumns = `repeat(${gridSize}, ${this.cellSize}px)`;
    gridEl.style.width               = `${totalSize}px`;
    gridEl.style.height              = `${totalSize}px`;

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

        } else if (val === 'O') {
          // Pre-existing O — stamp without draw animation
          cell.classList.add('o-marked', 'marked');
          cell.innerHTML = makeOSvg();

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

    // Redraw all persistent strikes after rebuilding the grid
    this.redrawAllStrikes();
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

    const ghostSvg = cell.querySelector('.cell-ghost svg');
    if (ghostSvg && ghostSvg.classList.contains(`${player.toLowerCase()}-mark`)) {
      ghostSvg.classList.remove('ghost');
      cell.innerHTML = ghostSvg.outerHTML;
    } else {
      cell.innerHTML = player === 'X' ? makeXSvg() : makeOSvg();
    }

    cell.classList.add(`${player.toLowerCase()}-marked`, 'marked');

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
    this.drawScoreStrikes([cells], player);
  },

  /**
   * Draws one or more strike lines for newly scored chains.
   * @param {Array<number[][]>} lines
   * @param {'X'|'O'} player
   */
  drawScoreStrikes(lines, player) {
    // Generate random path data for each chain once when it's drawn
    const chainsWithParams = lines.map(cells => ({
      cells,
      extendStart: Math.random() * STRIKE_OVERSHOOT_JITTER + STRIKE_OVERSHOOT_MIN,
      extendEnd: Math.random() * STRIKE_OVERSHOOT_JITTER + STRIKE_OVERSHOOT_MIN,
      xAOffset: Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER,
      yAOffset: Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER,
      xBOffset: Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER,
      yBOffset: Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER,
      curveJitter: Math.random() * (STRIKE_CURVE_JITTER * 2) - STRIKE_CURVE_JITTER,
      curveSign: Math.random() < 0.5 ? 1 : -1
    }));

    // Add new lines to the persistent list
    State.scoredLines.push({ chains: chainsWithParams, player });

    // Redraw all strikes
    this.redrawAllStrikes();
  },

  /**
   * Redraws all persistent strike lines from State.scoredLines.
   */
  redrawAllStrikes() {
    const gridEl = document.getElementById('game-grid');

    // Clear old strikes and cell highlights
    gridEl.querySelectorAll('.win-strike-svg').forEach(s => s.remove());
    document.querySelectorAll('.win-cell').forEach(cell => cell.classList.remove('win-cell'));

    if (State.scoredLines.length === 0) return;

    const cs    = this.cellSize;
    const gap   = 6;
    const padding = 6;
    const total = (cs * State.gridSize) + (gap * (State.gridSize - 1)) + (padding * 2);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
    svg.setAttribute('width',  total);
    svg.setAttribute('height', total);
    svg.classList.add('win-strike-svg');
    svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';

    for (const { chains, player } of State.scoredLines) {
      for (const chain of chains) {
        // Support backward compatibility if the chain is a legacy unparametrised array
        const isLegacy = Array.isArray(chain);
        const cells = isLegacy ? chain : chain.cells;

        if (!cells || !cells.length) continue;

        const [r0, c0] = cells[0];
        const [r1, c1] = cells[cells.length - 1];
        const x1 = padding + c0 * (cs + gap) + cs / 2;
        const y1 = padding + r0 * (cs + gap) + cs / 2;
        const x2 = padding + c1 * (cs + gap) + cs / 2;
        const y2 = padding + r1 * (cs + gap) + cs / 2;

        // Over-shoot and jitter ends for a fast, hand-drawn look
        const dxOrig = x2 - x1;
        const dyOrig = y2 - y1;
        const lenOrig = Math.sqrt(dxOrig * dxOrig + dyOrig * dyOrig);
        const nx = lenOrig > 0 ? dxOrig / lenOrig : 0;
        const ny = lenOrig > 0 ? dyOrig / lenOrig : 0;

        const extendStart = isLegacy ? (Math.random() * STRIKE_OVERSHOOT_JITTER + STRIKE_OVERSHOOT_MIN) : chain.extendStart;
        const extendEnd   = isLegacy ? (Math.random() * STRIKE_OVERSHOOT_JITTER + STRIKE_OVERSHOOT_MIN) : chain.extendEnd;

        const xAOff = isLegacy ? (Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER) : chain.xAOffset;
        const yAOff = isLegacy ? (Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER) : chain.yAOffset;
        const xBOff = isLegacy ? (Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER) : chain.xBOffset;
        const yBOff = isLegacy ? (Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER) : chain.yBOffset;

        const xA = x1 - nx * extendStart + xAOff;
        const yA = y1 - ny * extendStart + yAOff;
        const xB = x2 + nx * extendEnd   + xBOff;
        const yB = y2 + ny * extendEnd   + yBOff;

        // Create a slightly curved path
        const dx = xB - xA;
        const dy = yB - yA;
        const length = Math.sqrt(dx * dx + dy * dy);
        const baseOffset = Math.min(STRIKE_CURVE_BASE, length * 0.08);
        const curveJitter = isLegacy ? (Math.random() * (STRIKE_CURVE_JITTER * 2) - STRIKE_CURVE_JITTER) : chain.curveJitter;
        const curveSign = isLegacy ? (Math.random() < 0.5 ? 1 : -1) : chain.curveSign;
        const offsetMag = baseOffset + curveJitter;
        const offset = offsetMag * curveSign;
        
        const cx = (xA + xB) / 2 - (dy / length) * offset;
        const cy = (yA + yB) / 2 + (dx / length) * offset;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${xA} ${yA} Q ${cx} ${cy} ${xB} ${yB}`);
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('fill', 'none');
        path.classList.add('win-strike-line', player === 'X' ? 'x-strike' : 'o-strike');
        svg.appendChild(path);

        cells.forEach(([r, c]) => this.getCell(r, c)?.classList.add('win-cell'));
      }
    }

    gridEl.style.position = 'relative';
    gridEl.appendChild(svg);
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
