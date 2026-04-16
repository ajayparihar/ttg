'use strict';

/* ============================================================
   AI OPPONENT
   A heuristic (non-minimax) AI that plays reasonably well
   without being unbeatable, keeping the game fun.

   Priority order:
     1. Win immediately if possible.
     2. Block the opponent's immediate win / long chain.
     3. Maximise own chain score on this move.
     4. Block the opponent from scoring a chain.
     5. Prefer centre → corners → random empty cell.

   All grid mutations are temporary (set → evaluate → unset),
   so the original State.grid is never touched.
   ============================================================ */

const AI = {

  /**
   * Returns the best move for the AI player.
   *
   * @param {string[][]} grid  - A COPY of the board (safe to mutate).
   * @param {string}     aiPlayer       - 'X' or 'O' (AI's mark).
   * @param {string}     opponentPlayer - The human's mark.
   * @returns {{ r: number, c: number }|null} Chosen cell, or null if board is full.
   */
  getBestMove(grid, aiPlayer, opponentPlayer) {
    const size  = grid.length;
    const empty = [];

    // Collect all playable cells
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!grid[r][c]) empty.push([r, c]);
      }
    }

    if (!empty.length) return null;

    const skill = Math.min(Math.max(Number.isFinite(LEVEL) ? LEVEL : 3, 1), 5);

    if (skill === 1) {
      const [r, c] = this._randomChoice(empty);
      return { r, c };
    }

    // --- Priority 1: Win immediately ---
    for (const [r, c] of empty) {
      grid[r][c] = aiPlayer;
      const wins  = size === 3  ? check3x3Win(grid) : null;
      const chain = size >= 4   ? this._bestChain(grid, r, c, aiPlayer) : 0;
      grid[r][c] = '';
      if (wins || chain >= size) return { r, c };
    }

    // --- Priority 2: Block opponent's immediate win / long chain ---
    const blockThreshold = skill >= 4 ? 3 : 4;
    for (const [r, c] of empty) {
      grid[r][c] = opponentPlayer;
      const wins  = size === 3  ? check3x3Win(grid) : null;
      const chain = size >= 4   ? this._bestChain(grid, r, c, opponentPlayer) : 0;
      grid[r][c] = '';
      if (wins || chain >= blockThreshold) return { r, c };
    }

    // --- Priority 3: Maximise own chain score ---
    let best = null, bestScore = -1;
    for (const [r, c] of empty) {
      grid[r][c] = aiPlayer;
      const score = this._evaluateMove(grid, r, c, aiPlayer);
      grid[r][c] = '';
      if (score > bestScore) { bestScore = score; best = { r, c }; }
    }

    if (best && bestScore > 0) {
      if (skill === 2 && bestScore < 20) {
        const [r, c] = this._randomChoice(empty);
        return { r, c };
      }
      return best;
    }

    if (skill === 2) {
      const [r, c] = this._randomChoice(empty);
      return { r, c };
    }

    // --- Priority 4: Block opponent from scoring ---
    let bestBlock = null, bestBlockScore = -1;
    for (const [r, c] of empty) {
      grid[r][c] = opponentPlayer;
      const score = this._evaluateMove(grid, r, c, opponentPlayer);
      grid[r][c] = '';
      if (score > bestBlockScore) { bestBlockScore = score; bestBlock = { r, c }; }
    }

    const blockFloor = skill >= 4 ? 1 : 10;
    if (bestBlock && bestBlockScore >= blockFloor) return bestBlock;

    // --- Priority 5: Positional preference — centre → corners → random ---
    const mid = Math.floor(size / 2);
    if (!grid[mid][mid]) return { r: mid, c: mid };

    const corners = [
      [0, 0], [0, size - 1], [size - 1, 0], [size - 1, size - 1],
    ].filter(([r, c]) => !grid[r][c]);

    if (corners.length) {
      const [r, c] = this._randomChoice(corners);
      return { r, c };
    }

    const [r, c] = this._randomChoice(empty);
    return { r, c };
  },

  _randomChoice(array) {
    return array[Math.floor(Math.random() * array.length)];
  },

  /**
   * Returns the longest chain length the player would achieve at (r, c).
   * Checks all four axis directions.
   *
   * @param {string[][]} grid
   * @param {number} r
   * @param {number} c
   * @param {string} player
   * @returns {number}
   */
  _bestChain(grid, r, c, player) {
    const dirs = [[0,1], [1,0], [1,1], [1,-1]];
    return Math.max(...dirs.map(([dr, dc]) => getChainLength(grid, r, c, dr, dc, player)));
  },

  /**
   * Sums up chain scores for all chains of length ≥ 3 passing through (r, c).
   * Used for greedy move selection on large boards.
   *
   * @param {string[][]} grid
   * @param {number} r
   * @param {number} c
   * @param {string} player
   * @returns {number} Combined score value.
   */
  _evaluateMove(grid, r, c, player) {
    const dirs = [[0,1], [1,0], [1,1], [1,-1]];
    let score = 0;
    for (const [dr, dc] of dirs) {
      const len = getChainLength(grid, r, c, dr, dc, player);
      if (len >= 3) score += chainScore(len);
    }
    return score;
  },
};
