/**
 * @file game.js — Core game loop and move processing for Tic Tac Grow.
 *
 * This module owns the runtime game lifecycle:
 *
 *  • **Input handling**    — validates preconditions on cell clicks.
 *  • **Move processing**   — places marks, checks outcomes, awards points.
 *  • **Turn management**   — alternates players, triggers AI.
 *  • **Grid expansion**    — grows the board on ties.
 *  • **Game over**         — renders the result screen, persists stats.
 *  • **Timer cleanup**     — clears countdown and AI timeouts.
 *
 * The module bridges to Render for DOM updates, to AI for computer moves,
 * and to Multiplayer for remote state synchronisation.
 *
 * @module game
 */

import { State } from './state.js';
import { Render, setCellClickHandler } from './render.js';
import { AI } from './ai.js';
import {
  copyGrid,
  isGridFull,
  check3x3Win,
  scoreMoveOnGrid,
  getChainLength,
  getChainCells,
  createGrid,
  DIRECTIONS
} from './grid.js';
import { launchConfetti } from './confetti.js';
import { App } from './app.js';
import { makeCrownSvg } from './svg.js';
import { Multiplayer } from './multiplayer.js';
import { hapticFeedback } from './utils.js';
import { Tutorial } from './tutorial.js';
import { i18n } from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
//  Input handling
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Click handler attached to every empty cell element.
 *
 * Validates a comprehensive set of preconditions before forwarding to
 * {@link makeMove}.  Guards against clicks during:
 *  - Inactive game state (pre-game or game-over).
 *  - Pause modal being open.
 *  - Move/animation currently processing (debounce interlock).
 *  - Cell already occupied.
 *  - AI's turn (single-player).
 *  - Opponent's turn (multiplayer).
 *
 * @param {MouseEvent} e - The click event on a cell `<div>`.
 */
export function handleCellClick(e) {
  const cell = e.currentTarget;
  const r    = parseInt(cell.dataset.r, 10);
  const c    = parseInt(cell.dataset.c, 10);

  // --- Precondition guards (order matters for UX responsiveness) ---
  if (!State.gameActive)       return;   // Game not running
  if (State.paused)            return;   // Pause modal is open
  if (State.isProcessing)      return;   // Already handling a move
  if (State.grid[r][c])        return;   // Cell already occupied

  // Block input when it's the AI's turn
  if (State.mode === 'single' && State.currentPlayer === 'O') return;

  // Block input when it's the remote opponent's turn
  if (State.isMultiplayer && State.currentPlayer !== State.playerRole) return;

  // Check if tutorial allows this move
  if (!Tutorial.handleMove(r, c)) return;

  // All guards passed — lock input and execute the move
  State.isProcessing = true;
  Render.updateTurnIndicator();   // Hide ghosts immediately
  makeMove(r, c);
}

// Register handler with the Render module to break the circular dependency
// (Render needs this handler, but this module imports Render).
setCellClickHandler(handleCellClick);

// ═══════════════════════════════════════════════════════════════════════════
//  Core move flow
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Places the current player's mark at (r, c) and processes the outcome.
 *
 * Called for both human moves (via {@link handleCellClick}) and AI moves
 * (via {@link triggerAI}).
 *
 * **Flow:**
 *  1. Final guard: bail if the game ended or the cell is occupied.
 *  2. Snapshot the board for undo (human moves only).
 *  3. Place the mark in State and update the DOM.
 *  4. Delegate outcome processing to the appropriate handler based on
 *     board size (3×3 classic rules vs 4×4+ scoring rules).
 *
 * @param {number}  r      - Row index.
 * @param {number}  c      - Column index.
 * @param {boolean} [isAI=false] - `true` when called by the AI engine.
 */
export function makeMove(r, c, isAI = false) {
  if (!State.gameActive || State.grid[r][c]) return;

  State.isProcessing = true;

  // ── Save undo snapshot before every human move ─────────────────────
  // (AI moves are excluded — the undo should revert to "before the
  //  human's last move", not to "before the AI's response".)
  if (!isAI) {
    State.undoSnapshot = {
      grid:          copyGrid(State.grid),
      scores:        { ...State.scores },
      currentPlayer: State.currentPlayer,
      scoredChains:  new Set(State.scoredChains),
      scoredLines:   [...State.scoredLines],
      gridSize:      State.gridSize,
    };
  }

  // ── Place the mark ─────────────────────────────────────────────────
  const player       = State.currentPlayer;
  State.grid[r][c]   = player;
  State.lastMove     = { r, c, player };
  Render.updateCell(r, c, player);

  // Haptic feedback on mobile devices (10ms light tap)
  hapticFeedback(10);

  // ── Delegate to board-size-specific outcome processor ──────────────
  if (State.gridSize === 3) {
    _processMoveOn3x3();
  } else {
    _processMoveOnLargeGrid(r, c, player);
  }

  // Synchronise move to Firebase (granular update)
  if (State.isMultiplayer) {
    Multiplayer.pushMove(r, c, player);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Outcome processors (private)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Post-move processing for the classic 3×3 board.
 *
 * **Rules:**
 *  - If a player completes a line of 3 → instant win.
 *  - If the board is full with no winner → grid expands to 4×4 (tie).
 *  - Otherwise → switch turn.
 *
 * @private
 */
function _processMoveOn3x3() {
  const win = check3x3Win(State.grid);

  if (win) {
    Render.drawWinStrike(win.cells, win.winner);
    setTimeout(() => endGame(win.winner, 'classic'), 350);
    return;
  }

  if (isGridFull(State.grid)) {
    // Board full with no winner → expand the grid (tie resolution)
    expandGrid();
    return;
  }

  switchTurn();
}

/**
 * Checks whether the move at (r, c) completes a full-board-length chain
 * (i.e. a line of `gridSize` marks).  If so, returns the winning cells.
 *
 * On 4×4+ boards this is a secondary "instant win" condition alongside
 * the primary scoring system — filling an entire row/column/diagonal
 * ends the game immediately.
 *
 * @param {number}    r      - Row of the last move.
 * @param {number}    c      - Column of the last move.
 * @param {'X'|'O'}   player - Mark placed.
 * @returns {number[][] | null} Winning cells, or `null`.
 * @private
 */
function _findFullChainWin(r, c, player) {
  const needed = State.gridSize;

  for (const [dr, dc] of DIRECTIONS) {
    const len = getChainLength(State.grid, r, c, dr, dc, player);
    if (len >= needed) {
      return getChainCells(State.grid, r, c, dr, dc, player);
    }
  }

  return null;
}

/**
 * Post-move processing for 4×4+ boards.
 *
 * **Rules:**
 *  1. Full-chain win → instant game end (same player filled an entire
 *     row, column, or diagonal).
 *  2. Award incremental points for any new chains ≥ 3.
 *  3. If the board is full:
 *     - Tied scores → expand grid (tie resolution).
 *     - Unequal scores → high scorer wins.
 *  4. Otherwise → switch turn.
 *
 * @param {number}    r      - Row of the last move.
 * @param {number}    c      - Column of the last move.
 * @param {'X'|'O'}   player - Mark just placed.
 * @private
 */
function _processMoveOnLargeGrid(r, c, player) {
  // ── Check for full-chain instant win ───────────────────────────────
  const winningLine = _findFullChainWin(r, c, player);
  if (winningLine) {
    Render.drawWinStrike(winningLine, player);
    setTimeout(() => endGame(player, 'classic'), 350);
    return;
  }

  // ── Score any new chains created by this move ──────────────────────
  const result = scoreMoveOnGrid(State.grid, r, c, player, State.scoredChains);

  if (result.points > 0) {
    State.scores[player] += result.points;
    Render.updateScore(player);
    Render.drawScoreStrikes(result.chains, player);

    // Show floating score text at the last move position
    showFloatingScore(r, c, result.points, player);

    // Stronger haptic feedback for scoring moves
    hapticFeedback(20);

    // Notify the player with a toast for notable scores
    if (result.points >= 20) {
      App.showToast(`${State.names[player]} +${result.points} pts!`);
    }
  }

  // ── Check if the board is full ─────────────────────────────────────
  if (isGridFull(State.grid)) {
    if (State.scores.X === State.scores.O) {
      // Tied scores → expand the grid to break the deadlock
      expandGrid();
      return;
    }

    // Unequal scores → declare the higher scorer the winner
    const winner = State.scores.X > State.scores.O ? 'X' : 'O';
    setTimeout(() => endGame(winner, 'classic'), 300);
    return;
  }

  switchTurn();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Turn management
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Advances to the next player's turn.
 *
 * After switching:
 *  - Unlocks the input interlock (`isProcessing = false`).
 *  - Updates the turn indicator and ghost previews.
 *  - Pushes the new state to Firebase (multiplayer).
 *  - Triggers the AI if it's now the computer's turn (single-player).
 */
export function switchTurn() {
  State.currentPlayer = State.currentPlayer === 'X' ? 'O' : 'X';
  State.isProcessing  = false;   // Turn is now open for input
  Render.updateTurnIndicator();

  // Synchronise turn change to Firebase (granular update)
  if (State.isMultiplayer) {
    Multiplayer.pushStateUpdate({ currentPlayer: State.currentPlayer });
  }

  // Trigger the AI if it's now the computer's turn
  if (State.mode === 'single' && State.currentPlayer === 'O' && State.gameActive) {
    triggerAI();
  }
}

/**
 * Shows the "AI thinking…" indicator and schedules the AI's move after
 * a short delay (150–400 ms).
 *
 * The delay prevents the AI from feeling instantaneous and gives the
 * human player a moment to observe the board after their own move.
 */
export function triggerAI() {
  State.isThinking = true;
  Render.updateTurnIndicator();

  // Snappy thinking delay — just enough to feel responsive
  const delay = 150 + Math.random() * 250;

  State.aiTimeout = setTimeout(() => {
    State.isThinking = false;
    Render.updateTurnIndicator();

    if (!State.gameActive) return;   // Game may have ended while "thinking"

    // AI receives a **copy** of the grid so look-ahead mutations
    // cannot corrupt the real board
    const move = AI.getBestMove(copyGrid(State.grid), 'O', 'X', State.aiLevel);
    if (move) makeMove(move.r, move.c, /* isAI */ true);
  }, delay);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Grid expansion
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Grows the board by one row and one column (tie resolution).
 *
 * **Expansion algorithm:**
 *  1. Increment `State.gridSize`.
 *  2. Append an empty cell to each existing row (new column).
 *  3. Push a new full-width empty row (new row).
 *  4. Play the expand animation.
 *  5. After a short delay, rebuild the DOM and switch turns.
 */
export function expandGrid() {
  const oldSize  = State.gridSize;
  State.gridSize += 1;

  // Expand the 2-D array in-place: add one column to each existing row…
  State.grid.forEach(row => row.push(''));
  // …then add a new full-width row
  State.grid.push(Array(State.gridSize).fill(''));

  Render.animateGridExpand();
  App.showToast(`Board grows to ${State.gridSize}×${State.gridSize}!`);
  hapticFeedback(30);

  if (Tutorial.active) Tutorial.nextStep();

  // Lock input during the expansion animation
  State.isProcessing = true;

  // Short delay lets the CSS animation finish before the DOM rebuild
  setTimeout(() => {
    Render.buildGrid(State.gridSize, oldSize);
    State.isProcessing = false;
    
    // Sync expanded grid and new turn to Firebase
    if (State.isMultiplayer) {
      Multiplayer.pushStateUpdate({
        grid: State.grid,
        gridSize: State.gridSize,
        currentPlayer: State.currentPlayer === 'X' ? 'O' : 'X' // Prepare for switchTurn
      });
    }

    switchTurn();
  }, 300);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Game over
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Terminates the current game, renders the game-over screen, persists
 * stats to localStorage, and notifies the remote player if multiplayer.
 *
 * @param {'X'|'O'|'draw'} winner - Winning player mark, or `'draw'`.
 * @param {'classic'|'timeout'}   reason - How the game ended.
 */
export function endGame(winner, reason) {
  State.gameActive   = false;
  State.isProcessing = false;
  State.winner       = winner;
  clearTimers();

  _renderGameOverScreen(winner, reason);
  App.showScreen('gameover');
  _persistStats();

  // Push final state to Firebase so the remote player sees the result
  if (State.isMultiplayer) {
    Multiplayer.pushState();
  }
}

/**
 * Populates all game-over screen elements (emoji, title, subtitle,
 * scorecard, and metadata) based on the match outcome.
 *
 * Handles four distinct outcome cases:
 *  - **Draw** — handshake emoji, neutral title.
 *  - **Human win (single-player)** — victory title + confetti.
 *  - **AI win (single-player)** — defeat title, no confetti.
 *  - **Multiplayer** — perspective-aware titles ("Victory" vs "Defeat").
 *
 * @param {string} winner - `'X'`, `'O'`, or `'draw'`.
 * @param {string} reason - `'classic'` or `'timeout'`.
 * @private
 */
function _renderGameOverScreen(winner, reason) {
  const goEmoji    = document.getElementById('go-emoji');
  const goTitle    = document.getElementById('go-title');
  const goSubtitle = document.getElementById('go-subtitle');
  const goScores   = document.getElementById('go-scores');
  const goMeta     = document.getElementById('go-meta');

  // Resolve the effective winner (accounting for score ties)
  const isDraw = (winner === 'draw' || (!winner && State.scores.X === State.scores.O));
  const w = isDraw ? 'draw' : (winner || (State.scores.X > State.scores.O ? 'X' : 'O'));

  // ── Draw outcome ───────────────────────────────────────────────────
  if (isDraw) {
    goEmoji.innerHTML = '🤝';
    goEmoji.className = 'gameover-emoji';
    goEmoji.style.color = 'var(--fg-secondary)';

    goTitle.textContent = "DRAW";
    goTitle.className   = 'gameover-title draw';
    goSubtitle.textContent = "A well-fought battle.";
  }
  // ── Win / loss outcome ─────────────────────────────────────────────
  else {
    const winnerName = State.names[w];

    // Winner initial with crown icon
    goEmoji.innerHTML = `
      <div class="winner-initial ${w.toLowerCase()}-color">
        <div class="winner-crown">${makeCrownSvg()}</div>
        ${w}
      </div>`;
    goEmoji.className = 'gameover-emoji';

    // Choose context-appropriate title and subtitle
    let titles = ["VICTORY!", "DOMINATION!", "YOU WIN!", "CHAMPION!"];
    let quotes = ["dominated the field.", "showed no mercy.", "takes the crown.", "is unstoppable."];

    if (State.isMultiplayer) {
      // Multiplayer: perspective-aware messaging
      if (w === State.playerRole) {
        titles = ["VICTORY!", "DOMINATION!", "YOU WON!", "CHAMPION!"];
        quotes = ["dominated the field.", "takes the crown.", "is the master!"];
      } else {
        titles = ["OUCH!", "DEFEAT", "TOUGH BREAK", "NEXT TIME!"];
        quotes = ["got outplayed.", "almost had it!", "needs a rematch!"];
      }
    } else if (State.mode === 'single' && w === 'O') {
      // Single-player: AI won
      titles = ["DEFEAT", "GAME OVER", "AI VICTORIOUS", "AI DOMINATES"];
    }

    const isDefeat = (State.isMultiplayer && w !== State.playerRole) ||
                     (State.mode === 'single' && w === 'O');

    goTitle.textContent = titles[Math.floor(Math.random() * titles.length)];
    goTitle.className   = `gameover-title ${isDefeat ? 'defeat' : `win-${w.toLowerCase()}`}`;
    goSubtitle.textContent = `${winnerName} ${quotes[Math.floor(Math.random() * quotes.length)]}`;

    // Launch confetti only for human victories
    if (State.mode === 'dual' || w === 'X') {
      launchConfetti(w);
    }
  }

  // ── Score rows ─────────────────────────────────────────────────────
  // Winner is placed on top; loser is visually demoted.
  const isXWinner = (w === 'X');
  const isOWinner = (w === 'O');

  const crown = `<span class="score-winner-crown">${makeCrownSvg()}</span>`;

  // Annotate the local player's name with "(You)" in multiplayer
  const xName = State.isMultiplayer && State.playerRole === 'X'
    ? `${State.names.X} (You)` : State.names.X;
  const oName = State.isMultiplayer && State.playerRole === 'O'
    ? `${State.names.O} (You)` : State.names.O;

  const xRow = `
    <div class="gameover-score-row x-row ${isXWinner ? 'winner-row' : (isOWinner ? 'loser-row' : '')}">
      <span class="score-name-cell">${isXWinner ? crown : ''}${xName}</span>
      <span>${State.scores.X} pts</span>
    </div>`;
  const oRow = `
    <div class="gameover-score-row o-row ${isOWinner ? 'winner-row' : (isXWinner ? 'loser-row' : '')}">
      <span class="score-name-cell">${isOWinner ? crown : ''}${oName}</span>
      <span>${State.scores.O} pts</span>
    </div>`;

  // Place the winner's row on top
  goScores.innerHTML = isOWinner ? (oRow + xRow) : (xRow + oRow);

  // Hide scores entirely for classic 3×3 wins (0-0 scoreboard looks odd)
  if (State.scores.X === 0 && State.scores.O === 0) {
    goScores.style.display = 'none';
  } else {
    goScores.style.display = 'flex';
  }

  goMeta.textContent = `${State.gridSize}×${State.gridSize} grid`;
}

/**
 * Persists aggregate game statistics (total games, largest grid, highest
 * score) to localStorage under the key `ttg_stats`.
 *
 * Silently swallows any storage errors (e.g. private browsing mode or
 * storage quota exceeded).
 *
 * @private
 */
function _persistStats() {
  try {
    const statsJSON = localStorage.getItem('ttg_stats') || '{}';
    const stats = JSON.parse(statsJSON);
    
    stats.gamesPlayed = (stats.gamesPlayed || 0) + 1;
    if (State.scores.X > (stats.highestScore || 0)) stats.highestScore = State.scores.X;
    if (State.scores.O > (stats.highestScore || 0)) stats.highestScore = State.scores.O;
    if (State.gridSize > (stats.largestGrid || 0)) stats.largestGrid = State.gridSize;

    localStorage.setItem('ttg_stats', JSON.stringify(stats));
    
    // Sync to Cloud if authenticated
    Multiplayer.pushStat('gamesPlayed', stats.gamesPlayed);
    Multiplayer.pushStat('highestScore', stats.highestScore);
    Multiplayer.pushStat('largestGrid', stats.largestGrid);
  } catch (err) {}
}

// ═══════════════════════════════════════════════════════════════════════════
//  Timer cleanup
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Clears both the countdown interval and any pending AI move timeout.
 *
 * Safe to call at any time — if neither timer is active, this is a no-op.
 */
export function clearTimers() {
  if (State.timerInterval) { clearInterval(State.timerInterval); State.timerInterval = null; }
  if (State.aiTimeout)     { clearTimeout(State.aiTimeout);      State.aiTimeout     = null; }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Floating score animation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shows a floating "+N" text animation at the specified cell.
 * @param {number} r - Row of the cell.
 * @param {number} c - Column of the cell.
 * @param {number} points - Points to display.
 * @param {'X'|'O'} player - The scoring player.
 */
function showFloatingScore(r, c, points, player) {
  const cell = Render.getCell(r, c);
  if (!cell) return;

  const floatEl = document.createElement('div');
  floatEl.className = 'floating-score';
  floatEl.textContent = `+${points}`;
  floatEl.style.color = player === 'X' ? 'var(--color-x)' : 'var(--color-o)';

  // Position at the center of the cell using relative percentages to handle zoom
  const cellSize = Render.cellSize || 60;
  const gap = 6;
  const padding = 6;

  // Calculate position based on grid coordinates (works with zoom/pan)
  const x = padding + c * (cellSize + gap) + cellSize / 2;
  const y = padding + r * (cellSize + gap) + cellSize / 2;

  floatEl.style.left = `${x}px`;
  floatEl.style.top = `${y}px`;

  document.getElementById('game-grid').appendChild(floatEl);

  // Remove floatEl after animation completes
  setTimeout(() => floatEl.remove(), 1200);

  // Sparkle particles
  for (let i = 0; i < 8; i++) {
    const p = document.createElement('div');
    p.className = 'score-sparkle';
    p.style.backgroundColor = player === 'X' ? 'var(--color-x)' : 'var(--color-o)';
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    
    // Random trajectory
    const angle = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 40;
    p.style.setProperty('--tx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--ty', `${Math.sin(angle) * dist}px`);
    
    document.getElementById('game-grid').appendChild(p);
    setTimeout(() => p.remove(), 800);
  }
}
