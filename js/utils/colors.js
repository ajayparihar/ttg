/**
 * @file colors.js — Color utility functions for Tic Tac Grow.
 *
 * Provides consistent player-to-color mappings and CSS variable helpers.
 *
 * @module utils/colors
 */

/**
 * Returns the CSS color variable for a player.
 *
 * @param {'X'|'O'} player - The player ('X' or 'O').
 * @param {'primary'|'light'|'glow'} [type='primary'] - The color variant.
 * @returns {string} CSS variable reference like 'var(--color-x)'.
 */
export function getPlayerColor(player, type = 'primary') {
  const suffix = type === 'primary' ? '' : `-${type}`;
  return `var(--color-${player.toLowerCase()}${suffix})`;
}

