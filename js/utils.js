'use strict';

/**
 * @file utils.js — General-purpose utility functions for Tic Tac Grow.
 *
 * Every function in this module is **pure** (no side effects, no DOM access)
 * and operates only on its arguments.  They are consumed by many other
 * modules, so changes here should be made carefully.
 *
 * @module utils
 */

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

/**
 * Clamps a numeric value to the inclusive range [min, max].
 *
 * @param {number} val - The value to clamp.
 * @param {number} min - Lower bound (inclusive).
 * @param {number} max - Upper bound (inclusive).
 * @returns {number} The clamped result.
 *
 * @example
 *   clamp(15, 0, 10); // → 10
 *   clamp(-3, 0, 10); // → 0
 */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Returns a random integer between `min` and `max` (both inclusive).
 *
 * @param {number} min - Lower bound (inclusive).
 * @param {number} max - Upper bound (inclusive).
 * @returns {number} A random integer in [min, max].
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Returns a random element from an array, or `null` if the array is empty.
 *
 * @template T
 * @param {T[]} array - The source array.
 * @returns {T|null} A randomly selected element, or `null`.
 */
export function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Triggers haptic feedback on supported mobile devices.
 * @param {number} [duration=10] - Vibration duration in milliseconds.
 */
export function hapticFeedback(duration = 10) {
  if (navigator.vibrate && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(duration);
    } catch (_) {
      // Ignore if vibration fails (e.g., user disabled it)
    }
  }
}

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

/**
 * Creates a new empty `size × size` grid filled with empty strings.
 *
 * Each inner array is a distinct object, so mutating one row does not
 * affect the others.
 *
 * @param {number} size - Side length of the square grid.
 * @returns {string[][]} A 2-D array of empty strings.
 */
export function createGrid(size) {
  return Array.from({ length: size }, () => Array(size).fill(''));
}

/**
 * Returns a shallow-row deep copy of a grid.
 *
 * Each row is spread into a new array, so mutations to the copy never
 * propagate back to the original.  (Cell values are primitive strings,
 * so a deeper clone is unnecessary.)
 *
 * @param {string[][]} grid - The grid to copy.
 * @returns {string[][]} An independent clone of the grid.
 */
export function copyGrid(grid) {
  return grid.map(row => [...row]);
}
