'use strict';

/**
 * Utility functions for Tic-Tac-Grow.
 * All functions are pure and have no side effects.
 */

/**
 * Clamps a value between min and max (inclusive).
 */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Creates a new empty size×size grid.
 */
export function createGrid(size) {
  return Array.from({ length: size }, () => Array(size).fill(''));
}

/**
 * Returns a deep copy of a grid.
 */
export function copyGrid(grid) {
  return grid.map(row => [...row]);
}

/**
 * Returns a random integer between min and max (inclusive).
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Returns a random element from an array.
 */
export function randomChoice(array) {
  if (!array.length) return null;
  return array[Math.floor(Math.random() * array.length)];
}
