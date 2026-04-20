/**
 * @file svg.js — SVG mark generators for Tic Tac Grow.
 *
 * Builds the inline SVG markup for X and O marks, their hover-preview
 * "ghost" variants, and the winner crown icon.  Each mark receives a
 * randomised transform (rotation, scale, flip, offset) to create a
 * hand-drawn, sketchy aesthetic.
 *
 * The randomisation constants are imported from {@link module:constants}.
 *
 * @module svg
 */

import {
  MARK_ROT_JITTER,
  MARK_SCALE_BASE,
  MARK_SCALE_JITTER,
  MARK_POS_JITTER
} from './constants.js';

// ---------------------------------------------------------------------------
// Transform randomiser
// ---------------------------------------------------------------------------

/**
 * Generates a random SVG `transform` attribute string that applies
 * slight rotation, optional axis flips, scale variation, and positional
 * jitter to a mark centered inside a 100 × 100 viewBox.
 *
 * The transform pipeline (read right-to-left in SVG):
 *   1. Translate the origin to the mark center (−50, −50).
 *   2. Scale with optional axis flip and random magnitude.
 *   3. Rotate by a small random angle.
 *   4. Translate back to position (50 + dx, 50 + dy).
 *
 * @returns {string} An SVG-compatible `transform` value.
 */
export function randomMarkTransform() {
  // Random rotation in the range [−MARK_ROT_JITTER, +MARK_ROT_JITTER]
  const rotate = (Math.random() * (MARK_ROT_JITTER * 2) - MARK_ROT_JITTER).toFixed(1);

  // Random scale: base ± jitter
  const scale = MARK_SCALE_BASE + Math.random() * MARK_SCALE_JITTER;

  // ~15 % chance to flip along each axis for extra variation
  const flipX = Math.random() < 0.15 ? -1 : 1;
  const flipY = Math.random() < 0.15 ? -1 : 1;

  // Random positional offset in the range [−MARK_POS_JITTER, +MARK_POS_JITTER]
  const dx = (Math.random() * (MARK_POS_JITTER * 2) - MARK_POS_JITTER).toFixed(1);
  const dy = (Math.random() * (MARK_POS_JITTER * 2) - MARK_POS_JITTER).toFixed(1);

  return `translate(${50 + parseFloat(dx)} ${50 + parseFloat(dy)}) rotate(${rotate}) scale(${flipX * scale} ${flipY * scale}) translate(-50 -50)`;
}

// ---------------------------------------------------------------------------
// Mark builders
// ---------------------------------------------------------------------------

/**
 * Builds an SVG `<text>` mark inside a 100×100 viewBox.
 *
 * The mark is rendered using the "Excalifont" typeface to match the
 * game's sketchy aesthetic.  A slight random font-size variance adds to
 * the hand-drawn feel.
 *
 * @param {string} char - The character to render (`'X'` or `'O'`).
 * @param {string} cls  - CSS class(es) to apply (e.g. `'x-mark'`, `'o-mark ghost'`).
 * @returns {string} An HTML string containing the complete `<svg>` element.
 */
export function makeMarkSvg(char, cls) {
  // Subtle font-size variation: 68–76 px
  const fontSize = 68 + Math.round(Math.random() * 8);

  return `<svg class="mark-svg ${cls}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <g transform="${randomMarkTransform()}">
      <text x="50" y="75" text-anchor="middle" font-size="${fontSize}" font-family="Excalifont" fill="currentColor">${char}</text>
    </g>
  </svg>`;
}

/**
 * Builds a solid X mark SVG.
 * @returns {string} HTML string.
 */
export function makeXSvg() {
  return makeMarkSvg('X', 'x-mark');
}

/**
 * Builds a solid O mark SVG.
 * @returns {string} HTML string.
 */
export function makeOSvg() {
  return makeMarkSvg('O', 'o-mark');
}

/**
 * Builds a translucent "ghost" X used as a hover preview on empty cells.
 * The `ghost` class applies reduced opacity via CSS.
 * @returns {string} HTML string.
 */
export function makeGhostX() {
  return makeMarkSvg('X', 'x-mark ghost');
}

/**
 * Builds a translucent "ghost" O used as a hover preview on empty cells.
 * @returns {string} HTML string.
 */
export function makeGhostO() {
  return makeMarkSvg('O', 'o-mark ghost');
}

// ---------------------------------------------------------------------------
// Game-over icons
// ---------------------------------------------------------------------------

/**
 * Builds a flat-style golden crown SVG icon displayed next to the winner's
 * name on the game-over screen and inside the winner initial circle.
 *
 * The crown uses a simple polygonal `<path>` with a solid gold fill
 * (`#FFD700`) and no stroke, keeping it visually clean at small sizes.
 *
 * @returns {string} HTML string containing the crown `<svg>`.
 */
export function makeCrownSvg() {
  return `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="winner-crown-svg">
      <path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5Z" fill="#FFD700"/>
    </svg>
  `;
}
