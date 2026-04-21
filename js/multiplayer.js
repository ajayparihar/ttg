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
import { i18n } from './i18n.js';
import { hapticFeedback, HapticPresets } from './utils.js';
import { GOOGLE_SIGNIN_ENABLED } from './constants.js';

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
  
  // Enable auth persistence for better UX
  firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
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
    return new Promise((resolve) => {
      // 1. First, check if we're returning from a redirect login
      auth.getRedirectResult().catch(err => {
        console.error("Redirect login result error:", err);
        if (err.code === 'auth/unauthorized-domain') {
          App.showToast("Domain not authorized. Use Firebase Console to fix.");
        }
      });

      // 2. Listen for auth state changes
      auth.onAuthStateChanged(async (user) => {
        if (user) {
          State.userId = user.uid;
          
          if (!user.isAnonymous) {
            State.userProfile = {
              name: user.displayName,
              photo: user.photoURL,
              email: user.email
            };
            App.updateUserUI();
            
            // Sync stats if logging in for the first time in this session
            this.syncStatsFromLocal(user.uid);
          }
          
          // If we were on login screen, move to menu
          if (App.currentScreen === 'login') {
            App.showScreen('menu');
          }
          
          resolve(user.uid);
        } else {
          // No auto-anonymous anymore; user must Choose login or skip
          resolve(null);
        }
      });
    });
  },

  /**
   * Syncs locally stored stats to the Firebase account on login.
   * @param {string} uid - Authenticated User ID.
   */
  async syncStatsFromLocal(uid) {
    try {
      const local = localStorage.getItem('ttg_stats');
      if (local) {
        const stats = JSON.parse(local);
        db.ref(`users/${uid}/stats`).update(stats);
      }
    } catch (e) {
      console.warn('Failed to sync stats to Firebase:', e);
    }
  },

  /**
   * Saves a single stat point to account.
   */
  pushStat(key, val) {
    if (!State.userId || State.loginSkipped) return;
    db.ref(`users/${State.userId}/stats/${key}`).set(val);
  },

  /**
   * Triggers the Google Auth popup.
   * Returns early if GOOGLE_SIGNIN_ENABLED is false.
   */
  async loginWithGoogle() {
    if (!GOOGLE_SIGNIN_ENABLED) {
      App.showToast("Google Sign-in is currently disabled.");
      return;
    }

    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      // Initialize the listener if not already done
      this.initId();

      // Use signInWithPopup for better UX (no page reload)
      const result = await auth.signInWithPopup(provider);

      // The onAuthStateChanged listener will handle the UI update
      console.log("Google login successful:", result.user);
    } catch (err) {
      console.error("Google login failed:", err);

      if (err.code === 'auth/unauthorized-domain') {
        App.showToast("Domain not authorized. Use Firebase Console to fix.");
        console.warn("ACTION REQUIRED: Add ajayparihar.github.io to Authorized Domains in Firebase.");
      } else if (err.code === 'auth/popup-closed-by-user') {
        App.showToast("Login cancelled.");
      } else if (err.code === 'auth/popup-blocked') {
        App.showToast("Popup blocked. Please allow popups for this site.");
      } else {
        App.showToast("Login failed: " + err.message);
      }
    }
  },

  /**
   * Signs the user out of Firebase.
   */
  async logout() {
    try {
      await auth.signOut();
      
      // Clear user state manually instead of reload
      State.userId = null;
      State.userProfile = null;
      State.loginSkipped = false;
      
      // Return to login screen
      App.showScreen('login');
      App.showToast("Signed out successfully");
    } catch (err) {
      console.error("Logout failed:", err);
      App.showToast("Logout failed.");
    }
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
    State.duration      = 0;

    // ── Write Ring to Firebase ───────────────────────────────────────
    const roomRef = db.ref(`rings/${code}`);
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
    // Ensure room info is visible for host
    const roomInfoEl = document.querySelector('.room-info');
    if (roomInfoEl) roomInfoEl.style.display = '';

    const roomCodeText = document.getElementById('room-code-text');
    const slotHostName = document.getElementById('slot-host-name');
    const slotGuestName = document.getElementById('slot-guest-name');
    const slotGuest = document.getElementById('slot-guest');
    const startBtn = document.getElementById('start-multiplayer-btn');

    if (roomCodeText) roomCodeText.textContent = code;
    if (slotHostName) slotHostName.textContent = State.names.X || 'You';
    if (slotGuestName) slotGuestName.textContent = 'Waiting...';
    if (slotGuest) slotGuest.classList.remove('active');
    if (startBtn) startBtn.disabled = true;

    App.showScreen('multiplayer-waiting');

    // ── Listen for a guest to join ───────────────────────────────────
    roomRef.on('value', (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      // Detect guest arrival (status changes to 'ready' or guestId appears)
      const slotGuest = document.getElementById('slot-guest');
      const slotGuestName = document.getElementById('slot-guest-name');
      const startBtn = document.getElementById('start-multiplayer-btn');

      if ((data.status === 'ready' || data.guestId) &&
          slotGuest && !slotGuest.classList.contains('active')) {
        if (slotGuestName) slotGuestName.textContent = data.guestName || 'Friend';
        slotGuest.classList.add('active');
        if (startBtn) startBtn.disabled = false;
        App.showToast(i18n.t('play_friend')); // Reuse or add friend_joined
      }

      // Handle the case where the host is also listening for game start
      // (relevant during rematches where both clients are in the waiting screen)
      if (data.status === 'playing' && State.playerRole === 'O') {
        if (data.gameState && data.gameState.gameActive) {
          this._syncFromRemote(data.gameState);
          if (App.currentScreen !== 'game') {
            App.showScreen('game');
            // Show reaction UI for guest during rematch
            const reactContainer = document.getElementById('reaction-container');
            if (reactContainer) {
              reactContainer.style.display = 'flex';
              App.updateReactionTray();
            }
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
    const inputs = document.querySelectorAll('.otp-input');
    const code = Array.from(inputs).map(input => input.value.trim().toUpperCase()).join('');

    // ── Input validation ─────────────────────────────────────────────
    if (!code || code.length !== 4) {
      App.showToast("Enter a valid 4-char code.");
      return;
    }

    await this.initId();
    const roomRef  = db.ref(`rings/${code}`);
    const snapshot = await roomRef.once('value');

    // ── Room existence check ─────────────────────────────────────────
    if (!snapshot.exists()) {
      App.showToast("Room not found.");
      return;
    }

    const data = snapshot.val();

    // ── Room availability check ──────────────────────────────────────
    // Room must be in 'waiting' status AND have no guest assigned yet
    if (data.status !== 'waiting' || data.guestId) {
      if (data.status === 'abandoned') {
        App.showToast("Room was abandoned by host.");
      } else if (data.guestId) {
        App.showToast("Room is full (guest already joined).");
      } else {
        App.showToast("Room is full or already started.");
      }
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
    // Hide Ring ID for guests (they already know it - they just typed it)
    const roomInfoEl = document.querySelector('.room-info');
    if (roomInfoEl) roomInfoEl.style.display = 'none';

    const slotHostName = document.getElementById('slot-host-name');
    const slotGuestName = document.getElementById('slot-guest-name');
    const slotGuest = document.getElementById('slot-guest');
    const startBtn = document.getElementById('start-multiplayer-btn');
    const waitingStatus = document.getElementById('waiting-status-text');

    if (slotHostName) slotHostName.textContent = data.hostName;
    if (slotGuestName) slotGuestName.textContent = State.names.O || 'You';
    if (slotGuest) slotGuest.classList.add('active');
    if (startBtn) startBtn.style.display = 'none';

    App.showScreen('multiplayer-waiting');
    if (waitingStatus) waitingStatus.textContent = "Waiting for host to start...";

    // ── Listen for the host to start the game ─
    roomRef.on('value', (snap) => {
      const d = snap.val();
      if (d && d.status === 'playing' && App.currentScreen !== 'game') {
        if (d.gameState && d.gameState.gameActive === true) {
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
    const roomRef = db.ref(`rings/${State.roomCode}`);
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

    // Show reaction UI for guests (host gets this via App.initGame)
    const reactContainer = document.getElementById('reaction-container');
    if (reactContainer) {
      reactContainer.style.display = 'flex';
      App.updateReactionTray();
    }

    // Deferred build to let the screen layout settle
    setTimeout(() => {
      Render.buildGrid(State.gridSize);
      Render.updateTurnIndicator();
      Render.updateScore('X');
      Render.updateScore('O');
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
    const roomRef = db.ref(`rings/${State.roomCode}`);

    // Detach any existing listeners first to prevent duplicates on rematch
    roomRef.child('status').off();
    roomRef.child('gameState').off();
    roomRef.child('reaction').off();
    roomRef.child('rematchRequest').off();

    // Listen for opponent disconnection
    roomRef.child('status').on('value', (snapshot) => {
      if (snapshot.val() === 'abandoned' && State.isMultiplayer) {
        App.showToast(i18n.t('match_abandoned'));
        // Fire-and-forget: don't block the listener
        void this.leaveRoom(true);   // Forced leave (don't re-notify)
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

    // Listen for incoming reactions from the opponent
    roomRef.child('reaction').on('value', (snap) => {
      const data = snap.val();
      if (data && data.sender !== State.userId) {
        this._showReaction(data.emoji, false);
        // Haptic feedback when receiving a reaction from opponent
        hapticFeedback(HapticPresets.TAP);
      }
    });

    // Listen for rematch requests
    roomRef.child('rematchRequest').on('value', (snap) => {
      const data = snap.val();
      if (!data) return;

      this._handleRematchRequest(data);
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
    const roomRef = db.ref(`rings/${State.roomCode}/gameState`);
    roomRef.set(this._getSerializableState());
  },

  /**
   * Pushes a partial update to the game state.
   * Least data intensive way to sync changes across the server.
   * @param {object} delta - Key-value pairs to update.
   */
  pushStateUpdate(delta) {
    if (!State.isMultiplayer || !State.roomCode) return;
    const updateObj = {
      ...delta,
      lastModifiedBy: State.userId,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    };
    db.ref(`rings/${State.roomCode}/gameState`).update(updateObj);
  },

  /**
   * Efficiently pushes a single move and associated state changes.
   * @param {number} r - Row index.
   * @param {number} c - Column index.
   * @param {string} player - 'X' or 'O'.
   */
  pushMove(r, c, player) {
    this.pushStateUpdate({
      [`grid/${r}/${c}`]: player,
      currentPlayer: State.currentPlayer,
      scores: State.scores,
      scoredChains: Array.from(State.scoredChains),
      scoredLines: State.scoredLines,
      gameActive: State.gameActive,
      winner: State.winner || null
    });
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

    // ── Defensively update the local grid ───────────────────────────
    // We only perform a full reconstruction if the grid doesn't exist
    // or the size has changed (expansion). Otherwise, we apply deltas.
    if (!State.grid || State.grid.length !== newSize) {
      const safeGrid = Array(newSize).fill(null).map(() => Array(newSize).fill(''));
      if (data.grid) {
        for (let r = 0; r < newSize; r++) {
          if (data.grid[r]) {
            for (let c = 0; c < newSize; c++) {
              if (data.grid[r][c]) safeGrid[r][c] = data.grid[r][c];
            }
          }
        }
      }
      State.grid = safeGrid;
    } else if (data.grid) {
      // Incremental sync: only iterate over keys present in the update
      // (Firebase may send the grid as a sparse object or dense array)
      // Explicitly convert string keys to integers for array indexing
      Object.keys(data.grid).forEach(rStr => {
        const r = parseInt(rStr, 10);
        if (!isNaN(r) && data.grid[rStr]) {
          Object.keys(data.grid[rStr]).forEach(cStr => {
            const c = parseInt(cStr, 10);
            if (!isNaN(c)) {
              State.grid[r][c] = data.grid[rStr][cStr];
            }
          });
        }
      });
    }

    // ── Apply remote values to local State ───────────────────────────
    State.gridSize      = newSize;
    State.currentPlayer = data.currentPlayer;
    State.duration      = data.duration || 0;
    State.scores        = data.scores;
    State.names         = data.names;
    // Validate scoredChains is an array (Firebase may return object if data corrupted)
    const chainsArray = Array.isArray(data.scoredChains) ? data.scoredChains : [];
    State.scoredChains  = new Set(chainsArray);
    State.scoredLines   = data.scoredLines || [];
    State.gameActive    = data.gameActive !== undefined ? data.gameActive : true;
    State.winner        = data.winner || null;

    // Initialise timeLeft if it hasn't been set yet
    if (State.timeLeft === 0 && State.duration > 0) {
      State.timeLeft = State.duration;
    }

    // Safety: unlock input if it's now our turn AND we're not in the middle
    // of a local animation. This prevents race conditions where both the local
    // switchTurn() and remote sync try to unlock simultaneously.
    const isMyTurn = State.currentPlayer === State.playerRole;
    const wasWaiting = State.isProcessing;
    if (isMyTurn && State.gameActive && wasWaiting) {
      // Additional check: only unlock if remote timestamp is newer than our last move
      // to prevent stale syncs from unlocking prematurely
      if (data.timestamp && data.lastModifiedBy !== State.userId) {
        State.isProcessing = false;
      }
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
      }).catch(err => {
        console.error('Failed to load game module for endGame:', err);
        // Fallback: at least stop the game locally
        State.gameActive = false;
        App.showScreen('gameover');
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
  async leaveRoom(forced = false) {
    if (!State.isMultiplayer) return;

    if (State.roomCode) {
      const roomRef = db.ref(`rings/${State.roomCode}`);

      // Detach all listeners first to prevent hearing our own status update
      roomRef.child('status').off();
      roomRef.child('gameState').off();
      roomRef.child('reaction').off();
      roomRef.child('rematchRequest').off();
      roomRef.off();

      // Cancel the onDisconnect hook BEFORE sending the status update
      // to reduce the window where a network drop could cause the hook to fire
      try {
        await roomRef.onDisconnect().cancel();
      } catch (e) {
        // onDisconnect cancel can fail if already triggered or network down
        // This is non-fatal - we've already detached listeners
        console.warn('Failed to cancel onDisconnect (may already be triggered):', e);
      }

      if (!forced) {
        // Voluntary leave — notify the other player
        // Use a short delay to ensure cancel completes first
        try {
          await roomRef.update({ status: 'abandoned' });
        } catch (e) {
          console.warn('Failed to send abandoned status:', e);
        }
      }
    }

    // ── Reset local multiplayer state ────────────────────────────────
    State.isMultiplayer = false;
    State.roomCode      = null;
    State.gameActive    = false;
    State.rematchRequests = { X: false, O: false };
    clearTimers();

    // Hide any open popups
    App.hideRematchPopup();

    if (App.currentScreen !== 'menu') {
      App.showScreen('menu');
    }

    // Hide reaction UI
    const reactContainer = document.getElementById('reaction-container');
    const reactionTray = document.getElementById('reaction-tray');
    if (reactContainer) reactContainer.style.display = 'none';
    if (reactionTray) reactionTray.classList.remove('open');
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
  },

  /**
   * Toggles the visibility of the emoji reaction tray.
   */
  toggleReactionTray() {
    const tray = document.getElementById('reaction-tray');
    if (tray) tray.classList.toggle('open');
  },

  /**
   * Pushes a new emoji reaction to Firebase for the remote player to see.
   * @param {string} emoji - The emoji character to send.
   */
  sendReaction(emoji) {
    if (!State.isMultiplayer || !State.roomCode) return;
    
    // Spam prevention: 3 second cooldown
    const now = Date.now();
    if (now - State.lastReactionTime < 3000) {
      App.showToast(i18n.t('spam_warning'));
      return;
    }
    State.lastReactionTime = now;

    // Using a separate 'reaction' node to avoid full game state syncs
    const ref = db.ref(`rings/${State.roomCode}/reaction`);
    ref.set({
      emoji,
      sender: State.userId,
      // Using a random salt to ensure 'value' listener triggers even if same emoji sent twice
      salt: Math.random(),
      timestamp: firebase.database.ServerValue.TIMESTAMP
    });

    this.toggleReactionTray();
    
    // Show locally as well (feedback)
    this._showReaction(emoji, true);
  },

  /**
   * Renders a floating reaction bubble on the screen.
   * @param {string} emoji - The emoji to display.
   * @param {boolean} isLocal - Whether this reaction was sent by the local player.
   * @private
   */
  _showReaction(emoji, isLocal) {
    // Light haptic for local reactions too
    if (isLocal) {
      hapticFeedback(HapticPresets.BUTTON);
    }

    const bubble = document.createElement('div');
    // Add 'local' or 'remote' class for direction-specific animation
    bubble.className = `reaction-bubble ${isLocal ? 'local' : 'remote'}`;
    bubble.textContent = emoji;

    // Position at the center of the grid wrapper for maximum visibility
    const wrapper = document.getElementById('grid-wrapper');
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      bubble.style.position = 'fixed';
      bubble.style.left = `${rect.left + rect.width / 2}px`;
      bubble.style.top = `${rect.top + rect.height / 2}px`;
    } else {
      bubble.style.left = '50%';
      bubble.style.top = '50%';
    }

    document.body.appendChild(bubble);
    setTimeout(() => bubble.remove(), 2500);
  },

  // ─────────────────────────────────────────────────────────────────────
  //  Rematch request handling
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Sends a rematch request to the opponent.
   * Called when the local player clicks the rematch button.
   */
  requestRematch() {
    if (!State.isMultiplayer || !State.roomCode) return;

    const roomRef = db.ref(`rings/${State.roomCode}`);
    const myRole = State.playerRole;
    const opponentRole = myRole === 'X' ? 'O' : 'X';

    // Mark my approval
    State.rematchRequests[myRole] = true;

    // Send request to Firebase
    roomRef.child('rematchRequest').update({
      [myRole]: true,
      [`${myRole}Name`]: State.names[myRole],
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      salt: Math.random() // Ensure trigger on duplicate requests
    });

    // Check if both approved (local + remote already true)
    if (State.rematchRequests[opponentRole]) {
      this._startRematchGame();
    } else {
      // Show waiting popup
      App.showRematchWaiting();
      App.showToast('Rematch requested! Waiting for opponent...');
    }
  },

  /**
   * Accepts an incoming rematch request.
   * Called when user clicks "Accept" on the rematch popup.
   */
  acceptRematch() {
    if (!State.isMultiplayer || !State.roomCode) return;

    const roomRef = db.ref(`rings/${State.roomCode}`);
    const myRole = State.playerRole;
    const opponentRole = myRole === 'X' ? 'O' : 'X';

    // Mark my approval
    State.rematchRequests[myRole] = true;

    // Update Firebase
    roomRef.child('rematchRequest').update({
      [myRole]: true,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    });

    // Check if both approved
    if (State.rematchRequests[opponentRole]) {
      this._startRematchGame();
    } else {
      // Still waiting for opponent - show waiting state
      App.updateRematchStatus('Waiting for opponent to confirm...');
      App.showToast('You accepted! Waiting for opponent...');
    }

    hapticFeedback(HapticPresets.BUTTON);
  },

  /**
   * Declines an incoming rematch request.
   * Called when user clicks "Decline" on the rematch popup.
   */
  declineRematch() {
    if (!State.isMultiplayer || !State.roomCode) return;

    const roomRef = db.ref(`rings/${State.roomCode}`);

    // Clear the rematch request
    roomRef.child('rematchRequest').remove();

    // Reset local state
    State.rematchRequests = { X: false, O: false };

    // Hide popup
    App.hideRematchPopup();

    App.showToast('Rematch declined.');
    hapticFeedback(HapticPresets.BUTTON);
  },

  /**
   * Handles incoming rematch request data from Firebase.
   * @param {object} data - Rematch request data from Firebase.
   * @private
   */
  _handleRematchRequest(data) {
    if (!data || !State.isMultiplayer) return;

    const myRole = State.playerRole;
    const opponentRole = myRole === 'X' ? 'O' : 'X';

    // Update local state from Firebase
    if (data.X !== undefined) State.rematchRequests.X = data.X;
    if (data.O !== undefined) State.rematchRequests.O = data.O;

    const opponentRequested = State.rematchRequests[opponentRole];
    const iRequested = State.rematchRequests[myRole];

    // Both approved - start the game
    if (State.rematchRequests.X && State.rematchRequests.O) {
      this._startRematchGame();
      return;
    }

    // Opponent requested, I haven't responded yet
    if (opponentRequested && !iRequested && !State.rematchPopupOpen) {
      const opponentName = data[`${opponentRole}Name`] || State.names[opponentRole] || 'Opponent';
      App.showRematchPopup(opponentName);
      hapticFeedback(HapticPresets.BUTTON);
    }

    // I requested, opponent accepted (waiting for me to confirm)
    if (iRequested && opponentRequested && State.rematchPopupOpen) {
      App.updateRematchStatus('Opponent accepted! Starting game...');
    }
  },

  /**
   * Starts a rematch game after both players have approved.
   * Resets the rematch request state and initiates the game.
   * @private
   */
  _startRematchGame() {
    // Hide popup if open
    App.hideRematchPopup();

    // Reset rematch request state
    State.rematchRequests = { X: false, O: false };

    // Clear rematch request from Firebase
    const roomRef = db.ref(`rings/${State.roomCode}`);
    roomRef.child('rematchRequest').remove();

    // Show toast
    App.showToast('Both players ready! Starting rematch...');

    // Start the game (host handles the actual game start)
    if (State.playerRole === 'X') {
      this.hostStartGame();
    }
    // Guest will be notified via the existing room status listener

    hapticFeedback(HapticPresets.BUTTON);
  }
};
