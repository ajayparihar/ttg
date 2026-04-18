'use strict';

/* ============================================================
   CONSTANTS
   Game-wide numeric constants and the chain-score formula.
   All values are declared on the global scope so every module
   can reference them without an import/export step.
   ============================================================ */

/** Points awarded for a chain of exactly N consecutive marks. */
const SCORES_BY_CHAIN = { 3: 10, 4: 20, 5: 30, 6: 40, 7: 50 };

/** Hard cap on the score awarded for a single chain (7+ in a row). */
const MAX_CHAIN_SCORE = 50;

/** Milliseconds the AI "thinks" before playing — keeps UX from feeling instant. */
const AI_DELAY_MS = 500;

/** AI difficulty level: 1 = easiest, 5 = toughest. */
const LEVEL = 5;

/** When true, all durations are available. When false, only unlimited is available and selection is skipped. */
const MODE = false;

/** Minimum rendered pixel size for a grid cell (ensures tap targets are usable). */
const MIN_CELL_PX = 44;

/** Maximum zoom multiplier the player can reach with +/pinch. */
const MAX_ZOOM = 3.0;

/** Zoom increment applied per +/− button press. */
const ZOOM_STEP = 0.25;

/**
 * Returns the score for a chain of the given length.
 * Chains shorter than 3 are worth 0.
 * Score scales linearly: (len − 2) × 10, capped at MAX_CHAIN_SCORE.
 *
 * @param {number} len - Number of consecutive marks in the chain.
 * @returns {number} Points awarded.
 */
function chainScore(len) {
  if (len < 3) return 0;
  return Math.min((len - 2) * 10, MAX_CHAIN_SCORE);
}

/* ============================================================
   VISUAL TWEAKS
   Adjust these to change the hand-drawn feel of the game.
   (Note: Strike line thickness is controlled by --strike-width in style.css)
   ============================================================ */

/** Maximum degrees of rotation for X and O marks (+ and -) */
const MARK_ROT_JITTER = 13;

/** Base scaling factor for X and O marks */
const MARK_SCALE_BASE = 0.92;

/** Maximum additional random scaling for X and O marks */
const MARK_SCALE_JITTER = 0.14;

/** Maximum X/Y pixel translation for X and O marks (+ and -) */
const MARK_POS_JITTER = 4;

/** Minimum pixel overshoot extending past the grid for win strike lines */
const STRIKE_OVERSHOOT_MIN = 6;

/** Maximum extra random pixel overshoot for win strike lines */
const STRIKE_OVERSHOOT_JITTER = 14;

/** Maximum start/end pixel origin jitter for win strike lines (+ and -) */
const STRIKE_POS_JITTER = 4;

/** Maximum base curvature offset for win strike lines */
const STRIKE_CURVE_BASE = 18;

/** Maximum curvature pixel jitter for win strike lines */
const STRIKE_CURVE_JITTER = 5;

