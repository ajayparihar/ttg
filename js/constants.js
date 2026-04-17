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
const AI_DELAY_MS = 420;

/** AI difficulty level: 1 = easiest, 5 = toughest. */
const LEVEL = 1;

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
