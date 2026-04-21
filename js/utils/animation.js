/**
 * @file animation.js — Animation utilities for Tic Tac Grow.
 *
 * Provides reusable helpers for common animation patterns:
 *  - Restarting CSS animations
 *  - Auto-cleanup after animation end
 *  - Debounced animation triggers
 *
 * @module utils/animation
 */

/**
 * Restarts a CSS animation by removing and re-adding the animation class.
 * Forces a reflow to ensure the animation restarts from the beginning.
 *
 * @param {HTMLElement} element - The element to animate.
 * @param {string} className - The animation class to restart.
 */
export function restartAnimation(element, className) {
  element.classList.remove(className);
  void element.offsetWidth; // Force reflow
  element.classList.add(className);
}

/**
 * Automatically removes an element after its animation completes.
 * Uses the 'animationend' event for precise timing.
 *
 * @param {HTMLElement} element - The element to remove.
 * @param {string} [animationName] - Optional specific animation name to wait for.
 */
export function autoRemoveAfterAnimation(element, animationName = null) {
  const handler = (e) => {
    if (animationName && e.animationName !== animationName) return;
    element.remove();
  };
  element.addEventListener('animationend', handler, { once: true });
}

