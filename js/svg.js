'use strict';

/* ============================================================
   SVG GENERATORS
   Returns inline SVG strings for X marks, O marks, and their
   semi-transparent "ghost" previews shown on cell hover.
   The animated draw-on effect is driven by CSS (mark-path class).
   ============================================================ */

/**
 * Builds the animated X mark SVG.
 * Two slightly curved lines give it a hand-drawn feel.
 * @returns {string} SVG HTML string.
 */
function makeXSvg() {
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="x-mark">
    <path class="mark-path x-mark" d="M18,18 Q50,46 82,82" stroke-dasharray="115" stroke-dashoffset="115"/>
    <path class="mark-path x-mark" d="M82,18 Q50,46 18,82" stroke-dasharray="115" stroke-dashoffset="115" style="animation-delay:0.12s"/>
  </svg>`;
}

/**
 * Builds the animated O mark SVG.
 * A single ellipse stroked with a draw-on animation.
 * @returns {string} SVG HTML string.
 */
function makeOSvg() {
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="o-mark">
    <ellipse class="mark-path o-mark" cx="50" cy="50" rx="32" ry="31"
      style="stroke-dasharray:205;stroke-dashoffset:205;fill:none;"/>
  </svg>`;
}

/**
 * Builds a static (no animation) ghost X for hover preview.
 * @returns {string} SVG HTML string.
 */
function makeGhostX() {
  return `<svg viewBox="0 0 100 100" class="x-mark" style="width:65%;height:65%;">
    <line x1="18" y1="18" x2="82" y2="82" stroke="var(--color-x)" stroke-width="8" stroke-linecap="round"/>
    <line x1="82" y1="18" x2="18" y2="82" stroke="var(--color-x)" stroke-width="8" stroke-linecap="round"/>
  </svg>`;
}

/**
 * Builds a static (no animation) ghost O for hover preview.
 * @returns {string} SVG HTML string.
 */
function makeGhostO() {
  return `<svg viewBox="0 0 100 100" class="o-mark" style="width:65%;height:65%;">
    <ellipse cx="50" cy="50" rx="32" ry="31" fill="none" stroke="var(--color-o)" stroke-width="8"/>
  </svg>`;
}
