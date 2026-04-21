/**
 * @file index.js — Utility module exports for Tic Tac Grow.
 *
 * Centralizes exports from all utility sub-modules for cleaner imports.
 *
 * @example
 * import { getPlayerColor, restartAnimation, autoRemoveAfterAnimation } from './utils/index.js';
 *
 * @module utils
 */

export {
  restartAnimation,
  autoRemoveAfterAnimation,
  debounce,
  schedule
} from './animation.js';

export {
  getPlayerColor,
  getPlayerColorRgb,
  getPlayerColorStyle
} from './colors.js';
