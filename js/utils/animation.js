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

/**
 * Creates a debounced version of a function that delays execution.
 *
 * @param {Function} fn - The function to debounce.
 * @param {number} delay - Delay in milliseconds.
 * @returns {Function} The debounced function.
 */
export function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Schedules a function to run after a delay, returning a cancel function.
 *
 * @param {Function} fn - The function to run.
 * @param {number} delay - Delay in milliseconds.
 * @returns {Function} A function that cancels the scheduled execution.
 */
export function schedule(fn, delay) {
  const id = setTimeout(fn, delay);
  return () => clearTimeout(id);
}
