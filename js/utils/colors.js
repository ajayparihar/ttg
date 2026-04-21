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

/**
 * Returns the RGB values for a player color (for use with rgba()).
 *
 * @param {'X'|'O'} player - The player ('X' or 'O').
 * @returns {string} CSS variable reference like 'var(--color-x-rgb)'.
 */
export function getPlayerColorRgb(player) {
  return `var(--color-${player.toLowerCase()}-rgb)`;
}

/**
 * Returns the player color as an inline style object for React-style usage.
 *
 * @param {'X'|'O'} player - The player ('X' or 'O').
 * @param {'primary'|'light'|'glow'} [type='primary'] - The color variant.
 * @returns {Object} Style object with color property.
 */
export function getPlayerColorStyle(player, type = 'primary') {
  return { color: getPlayerColor(player, type) };
}
