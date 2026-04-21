'use strict';

/**
 * @file state.js — Centralised game state for Tic Tac Grow.
 *
 * This object is the **single source of truth** for all mutable game data.
 * No module should read the DOM to infer game state — instead, read/write
 * properties here and let {@link module:render|Render} synchronise the UI.
 *
 * Properties are grouped into logical sections:
 *  1. **Game mode & config** — mode, duration, AI level.
 *  2. **Board state**        — grid, size, current player, scores.
 *  3. **Scoring history**    — chain IDs and visual strike lines.
 *  4. **Timers**             — interval and timeout handles.
 *  5. **Zoom / Pan**         — viewport transform state.
 *  6. **UI flags**           — processing lock, pause toggle.
 *  7. **Multiplayer**        — room code, role, user identity.
 *
 * @module state
 */

/**
 * @typedef {'single'|'dual'} GameMode
 *   - `'single'` — human vs AI.
 *   - `'dual'`   — human vs human (local or online).
 *
 * @typedef {'X'|'O'|''} Cell
 *   A single board cell: `'X'`, `'O'`, or empty string.
 */

export const State = {

  // ═══════════════════════════════════════════════════════════════════════
  //  1. GAME MODE & CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════

  /** @type {GameMode} Currently active game mode. */
  mode: 'dual',

  /**
   * Game duration in seconds.
   * `0` means unlimited — the countdown timer is hidden entirely.
   */
  duration: 180,

  /**
   * AI difficulty level on a 1–10 scale.
   * Only relevant when `mode === 'single'`.
   * @see module:constants.LEVEL
   */
  aiLevel: 6,

  // ═══════════════════════════════════════════════════════════════════════
  //  2. BOARD STATE
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Current board side length.
   * Starts at 3 and increments by 1 each time the grid expands on a tie.
   */
  gridSize: 3,

  /**
   * 2-D board array indexed as `grid[row][col]`.
   * @type {Cell[][]}
   */
  grid: [],

  /**
   * Mark of the player whose turn it is right now.
   * Alternates between `'X'` and `'O'` via {@link module:game.switchTurn}.
   */
  currentPlayer: 'X',

  /** Accumulated point totals for each player. */
  scores: { X: 0, O: 0 },

  /**
   * Display names for each player, shown on the HUD and game-over screen.
   * Defaults are overwritten by the name-input screen before the match starts.
   */
  names: { X: 'Xi', O: 'Om' },

  /** Seconds remaining on the countdown timer. */
  timeLeft: 0,

  /**
   * Whether a match is currently in progress.
   * `false` during pre-game menus and the game-over screen.
   */
  gameActive: false,

  // ═══════════════════════════════════════════════════════════════════════
  //  3. SCORING HISTORY
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Set of serialised chain IDs that have already been rewarded with points.
   * Prevents double-counting the same chain when the board grows and the
   * chain is re-detected.
   * @type {Set<string>}
   */
  scoredChains: new Set(),

  /**
   * Persistent record of all scored strike lines, used to redraw the
   * SVG overlay after DOM rebuilds (e.g. grid expansion).
   * @type {Array<{ chains: Array<object>, player: 'X'|'O' }>}
   */
  scoredLines: [],

  /**
   * Grid size at the start of the most recent round.
   * Compared against `gridSize` to detect expansion.
   */
  lastGridSize: 3,

  // ═══════════════════════════════════════════════════════════════════════
  //  4. TIMER & AI HANDLES
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Handle returned by `setInterval` for the countdown clock.
   * Cleared by {@link module:game.clearTimers}.
   * @type {number|null}
   */
  timerInterval: null,

  /**
   * Handle returned by `setTimeout` for the AI's delayed move.
   * Cleared by {@link module:game.clearTimers}.
   * @type {number|null}
   */
  aiTimeout: null,

  /**
   * `true` when the AI is currently "thinking" (during its delay timer).
   * Used to show an animated status in the turn indicator.
   */
  isThinking: false,

  // ═══════════════════════════════════════════════════════════════════════
  //  5. ZOOM / PAN VIEWPORT STATE
  // ═══════════════════════════════════════════════════════════════════════

  /** Current zoom multiplier (1.0 = 100 %). */
  zoomLevel: 1.0,

  /** `true` while a two-finger pinch gesture is actively tracked. */
  isPinching: false,

  /** Distance (px) between the two fingers when the pinch gesture started. */
  pinchStartDist: 0,

  /** Zoom level captured at the instant the pinch gesture started. */
  pinchStartZoom: 1,

  /** Horizontal pan offset in CSS pixels (positive = right). */
  panX: 0,

  /** Vertical pan offset in CSS pixels (positive = down). */
  panY: 0,

  /** `true` while a single-finger pan gesture is in progress (zoomed-in only). */
  isPanning: false,

  /** Raw client-X coordinate where the current pan gesture began. */
  panStartX: 0,

  /** Raw client-Y coordinate where the current pan gesture began. */
  panStartY: 0,

  // ═══════════════════════════════════════════════════════════════════════
  //  6. UI FLAGS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Input interlock flag.
   * Set to `true` while a move or expansion animation is being processed.
   * Prevents the player from clicking cells or triggering double moves.
   */
  isProcessing: false,

  /** `true` while the pause modal is visible. */
  paused: false,

  // ═══════════════════════════════════════════════════════════════════════
  //  7. MULTIPLAYER
  // ═══════════════════════════════════════════════════════════════════════

  /** `true` when the current match is a remote (Firebase) multiplayer game. */
  isMultiplayer: false,

  /**
   * The 4-character alphanumeric room code (e.g. `"A3BK"`).
   * `null` when not in a multiplayer session.
   * @type {string|null}
   */
  roomCode: null,

  /**
   * This client's assigned role in a multiplayer game.
   * `'X'` for the host, `'O'` for the guest, `null` outside multiplayer.
   * @type {'X'|'O'|null}
   */
  playerRole: null,

  /**
   * Firebase anonymous user ID for the local player.
   * Obtained once during {@link module:multiplayer.Multiplayer.initId}.
   * @type {string|null}
   */
  userId: null,

  // ═══════════════════════════════════════════════════════════════════════
  //  8. AUDIO SETTINGS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Whether sound effects are enabled.
   * Controlled via the settings panel toggle.
   */
  soundEnabled: true,

  /**
   * The last move position {r, c} to show the move indicator ring.
   * Null when no moves have been made yet.
   */
  lastMove: null,

  // ═══════════════════════════════════════════════════════════════════════
  //  9. AUTH & CUSTOMIZATION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Data retrieved from Google Auth.
   * @type {{ name: string, photo: string, email: string }|null}
   */
  userProfile: null,

  /**
   * The set of 5 emojis currently equipped in the reaction tray.
   * @type {string[]}
   */
  activeEmojis: ['😂', '😲', '🔥', '👏', '🤔'],

  /**
   * Timestamp (ms) of the last sent reaction.
   * Used for spam prevention.
   */
  lastReactionTime: 0,

  /**
   * Full collection of available emojis that can be equipped.
   * @type {string[]}
   */
  emojiPack: [
    '😂', '😲', '🔥', '👏', '🤔', '😭', '😎', '💀', '🤡', '💖',
    '🎉', '🚀', '👀', '💯', '✨', '👑', '🥳', '😡', '😱', '👍'
  ],

  /**
   * Whether the user chose to skip Google login.
   * Disables online play features.
   */
  loginSkipped: false,

  // ═══════════════════════════════════════════════════════════════════════
  //  10. REMATCH REQUEST STATE
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Current rematch request status for multiplayer.
   * Tracks which players have requested/approved a rematch.
   * @type {{ X: boolean, O: boolean }}
   */
  rematchRequests: { X: false, O: false },

  /**
   * Whether a rematch request popup is currently being shown.
   * Prevents duplicate popups.
   */
  rematchPopupOpen: false,
};
