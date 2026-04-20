/**
 * @file multiplayer.js — Firebase real-time multiplayer for Tic Tac Grow.
 *
 * Manages the full multiplayer lifecycle via Firebase Realtime Database:
 *
 *  1. **Authentication** — anonymous sign-in for user identity.
 *  2. **Room creation**  — host generates a 4-character room code and
 *     publishes the room to Firebase.
 *  3. **Room joining**   — guest validates the code, joins the room, and
 *     waits for the host to start.
 *  4. **State sync**     — bi-directional real-time listeners push and
 *     pull the game state on every turn change.
 *  5. **Disconnect**     — graceful and forced leave with cleanup.
 *  6. **Clipboard**      — copy invite link or room code to clipboard.
 *
 * The room document in Firebase has this shape:
 * ```
 * rooms/{CODE} = {
 *   hostId, guestId, hostName, guestName,
 *   playerXName, playerOName,
 *   status: 'waiting' | 'ready' | 'playing' | 'abandoned',
 *   duration, createdAt,
 *   gameState: { grid, gridSize, currentPlayer, scores, ... }
 * }
 * ```
 *
 * @module multiplayer
 */

import { State } from './state.js';
import { App } from './app.js';
import { makeMove, switchTurn, clearTimers } from './game.js';
import { Render } from './render.js';

// ═══════════════════════════════════════════════════════════════════════════
//  Firebase initialisation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Firebase project configuration.
 * Replace these values with your own Firebase project's config if
 * deploying to a different backend.
 */
const firebaseConfig = {
  apiKey: "AIzaSyDCNkuTFDA3MLWekDYGHhcJAWA_cs16K5o",
  authDomain: "ttgs-e92f7.firebaseapp.com",
  databaseURL: "https://ttgs-e92f7-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ttgs-e92f7",
  storageBucket: "ttgs-e92f7.firebasestorage.app",
  messagingSenderId: "456853478670",
  appId: "1:456853478670:web:216d4ab97e32088548cb5f",
  measurementId: "G-0D8F1TETRV"
};

// Initialise Firebase exactly once (guards against hot-reload duplicates)
if (firebase.apps.length === 0) {
  firebase.initializeApp(firebaseConfig);
}

/** Firebase Realtime Database reference. */
const db = firebase.database();

/** Firebase Authentication reference. */
const auth = firebase.auth();

// ═══════════════════════════════════════════════════════════════════════════
//  Multiplayer module
// ═══════════════════════════════════════════════════════════════════════════

export const Multiplayer = {

  // ─────────────────────────────────────────────────────────────────────
  //  Authentication
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Ensures the local player has a Firebase anonymous user ID.
   *
   * Called lazily when creating or joining a room.  If a user ID already
   * exists in {@link State.userId}, this is a no-op.
   */
  async initId() {
    if (State.userId) return;
    const user = await auth.signInAnonymously();
    State.userId = user.user.uid;
    console.log("Logged in as:", State.userId);
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Room creation (Host flow)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Generates a random 4-character room code.
   *
   * Uses a reduced character set that excludes visually ambiguous
   * characters: O / 0 / I / 1 are omitted to prevent confusion when
   * the code is read aloud or copied manually.
   *
   * @returns {string} A 4-character uppercase alphanumeric code.
   * @private
   */
  _generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  },

  /**
   * Creates a new multiplayer room in Firebase.
   *
   * **Host flow:**
   *  1. Authenticate anonymously.
   *  2. Generate a unique room code.
   *  3. Set local State: role = X, mode = dual, multiplayer = true.
   *  4. Write the initial room document to Firebase.
   *  5. Register an `onDisconnect` hook to mark the room as abandoned.
   *  6. Update the waiting-room UI (code display, player slots).
   *  7. Attach a `value` listener to detect when a guest joins.
   */
  async createRoom() {
    await this.initId();
    const code = this._generateCode();

    // ── Configure local state as host ────────────────────────────────
    State.roomCode      = code;
    State.playerRole    = 'X';
    State.isMultiplayer = true;
    State.mode          = 'dual';
    State.duration      = App.selectedDuration;

    // ── Write room to Firebase ───────────────────────────────────────
    const roomRef = db.ref(`rooms/${code}`);
    roomRef.onDisconnect().update({ status: 'abandoned' });

    await roomRef.set({
      hostId:      State.userId,
      hostName:    State.names.X || 'Host',
      status:      'waiting',
      duration:    State.duration,
      playerXName: State.names.X || 'Host',
      createdAt:   firebase.database.ServerValue.TIMESTAMP,
      gameState:   null
    });

    // ── Update the waiting-room UI ───────────────────────────────────
    document.getElementById('room-code-text').textContent    = code;
    document.getElementById('slot-host-name').textContent    = State.names.X || 'You';
    document.getElementById('slot-guest-name').textContent   = 'Waiting...';
    document.getElementById('slot-guest').classList.remove('active');
    document.getElementById('start-multiplayer-btn').disabled = true;

    App.showScreen('multiplayer-waiting');

    // ── Listen for a guest to join ───────────────────────────────────
    roomRef.on('value', (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      // Detect guest arrival (status changes to 'ready' or guestId appears)
      if ((data.status === 'ready' || data.guestId) &&
          !document.getElementById('slot-guest').classList.contains('active')) {
        document.getElementById('slot-guest-name').textContent = data.guestName || 'Friend';
        document.getElementById('slot-guest').classList.add('active');
        document.getElementById('start-multiplayer-btn').disabled = false;
        App.showToast("Friend joined!");
      }

      // Handle the case where the host is also listening for game start
      // (relevant during rematches where both clients are in the waiting screen)
      if (data.status === 'playing' && State.playerRole === 'O') {
        if (data.gameState && data.gameState.gameActive) {
          this._syncFromRemote(data.gameState);
          if (App.currentScreen !== 'game') {
            App.showScreen('game');
            this._startSyncListeners();
          }
        }
      }
    });
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Room joining (Guest flow)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Joins an existing room by its 4-character code.
   *
   * **Guest flow:**
   *  1. Validate the code format (exactly 4 characters).
   *  2. Authenticate anonymously.
   *  3. Check that the room exists and is still in `'waiting'` status.
   *  4. Write guest info to the room document and set status to `'ready'`.
   *  5. Register an `onDisconnect` hook.
   *  6. Update the waiting-room UI (hide the "Start" button for guests).
   *  7. Attach a `value` listener to detect when the host starts the game.
   */
  async joinRoom() {
    const code = document.getElementById('join-code-input').value.trim().toUpperCase();

    // ── Input validation ─────────────────────────────────────────────
    if (!code || code.length !== 4) {
      App.showToast("Enter a valid 4-char code.");
      return;
    }

    await this.initId();
    const roomRef  = db.ref(`rooms/${code}`);
    const snapshot = await roomRef.once('value');

    // ── Room existence check ─────────────────────────────────────────
    if (!snapshot.exists()) {
      App.showToast("Room not found.");
      return;
    }

    const data = snapshot.val();

    // ── Room availability check ──────────────────────────────────────
    if (data.status !== 'waiting') {
      App.showToast("Room is full or already started.");
      return;
    }

    // ── Configure local state as guest ───────────────────────────────
    State.roomCode      = code;
    State.playerRole    = 'O';
    State.isMultiplayer = true;
    State.mode          = 'dual';
    State.duration      = data.duration || 0;
    State.timeLeft      = State.duration;

    roomRef.onDisconnect().update({ status: 'abandoned' });

    // ── Write guest data to Firebase ─────────────────────────────────
    await roomRef.update({
      guestId:     State.userId,
      guestName:   State.names.O || 'Guest',
      playerOName: State.names.O || 'Guest',
      status:      'ready'
    });

    // ── Update the waiting-room UI ───────────────────────────────────
    document.getElementById('room-code-text').textContent         = code;
    document.getElementById('slot-host-name').textContent         = data.hostName;
    document.getElementById('slot-guest-name').textContent        = State.names.O || 'You';
    document.getElementById('slot-guest').classList.add('active');
    document.getElementById('start-multiplayer-btn').style.display = 'none';

    App.showScreen('multiplayer-waiting');
    document.getElementById('waiting-status-text').textContent = "Waiting for host to start...";

    // ── Listen for the host to start the game (or trigger a rematch) ─
    roomRef.on('value', (snap) => {
      const d = snap.val();
      if (d && d.status === 'playing' && App.currentScreen !== 'game') {
        // Only transition once the host has pushed an active gameState
        if (d.gameState && d.gameState.gameActive === true) {
          App.showToast("Game started!");
          this._startRemoteGame(d.gameState);
        }
      }
    });
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Game start (Host triggers)
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Host-only: initialises a new game locally, pushes state to Firebase,
   * and starts the real-time sync listeners.
   *
   * Also called for rematch — re-initialises everything and pushes fresh
   * state.
   */
  async hostStartGame() {
    if (State.playerRole !== 'X') return;

    // Initialise game locally (resets board, turn, timers)
    App.initGame();

    // ── Sync names from Firebase (in case the guest updated theirs) ──
    const roomRef = db.ref(`rooms/${State.roomCode}`);
    const snap    = await roomRef.once('value');
    const data    = snap.val();

    State.names.X = data.playerXName || 'Host';
    State.names.O = data.playerOName || 'Guest';
    Render.updateScore('X');
    Render.updateScore('O');

    // ── Push game state and set status to 'playing' ──────────────────
    await roomRef.update({
      status:    'playing',
      gameState: this._getSerializableState()
    });

    if (App.currentScreen !== 'game') {
      App.showScreen('game');
    }

    this._startSyncListeners();
  },

  /**
   * Guest-only: initialises the local game from the host's published
   * state and starts sync listeners.
   *
   * @param {object} remoteState - The `gameState` object from Firebase.
   * @private
   */
  _startRemoteGame(remoteState) {
    this._syncFromRemote(remoteState);
    App.showScreen('game');

    // Sync HUD elements specifically for the guest
    document.getElementById('mode-badge').textContent = 'Online';

    // Deferred build to let the screen layout settle
    setTimeout(() => {
      Render.buildGrid(State.gridSize);
      Render.updateTurnIndicator();
      Render.updateScore('X');
      Render.updateScore('O');
      App.startTimer();
      this._startSyncListeners();
    }, 100);
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Real-time synchronisation
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Attaches Firebase `value` listeners to the room's status and
   * gameState nodes.
   *
   * - **Status listener**: detects when the opponent abandons the room.
   * - **GameState listener**: receives state updates pushed by the other
   *   player.  Only processes updates where `lastModifiedBy` differs
   *   from the local user (prevents echo-processing our own writes).
   *
   * @private
   */
  _startSyncListeners() {
    const roomRef = db.ref(`rooms/${State.roomCode}`);

    // Listen for opponent disconnection
    roomRef.child('status').on('value', (snapshot) => {
      if (snapshot.val() === 'abandoned' && State.isMultiplayer) {
        App.showToast("Opponent left the match.");
        this.leaveRoom(true);   // Forced leave (don't re-notify)
      }
    });

    // Listen for game state changes (moves, turns, game over)
    const stateRef = roomRef.child('gameState');
    stateRef.on('value', (snapshot) => {
      const remoteState = snapshot.val();
      if (!remoteState) return;

      // Only sync if the change was made by the other player
      if (remoteState.lastModifiedBy !== State.userId) {
        this._syncFromRemote(remoteState);
      }
    });
  },

  /**
   * Pushes the current local game state to Firebase so the remote
   * player can pick it up.
   *
   * No-ops outside multiplayer mode.
   */
  pushState() {
    if (!State.isMultiplayer) return;
    const roomRef = db.ref(`rooms/${State.roomCode}/gameState`);
    roomRef.set(this._getSerializableState());
  },

  /**
   * Converts the current {@link State} into a plain JSON-serialisable
   * object suitable for Firebase.
   *
   * Notable conversions:
   *  - `Set<string>` → `Array<string>` (Firebase doesn't support Sets).
   *  - `firebase.database.ServerValue.TIMESTAMP` for ordering.
   *
   * @returns {object} Serialisable state snapshot.
   * @private
   */
  _getSerializableState() {
    return {
      grid:           State.grid,
      gridSize:       State.gridSize,
      currentPlayer:  State.currentPlayer,
      duration:       State.duration,
      scores:         State.scores,
      names:          State.names,
      scoredChains:   Array.from(State.scoredChains),   // Set → Array
      scoredLines:    State.scoredLines,
      gameActive:     State.gameActive,
      winner:         State.winner || null,
      lastModifiedBy: State.userId,                     // Echo-guard
      timestamp:      firebase.database.ServerValue.TIMESTAMP
    };
  },

  /**
   * Applies a remote game state snapshot to the local {@link State} and
   * re-renders the UI.
   *
   * **Grid reconstruction:** Firebase strips empty strings and sparse
   * arrays, so the grid is defensively rebuilt cell-by-cell into a
   * guaranteed `gridSize × gridSize` array of strings.
   *
   * **Processing unlock:** If it's now the local player's turn, the
   * `isProcessing` flag is force-cleared as a safety net against stale
   * locks from previous moves.
   *
   * **Screen transition:** If the remote state indicates the game is
   * over and we're still on the game screen, triggers the game-over
   * flow locally.
   *
   * @param {object} data - Remote gameState from Firebase.
   * @private
   */
  _syncFromRemote(data) {
    if (!data) return;

    const oldSize = State.gridSize;
    const newSize = data.gridSize || State.gridSize;

    // ── Defensively reconstruct the grid ─────────────────────────────
    // Firebase omits empty-string values and may collapse sparse arrays,
    // so we build a fresh grid and copy only the non-empty cells.
    const safeGrid = Array(newSize).fill(null).map(() => Array(newSize).fill(''));
    if (data.grid) {
      for (let r = 0; r < newSize; r++) {
        if (data.grid[r]) {
          for (let c = 0; c < newSize; c++) {
            if (data.grid[r][c]) {
              safeGrid[r][c] = data.grid[r][c];
            }
          }
        }
      }
    }

    // ── Apply remote values to local State ───────────────────────────
    State.grid          = safeGrid;
    State.gridSize      = newSize;
    State.currentPlayer = data.currentPlayer;
    State.duration      = data.duration || 0;
    State.scores        = data.scores;
    State.names         = data.names;
    State.scoredChains  = new Set(data.scoredChains || []);
    State.scoredLines   = data.scoredLines || [];
    State.gameActive    = data.gameActive !== undefined ? data.gameActive : true;
    State.winner        = data.winner || null;

    // Initialise timeLeft if it hasn't been set yet
    if (State.timeLeft === 0 && State.duration > 0) {
      State.timeLeft = State.duration;
    }

    // Safety: unlock input if it's now our turn
    if (State.currentPlayer === State.playerRole && State.gameActive) {
      State.isProcessing = false;
    }

    // ── Re-render ────────────────────────────────────────────────────
    if (oldSize !== State.gridSize) {
      // Grid expanded — full DOM rebuild with expansion animation
      Render.buildGrid(State.gridSize, oldSize);
    } else {
      // Same size — incremental cell sync (smoother)
      Render.syncGrid(State.grid);
    }

    Render.updateScore('X');
    Render.updateScore('O');
    Render.updateTurnIndicator();

    // ── Handle remote game-over ──────────────────────────────────────
    if (!State.gameActive && App.currentScreen === 'game') {
      // Dynamically import game.js to call endGame without a circular
      // static import (game.js already imports multiplayer.js)
      import('./game.js').then(module => {
        const winner = State.winner ||
          (State.scores.X === State.scores.O ? 'draw' :
           (State.scores.X > State.scores.O ? 'X' : 'O'));
        module.endGame(winner, 'classic');
      });
    }
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Room teardown
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Leaves the current multiplayer room and cleans up all listeners.
   *
   * @param {boolean} [forced=false] - `true` when leaving because the
   *   opponent disconnected.  Prevents echoing the `'abandoned'` status
   *   back to Firebase (the other player already wrote it).
   */
  leaveRoom(forced = false) {
    if (!State.isMultiplayer) return;

    if (State.roomCode) {
      const roomRef = db.ref(`rooms/${State.roomCode}`);

      // Detach all listeners first to prevent hearing our own status update
      roomRef.child('status').off();
      roomRef.child('gameState').off();
      roomRef.off();

      if (!forced) {
        // Voluntary leave — notify the other player
        roomRef.update({ status: 'abandoned' });
      }

      // Cancel the onDisconnect hook (we've already left gracefully)
      roomRef.onDisconnect().cancel();
    }

    // ── Reset local multiplayer state ────────────────────────────────
    State.isMultiplayer = false;
    State.roomCode      = null;
    State.gameActive    = false;
    clearTimers();

    if (App.currentScreen !== 'menu') {
      App.showScreen('menu');
    }
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Clipboard helpers
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Copies text to the clipboard using the modern Clipboard API
   * with a legacy fallback for non-HTTPS or older browsers.
   *
   * @param {string} text - The text to copy.
   * @returns {Promise<boolean>} Whether the copy succeeded.
   * @private
   */
  async _copyToClipboard(text) {
    // Modern Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    // Legacy fallback
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (!ok) throw new Error('copy failed');
    return true;
  },

  /**
   * Copies the full invite link (including `?room=CODE` query param)
   * to the clipboard.
   */
  copyInviteLink() {
    const url = `${window.location.origin}${window.location.pathname}?room=${State.roomCode}`;
    this._copyToClipboard(url)
      .then(() => App.showToast('Invite link copied!'))
      .catch(() => App.showToast('Could not copy. Room code: ' + State.roomCode));
  },

  /**
   * Copies only the 4-character room code to the clipboard and shows
   * a checkmark animation on the copy button.
   *
   * The button icon changes from 📋 (copy) to ✓ (check) for 2 seconds
   * to provide visual confirmation.
   */
  copyRoomCode() {
    if (!State.roomCode) return;

    const btn  = document.querySelector('.copy-mini-btn');
    const icon = btn.querySelector('i');

    /**
     * Visual feedback: swap icon to a checkmark for 2 seconds.
     * @private
     */
    const finishCopy = () => {
      App.showToast('Code copied!');
      btn.classList.add('copied');
      icon.className = 'fa-solid fa-check';
      setTimeout(() => {
        btn.classList.remove('copied');
        icon.className = 'fa-solid fa-copy';
      }, 2000);
    };

    this._copyToClipboard(State.roomCode)
      .then(finishCopy)
      .catch(() => App.showToast('Could not copy code.'));
  }
};
