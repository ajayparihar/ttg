'use strict';

/* ============================================================
   SVG GENERATORS
   Returns inline SVG strings for X marks, O marks, and their
   semi-transparent "ghost" previews shown on cell hover.
   The animated draw-on effect is driven by CSS (mark-path class).
   ============================================================ */

/**
 * Builds the X mark as plain text.
 * @returns {string} HTML string.
 */
function makeXSvg() {
  return `<span class="mark-text x-mark">X</span>`;
}

/**
 * Builds the O mark as plain text.
 * @returns {string} HTML string.
 */
function makeOSvg() {
  return `<span class="mark-text o-mark">O</span>`;
}

/**
 * Builds a ghost X for hover preview.
 * @returns {string} HTML string.
 */
function makeGhostX() {
  return `<span class="mark-text x-mark ghost">X</span>`;
}

/**
 * Builds a ghost O for hover preview.
 * @returns {string} HTML string.
 */
function makeGhostO() {
  return `<span class="mark-text o-mark ghost">O</span>`;
}
