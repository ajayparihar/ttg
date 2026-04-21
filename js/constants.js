'use strict';

/**
 * @file constants.js — Game-wide configuration constants for Tic Tac Grow.
 *
 * This module centralises every "magic number" used throughout the game so
 * that tuning gameplay, AI behaviour, or visual styling only requires edits
 * in one place.  Constants are grouped into three categories:
 *
 *  1. **Gameplay** — scoring, timing, AI difficulty.
 *  2. **Layout**   — minimum cell size, zoom limits.
 *  3. **Visual**   — hand-drawn jitter parameters for marks and strike lines.
 *
 * @module constants
 */

// ═══════════════════════════════════════════════════════════════════════════
//  GAMEPLAY CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════


/**
 * Hard cap on the score a single chain can yield.
 * Chains of 7 or more marks always award this value.
 */
export const MAX_CHAIN_SCORE = 50;

/**
 * Milliseconds the AI "thinks" before placing its mark.
 * A non-zero delay prevents the move from feeling instantaneous and gives
 * the human player a moment to register what just happened.
 */
export const AI_DELAY_MS = 500;

/**
 * Default AI difficulty level on a 1–10 scale.
 *   - 1 = mostly random moves.
 *   - 6 = balanced (default).
 *   - 10 = uses look-ahead and minimax on 3×3 boards.
 */
export const LEVEL = 6;

/**
 * Feature flag controlling duration selection.
 *   - `true`  → show all duration choices (1 / 2 / 3 / 5 min / unlimited).
 *   - `false` → skip the duration screen entirely; default to unlimited (0 s).
 */
export const MODE = false;

/**
 * Feature flag controlling the undo button.
 *   - `true`  → show undo button (single use per game).
 *   - `false` → hide undo button entirely.
 */
export const UNDO_ENABLED = false;

// ═══════════════════════════════════════════════════════════════════════════
//  LAYOUT CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Minimum rendered pixel size for a single grid cell.
 * Ensures that touch targets remain usable on small screens (≥ 44 px meets
 * Apple's HIG recommendation).
 */
export const MIN_CELL_PX = 44;

/**
 * Maximum zoom multiplier reachable via button or pinch.
 * 3.0 = 300 %.
 */
export const MAX_ZOOM = 3.0;

/**
 * Zoom increment applied per +/− button press.
 */
export const ZOOM_STEP = 0.25;

// ═══════════════════════════════════════════════════════════════════════════
//  SCORING FORMULA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculates the point value for a chain of the given length.
 *
 * **Formula:** `(length − 2) × 10`, capped at {@link MAX_CHAIN_SCORE}.
 * Chains shorter than 3 are worth nothing.
 *
 * @param {number} len - Number of consecutive same-player marks.
 * @returns {number} Points awarded for the chain.
 *
 * @example
 *   chainScore(2);  // → 0   (too short)
 *   chainScore(3);  // → 10
 *   chainScore(5);  // → 30
 *   chainScore(10); // → 50  (capped)
 */
export function chainScore(len) {
  if (len < 3) return 0;
  return Math.min((len - 2) * 10, MAX_CHAIN_SCORE);
}

// ═══════════════════════════════════════════════════════════════════════════
//  VISUAL JITTER CONSTANTS
//  Tweak these to adjust the hand-drawn / sketchy aesthetic.
//  (The strike-line *thickness* is controlled by --strike-width in CSS.)
// ═══════════════════════════════════════════════════════════════════════════

/** Maximum random rotation applied to each X / O mark (±degrees). */
export const MARK_ROT_JITTER = 13;

/** Base scale factor for X / O marks (before random jitter is added). */
export const MARK_SCALE_BASE = 0.92;

/** Maximum additional random scale applied on top of the base. */
export const MARK_SCALE_JITTER = 0.14;

/** Maximum random X / Y pixel offset for X / O mark placement (±px). */
export const MARK_POS_JITTER = 4;

/** Minimum pixel overshoot extending past the first/last winning cell. */
export const STRIKE_OVERSHOOT_MIN = 6;

/** Maximum *additional* random overshoot beyond the minimum. */
export const STRIKE_OVERSHOOT_JITTER = 14;

/** Maximum random pixel offset at each strike endpoint (±px). */
export const STRIKE_POS_JITTER = 4;

/** Maximum base curvature offset for the quadratic Bézier control point. */
export const STRIKE_CURVE_BASE = 18;

/** Maximum random curvature jitter on top of the base (±px). */
export const STRIKE_CURVE_JITTER = 5;

// ═══════════════════════════════════════════════════════════════════════════
//  ANIMATION DURATIONS (ms) - Sync with CSS animations
// ═══════════════════════════════════════════════════════════════════════════

/** Mark appearance animation duration (matches CSS markAppear). */
export const ANIM_MARK_APPEAR_MS = 300;

/** Grid expansion animation duration (matches CSS gridExpand). */
export const ANIM_GRID_EXPAND_MS = 800;

/** Win strike line draw animation (matches CSS drawStrike). */
export const ANIM_STRIKE_DRAW_MS = 500;

/** Floating score animation duration (matches CSS floatUp). */
export const ANIM_FLOAT_SCORE_MS = 1200;

/** Sparkle particle lifetime. */
export const ANIM_SPARKLE_MS = 800;

/** Grid expansion delay before DOM rebuild. */
export const GRID_EXPAND_DELAY_MS = 300;

/** Delay after win strike before showing game over. */
export const WIN_END_DELAY_MS = 350;

/** AI thinking delay range (min, max in ms). */
export const AI_THINKING_DELAY_MIN_MS = 150;
export const AI_THINKING_DELAY_MAX_MS = 400;
