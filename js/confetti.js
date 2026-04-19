'use strict';

/* ============================================================
   CONFETTI
   Launches a burst of coloured confetti pieces styled to match
   the winning player's colour palette.
   ============================================================ */

/** Colour palettes keyed by player mark. */
const CONFETTI_COLORS = {
  X: ['#FF3366', '#FF6699', '#FFB3C6'],
  O: ['#3366FF', '#6699FF', '#B3C6FF'],
};

/** Total number of confetti pieces spawned per win. */
const CONFETTI_COUNT = 60;

/** Milliseconds after which the container is cleared. */
const CONFETTI_LIFETIME_MS = 4000;

/**
 * Fills the confetti container with randomised CSS-animated pieces,
 * then clears the container after they finish falling.
 *
 * @param {'X'|'O'} player - Winning player; determines colour palette.
 */
export function launchConfetti(player) {
  const container = document.getElementById('confetti-container');
  container.innerHTML = '';

  const palette = CONFETTI_COLORS[player] || CONFETTI_COLORS.X;

  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';

    // Randomise position, size, shape and animation timing
    piece.style.left             = `${Math.random() * 100}vw`;
    piece.style.background       = palette[Math.floor(Math.random() * palette.length)];
    piece.style.width            = `${Math.random() * 10 + 6}px`;
    piece.style.height           = `${Math.random() * 10 + 6}px`;
    piece.style.borderRadius     = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.animationDuration = `${Math.random() * 2 + 1.5}s`;
    piece.style.animationDelay   = `${Math.random() * 0.5}s`;

    container.appendChild(piece);
  }

  // Auto-clean after animation completes
  setTimeout(() => { container.innerHTML = ''; }, CONFETTI_LIFETIME_MS);
}
