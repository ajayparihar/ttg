'use strict';

/* ============================================================
   GAME STATE
   Single source of truth for all mutable game data.
   Never read UI elements to determine game state — always
   read/write this object and let Render synchronise the DOM.
   ============================================================ */

/**
 * @typedef {'single'|'dual'} GameMode
 * @typedef {'X'|'O'|''} Cell
 */

export const State = {
  /** @type {GameMode} Active game mode. */
  mode: 'dual',

  /** Game duration in seconds. 0 = unlimited (no timer). */
  duration: 180,

  /** AI difficulty level (1-10). */
  aiLevel: 6,

  /** Current board size (starts at 3, grows on ties). */
  gridSize: 3,

  /**
   * 2-D board array.
   * @type {Cell[][]}
   */
  grid: [],

  /** Which player is currently moving. */
  currentPlayer: 'X',

  /** Accumulated scores for both players. */
  scores: { X: 0, O: 0 },

  /** Display names for both players. */
  names: { X: 'Xi', O: 'Om' },

  /** Seconds remaining on the countdown timer. */
  timeLeft: 0,

  /** False when pre-game or game-over; true while a match is running. */
  gameActive: false,

  /** True once the player has consumed their single undo. */
  undoUsed: false,

  /**
   * Snapshot taken before each human move, used by the undo feature.
   * @type {{ grid: Cell[][], scores: object, currentPlayer: string,
   *          scoredChains: Set<string>, gridSize: number }|null}
   */
  undoSnapshot: null,

  /**
   * Serialised IDs of chains already rewarded with points.
   * Prevents double-counting the same chain when the board grows.
   * @type {Set<string>}
   */
  scoredChains: new Set(),

  /**
   * All scored strike lines to persist visually.
   * @type {Array<{chains: number[][][], player: 'X'|'O'}>}
   */
  scoredLines: [],

  /** Grid size at the start of the most recent round (used for expansion logic). */
  lastGridSize: 3,

  /** Handle for the countdown interval (@see App.startTimer). */
  timerInterval: null,

  /** Handle for the AI move timeout (@see triggerAI). */
  aiTimeout: null,

  /* ---- Zoom / Pan ---- */

  /** Current zoom multiplier (1.0 = 100 %). */
  zoomLevel: 1.0,

  /** True while a two-finger pinch gesture is active. */
  isPinching: false,

  /** Touch distance at the moment the pinch started. */
  pinchStartDist: 0,

  /** Zoom level at the moment the pinch started. */
  pinchStartZoom: 1,

  /** Horizontal pan offset in pixels. */
  panX: 0,

  /** Vertical pan offset in pixels. */
  panY: 0,

  /** True while a single-finger pan gesture is active (zoomed-in only). */
  isPanning: false,

  /** Raw X coordinate where the pan gesture started. */
  panStartX: 0,

  /** Raw Y coordinate where the pan gesture started. */
  panStartY: 0,

  /** True while the pause modal is open. */
  paused: false,
};
