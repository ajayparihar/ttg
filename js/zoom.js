/**
 * @file zoom.js — Touch-based zoom and pan controller for Tic Tac Grow.
 *
 * Handles two distinct mobile gestures on the grid wrapper element:
 *
 *  • **Two-finger pinch** → scales the board between 100 % and
 *    {@link module:constants.MAX_ZOOM|MAX_ZOOM}.
 *  • **One-finger drag** (only when zoomed in) → pans the board within
 *    clamped bounds so the grid never scrolls entirely out of view.
 *
 * A movement threshold ({@link PAN_THRESHOLD}) prevents accidental pans
 * when the user only intended to tap a cell.
 *
 * Must be initialised exactly once after DOMContentLoaded via
 * {@link initZoomPan}.
 *
 * @module zoom
 */

import { State } from './state.js';
import { MAX_ZOOM } from './constants.js';
import { clamp } from './utils.js';

// ═══════════════════════════════════════════════════════════════════════════
//  Utility helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculates the Euclidean distance between exactly two touch points.
 *
 * @param {Touch[]} touches - Array containing at least two Touch objects.
 * @returns {number} Distance in CSS pixels.
 */
export function getTouchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Constrains {@link State.panX} and {@link State.panY} so that the grid
 * never moves completely out of the visible wrapper area.
 *
 * The maximum allowed pan is half the difference between the scaled grid
 * size and the wrapper size, clamped to zero when the grid fits inside
 * the wrapper without scrolling.
 */
export function clampPan() {
  const wrapper = document.getElementById('grid-wrapper');
  const gridEl  = document.getElementById('game-grid');

  // Dimensions of the visible container
  const ww = wrapper.clientWidth;
  const wh = wrapper.clientHeight;

  // Dimensions of the grid at the current zoom level
  const gw = gridEl.offsetWidth  * State.zoomLevel;
  const gh = gridEl.offsetHeight * State.zoomLevel;

  // Allow panning only as far as needed to reveal the grid edge
  const maxPanX = Math.max(0, (gw - ww) / 2);
  const maxPanY = Math.max(0, (gh - wh) / 2);

  State.panX = clamp(State.panX, -maxPanX, maxPanX);
  State.panY = clamp(State.panY, -maxPanY, maxPanY);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Initialisation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Attaches touch event listeners to the `#grid-wrapper` element for
 * pinch-to-zoom and drag-to-pan gestures.
 *
 * **Gesture lifecycle:**
 *  1. `touchstart` — records initial finger positions and determines
 *     whether this is a pinch (2 fingers) or potential pan (1 finger
 *     while zoomed in).
 *  2. `touchmove`  — continuously updates zoom or pan based on finger
 *     movement.  Pan only activates after the user drags beyond
 *     {@link PAN_THRESHOLD} pixels to avoid interfering with taps.
 *  3. `touchend`   — resets gesture flags when fingers are lifted.
 *
 * @param {object} Render - The Render module, passed in to avoid a
 *   circular import (Render → State ← zoom).
 */
export function initZoomPan(Render) {
  const wrapper = document.getElementById('grid-wrapper');

  // --- Local gesture tracking state ---
  let currentTouches = [];     // Snapshot of active Touch objects
  let panStarted     = false;  // True once the drag exceeds the threshold
  let panOriginX     = 0;      // Client X at the moment panning was locked in
  let panOriginY     = 0;      // Client Y at the moment panning was locked in
  let touchStartX    = 0;      // Initial finger X (for threshold calculation)
  let touchStartY    = 0;      // Initial finger Y (for threshold calculation)

  /**
   * Minimum pixels of finger movement required before a one-finger drag
   * is recognised as a pan gesture.  Prevents accidental pans when the
   * user only wanted to tap a cell.
   */
  const PAN_THRESHOLD = 8;

  // -----------------------------------------------------------------------
  //  touchstart — begin a pinch or prepare for a potential pan
  // -----------------------------------------------------------------------
  wrapper.addEventListener('touchstart', (e) => {
    currentTouches = Array.from(e.touches);

    if (currentTouches.length === 2) {
      // Two fingers → begin pinch-to-zoom
      State.isPinching     = true;
      State.pinchStartDist = getTouchDist(currentTouches);
      State.pinchStartZoom = State.zoomLevel;

    } else if (currentTouches.length === 1 && State.zoomLevel > 1.001) {
      // One finger while zoomed in → track start position for threshold check
      touchStartX = currentTouches[0].clientX;
      touchStartY = currentTouches[0].clientY;
      panStarted  = false;   // Don't commit to panning until threshold is met
    }
  }, { passive: true });

  // -----------------------------------------------------------------------
  //  touchmove — update zoom level (pinch) or pan offset (drag)
  // -----------------------------------------------------------------------
  wrapper.addEventListener('touchmove', (e) => {
    currentTouches = Array.from(e.touches);

    if (State.isPinching && currentTouches.length === 2) {
      // --- Pinch gesture: scale zoom level proportionally ---
      if (e.cancelable) e.preventDefault();   // Prevent native browser zoom

      const dist      = getTouchDist(currentTouches);
      const scale     = dist / State.pinchStartDist;
      State.zoomLevel = clamp(State.pinchStartZoom * scale, 1.0, MAX_ZOOM);
      Render.setZoomDisplay(State.zoomLevel);

    } else if (currentTouches.length === 1 && State.zoomLevel > 1.001) {
      // --- One-finger drag while zoomed in ---
      const dx   = currentTouches[0].clientX - touchStartX;
      const dy   = currentTouches[0].clientY - touchStartY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Lock in the pan gesture once the drag exceeds the threshold
      if (!panStarted && dist > PAN_THRESHOLD) {
        panStarted = true;
        panOriginX = currentTouches[0].clientX - State.panX;
        panOriginY = currentTouches[0].clientY - State.panY;
      }

      if (panStarted) {
        if (e.cancelable) e.preventDefault();   // Prevent page scroll during pan

        State.panX = currentTouches[0].clientX - panOriginX;
        State.panY = currentTouches[0].clientY - panOriginY;
        clampPan();
        Render.setZoomDisplay(State.zoomLevel);
      }
    }
  }, { passive: false });   // passive: false so we can call preventDefault()

  // -----------------------------------------------------------------------
  //  touchend — reset gesture flags when fingers are lifted
  // -----------------------------------------------------------------------
  wrapper.addEventListener('touchend', (e) => {
    // End pinch when fewer than 2 fingers remain
    if (e.touches.length < 2) State.isPinching = false;

    // End pan when all fingers are lifted
    if (e.touches.length === 0) panStarted = false;
  }, { passive: true });
}
