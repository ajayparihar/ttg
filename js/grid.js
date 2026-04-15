'use strict';

/* ============================================================
   GRID UTILITIES & WIN/SCORE LOGIC
   Pure functions — no DOM access, no State mutation.
   All functions take grid arrays as arguments so they can be
   called safely on copies (e.g. by the AI lookahead).
   ============================================================ */

/* ---- Grid construction ---- */

/**
 * Creates a new empty size×size grid.
 * @param {number} size
 * @returns {string[][]}
 */
function createGrid(size) {
  return Array.from({ length: size }, () => Array(size).fill(''));
}

/**
 * Returns a shallow-row copy of a grid (safe for mutation during AI lookahead).
 * @param {string[][]} grid
 * @returns {string[][]}
 */
function copyGrid(grid) {
  return grid.map(row => [...row]);
}

/**
 * Returns true when every cell in the grid has been filled.
 * @param {string[][]} grid
 * @returns {boolean}
 */
function isGridFull(grid) {
  return grid.every(row => row.every(cell => cell !== ''));
}

/* ---- Chain detection ---- */

/**
 * Counts consecutive marks belonging to `player` in both directions
 * along (dr, dc) from the origin cell (r, c), including the origin itself.
 *
 * @param {string[][]} grid
 * @param {number} r   - Row of the cell just played.
 * @param {number} c   - Column of the cell just played.
 * @param {number} dr  - Row direction component (-1, 0, or 1).
 * @param {number} dc  - Column direction component (-1, 0, or 1).
 * @param {string} player - 'X' or 'O'.
 * @returns {number} Total length of the chain through (r, c).
 */
function getChainLength(grid, r, c, dr, dc, player) {
  const size = grid.length;
  let count = 1;

  // Walk in the positive direction
  let nr = r + dr, nc = c + dc;
  while (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === player) {
    count++;
    nr += dr;
    nc += dc;
  }

  // Walk in the negative direction
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
 * Returns the top-/left-most cell of the chain that passes through (r, c)
 * in direction (dr, dc).  Used to build a canonical chain ID.
 *
 * @param {string[][]} grid
 * @param {number} r
 * @param {number} c
 * @param {number} dr
 * @param {number} dc
 * @param {string} player
 * @returns {{ r: number, c: number }}
 */
function getChainStart(grid, r, c, dr, dc, player) {
  let sr = r - dr, sc = c - dc;
  while (
    sr >= 0 && sr < grid.length &&
    sc >= 0 && sc < grid.length &&
    grid[sr][sc] === player
  ) {
    sr -= dr;
    sc -= dc;
  }
  // Step back one to get the first cell that IS the player
  return { r: sr + dr, c: sc + dc };
}

/**
 * Produces a stable string key for a specific chain so it can be stored in
 * a Set and checked for double-scoring.  Directions are normalised so that
 * the same chain is not counted twice when traversed from both ends.
 *
 * @param {number} r   - Start row (from getChainStart).
 * @param {number} c   - Start column.
 * @param {number} dr
 * @param {number} dc
 * @param {number} len - Chain length.
 * @returns {string}
 */
function chainId(r, c, dr, dc, len) {
  // Normalise direction so (−dr, −dc) maps to the same key as (dr, dc)
  const ndr = (dr < 0 || (dr === 0 && dc < 0)) ? -dr : dr;
  const ndc = (dr < 0 || (dr === 0 && dc < 0)) ? -dc : dc;
  return `${r},${c},${ndr},${ndc},${len}`;
}

/* ---- Win detection ---- */

/**
 * Checks all eight classic 3×3 win lines.
 * Only called when gridSize === 3 (classic rules).
 *
 * @param {string[][]} grid - Must be exactly 3×3.
 * @returns {{ winner: string, cells: number[][] }|null}
 */
function check3x3Win(grid) {
  // All possible winning triplets on a 3×3 board
  const WIN_LINES = [
    [[0,0],[0,1],[0,2]], // top row
    [[1,0],[1,1],[1,2]], // middle row
    [[2,0],[2,1],[2,2]], // bottom row
    [[0,0],[1,0],[2,0]], // left column
    [[0,1],[1,1],[2,1]], // middle column
    [[0,2],[1,2],[2,2]], // right column
    [[0,0],[1,1],[2,2]], // diagonal ↘
    [[0,2],[1,1],[2,0]], // diagonal ↙
  ];

  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    const mark = grid[a[0]][a[1]];
    if (mark && mark === grid[b[0]][b[1]] && mark === grid[c[0]][c[1]]) {
      return { winner: mark, cells: line };
    }
  }
  return null;
}

/* ---- Incremental scoring (4 × 4 and larger) ---- */

/**
 * Scores the move at (r, c) for `player` on a 4×4+ board.
 * Awards only incremental points — if a chain was already
 * partially scored at a shorter length, only the delta is added.
 *
 * Mutates `scoredChains` by registering newly awarded chain IDs.
 *
 * @param {string[][]} grid
 * @param {number} r
 * @param {number} c
 * @param {string} player - 'X' or 'O'.
 * @param {Set<string>} scoredChains - Already-rewarded chain IDs.
 * @returns {number} Points to add to the player's score.
 */
function scoreMoveOnGrid(grid, r, c, player, scoredChains) {
  // The four directions to check (pairs cover all eight because getChainLength
  // walks both ways from the origin cell)
  const DIRECTIONS = [[0,1], [1,0], [1,1], [1,-1]];
  let totalPts = 0;

  for (const [dr, dc] of DIRECTIONS) {
    const len = getChainLength(grid, r, c, dr, dc, player);
    if (len < 3) continue;

    const start = getChainStart(grid, r, c, dr, dc, player);
    const id    = chainId(start.r, start.c, dr, dc, len);

    if (scoredChains.has(id)) continue; // already fully awarded

    // Find the longest sub-chain already scored in this direction
    // so we award only the incremental delta
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
    }
  }

  return totalPts;
}
