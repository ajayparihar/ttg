/**
 * @file render.js — DOM rendering engine for Tic Tac Grow.
 *
 * This module is the **only place** that directly manipulates the game DOM.
 * Every other module writes to {@link module:state|State} and then calls
 * a Render method to synchronise the UI.
 *
 * Responsibilities:
 *  - **Grid construction** — builds and rebuilds the CSS-Grid board.
 *  - **Cell updates**      — stamps marks and manages ghost hover previews.
 *  - **HUD updates**       — turn indicator, scores, timer, grid-size badge.
 *  - **Strike overlay**    — draws SVG strike-through lines for scored chains.
 *  - **Zoom display**      — applies CSS transforms for zoom/pan and manages
 *                             the "Reset Zoom" button visibility.
 *
 * A circular dependency exists with game.js (Render needs the cell-click
 * handler, and game.js needs Render).  This is resolved via
 * {@link setCellClickHandler}, which game.js calls once at module load.
 *
 * @module render
 */

import { State } from './state.js';
import {
  MIN_CELL_PX,
  STRIKE_OVERSHOOT_MIN,
  STRIKE_OVERSHOOT_JITTER,
  STRIKE_POS_JITTER,
  STRIKE_CURVE_BASE,
  STRIKE_CURVE_JITTER
} from './constants.js';
import { makeXSvg, makeOSvg, makeGhostX, makeGhostO } from './svg.js';
import { resetKeyboardFocus } from './main.js';
import { i18n } from './i18n.js';

// ---------------------------------------------------------------------------
// Grid layout constants (shared by buildGrid and redrawAllStrikes)
// ---------------------------------------------------------------------------

/** Pixel gap between grid cells. */
const GRID_GAP = 6;

/** Pixel padding around the grid edge. */
const GRID_PADDING = 6;

// ---------------------------------------------------------------------------
// Circular-dependency bridge
// ---------------------------------------------------------------------------

/**
 * Reference to the cell-click handler, injected by game.js at load time
 * via {@link setCellClickHandler}.
 * @type {Function|null}
 * @private
 */
let onCellClick = null;

/**
 * Registers the click handler that will be attached to every empty cell.
 * Called once by game.js to break the circular dependency.
 *
 * @param {Function} handler - The `handleCellClick` function from game.js.
 */
export function setCellClickHandler(handler) {
  onCellClick = handler;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Render module
// ═══════════════════════════════════════════════════════════════════════════

export const Render = {

  /**
   * Pixel size of each cell on the current board.
   * Computed during {@link buildGrid} and used by {@link redrawAllStrikes}
   * to position strike-line endpoints.
   * @type {number}
   */
  cellSize: 0,

  // ─────────────────────────────────────────────────────────────────────
  //  Grid construction
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Builds (or fully rebuilds) the grid DOM to match the current
   * {@link State.grid}.
   *
   * **Layout algorithm:**
   *  1. Compute the largest cell size that fits inside the wrapper
   *     (minus padding and gaps), floored at {@link MIN_CELL_PX}.
   *  2. Apply CSS Grid properties (gap, padding, template columns).
   *  3. Create a `<div class="cell">` for each cell:
   *     - Occupied cells receive a static mark SVG (no draw animation).
   *     - Empty cells receive a ghost hover preview and a click handler.
   *  4. Cells beyond `oldSize` get a `new-cell` class for the entrance
   *     animation (used during grid expansion).
   *
   * After building, refreshes the grid border, size badge, and all
   * persistent strike lines.
   *
   * @param {number} gridSize       - Target board dimension (side length).
   * @param {number} [oldSize=0]    - Previous board size; cells outside
   *   this range receive the entrance animation.
   */
  buildGrid(gridSize, oldSize = 0) {
    const gridEl    = document.getElementById('game-grid');
    const wrapperEl = document.getElementById('grid-wrapper');

    // --- Compute cell size to fit inside wrapper ---
    const maxW   = wrapperEl.clientWidth  - 32;    // horizontal padding
    const maxH   = wrapperEl.clientHeight - 80;    // vertical padding
    const maxDim = Math.min(maxW, maxH, 640);      // cap at 640 px total

    const gap     = GRID_GAP;
    const padding = GRID_PADDING;
    const availableForCells = maxDim - (gap * (gridSize - 1)) - (padding * 2);

    this.cellSize = Math.max(MIN_CELL_PX, Math.floor(availableForCells / gridSize));

    // --- Apply CSS Grid layout properties ---
    const totalSize = (this.cellSize * gridSize) + (gap * (gridSize - 1)) + (padding * 2);
    gridEl.style.gap                 = `${gap}px`;
    gridEl.style.padding             = `${padding}px`;
    // Use 1fr to evenly distribute space and avoid sub-pixel gaps
    gridEl.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`;
    gridEl.style.gridTemplateRows    = `repeat(${gridSize}, 1fr)`;
    gridEl.style.width               = `${totalSize}px`;
    gridEl.style.height              = `${totalSize}px`;

    // --- Rebuild all cell elements from scratch ---
    gridEl.innerHTML = '';

    // Coordinate labels removed per user request

    for (let r = 0; r < gridSize; r++) {
      for (let c = 0; c < gridSize; c++) {
        const cell  = document.createElement('div');
        cell.className   = 'cell';
        cell.dataset.r   = r;
        cell.dataset.c   = c;
        cell.setAttribute('role', 'button');
        cell.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}, empty`);
        cell.setAttribute('tabindex', '-1');

        // Flag cells added by grid expansion for entrance animation
        const isNew = (r >= oldSize || c >= oldSize);
        if (isNew && oldSize > 0) cell.classList.add('new-cell');

        const val = State.grid[r][c];

        if (val === 'X') {
          // Pre-existing X — stamp instantly without draw animation
          cell.classList.add('x-marked', 'marked');
          cell.innerHTML = makeXSvg();

        } else if (val === 'O') {
          // Pre-existing O — stamp instantly without draw animation
          cell.classList.add('o-marked', 'marked');
          cell.innerHTML = makeOSvg();

        } else {
          // Empty cell — attach ghost hover preview and click handler
          const ghost = document.createElement('div');
          ghost.className = 'cell-ghost';
          ghost.innerHTML = this.getGhostHtml();
          cell.appendChild(ghost);
          if (onCellClick) cell.addEventListener('click', onCellClick);
        }

        gridEl.appendChild(cell);
      }
    }

    // Refresh dependent UI elements
    this.updateGridBorder();
    this.updateGridSizeBadge();

    // Show coordinate labels (A1, B2...) only for 5x5 and larger grids
    if (gridSize >= 5) {
      this._addGridCoordinates(gridEl, gridSize, gap, padding);
    }

    // Redraw all persistent strike lines after the DOM rebuild
    this.redrawAllStrikes();

    // Reset keyboard navigation focus since DOM was rebuilt
    resetKeyboardFocus();
  },

  /**
   * Adds A1, B2 style coordinate labels around the grid edges.
   * Only shown for 5x5 and larger grids to help with communication.
   * @private
   */
  _addGridCoordinates(gridEl, gridSize, gap, padding) {
    // Column labels (A, B, C...) at top
    for (let c = 0; c < gridSize; c++) {
      const label = document.createElement('div');
      label.className = 'grid-coord grid-coord-col';
      label.textContent = this._numberToLetter(c);
      label.style.position = 'absolute';
      label.style.top = `${padding - 18}px`;
      label.style.left = `${padding + c * (this.cellSize + gap) + this.cellSize / 2}px`;
      label.style.transform = 'translateX(-50%)';
      gridEl.appendChild(label);
    }

    // Row labels (1, 2, 3...) at left
    for (let r = 0; r < gridSize; r++) {
      const label = document.createElement('div');
      label.className = 'grid-coord grid-coord-row';
      label.textContent = (r + 1).toString();
      label.style.position = 'absolute';
      label.style.left = `${padding - 20}px`;
      label.style.top = `${padding + r * (this.cellSize + gap) + this.cellSize / 2}px`;
      label.style.transform = 'translateY(-50%)';
      gridEl.appendChild(label);
    }
  },

  /**
   * Converts 0-indexed number to spreadsheet-style column letter(s).
   * 0=A, 25=Z, 26=AA, 27=AB, etc.
   * @private
   */
  _numberToLetter(n) {
    let result = '';
    n++; // Convert to 1-based
    while (n > 0) {
      n--; // Adjust because A=1 in this system
      result = String.fromCharCode(65 + (n % 26)) + result;
      n = Math.floor(n / 26);
    }
    return result;
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Single-cell update
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Updates a single cell's DOM after a move, without rebuilding the
   * entire board.
   *
   * If the cell already shows a ghost preview matching the player's mark,
   * the ghost is promoted to a solid mark (preserving its random transform
   * for visual continuity).  Otherwise a fresh mark SVG is generated.
   *
   * @param {number}    r      - Row index.
   * @param {number}    c      - Column index.
   * @param {'X'|'O'}   player - Mark to place.
   */
  updateCell(r, c, player) {
    const cell = this.getCell(r, c);
    if (!cell) return;

    // Check if the ghost preview matches — if so, promote it in place
    const ghostSvg = cell.querySelector('.cell-ghost svg');
    if (ghostSvg && ghostSvg.classList.contains(`${player.toLowerCase()}-mark`)) {
      ghostSvg.classList.remove('ghost');
      cell.innerHTML = ghostSvg.outerHTML;
    } else {
      cell.innerHTML = player === 'X' ? makeXSvg() : makeOSvg();
    }

    cell.classList.add(`${player.toLowerCase()}-marked`, 'marked');
    cell.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}, ${player === 'X' ? 'X mark' : 'O mark'}`);
    cell.setAttribute('aria-pressed', 'true');

    // Detach click listener — this cell is now permanently occupied
    if (onCellClick) cell.removeEventListener('click', onCellClick);
  },

  // ─────────────────────────────────────────────────────────────────────
  //  DOM helpers
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Locates the cell element at board position (r, c) using data attributes.
   *
   * @param {number} r - Row index.
   * @param {number} c - Column index.
   * @returns {HTMLElement|null} The cell `<div>`, or `null` if not found.
   */
  getCell(r, c) {
    return document.querySelector(`[data-r="${r}"][data-c="${c}"]`);
  },

  // ─────────────────────────────────────────────────────────────────────
  //  HUD updates
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Applies the current player's colour class to both the grid border
   * and the turn-indicator pill.
   *
   * Also toggles a `waiting` class on the grid when the local player
   * cannot interact (AI's turn, opponent's turn in multiplayer, or
   * while a move is being processed).
   */
  updateGridBorder() {
    const gridEl  = document.getElementById('game-grid');
    const turnInd = document.getElementById('turn-indicator');
    const cls     = State.currentPlayer === 'X' ? 'turn-x' : 'turn-o';

    // Determine whether the grid should be in a non-interactive "waiting" state
    const isAiTurn       = State.mode === 'single' && State.currentPlayer === 'O';
    const isMultiwaiting = State.isMultiplayer && State.currentPlayer !== State.playerRole;
    const isWaiting      = isAiTurn || isMultiwaiting || State.isProcessing;

    gridEl.className = `game-grid ${cls} ${isWaiting ? 'waiting' : ''}`;

    // Preserve the hidden class if the turn indicator was previously hidden
    const isHidden = turnInd.classList.contains('hidden');
    turnInd.className = `turn-indicator ${cls} ${isHidden ? 'hidden' : ''}`;
  },

  /**
   * Updates the turn-indicator pill text and refreshes ghost previews
   * on all empty cells to show the new current player's mark.
   *
   * In multiplayer, shows "Your Turn" / "Opponent's Turn" instead of
   * player names.
   */
  updateTurnIndicator() {
    const ti = document.getElementById('turn-indicator');
    const name = State.names[State.currentPlayer];

    this.updateGridBorder();

    if (State.isThinking) {
      ti.innerHTML = `${i18n.t('ai_thinking')} <span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span>`;
    } else if (State.isMultiplayer) {
      const isOurTurn = State.currentPlayer === State.playerRole;

      // Fail-safe: unlock the processing flag if it's now our turn.
      // This catches edge cases where a remote state update arrives
      // while isProcessing was still true from a previous move.
      if (isOurTurn) State.isProcessing = false;

      ti.classList.remove('hidden');
      ti.textContent = isOurTurn ? i18n.t('your_turn') : i18n.t('opponent_turn');
    } else {
      ti.classList.remove('hidden');
      ti.textContent = (State.currentPlayer === 'O' && State.mode === 'single') 
        ? i18n.t('ai_turn')
        : `${name} ${i18n.t('your_turn')}`;
    }

    // Swap ghost previews on all empty cells to the new current player's mark
    const html = this.getGhostHtml();
    document.querySelectorAll('.cell:not(.marked) .cell-ghost').forEach(ghost => {
      ghost.innerHTML = html;
    });
  },

  /**
   * Synchronises the DOM cells with the given grid data without a full
   * DOM rebuild.  Used for smooth multiplayer incremental updates.
   *
   * For each cell:
   *  - If the grid has a mark but the DOM doesn't → stamp the mark.
   *  - If the grid is empty but the DOM has a mark → clear (defensive;
   *    currently impossible in normal gameplay).
   *
   * @param {string[][]} grid - The authoritative grid data.
   */
  syncGrid(grid) {
    for (let r = 0; r < State.gridSize; r++) {
      for (let c = 0; c < State.gridSize; c++) {
        const val  = grid[r][c];
        const cell = this.getCell(r, c);
        if (!cell) continue;

        if (val && !cell.classList.contains('marked')) {
          // Remote player placed a mark — stamp it locally
          this.updateCell(r, c, val);
        } else if (!val && cell.classList.contains('marked')) {
          // Cell was cleared (defensive — unlikely in this game)
          cell.classList.remove('x-marked', 'o-marked', 'marked');
          cell.innerHTML = "";
          const ghost = document.createElement('div');
          ghost.className = 'cell-ghost';
          ghost.innerHTML = this.getGhostHtml();
          cell.appendChild(ghost);
          if (onCellClick) cell.addEventListener('click', onCellClick);
        }
      }
    }

    // Redraw strikes since cell DOM nodes may have changed
    this.redrawAllStrikes();
  },

  /**
   * Returns the SVG markup for a ghost hover preview, or an empty string
   * when no ghost should be shown.
   *
   * Ghosts are hidden when:
   *  - A move/animation is being processed.
   *  - It's the AI's turn (single-player mode).
   *  - It's the opponent's turn (multiplayer mode).
   *  - The game is no longer active.
   *
   * @returns {string} Ghost SVG markup or `''`.
   */
  getGhostHtml() {
    if (State.isProcessing)  return '';
    if (State.mode === 'single' && State.currentPlayer === 'O') return '';
    if (State.isMultiplayer && State.currentPlayer !== State.playerRole) return '';
    if (!State.gameActive)   return '';

    return State.currentPlayer === 'X' ? makeGhostX() : makeGhostO();
  },

  /**
   * Syncs the score display for one player and triggers the pop/flash
   * animation on the score block.
   *
   * Also appends "(You)" next to the player's name in multiplayer mode
   * to clearly indicate which score belongs to the local player.
   *
   * @param {'X'|'O'} player - Which player's score to update.
   */
  updateScore(player) {
    const key    = player.toLowerCase();
    const val    = document.getElementById(`score-${key}-val`);
    const block  = document.getElementById(`score-${key}-block`);
    const nameEl = document.getElementById(`score-${key}-name`);

    val.textContent = State.scores[player];

    // Append "(You)" indicator in multiplayer for the local player
    if (State.isMultiplayer && player === State.playerRole) {
      nameEl.textContent = `${State.names[player]} (You)`;
    } else {
      nameEl.textContent = State.names[player];
    }

    // Restart the flash animation by forcing a browser reflow
    block.classList.remove('score-flash');
    void block.offsetWidth;   // Force reflow — intentional layout thrash
    block.classList.add('score-flash');
  },

  /**
   * Updates the grid-size badge in the HUD (e.g. "4×4").
   */
  updateGridSizeBadge() {
    document.getElementById('grid-size-badge').textContent =
      `${State.gridSize}×${State.gridSize}`;
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Win / score strike-line overlay
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Draws a single animated strike-through line over the winning cells.
   * Convenience wrapper around {@link drawScoreStrikes}.
   *
   * @param {number[][]} cells  - Array of [row, col] pairs in the winning line.
   * @param {'X'|'O'}    player - Winning player (determines stroke colour).
   */
  drawWinStrike(cells, player) {
    this.drawScoreStrikes([cells], player);
  },

  /**
   * Draws one or more strike lines for newly scored chains.
   *
   * For each chain, pre-computes random jitter parameters (overshoot,
   * positional offset, curvature) and stores them in
   * {@link State.scoredLines} so the lines can be redrawn identically
   * after DOM rebuilds.
   *
   * @param {Array<number[][]>} lines  - Array of chain cell-coordinate arrays.
   * @param {'X'|'O'}           player - Scoring player.
   */
  drawScoreStrikes(lines, player) {
    // Pre-compute random path parameters for each chain (persisted for redraws)
    const chainsWithParams = lines.map(cells => ({
      cells,
      extendStart:  Math.random() * STRIKE_OVERSHOOT_JITTER + STRIKE_OVERSHOOT_MIN,
      extendEnd:    Math.random() * STRIKE_OVERSHOOT_JITTER + STRIKE_OVERSHOOT_MIN,
      xAOffset:     Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER,
      yAOffset:     Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER,
      xBOffset:     Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER,
      yBOffset:     Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER,
      curveJitter:  Math.random() * (STRIKE_CURVE_JITTER * 2) - STRIKE_CURVE_JITTER,
      curveSign:    Math.random() < 0.5 ? 1 : -1
    }));

    // Append to persistent list so strikes survive DOM rebuilds
    State.scoredLines.push({ chains: chainsWithParams, player });

    // Force a full redraw of all strikes (old + new)
    this.redrawAllStrikes();
  },

  /**
   * Redraws **all** persistent strike lines from {@link State.scoredLines}.
   *
   * Called after:
   *  - {@link buildGrid} (DOM was destroyed and rebuilt).
   *  - {@link drawScoreStrikes} (new lines were added).
   *  - {@link syncGrid} (cells may have been updated by multiplayer sync).
   *
   * **Drawing algorithm per chain:**
   *  1. Compute the pixel centre of the first and last cells.
   *  2. Extend the endpoints by a random overshoot along the line direction
   *     to create the classic "hand-drawn" strike that overshoots the grid.
   *  3. Apply random positional jitter to each endpoint.
   *  4. Calculate a quadratic Bézier control point offset perpendicular
   *     to the line to create a subtle curve.
   *  5. Render as an SVG `<path>` with the `Q` (quadratic) command.
   */
  redrawAllStrikes() {
    const gridEl = document.getElementById('game-grid');

    // Remove old SVG overlay and cell highlight classes
    gridEl.querySelectorAll('.win-strike-svg').forEach(s => s.remove());
    document.querySelectorAll('.win-cell').forEach(cell => cell.classList.remove('win-cell'));

    if (State.scoredLines.length === 0) return;

    // --- Create a single SVG element sized to cover the entire grid ---
    const cs      = this.cellSize;
    const gap     = GRID_GAP;
    const padding = GRID_PADDING;
    const total   = (cs * State.gridSize) + (gap * (State.gridSize - 1)) + (padding * 2);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
    svg.setAttribute('width',  total);
    svg.setAttribute('height', total);
    svg.classList.add('win-strike-svg');
    svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';

    // --- Draw each scored chain ---
    for (const { chains, player } of State.scoredLines) {
      for (const chain of chains) {
        // Backward compatibility: older data may store chains as plain arrays
        const isLegacy = Array.isArray(chain);
        const cells    = isLegacy ? chain : chain.cells;

        if (!cells || !cells.length) continue;

        // Pixel centres of the first and last cells in the chain
        const [r0, c0] = cells[0];
        const [r1, c1] = cells[cells.length - 1];
        const x1 = padding + c0 * (cs + gap) + cs / 2;
        const y1 = padding + r0 * (cs + gap) + cs / 2;
        const x2 = padding + c1 * (cs + gap) + cs / 2;
        const y2 = padding + r1 * (cs + gap) + cs / 2;

        // --- Overshoot: extend the line past the edge cells ---
        const dxOrig  = x2 - x1;
        const dyOrig  = y2 - y1;
        const lenOrig = Math.sqrt(dxOrig * dxOrig + dyOrig * dyOrig);
        const nx = lenOrig > 0 ? dxOrig / lenOrig : 0;   // Unit direction vector X
        const ny = lenOrig > 0 ? dyOrig / lenOrig : 0;   // Unit direction vector Y

        // Use persisted jitter values, or generate new ones for legacy data
        const extendStart = isLegacy ? (Math.random() * STRIKE_OVERSHOOT_JITTER + STRIKE_OVERSHOOT_MIN) : chain.extendStart;
        const extendEnd   = isLegacy ? (Math.random() * STRIKE_OVERSHOOT_JITTER + STRIKE_OVERSHOOT_MIN) : chain.extendEnd;

        const xAOff = isLegacy ? (Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER) : chain.xAOffset;
        const yAOff = isLegacy ? (Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER) : chain.yAOffset;
        const xBOff = isLegacy ? (Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER) : chain.xBOffset;
        const yBOff = isLegacy ? (Math.random() * (STRIKE_POS_JITTER * 2) - STRIKE_POS_JITTER) : chain.yBOffset;

        // Final start (A) and end (B) points after overshoot + jitter
        const xA = x1 - nx * extendStart + xAOff;
        const yA = y1 - ny * extendStart + yAOff;
        const xB = x2 + nx * extendEnd   + xBOff;
        const yB = y2 + ny * extendEnd   + yBOff;

        // --- Curvature: slight perpendicular offset for hand-drawn feel ---
        const dx     = xB - xA;
        const dy     = yB - yA;
        const length = Math.sqrt(dx * dx + dy * dy);

        const baseOffset  = Math.min(STRIKE_CURVE_BASE, length * 0.08);
        const curveJitter = isLegacy ? (Math.random() * (STRIKE_CURVE_JITTER * 2) - STRIKE_CURVE_JITTER) : chain.curveJitter;
        const curveSign   = isLegacy ? (Math.random() < 0.5 ? 1 : -1) : chain.curveSign;
        const offsetMag   = baseOffset + curveJitter;
        const offset      = offsetMag * curveSign;

        // Bézier control point: midpoint shifted perpendicular to the line
        const cx = (xA + xB) / 2 - (dy / length) * offset;
        const cy = (yA + yB) / 2 + (dx / length) * offset;

        // --- Build the SVG <path> element ---
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${xA} ${yA} Q ${cx} ${cy} ${xB} ${yB}`);
        path.setAttribute('stroke', 'currentColor');
        path.setAttribute('fill', 'none');
        path.classList.add('win-strike-line', player === 'X' ? 'x-strike' : 'o-strike');
        svg.appendChild(path);

        // Highlight the cells that belong to this chain
        cells.forEach(([r, c]) => this.getCell(r, c)?.classList.add('win-cell'));
      }
    }

    gridEl.style.position = 'relative';
    gridEl.appendChild(svg);
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Expansion animation
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Briefly animates the grid element when the board size increases.
   * The `grid-expanding` class triggers a CSS scale pulse, removed
   * after 500 ms.
   */
  animateGridExpand() {
    const gridEl = document.getElementById('game-grid');
    gridEl.classList.add('grid-expanding');
    setTimeout(() => gridEl.classList.remove('grid-expanding'), 500);
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Zoom / Pan display
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Applies the current zoom level and pan offset to the zoom container
   * via a CSS `transform`, updates the zoom percentage label, and
   * toggles the "Reset Zoom" button visibility.
   *
   * @param {number} level - Zoom multiplier (e.g. 1.5 = 150 %).
   */
  setZoomDisplay(level) {
    // Update the percentage label in the controls bar
    document.getElementById('zoom-display').textContent = `${Math.round(level * 100)}%`;

    // Apply the combined translate + scale transform
    const container = document.getElementById('grid-zoom-container');
    container.style.transform = `translate(${State.panX}px,${State.panY}px) scale(${level})`;

    // Show the "Reset Zoom" button only when zoomed beyond 100 %
    const resetBtn = document.getElementById('reset-zoom-btn');
    if (resetBtn) {
      resetBtn.style.display = level > 1.001 ? 'flex' : 'none';
    }
  },

};
