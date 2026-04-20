'use strict';

/**
 * @file confetti.js — Victory confetti animation for Tic Tac Grow.
 *
 * When a player wins, this module fills a full-viewport container with
 * randomised CSS-animated confetti pieces styled in the winner's colour
 * palette.  The container is auto-cleaned after the animation finishes.
 *
 * @module confetti
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Player-keyed colour palettes.
 * Three shades per player create a richer visual burst.
 * @type {Record<string, string[]>}
 */
const CONFETTI_COLORS = {
  X: ['#FF3366', '#FF6699', '#FFB3C6'],   // Warm reds / pinks
  O: ['#3366FF', '#6699FF', '#B3C6FF'],   // Cool blues
};

/** Total number of confetti pieces spawned per win celebration. */
const CONFETTI_COUNT = 60;

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
 * Each piece receives random:
 *  - **Horizontal position** across the full viewport width.
 *  - **Colour** from the winning player's palette.
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

  // Fall back to X's palette if an unexpected value is passed
  const palette = CONFETTI_COLORS[player] || CONFETTI_COLORS.X;

  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';

    // Randomise visual properties via inline styles
    piece.style.left              = `${Math.random() * 100}vw`;
    piece.style.background        = palette[Math.floor(Math.random() * palette.length)];
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
