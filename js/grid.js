/**
 * @file grid.js — Board logic and win/score detection for Tic Tac Grow.
 *
 * This module owns all pure logic that operates on the 2-D grid array:
 *
 *  • **Grid utilities** — create, copy, check-if-full helpers (re-exported
 *    from {@link module:utils}).
 *  • **Chain detection** — functions that walk contiguous same-player marks
 *    in a given direction to measure chain length, find chain start cells,
 *    produce canonical chain IDs, and collect chain cell coordinates.
 *  • **Win detection** — classic 3×3 win check (eight fixed lines).
 *  • **Incremental scoring** — awards points for new chains on 4×4+ boards
 *    while avoiding double-counting previously rewarded sub-chains.
 *
 * All functions are **pure** (no DOM access, no State mutation) except
 * `scoreMoveOnGrid`, which mutates the `scoredChains` Set it receives.
 *
 * @module grid
 */

import { createGrid, copyGrid } from './utils.js';
import { chainScore } from './constants.js';

// Re-export grid construction helpers so consumers can import from one place
export { createGrid, copyGrid };

// ═══════════════════════════════════════════════════════════════════════════
//  Grid utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns `true` when every cell in the grid contains a non-empty value.
 *
 * @param {string[][]} grid - The board to check.
 * @returns {boolean} Whether the board is completely filled.
 */
export function isGridFull(grid) {
  return grid.every(row => row.every(cell => cell !== ''));
}

// ═══════════════════════════════════════════════════════════════════════════
//  Chain detection
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The four canonical directions used to scan for chains.
 * Each pair covers both orientations (e.g. [0,1] walks left↔right),
 * because every chain-scanning function walks **both** directions from
 * the origin cell.
 *
 * @type {number[][]}
 * @private
 */
export const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];

/**
 * Counts consecutive marks belonging to `player` along the line defined
 * by direction (dr, dc), walking **both** ways from the origin cell (r, c)
 * and including the origin itself.
 *
 * @param {string[][]} grid   - The board.
 * @param {number}     r      - Row of the origin cell (just played).
 * @param {number}     c      - Column of the origin cell.
 * @param {number}     dr     - Row step direction (−1, 0, or 1).
 * @param {number}     dc     - Column step direction (−1, 0, or 1).
 * @param {string}     player - Mark to match (`'X'` or `'O'`).
 * @returns {number} Total chain length through (r, c).
 */
export function getChainLength(grid, r, c, dr, dc, player) {
  const size = grid.length;
  let count = 1;   // Start with the origin cell itself

  // Walk in the positive direction (+dr, +dc)
  let nr = r + dr, nc = c + dc;
  while (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === player) {
    count++;
    nr += dr;
    nc += dc;
  }

  // Walk in the negative direction (−dr, −dc)
  nr = r - dr;
  nc = c - dc;
  while (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === player) {
    count++;
    nr -= dr;
    nc -= dc;
  }

  return count;
}

/**
 * Finds the top-/left-most cell of the chain that passes through (r, c)
 * in the given direction.  "Top-/left-most" means the cell you reach by
 * walking in the **negative** direction until you hit a non-matching cell
 * or the board edge.
 *
 * Used to produce a **canonical starting point** for chain IDs so that
 * the same physical chain always generates the same key regardless of
 * which cell triggered the detection.
 *
 * @param {string[][]} grid
 * @param {number}     r
 * @param {number}     c
 * @param {number}     dr
 * @param {number}     dc
 * @param {string}     player
 * @returns {{ r: number, c: number }} Coordinates of the chain's first cell.
 */
export function getChainStart(grid, r, c, dr, dc, player) {
  // Walk backwards until we overshoot the chain
  let sr = r - dr, sc = c - dc;
  while (
    sr >= 0 && sr < grid.length &&
    sc >= 0 && sc < grid.length &&
    grid[sr][sc] === player
  ) {
    sr -= dr;
    sc -= dc;
  }

  // Step forward once to land on the first cell that IS the player's mark
  return { r: sr + dr, c: sc + dc };
}

/**
 * Produces a stable, unique string key for a specific chain instance.
 *
 * Direction is **normalised** so that walking a chain from either end
 * yields the same key — e.g. direction (1, 0) and (−1, 0) for the same
 * chain both produce the same normalised direction.
 *
 * Format: `"startRow,startCol,normDr,normDc,length"`
 *
 * @param {number} r   - Chain start row (from {@link getChainStart}).
 * @param {number} c   - Chain start column.
 * @param {number} dr  - Direction row component.
 * @param {number} dc  - Direction column component.
 * @param {number} len - Total chain length.
 * @returns {string} A canonical string key.
 */
export function chainId(r, c, dr, dc, len) {
  // Normalise so that the "negative" mirror of a direction maps to its
  // positive counterpart.  This prevents the same physical chain from
  // generating two distinct IDs.
  const ndr = (dr < 0 || (dr === 0 && dc < 0)) ? -dr : dr;
  const ndc = (dr < 0 || (dr === 0 && dc < 0)) ? -dc : dc;
  return `${r},${c},${ndr},${ndc},${len}`;
}

/**
 * Returns the ordered cell coordinates `[row, col]` for every cell in
 * the chain that passes through (r, c) in the given direction.
 *
 * Cells are ordered from the negative-direction end to the positive-
 * direction end, which matches the visual order for strike-line drawing.
 *
 * @param {string[][]} grid
 * @param {number}     r
 * @param {number}     c
 * @param {number}     dr
 * @param {number}     dc
 * @param {string}     player
 * @returns {number[][]} Array of `[row, col]` pairs.
 */
export function getChainCells(grid, r, c, dr, dc, player) {
  const cells = [[r, c]];
  const size = grid.length;

  // Collect cells in the positive direction (appended to the end)
  let nr = r + dr;
  let nc = c + dc;
  while (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === player) {
    cells.push([nr, nc]);
    nr += dr;
    nc += dc;
  }

  // Collect cells in the negative direction (prepended to the start)
  nr = r - dr;
  nc = c - dc;
  while (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === player) {
    cells.unshift([nr, nc]);
    nr -= dr;
    nc -= dc;
  }

  return cells;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Win detection (classic 3×3 only)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * All eight possible winning lines on a 3×3 board:
 * 3 rows + 3 columns + 2 diagonals.
 * @type {number[][][]}
 * @private
 */
const WIN_LINES_3x3 = [
  [[0,0],[0,1],[0,2]],   // top row
  [[1,0],[1,1],[1,2]],   // middle row
  [[2,0],[2,1],[2,2]],   // bottom row
  [[0,0],[1,0],[2,0]],   // left column
  [[0,1],[1,1],[2,1]],   // centre column
  [[0,2],[1,2],[2,2]],   // right column
  [[0,0],[1,1],[2,2]],   // diagonal ↘
  [[0,2],[1,1],[2,0]],   // diagonal ↙
];

/**
 * Checks all eight classic 3×3 win lines for a completed triplet.
 *
 * **Only called when `gridSize === 3`** (classic rules).  On larger
 * boards, scoring and win detection use chain-based logic instead.
 *
 * @param {string[][]} grid - Must be exactly 3×3.
 * @returns {{ winner: string, cells: number[][] } | null}
 *   The winning player mark and the three winning cells, or `null`
 *   if no player has completed a line.
 */
export function check3x3Win(grid) {
  for (const line of WIN_LINES_3x3) {
    const [a, b, c] = line;
    const mark = grid[a[0]][a[1]];

    // A line is won when all three cells contain the same non-empty mark
    if (mark && mark === grid[b[0]][b[1]] && mark === grid[c[0]][c[1]]) {
      return { winner: mark, cells: line };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Incremental scoring (4×4 and larger boards)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Scores the move at (r, c) for `player` on a 4×4+ board.
 *
 * **Incremental scoring algorithm:**
 * For each of the four scan directions, the function:
 *  1. Measures the chain length through (r, c).
 *  2. Skips chains shorter than 3 (no points).
 *  3. Computes a canonical chain ID via {@link getChainStart} and
 *     {@link chainId}.
 *  4. Checks if this exact chain was already fully rewarded.
 *  5. If not, looks for the longest previously-scored *sub-chain* in
 *     the same direction and awards only the **delta** (new points minus
 *     previously awarded points).
 *
 * This ensures that extending a 3-chain to a 4-chain awards only
 * the difference (20 − 10 = 10 pts), not the full 20.
 *
 * **Side effect:** Mutates `scoredChains` by adding newly awarded IDs.
 *
 * @param {string[][]}   grid         - The current board.
 * @param {number}       r            - Row of the cell just played.
 * @param {number}       c            - Column of the cell just played.
 * @param {string}       player       - `'X'` or `'O'`.
 * @param {Set<string>}  scoredChains - Already-rewarded chain IDs.
 * @returns {{ points: number, chains: number[][][] }}
 *   `points` — total incremental points earned by this move.
 *   `chains` — array of cell-coordinate arrays for each newly scored chain
 *              (used to draw strike lines).
 */
export function scoreMoveOnGrid(grid, r, c, player, scoredChains) {
  let totalPts = 0;
  const scoredLinesList = [];

  for (const [dr, dc] of DIRECTIONS) {
    const len = getChainLength(grid, r, c, dr, dc, player);

    // Chains shorter than 3 don't earn any points
    if (len < 3) continue;

    const start = getChainStart(grid, r, c, dr, dc, player);
    const id    = chainId(start.r, start.c, dr, dc, len);

    // Skip if this exact chain length was already fully awarded
    if (scoredChains.has(id)) continue;

    // Find the longest previously-scored sub-chain in this direction
    // so we award only the incremental delta, not the full value
    let prevScored = 0;
    for (let prevLen = len - 1; prevLen >= 3; prevLen--) {
      const prevId = chainId(start.r, start.c, dr, dc, prevLen);
      if (scoredChains.has(prevId)) {
        prevScored = chainScore(prevLen);
        break;
      }
    }

    const newPts = chainScore(len) - prevScored;
    if (newPts > 0) {
      totalPts += newPts;
      scoredChains.add(id);
      scoredLinesList.push(getChainCells(grid, r, c, dr, dc, player));
    }
  }

  return { points: totalPts, chains: scoredLinesList };
}
