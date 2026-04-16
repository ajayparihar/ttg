'use strict';

/* ============================================================
   SVG GENERATORS
   Returns inline SVG strings for X marks, O marks, and their
   semi-transparent "ghost" previews shown on cell hover.
   The animated draw-on effect is driven by CSS (mark-path class).
   ============================================================ */

/**
 * Builds the X mark as hand-drawn SVG.
 * @returns {string} HTML string.
 */
function makeXSvg() {
  return `<svg class="mark-svg x-mark" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <line x1="15" y1="15" x2="85" y2="85" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
    <line x1="85" y1="15" x2="15" y2="85" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
  </svg>`;
}

/**
 * Builds the O mark as hand-drawn SVG.
 * @returns {string} HTML string.
 */
function makeOSvg() {
  return `<svg class="mark-svg o-mark" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="50" cy="50" rx="35" ry="40" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
  </svg>`;
}

/**
 * Builds a ghost X for hover preview.
 * @returns {string} HTML string.
 */
function makeGhostX() {
  return `<svg class="mark-svg x-mark ghost" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <line x1="15" y1="15" x2="85" y2="85" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
    <line x1="85" y1="15" x2="15" y2="85" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
  </svg>`;
}

/**
 * Builds a ghost O for hover preview.
 * @returns {string} HTML string.
 */
function makeGhostO() {
  return `<svg class="mark-svg o-mark ghost" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="50" cy="50" rx="35" ry="40" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
  </svg>`;
}
