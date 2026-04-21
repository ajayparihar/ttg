'use strict';

/**
 * @file confetti.js — Victory confetti animation for Tic Tac Grow.
 *
 * When a player wins, this module fills a full-viewport container with
 * randomised CSS-animated confetti pieces styled in the winner's colour
 * palette.  The container is auto-cleaned after the animation finishes.
 *
 * Respects prefers-reduced-motion for accessibility.
 *
 * @module confetti
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Check if user prefers reduced motion.
 * @returns {boolean}
 */
function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Player-keyed colour CSS variable names for theme-aware colors.
 * @type {Record<string, string[]>}
 */
const CONFETTI_COLOR_VARS = {
  X: ['var(--color-x)', 'var(--color-x-light)'],
  O: ['var(--color-o)', 'var(--color-o-light)'],
};

/** Default fallback colors if CSS variables aren't available. */
const CONFETTI_FALLBACK_COLORS = {
  X: ['#FF3366', '#FF6699', '#FFB3C6'],
  O: ['#3366FF', '#6699FF', '#B3C6FF'],
};

/** Base number of confetti pieces - scaled by viewport size. */
const CONFETTI_BASE_COUNT = 40;

/** Maximum confetti pieces for large screens. */
const CONFETTI_MAX_COUNT = 80;

/**
 * Milliseconds after which the confetti container is emptied.
 * Should be long enough for every piece to complete its fall animation.
 */
const CONFETTI_LIFETIME_MS = 4000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fills the `#confetti-container` with randomised CSS-animated confetti
 * pieces, then clears the container after they finish falling.
 *
 * Respects prefers-reduced-motion. Uses responsive particle count based on
 * viewport size and theme-aware colors from CSS variables.
 *
 * Each piece receives random:
 *  - **Horizontal position** across the full viewport width.
 *  - **Colour** from the winning player's palette (CSS variables with fallback).
 *  - **Size** between 6 px and 16 px.
 *  - **Shape** (50 % circle, 50 % rounded rectangle).
 *  - **Animation duration** between 1.5 s and 3.5 s.
 *  - **Animation delay** up to 0.5 s for a staggered launch effect.
 *
 * @param {'X'|'O'} player - The winning player; determines the colour palette.
 */
export function launchConfetti(player) {
  const container = document.getElementById('confetti-container');
  container.innerHTML = '';   // Clear any leftover pieces from a previous win

  // Respect prefers-reduced-motion
  if (prefersReducedMotion()) {
    return;
  }

  // Calculate responsive particle count based on viewport area
  const viewportArea = window.innerWidth * window.innerHeight;
  const baseArea = 1920 * 1080; // Full HD baseline
  const scaleFactor = Math.min(1, Math.sqrt(viewportArea / baseArea));
  const particleCount = Math.floor(CONFETTI_BASE_COUNT + (CONFETTI_MAX_COUNT - CONFETTI_BASE_COUNT) * scaleFactor);

  // Use CSS variables for theme-aware colors, with fallback
  const colorVars = CONFETTI_COLOR_VARS[player] || CONFETTI_COLOR_VARS.X;
  const fallbackColors = CONFETTI_FALLBACK_COLORS[player] || CONFETTI_FALLBACK_COLORS.X;

  // Check if CSS variables are supported and resolved
  const testEl = document.createElement('div');
  testEl.style.color = 'var(--color-x)';
  const supportsCssVars = testEl.style.color !== '';

  for (let i = 0; i < particleCount; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';

    // Randomise visual properties via inline styles
    piece.style.left              = `${Math.random() * 100}vw`;
    // Use CSS variable with fallback color
    const colorVar = colorVars[Math.floor(Math.random() * colorVars.length)];
    const fallback = fallbackColors[Math.floor(Math.random() * fallbackColors.length)];
    piece.style.background        = supportsCssVars ? colorVar : fallback;
    piece.style.width             = `${Math.random() * 10 + 6}px`;
    piece.style.height            = `${Math.random() * 10 + 6}px`;
    piece.style.borderRadius      = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.animationDuration = `${Math.random() * 2 + 1.5}s`;
    piece.style.animationDelay    = `${Math.random() * 0.5}s`;

    container.appendChild(piece);
  }

  // Auto-clean after the longest possible animation completes
  setTimeout(() => { container.innerHTML = ''; }, CONFETTI_LIFETIME_MS);
}
