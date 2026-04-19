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
  createGrid 
} from './grid.js';
import { launchConfetti } from './confetti.js';
import { App } from './app.js';
import { makeCrownSvg } from './svg.js';
import { Multiplayer } from './multiplayer.js';

/* ---- Input handling ---- */

/**
 * Click handler attached to every empty cell element.
 * Validates all preconditions before forwarding to makeMove().
 *
 * @param {MouseEvent} e
 */
export function handleCellClick(e) {
  const cell = e.currentTarget;
  const r    = parseInt(cell.dataset.r, 10);
  const c    = parseInt(cell.dataset.c, 10);

  if (!State.gameActive)       return; // game not running
  if (State.paused)            return; // pause modal open
  if (State.isProcessing)      return; // already handling a move
  if (State.grid[r][c])        return; // cell already occupied

  // Ignore human clicks during AI's turn
  if (State.mode === 'single' && State.currentPlayer === 'O') return;

  // Ignore human clicks if it's not our turn in multiplayer
  if (State.isMultiplayer && State.currentPlayer !== State.playerRole) return;

  State.isProcessing = true;
  Render.updateTurnIndicator(); // Hide ghosts immediately
  makeMove(r, c);
}

// Register handler with Render module to break circular dependency
setCellClickHandler(handleCellClick);

/* ---- Core move flow ---- */

/**
 * Places the current player's mark at (r, c) and processes the outcome.
 * Called for both human moves and AI moves.
 *
 * @param {number}  r     - Row index.
 * @param {number}  c     - Column index.
 * @param {boolean} [isAI=false] - True when the AI is calling this function.
 */
export function makeMove(r, c, isAI = false) {
  if (!State.gameActive || State.grid[r][c]) return;

  State.isProcessing = true;

  // Save undo snapshot before every human move
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

  const player       = State.currentPlayer;
  State.grid[r][c]   = player;
  Render.updateCell(r, c, player);

  if (State.gridSize === 3) {
    _processMoveOn3x3();
  } else {
    _processMoveOnLargeGrid(r, c, player);
  }
}

/**
 * Post-move processing for the classic 3×3 board.
 * Checks for a win; if the board is full with no winner, expands.
 */
function _processMoveOn3x3() {
  const win = check3x3Win(State.grid);
  if (win) {
    Render.drawWinStrike(win.cells, win.winner);
    setTimeout(() => endGame(win.winner, 'classic'), 600);
    return;
  }
  if (isGridFull(State.grid)) {
    expandGrid();
    return;
  }
  switchTurn();
}

/**
 * Returns the cells for a full-board line of the current grid size.
 * If no winning line exists, returns null.
 * @param {number} r
 * @param {number} c
 * @param {'X'|'O'} player
 * @returns {number[][]|null}
 */
function _findFullChainWin(r, c, player) {
  const needed = State.gridSize;
  const directions = [[0,1], [1,0], [1,1], [1,-1]];

  for (const [dr, dc] of directions) {
    const len = getChainLength(State.grid, r, c, dr, dc, player);
    if (len >= needed) {
      return getChainCells(State.grid, r, c, dr, dc, player);
    }
  }

  return null;
}

/**
 * Post-move processing for 4×4+ boards.
 * Scores any new chains, then expands if the board is full.
 *
 * @param {number} r
 * @param {number} c
 * @param {'X'|'O'} player
 */
function _processMoveOnLargeGrid(r, c, player) {
  const winningLine = _findFullChainWin(r, c, player);
  if (winningLine) {
    Render.drawWinStrike(winningLine, player);
    setTimeout(() => endGame(player, 'classic'), 600);
    return;
  }

  const result = scoreMoveOnGrid(State.grid, r, c, player, State.scoredChains);

  if (result.points > 0) {
    State.scores[player] += result.points;
    Render.updateScore(player);
    Render.drawScoreStrikes(result.chains, player);

    // Toast for notable scores
    if (result.points >= 30) App.showToast(`${State.names[player]} +${result.points} pts!`);
    else if (result.points >= 20) App.showToast(`${State.names[player]} +${result.points} pts!`);
  }

  if (isGridFull(State.grid)) {
    if (State.scores.X === State.scores.O) {
      expandGrid();
      return;
    }

    const winner = State.scores.X > State.scores.O ? 'X' : 'O';
    setTimeout(() => endGame(winner, 'classic'), 300);
    return;
  }

  switchTurn();
}

/* ---- Turn management ---- */

/**
 * Advances to the next player's turn and triggers the AI if applicable.
 */
export function switchTurn() {
  State.currentPlayer = State.currentPlayer === 'X' ? 'O' : 'X';
  State.isProcessing = false; // Turn is now open for input
  Render.updateTurnIndicator();

  // Sync turn switch to Firebase
  if (State.isMultiplayer) {
    Multiplayer.pushState();
  }

  if (State.mode === 'single' && State.currentPlayer === 'O' && State.gameActive) {
    triggerAI();
  }
}

/**
 * Shows the AI "thinking" indicator and schedules the AI move after
 * AI_DELAY_MS milliseconds.  The delay prevents the AI from feeling
 * instantaneous and gives the human a moment to see what just happened.
 */
export function triggerAI() {
  document.getElementById('ai-thinking').style.display = 'flex';

  // Random delay to simulate human thinking: 500ms to 2500ms
  const delay = 500 + Math.random() * 2000;

  State.aiTimeout = setTimeout(() => {
    document.getElementById('ai-thinking').style.display = 'none';
    if (!State.gameActive) return;

    // AI receives a copy so the lookahead cannot mutate the real board
    const move = AI.getBestMove(copyGrid(State.grid), 'O', 'X', State.aiLevel);
    if (move) makeMove(move.r, move.c, /* isAI */ true);
  }, delay);
}

/* ---- Grid expansion ---- */

/**
 * Grows the board by one row and one column (tie resolution).
 * Rebuilds the grid DOM after a brief animation delay.
 */
export function expandGrid() {
  const oldSize  = State.gridSize;
  State.gridSize += 1;

  // Expand the 2-D array in-place
  State.grid.forEach(row => row.push(''));
  State.grid.push(Array(State.gridSize).fill(''));

  Render.animateGridExpand();
  App.showToast(`Board grows to ${State.gridSize}×${State.gridSize}!`);
  State.isProcessing = true;

  // Short delay so the expand animation finishes before the DOM rebuild
  setTimeout(() => {
    Render.buildGrid(State.gridSize, oldSize);
    State.isProcessing = false;
    switchTurn();
  }, 300);
}

/* ---- Game over ---- */

/**
 * Ends the current game, updates the game-over screen, persists stats,
 * and navigates to the gameover screen.
 *
 * @param {'X'|'O'|'draw'} winner - Winning player mark, or 'draw'.
 * @param {'classic'|'timeout'} reason - How the game ended.
 */
export function endGame(winner, reason) {
  State.gameActive = false;
  State.isProcessing = false;
  State.winner = winner;
  clearTimers();

  _renderGameOverScreen(winner, reason);
  App.showScreen('gameover');
  _persistStats();
  
  if (State.isMultiplayer) {
    Multiplayer.pushState();
  }
}

/**
 * Fills in all game-over screen elements based on the outcome.
 * @param {string} winner
 * @param {string} reason
 */
function _renderGameOverScreen(winner, reason) {
  const goEmoji    = document.getElementById('go-emoji');
  const goTitle    = document.getElementById('go-title');
  const goSubtitle = document.getElementById('go-subtitle');
  const goScores   = document.getElementById('go-scores');
  const goMeta     = document.getElementById('go-meta');

  const isDraw = (winner === 'draw' || (!winner && State.scores.X === State.scores.O));
  // Determine winner by score if not explicitly passed, or 'draw'
  const w = isDraw ? 'draw' : (winner || (State.scores.X > State.scores.O ? 'X' : 'O'));

  if (isDraw) {
    goEmoji.innerHTML = '🤝'; // Simple hand-shake for draw
    goEmoji.className = 'gameover-emoji';
    goEmoji.style.color = 'var(--fg-secondary)';
    
    goTitle.textContent = "DRAW";
    goTitle.className   = 'gameover-title draw';
    goSubtitle.textContent = "A well-fought battle.";
  } else {
    const winnerName = State.names[w];
    
    goEmoji.innerHTML = `
      <div class="winner-initial ${w.toLowerCase()}-color">
        <div class="winner-crown">${makeCrownSvg()}</div>
        ${w}
      </div>`;
    goEmoji.className = 'gameover-emoji';
    
    // Choose an emotional title based on the outcome
    let titles = ["VICTORY!", "DOMINATION!", "YOU WIN!", "CHAMPION!"];
    let quotes = ["dominated the field.", "showed no mercy.", "takes the crown.", "is unstoppable."];
    
    // Multiplayer perspective
    if (State.isMultiplayer) {
      if (w === State.playerRole) {
        titles = ["VICTORY!", "DOMINATION!", "YOU WON!", "CHAMPION!"];
        quotes = ["dominated the field.", "takes the crown.", "is the master!"];
      } else {
        titles = ["OUCH!", "DEFEAT", "TOUGH BREAK", "NEXT TIME!"];
        quotes = ["got outplayed.", "almost had it!", "needs a rematch!"];
      }
    } 
    // Single-player perspective (AI won)
    else if (State.mode === 'single' && w === 'O') {
      titles = ["DEFEAT", "GAME OVER", "AI VICTORIOUS", "AI DOMINATES"];
    }

    const isDefeat = (State.isMultiplayer && w !== State.playerRole) || (State.mode === 'single' && w === 'O');

    goTitle.textContent = titles[Math.floor(Math.random() * titles.length)];
    goTitle.className   = `gameover-title ${isDefeat ? 'defeat' : `win-${w.toLowerCase()}`}`;
    goSubtitle.textContent = `${winnerName} ${quotes[Math.floor(Math.random() * quotes.length)]}`;
    
    // Only launch confetti if a human won (X in single mode, either in dual)
    if (State.mode === 'dual' || w === 'X') {
      launchConfetti(w);
    }
  }

  // Build the two score rows
  // Determine winners/losers based on the 'w' variable (the game winner)
  // This ensures correct ordering even if scores are tied (e.g. 3x3 board win)
  const isXWinner = (w === 'X');
  const isOWinner = (w === 'O');

  const crown = `<span class="score-winner-crown">${makeCrownSvg()}</span>`;

  // Explicitly annotate players natively with (You) for clarity if multiplayer
  const xName = State.isMultiplayer && State.playerRole === 'X' ? `${State.names.X} (You)` : State.names.X;
  const oName = State.isMultiplayer && State.playerRole === 'O' ? `${State.names.O} (You)` : State.names.O;

  // Order the score rows: winner always on top
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

  goScores.innerHTML = isOWinner ? (oRow + xRow) : (xRow + oRow);
  
  // Hide scores if both are zero (classic 3x3 win with no points)
  if (State.scores.X === 0 && State.scores.O === 0) {
    goScores.style.display = 'none';
  } else {
    goScores.style.display = 'flex';
  }

  // Duration label for the meta line
  const durLabel =
    State.duration === 0  ? 'Unlimited' :
    State.duration === 60 ? '1 min'     :
    `${State.duration / 60} min`;

  goMeta.textContent = `${State.gridSize}×${State.gridSize} grid · ${durLabel}`;
}

/**
 * Persists aggregate game statistics to localStorage.
 * Silently swallows any storage errors (e.g. private browsing mode).
 */
function _persistStats() {
  try {
    const saved          = JSON.parse(localStorage.getItem('ttg_stats') || '{}');
    saved.gamesPlayed    = (saved.gamesPlayed   || 0) + 1;
    saved.largestGrid    = Math.max(saved.largestGrid   || 3, State.gridSize);
    saved.highestScore   = Math.max(saved.highestScore  || 0, Math.max(State.scores.X, State.scores.O));
    localStorage.setItem('ttg_stats', JSON.stringify(saved));
  } catch (_) { /* storage unavailable — not a critical failure */ }
}

/* ---- Timer cleanup ---- */

/**
 * Clears both the countdown interval and any pending AI timeout.
 * Safe to call even if neither is active.
 */
export function clearTimers() {
  if (State.timerInterval) { clearInterval(State.timerInterval); State.timerInterval = null; }
  if (State.aiTimeout)     { clearTimeout(State.aiTimeout);      State.aiTimeout     = null; }
}
