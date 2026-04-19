import { LEVEL, chainScore } from './constants.js';
import { check3x3Win, getChainLength } from './grid.js';
import { randomChoice } from './utils.js';

export const AI = {

  /**
   * Returns the best move for the AI player.
   *
   * @param {string[][]} grid           - A COPY of the board (safe to mutate).
   * @param {string}     aiPlayer       - 'X' or 'O' (AI's mark).
   * @param {string}     opponentPlayer - The human's mark.
   * @param {number}     [skillOverride]- Optional skill (1-10).
   * @returns {{ r: number, c: number }|null} Chosen cell, or null if board is full.
   */
  getBestMove(grid, aiPlayer, opponentPlayer, skillOverride) {
    const size  = grid.length;
    const empty = [];

    // Collect all playable cells
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!grid[r][c]) empty.push({ r, c });
      }
    }

    if (!empty.length) return null;

    const skill = Math.min(Math.max(Number.isFinite(skillOverride) ? skillOverride : (Number.isFinite(LEVEL) ? LEVEL : 6), 1), 10);

    // --- Difficulty Scaling Logic ---
    // Skill 1: 90% random
    // Skill 10: 0% random
    const randomChance = Math.max(0, (10 - skill) / 10 - 0.1); 
    if (Math.random() < randomChance) {
      return this._getRandomMove(grid, empty);
    }

    // --- Special Case: 3x3 Classic Board ---
    // At higher skill levels (7+), use minimax for a perfect game.
    if (size === 3 && skill >= 7) {
      return this._getMinimaxMove(grid, aiPlayer, opponentPlayer);
    }

    // --- Priority 1: Win immediately ---
    for (const pos of empty) {
      grid[pos.r][pos.c] = aiPlayer;
      const wins  = size === 3  ? check3x3Win(grid) : null;
      const chain = size >= 4   ? this._bestChain(grid, pos.r, pos.c, aiPlayer) : 0;
      grid[pos.r][pos.c] = '';
      if (wins || chain >= size) return pos;
    }

    // --- Priority 2: Block opponent's immediate win / critical threat ---
    // Higher skill means blocking smaller chains (more aggressive)
    const blockThreshold = skill >= 7 ? 3 : (skill >= 4 ? 4 : 5);
    for (const pos of empty) {
      grid[pos.r][pos.c] = opponentPlayer;
      const wins  = size === 3  ? check3x3Win(grid) : null;
      const chain = size >= 4   ? this._bestChain(grid, pos.r, pos.c, opponentPlayer) : 0;
      grid[pos.r][pos.c] = '';
      if (wins || chain >= blockThreshold) return pos;
    }

    // --- Priority 3: Evaluation-based move ---
    let bestMoves = [];
    let maxEval = -Infinity;

    for (const pos of empty) {
      grid[pos.r][pos.c] = aiPlayer;
      let score = this._evaluateBoard(grid, pos.r, pos.c, aiPlayer, opponentPlayer, skill);

      // --- Advanced Look-ahead (Skill 9-10) ---
      // For each move, simulate the opponent's best response and subtract it from the score.
      if (skill >= 9) {
        let maxOpponentResponse = 0;
        // Check a subset of plausible opponent moves to keep it fast
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
        score -= maxOpponentResponse * 0.8; // Penalize moves that allow high-scoring responses
      }

      grid[pos.r][pos.c] = '';

      if (score > maxEval) {
        maxEval = score;
        bestMoves = [pos];
      } else if (score === maxEval) {
        bestMoves.push(pos);
      }
    }

    // Pick from the best evaluated moves
    if (bestMoves.length > 0) {
      return randomChoice(bestMoves);
    }

    return this._getRandomMove(grid, empty);
  },

  /** 
   * Enhanced heuristic evaluation of a move.
   */
  _evaluateBoard(grid, r, c, player, opponent, skill) {
    let score = 0;
    const size = grid.length;
    const dirs = [[0,1], [1,0], [1,1], [1,-1]];

    // 1. Scoring own potential chains
    for (const [dr, dc] of dirs) {
      const { length, openEnds } = this._getChainMetadata(grid, r, c, dr, dc, player);
      
      // Points for length
      if (length >= 3) {
        score += chainScore(length) * 2;
      } else if (length === 2 && openEnds > 0) {
        score += 5; // Preference for creating 2-chains with space
      }

      // Bonus for open-ended chains (huge threat)
      if (openEnds === 2) score += 10;
      if (openEnds === 1) score += 3;
    }

    // 2. Blocking opponent chains (Defense)
    for (const [dr, dc] of dirs) {
      const { length, openEnds } = this._getChainMetadata(grid, r, c, dr, dc, opponent);
      if (length >= 3) {
        score += chainScore(length) * 1.5;
      }
      if (openEnds === 2 && length >= 2) score += 8;
    }

    // 3. Positional preference
    const mid = Math.floor(size / 2);
    const distFromCenter = Math.abs(r - mid) + Math.abs(c - mid);
    score += (size - distFromCenter); // Prefer center

    // Corners bonus
    if ((r === 0 || r === size - 1) && (c === 0 || c === size - 1)) {
      score += 2;
    }

    return score;
  },

  /**
   * Helper to get length and how many ends are "open" (free to expand).
   */
  _getChainMetadata(grid, r, c, dr, dc, player) {
    const size = grid.length;
    let length = 1;
    let openEnds = 0;

    // Check forward
    let nr = r + dr, nc = c + dc;
    while (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === player) {
      length++;
      nr += dr;
      nc += dc;
    }
    if (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === '') {
      openEnds++;
    }

    // Check backward
    nr = r - dr; nc = c - dc;
    while (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === player) {
      length++;
      nr -= dr;
      nc -= dc;
    }
    if (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === '') {
      openEnds++;
    }

    return { length, openEnds };
  },

  _bestChain(grid, r, c, player) {
    const dirs = [[0,1], [1,0], [1,1], [1,-1]];
    return Math.max(...dirs.map(([dr, dc]) => getChainLength(grid, r, c, dr, dc, player)));
  },

  _getRandomMove(grid, empty) {
    // Weighted random: prefer center/corners even for "random" moves
    const mid = Math.floor(grid.length / 2);
    const center = empty.find(p => p.r === mid && p.c === mid);
    if (center && Math.random() < 0.3) return center;
    
    return randomChoice(empty);
  },

  /**
   * Simple Minimax for 3x3 classic Tic Tac Toe.
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

  _minimax(grid, depth, isMaximizing, aiPlayer, opponent) {
    const result = check3x3Win(grid);
    if (result) {
      return result.winner === aiPlayer ? 10 - depth : depth - 10;
    }
    
    // Check for draw
    let full = true;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (!grid[r][c]) { full = false; break; }
      }
    }
    if (full) return 0;

    if (isMaximizing) {
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
