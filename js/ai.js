/**
 * @file ai.js — AI opponent logic for Tic Tac Grow.
 *
 * Implements a multi-level AI (skill 1–10) that scales from nearly random
 * play to full minimax on 3×3 boards with look-ahead evaluation on larger
 * boards.
 *
 * **Decision pipeline (high skill):**
 *  1. **Random bail-out** — at lower skill levels, a percentage of moves
 *     are made randomly to simulate weaker play.
 *  2. **Minimax (3×3 only, skill ≥ 7)** — guaranteed optimal play on the
 *     classic board.
 *  3. **Win check** — if any move produces an instant win, take it.
 *  4. **Block check** — if the opponent can win next turn, block it.
 *     The threshold chain length decreases at higher skill.
 *  5. **Heuristic evaluation** — score every empty cell using a weighted
 *     combination of:
 *       - Offensive chain potential (length + open ends).
 *       - Defensive value (blocking opponent chains).
 *       - Positional preference (centre > corners > edges).
 *  6. **Look-ahead (skill ≥ 9)** — simulate the opponent's best response
 *     and penalise moves that leave high-scoring replies.
 *
 * @module ai
 */

import { LEVEL, chainScore } from './constants.js';
import { check3x3Win, getChainLength, DIRECTIONS } from './grid.js';
import { randomChoice } from './utils.js';

export const AI = {

  // ═══════════════════════════════════════════════════════════════════════
  //  Public entry point
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Returns the best move for the AI player.
   *
   * The caller **must** pass a *copy* of the grid, because the AI mutates
   * cells during its evaluation (placing and removing trial marks).
   *
   * @param {string[][]} grid           - A **copy** of the board (safe to mutate).
   * @param {string}     aiPlayer       - The AI's mark (`'X'` or `'O'`).
   * @param {string}     opponentPlayer - The human's mark.
   * @param {number}     [skillOverride]- Optional skill level (1–10).
   *   Falls back to the global {@link module:constants.LEVEL|LEVEL} constant.
   * @returns {{ r: number, c: number } | null} The chosen cell, or `null`
   *   if the board is completely full.
   */
  getBestMove(grid, aiPlayer, opponentPlayer, skillOverride) {
    const size  = grid.length;
    const empty = [];

    // Collect all playable (empty) cells
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!grid[r][c]) empty.push({ r, c });
      }
    }

    // No valid moves → board is full
    if (!empty.length) return null;

    // Normalise skill to [1, 10]
    const skill = Math.min(Math.max(
      Number.isFinite(skillOverride) ? skillOverride : (Number.isFinite(LEVEL) ? LEVEL : 6),
      1), 10);

    // ── Step 1: Random bail-out (difficulty scaling) ──────────────────
    // Lower skill → higher chance of playing a random move.
    // Skill  1 → 80 % random,  Skill 5 → 40 %,  Skill 10 → 0 %.
    const randomChance = Math.max(0, (10 - skill) / 10 - 0.1);
    if (Math.random() < randomChance) {
      return this._getRandomMove(grid, empty);
    }

    // ── Step 2: Minimax on 3×3 board (skill ≥ 7) ─────────────────────
    // Perfect play via exhaustive search (small state space).
    if (size === 3 && skill >= 7) {
      return this._getMinimaxMove(grid, aiPlayer, opponentPlayer);
    }

    // ── Step 3: Instant-win check ────────────────────────────────────
    for (const pos of empty) {
      grid[pos.r][pos.c] = aiPlayer;
      const wins  = size === 3  ? check3x3Win(grid) : null;
      const chain = size >= 4   ? this._bestChain(grid, pos.r, pos.c, aiPlayer) : 0;
      grid[pos.r][pos.c] = '';
      if (wins || chain >= size) return pos;
    }

    // ── Step 4: Block opponent's winning / critical threat ───────────
    // Higher skill blocks shorter chains (more proactively):
    //   Skill ≥ 7 → block 3+,  Skill ≥ 4 → block 4+,  else → block 5+
    const blockThreshold = skill >= 7 ? 3 : (skill >= 4 ? 4 : 5);
    for (const pos of empty) {
      grid[pos.r][pos.c] = opponentPlayer;
      const wins  = size === 3  ? check3x3Win(grid) : null;
      const chain = size >= 4   ? this._bestChain(grid, pos.r, pos.c, opponentPlayer) : 0;
      grid[pos.r][pos.c] = '';
      if (wins || chain >= blockThreshold) return pos;
    }

    // ── Step 5 + 6: Heuristic evaluation with optional look-ahead ───
    let bestMoves = [];
    let maxEval   = -Infinity;

    for (const pos of empty) {
      grid[pos.r][pos.c] = aiPlayer;
      let score = this._evaluateBoard(grid, pos.r, pos.c, aiPlayer, opponentPlayer, skill);

      // Look-ahead (skill 9–10): simulate opponent's best response and
      // penalise moves that leave strong counter-moves on the board.
      if (skill >= 9) {
        let maxOpponentResponse = 0;

        // Sample a random subset of opponent moves (up to 15) for speed
        const opponentMoves = empty
          .filter(p => p.r !== pos.r || p.c !== pos.c)
          .sort(() => Math.random() - 0.5)
          .slice(0, 15);

        for (const oppPos of opponentMoves) {
          grid[oppPos.r][oppPos.c] = opponentPlayer;
          const oppScore = this._evaluateBoard(grid, oppPos.r, oppPos.c, opponentPlayer, aiPlayer, skill);
          grid[oppPos.r][oppPos.c] = '';
          if (oppScore > maxOpponentResponse) maxOpponentResponse = oppScore;
        }

        // Penalise by 80 % of the opponent's strongest reply
        score -= maxOpponentResponse * 0.8;
      }

      grid[pos.r][pos.c] = '';

      // Track the best-scoring move(s)
      if (score > maxEval) {
        maxEval   = score;
        bestMoves = [pos];
      } else if (score === maxEval) {
        bestMoves.push(pos);
      }
    }

    // Break ties randomly among equally-scored moves
    if (bestMoves.length > 0) {
      return randomChoice(bestMoves);
    }

    // Absolute fallback — should never reach here in practice
    return this._getRandomMove(grid, empty);
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  Heuristic evaluation
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Scores a board position heuristically after the AI tentatively
   * places its mark at (r, c).
   *
   * **Scoring components:**
   *  1. **Offensive chains** — points for same-player chains through
   *     (r, c), with bonuses for open-ended chains (harder to block).
   *  2. **Defensive value** — partial credit for being adjacent to
   *     opponent chains (blocking potential).
   *  3. **Positional bonus** — centre cells score higher than edges;
   *     corners also receive a small bonus.
   *
   * @param {string[][]} grid     - Board with the AI's trial mark placed.
   * @param {number}     r        - Row of the trial mark.
   * @param {number}     c        - Column of the trial mark.
   * @param {string}     player   - The AI's mark.
   * @param {string}     opponent - The human's mark.
   * @param {number}     skill    - Current difficulty level (available for
   *   future skill-sensitive heuristic tuning).
   * @returns {number} A heuristic score (higher is better for the AI).
   */
  _evaluateBoard(grid, r, c, player, opponent, skill) {
    let score = 0;
    const size = grid.length;
    const dirs = DIRECTIONS;

    // ── 1. Offensive chain scoring ───────────────────────────────────
    for (const [dr, dc] of dirs) {
      const { length, openEnds } = this._getChainMetadata(grid, r, c, dr, dc, player);

      // Direct chain points (doubled to weight offence over defence)
      if (length >= 3) {
        score += chainScore(length) * 2;
      } else if (length === 2 && openEnds > 0) {
        score += 5;   // Encourage building 2-chains that can grow
      }

      // Open-end bonuses: chains with 2 open ends are very threatening
      if (openEnds === 2) score += 10;
      if (openEnds === 1) score += 3;
    }

    // ── 2. Defensive blocking value ──────────────────────────────────
    for (const [dr, dc] of dirs) {
      const { length, openEnds } = this._getChainMetadata(grid, r, c, dr, dc, opponent);

      if (length >= 3) {
        score += chainScore(length) * 1.5;   // Blocking is slightly less weighted than attacking
      }
      if (openEnds === 2 && length >= 2) score += 8;   // Urgent to block a double-open threat
    }

    // ── 3. Positional preference ─────────────────────────────────────
    const mid = Math.floor(size / 2);
    const distFromCenter = Math.abs(r - mid) + Math.abs(c - mid);
    score += (size - distFromCenter);   // Prefer cells closer to the centre

    // Small corner bonus (corners control two axes)
    if ((r === 0 || r === size - 1) && (c === 0 || c === size - 1)) {
      score += 2;
    }

    return score;
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  Chain analysis helpers
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Analyses a chain through (r, c) in a given direction, returning both
   * the chain length and the number of open ends (0, 1, or 2).
   *
   * An "open end" is a board cell adjacent to the chain's terminus that
   * is empty — meaning the chain can still be extended in that direction.
   *
   * @param {string[][]} grid
   * @param {number}     r
   * @param {number}     c
   * @param {number}     dr
   * @param {number}     dc
   * @param {string}     player
   * @returns {{ length: number, openEnds: number }}
   */
  _getChainMetadata(grid, r, c, dr, dc, player) {
    const size = grid.length;
    let length   = 1;
    let openEnds = 0;

    // Walk forward along (+dr, +dc)
    let nr = r + dr, nc = c + dc;
    while (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === player) {
      length++;
      nr += dr;
      nc += dc;
    }
    // Check if the cell just beyond the chain end is empty (open end)
    if (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === '') {
      openEnds++;
    }

    // Walk backward along (−dr, −dc)
    nr = r - dr; nc = c - dc;
    while (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === player) {
      length++;
      nr -= dr;
      nc -= dc;
    }
    // Check the backward open end
    if (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === '') {
      openEnds++;
    }

    return { length, openEnds };
  },

  /**
   * Returns the length of the longest chain through (r, c) across all
   * four cardinal/diagonal directions.
   *
   * @param {string[][]} grid
   * @param {number}     r
   * @param {number}     c
   * @param {string}     player
   * @returns {number} Maximum chain length.
   * @private
   */
  _bestChain(grid, r, c, player) {
    return Math.max(...DIRECTIONS.map(([dr, dc]) => getChainLength(grid, r, c, dr, dc, player)));
  },

  /**
   * Selects a random move from the list of empty cells, with a slight
   * bias toward the centre cell (30 % chance of picking it if available).
   *
   * @param {string[][]} grid  - The board (used to compute the centre).
   * @param {Array}      empty - List of `{ r, c }` objects.
   * @returns {{ r: number, c: number }}
   * @private
   */
  _getRandomMove(grid, empty) {
    const mid    = Math.floor(grid.length / 2);
    const center = empty.find(p => p.r === mid && p.c === mid);

    // 30 % chance to prefer the centre if it's available
    if (center && Math.random() < 0.3) return center;

    return randomChoice(empty);
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  Minimax (3×3 classic only)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Finds the optimal move on a 3×3 board using the minimax algorithm.
   *
   * Because the 3×3 game tree is small (≤ 9! = 362 880 nodes), this runs
   * in negligible time and guarantees perfect play — the AI will never
   * lose on a 3×3 board at skill ≥ 7.
   *
   * @param {string[][]} grid     - 3×3 board (mutated during search, restored).
   * @param {string}     aiPlayer - AI's mark.
   * @param {string}     opponent - Human's mark.
   * @returns {{ r: number, c: number } | null}
   * @private
   */
  _getMinimaxMove(grid, aiPlayer, opponent) {
    let bestScore = -Infinity;
    let move = null;

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (!grid[r][c]) {
          grid[r][c] = aiPlayer;
          let score = this._minimax(grid, 0, false, aiPlayer, opponent);
          grid[r][c] = '';

          if (score > bestScore) {
            bestScore = score;
            move = { r, c };
          }
        }
      }
    }
    return move;
  },

  /**
   * Recursive minimax evaluation for 3×3 boards.
   *
   * **Terminal conditions:**
   *  - Win by AI           → return `+10 − depth` (prefer faster wins).
   *  - Win by opponent      → return `depth − 10` (prefer slower losses).
   *  - Full board, no winner → return `0` (draw).
   *
   * @param {string[][]} grid          - Board state (mutated, then restored).
   * @param {number}     depth         - Current recursion depth.
   * @param {boolean}    isMaximizing  - `true` when it's the AI's hypothetical turn.
   * @param {string}     aiPlayer      - AI's mark.
   * @param {string}     opponent      - Human's mark.
   * @returns {number} Evaluation score.
   * @private
   */
  _minimax(grid, depth, isMaximizing, aiPlayer, opponent) {
    // --- Terminal check: win ---
    const result = check3x3Win(grid);
    if (result) {
      return result.winner === aiPlayer ? 10 - depth : depth - 10;
    }

    // --- Terminal check: draw (board full) ---
    let full = true;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (!grid[r][c]) { full = false; break; }
      }
    }
    if (full) return 0;

    // --- Recursive search ---
    if (isMaximizing) {
      // AI's turn: maximise score
      let bestScore = -Infinity;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          if (!grid[r][c]) {
            grid[r][c] = aiPlayer;
            bestScore = Math.max(bestScore, this._minimax(grid, depth + 1, false, aiPlayer, opponent));
            grid[r][c] = '';
          }
        }
      }
      return bestScore;
    } else {
      // Opponent's turn: minimise score
      let bestScore = Infinity;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          if (!grid[r][c]) {
            grid[r][c] = opponent;
            bestScore = Math.min(bestScore, this._minimax(grid, depth + 1, true, aiPlayer, opponent));
            grid[r][c] = '';
          }
        }
      }
      return bestScore;
    }
  }
};
