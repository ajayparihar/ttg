'use strict';

/* ============================================================
   ZOOM & PAN SYSTEM
   Handles pinch-to-zoom and single-finger panning via touch
   events on the grid wrapper.  Button-based zoom is driven by
   App.zoom(), which reuses clamp() and clampPan() from here.
   ============================================================ */

/**
 * Clamps a value between min and max (inclusive).
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Calculates the Euclidean distance between two touch points.
 * @param {Touch[]} touches - Exactly two touch points.
 * @returns {number} Distance in pixels.
 */
function getTouchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Clamps State.panX and State.panY so the grid never moves
 * completely out of view when zoomed in.
 * Reads current element dimensions from the DOM.
 */
function clampPan() {
  const wrapper = document.getElementById('grid-wrapper');
  const gridEl  = document.getElementById('game-grid');

  const ww = wrapper.clientWidth;
  const wh = wrapper.clientHeight;
  const gw = gridEl.offsetWidth  * State.zoomLevel;
  const gh = gridEl.offsetHeight * State.zoomLevel;

  // Allow panning only as far as needed to show the grid edge
  const maxPanX = Math.max(0, (gw - ww) / 2);
  const maxPanY = Math.max(0, (gh - wh) / 2);

  State.panX = clamp(State.panX, -maxPanX, maxPanX);
  State.panY = clamp(State.panY, -maxPanY, maxPanY);
}

/**
 * Attaches touch event listeners to the grid wrapper for:
 *  - Two-finger pinch → zoom
 *  - One-finger drag (when zoomed in) → pan
 *
 * Must be called once after DOMContentLoaded.
 */
function initZoomPan() {
  const wrapper = document.getElementById('grid-wrapper');

  let currentTouches = [];
  let panStarted     = false;
  let panOriginX     = 0;
  let panOriginY     = 0;

  /* ---- touchstart ---- */
  wrapper.addEventListener('touchstart', (e) => {
    currentTouches = Array.from(e.touches);

    if (currentTouches.length === 2) {
      // Begin pinch gesture
      State.isPinching     = true;
      State.pinchStartDist = getTouchDist(currentTouches);
      State.pinchStartZoom = State.zoomLevel;

    } else if (currentTouches.length === 1 && State.zoomLevel > 1.001) {
      // Begin single-finger pan (only available when zoomed in)
      panStarted  = true;
      panOriginX  = currentTouches[0].clientX - State.panX;
      panOriginY  = currentTouches[0].clientY - State.panY;
    }
  }, { passive: true });

  /* ---- touchmove ---- */
  wrapper.addEventListener('touchmove', (e) => {
    currentTouches = Array.from(e.touches);

    if (State.isPinching && currentTouches.length === 2) {
      e.preventDefault(); // prevent browser default zoom
      const dist        = getTouchDist(currentTouches);
      const scale       = dist / State.pinchStartDist;
      State.zoomLevel   = clamp(State.pinchStartZoom * scale, 1.0, MAX_ZOOM);
      Render.setZoomDisplay(State.zoomLevel);

    } else if (panStarted && currentTouches.length === 1) {
      e.preventDefault(); // prevent page scroll during pan
      State.panX = currentTouches[0].clientX - panOriginX;
      State.panY = currentTouches[0].clientY - panOriginY;
      clampPan();
      Render.setZoomDisplay(State.zoomLevel);
    }
  }, { passive: false });

  /* ---- touchend ---- */
  wrapper.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) State.isPinching = false;
    if (e.touches.length === 0) panStarted = false;
  }, { passive: true });
}
