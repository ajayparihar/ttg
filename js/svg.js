'use strict';

/* ============================================================
   SVG GENERATORS
   Returns inline SVG strings for X marks, O marks, and their
   semi-transparent "ghost" previews shown on cell hover.
   The animated draw-on effect is driven by CSS (mark-path class).
   ============================================================ */

/**
 * Returns a small randomized transform for each mark.
 * This adds subtle rotation, flips, and size variance.
 * @returns {string}
 */
function randomMarkTransform() {
  const rotate = (Math.random() * (MARK_ROT_JITTER * 2) - MARK_ROT_JITTER).toFixed(1);
  const scale = MARK_SCALE_BASE + Math.random() * MARK_SCALE_JITTER;
  const flipX = Math.random() < 0.15 ? -1 : 1;
  const flipY = Math.random() < 0.15 ? -1 : 1;
  const dx = (Math.random() * (MARK_POS_JITTER * 2) - MARK_POS_JITTER).toFixed(1);
  const dy = (Math.random() * (MARK_POS_JITTER * 2) - MARK_POS_JITTER).toFixed(1);
  return `translate(${50 + parseFloat(dx)} ${50 + parseFloat(dy)}) rotate(${rotate}) scale(${flipX * scale} ${flipY * scale}) translate(-50 -50)`;
}

/**
 * Builds a text-based mark from the font.
 * @param {string} char
 * @param {string} cls
 * @returns {string} HTML string.
 */
function makeMarkSvg(char, cls) {
  const fontSize = 68 + Math.round(Math.random() * 8); // subtle size variation
  return `<svg class="mark-svg ${cls}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <g transform="${randomMarkTransform()}">
      <text x="50" y="75" text-anchor="middle" font-size="${fontSize}" font-family="Excalifont" fill="currentColor">${char}</text>
    </g>
  </svg>`;
}

/**
 * Builds the X mark as text from font.
 * @returns {string} HTML string.
 */
function makeXSvg() {
  return makeMarkSvg('X', 'x-mark');
}

/**
 * Builds the O mark as text from font.
 * @returns {string} HTML string.
 */
function makeOSvg() {
  return makeMarkSvg('O', 'o-mark');
}

/**
 * Builds a ghost X for hover preview.
 * @returns {string} HTML string.
 */
function makeGhostX() {
  return makeMarkSvg('X', 'x-mark ghost');
}

/**
 * Builds a ghost O for hover preview.
 * @returns {string} HTML string.
 */
function makeGhostO() {
  return makeMarkSvg('O', 'o-mark ghost');
}
