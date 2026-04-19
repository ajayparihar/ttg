import { State } from './state.js';
import { App } from './app.js';
import { makeMove, switchTurn, clearTimers } from './game.js';
import { Render } from './render.js';

/**
 * MULTIPLAYER MODULE
 * Handles all Firebase real-time database interactions.
 */

// --- Placeholder Firebase Config ---
// The user should replace this with their actual Firebase project config.
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

// Initialize Firebase
if (firebase.apps.length === 0) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.database();
const auth = firebase.auth();

export const Multiplayer = {
  
  /**
   * Initializes anonymous authentication.
   */
  async initId() {
    if (State.userId) return;
    const user = await auth.signInAnonymously();
    State.userId = user.user.uid;
    console.log("Logged in as:", State.userId);
  },

  /**
   * Generates a random 4-char uppercase code.
   */
  _generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O, I, 1, 0 to avoid confusion
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  },

  /**
   * Creates a new room in Firebase.
   */
  async createRoom() {
    await this.initId();
    const code = this._generateCode();
    State.roomCode = code;
    State.playerRole = 'X';
    State.isMultiplayer = true;
    State.mode = 'dual';
    State.duration = App.selectedDuration;

    const roomRef = db.ref(`rooms/${code}`);
    roomRef.onDisconnect().update({ status: 'abandoned' });
    
    // Initial room state
    await roomRef.set({
      hostId: State.userId,
      hostName: State.names.X || 'Host',
      status: 'waiting',
      duration: State.duration,
      playerXName: State.names.X || 'Host',
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      gameState: null
    });

    // Update UI
    document.getElementById('room-code-text').textContent = code;
    document.getElementById('slot-host-name').textContent = State.names.X || 'You';
    document.getElementById('slot-guest-name').textContent = 'Waiting...';
    document.getElementById('slot-guest').classList.remove('active');
    document.getElementById('start-multiplayer-btn').disabled = true;
    
    App.showScreen('multiplayer-waiting');

    // Watch for guest
    roomRef.on('value', (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      if ((data.status === 'ready' || data.guestId) && !document.getElementById('slot-guest').classList.contains('active')) {
        document.getElementById('slot-guest-name').textContent = data.guestName || 'Friend';
        document.getElementById('slot-guest').classList.add('active');
        document.getElementById('start-multiplayer-btn').disabled = false;
        App.showToast("Friend joined!");
      }
      
      // If host has already started for guest
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

  /**
   * Joins an existing room.
   */
  async joinRoom() {
    const code = document.getElementById('join-code-input').value.trim().toUpperCase();
    if (!code || code.length !== 4) {
      App.showToast("Enter a valid 4-char code.");
      return;
    }

    await this.initId();
    const roomRef = db.ref(`rooms/${code}`);
    const snapshot = await roomRef.once('value');
    
    if (!snapshot.exists()) {
      App.showToast("Room not found.");
      return;
    }

    const data = snapshot.val();
    if (data.status !== 'waiting') {
      App.showToast("Room is full or already started.");
      return;
    }

    State.roomCode = code;
    State.playerRole = 'O';
    State.isMultiplayer = true;
    State.mode = 'dual';
    State.duration = data.duration || 0;
    State.timeLeft = State.duration;

    roomRef.onDisconnect().update({ status: 'abandoned' });

    // Join room
    await roomRef.update({
      guestId: State.userId,
      guestName: State.names.O || 'Guest',
      playerOName: State.names.O || 'Guest',
      status: 'ready'
    });

    // Update UI and wait for host to start
    document.getElementById('room-code-text').textContent = code;
    document.getElementById('slot-host-name').textContent = data.hostName;
    document.getElementById('slot-guest-name').textContent = State.names.O || 'You';
    document.getElementById('slot-guest').classList.add('active');
    document.getElementById('start-multiplayer-btn').style.display = 'none'; // Guest can't start
    
    App.showScreen('multiplayer-waiting');
    document.getElementById('waiting-status-text').textContent = "Waiting for host to start...";

    // Listen for host starting the game (or rematch)
    roomRef.on('value', (snap) => {
      const d = snap.val();
      if (d && d.status === 'playing' && App.currentScreen !== 'game') {
        // Only trigger 'Game started' if the host has initialized an active game
        if (d.gameState && d.gameState.gameActive === true) {
          App.showToast("Game started!");
          this._startRemoteGame(d.gameState);
        }
      }
    });
  },

  /**
   * Host starts the game.
   */
  async hostStartGame() {
    if (State.playerRole !== 'X') return;

    // Initialize game locally first (resets board, turn, timers)
    App.initGame(); 
    
    // Push state to Firebase
    const roomRef = db.ref(`rooms/${State.roomCode}`);
    const snap = await roomRef.once('value');
    const data = snap.val();
    
    // Ensure names are synced
    State.names.X = data.playerXName || 'Host';
    State.names.O = data.playerOName || 'Guest';
    Render.updateScore('X');
    Render.updateScore('O');

    await roomRef.update({
      status: 'playing',
      gameState: this._getSerializableState()
    });

    if (App.currentScreen !== 'game') {
      App.showScreen('game');
    }
    this._startSyncListeners();

    // Ensure HUD is perfectly synced at the end
    Render.updateScore('X');
    Render.updateScore('O');
  },

  /**
   * For guest: Starts the game locally based on host's state.
   */
  _startRemoteGame(remoteState) {
    this._syncFromRemote(remoteState);
    App.showScreen('game');
    
    // Sync HUD elements specifically for guest
    document.getElementById('mode-badge').textContent = 'Online';

    setTimeout(() => {
      Render.buildGrid(State.gridSize);
      Render.updateTurnIndicator();
      Render.updateScore('X');
      Render.updateScore('O');
      App.startTimer();
      this._startSyncListeners();
    }, 100);
  },

  /**
   * Listens for moves and state changes.
   */
  _startSyncListeners() {
    const roomRef = db.ref(`rooms/${State.roomCode}`);
    
    // Listen for room abandons
    roomRef.child('status').on('value', (snapshot) => {
      if (snapshot.val() === 'abandoned' && State.isMultiplayer) {
        App.showToast("Opponent left the match.");
        this.leaveRoom(true); // Forced leave
      }
    });

    const stateRef = roomRef.child('gameState');
    
    stateRef.on('value', (snapshot) => {
      const remoteState = snapshot.val();
      if (!remoteState) return;
      
      // Only sync if it's the other player's modification
      if (remoteState.lastModifiedBy !== State.userId) {
        this._syncFromRemote(remoteState);
      }
    });
  },

  /**
   * Pushes current state to Firebase.
   */
  pushState() {
    if (!State.isMultiplayer) return;
    const roomRef = db.ref(`rooms/${State.roomCode}/gameState`);
    roomRef.set(this._getSerializableState());
  },

  /**
   * Prepares state for Firebase (converting Sets to Arrays, etc.)
   */
  _getSerializableState() {
    return {
      grid: State.grid,
      gridSize: State.gridSize,
      currentPlayer: State.currentPlayer,
      duration: State.duration,
      scores: State.scores,
      names: State.names,
      scoredChains: Array.from(State.scoredChains),
      scoredLines: State.scoredLines,
      gameActive: State.gameActive,
      winner: State.winner || null,
      lastModifiedBy: State.userId,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    };
  },

  /**
   * Syncs local State from Remote data.
   */
  _syncFromRemote(data) {
    if (!data) return;

    const oldSize = State.gridSize;
    const newSize = data.gridSize || State.gridSize;
    
    // Reconstruct grid safely because Firebase strips empty strings and arrays
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
    
    State.grid = safeGrid;
    State.gridSize = newSize;
    State.currentPlayer = data.currentPlayer;
    State.duration = data.duration || 0;
    if (State.timeLeft === 0 && State.duration > 0) State.timeLeft = State.duration;
    State.scores = data.scores;
    State.names = data.names;
    State.scoredChains = new Set(data.scoredChains || []);
    State.scoredLines = data.scoredLines || [];
    State.gameActive = data.gameActive !== undefined ? data.gameActive : true;
    State.winner = data.winner || null;
    
    // Safety: Unlock processing if it's now our turn
    if (State.currentPlayer === State.playerRole && State.gameActive) {
      State.isProcessing = false;
    }

    // Re-render
    if (oldSize !== State.gridSize) {
      Render.buildGrid(State.gridSize, oldSize);
    } else {
      Render.syncGrid(State.grid);
    }

    Render.updateScore('X');
    Render.updateScore('O');
    Render.updateTurnIndicator();

    // If opponent won or drew, transition screen
    if (!State.gameActive && App.currentScreen === 'game') {
      import('./game.js').then(module => {
        // Just trigger the game over payload natively based on synced winner
        const winner = State.winner || (State.scores.X === State.scores.O ? 'draw' : (State.scores.X > State.scores.O ? 'X' : 'O'));
        module.endGame(winner, 'classic');
      });
    }
  },

  /**
   * Leaves the room and cleans up.
   */
  leaveRoom(forced = false) {
    if (!State.isMultiplayer) return;

    if (State.roomCode) {
      const roomRef = db.ref(`rooms/${State.roomCode}`);
      roomRef.child('status').off();
      roomRef.child('gameState').off();
      roomRef.off(); // Detach ALL listeners first so we don't hear our own 'abandoned' status
      
      if (!forced) {
        // We are leaving voluntarily, notify the other player
        roomRef.update({ status: 'abandoned' });
      }
      roomRef.onDisconnect().cancel(); // Remove our disconnect hook
    }
    
    State.isMultiplayer = false;
    State.roomCode = null;
    State.gameActive = false;
    clearTimers();
    
    if (App.currentScreen !== 'menu') {
      App.showScreen('menu');
    }
  },

  /**
   * Copies the invite link to clipboard.
   */
  copyInviteLink() {
    const url = `${window.location.origin}${window.location.pathname}?room=${State.roomCode}`;
    
    // Modern API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        App.showToast("Invite link copied!");
      });
      return;
    }

    // Fallback for non-HTTPS or older browsers
    try {
      const textArea = document.createElement("textarea");
      textArea.value = url;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) App.showToast("Invite link copied!");
      else throw new Error('copy failed');
    } catch (err) {
      console.error('Fallback copy failed', err);
      App.showToast("Could not copy. Room code: " + State.roomCode);
    }
  },

  /**
   * Copies only the 4-char room code to clipboard.
   */
  copyRoomCode() {
    if (!State.roomCode) return;
    
    const btn = document.querySelector('.copy-mini-btn');
    const icon = btn.querySelector('i');
    
    const finishCopy = () => {
      App.showToast("Code copied!");
      btn.classList.add('copied');
      icon.className = 'fa-solid fa-check';
      setTimeout(() => {
        btn.classList.remove('copied');
        icon.className = 'fa-solid fa-copy';
      }, 2000);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(State.roomCode).then(finishCopy);
      return;
    }

    // Fallback
    try {
      const textArea = document.createElement("textarea");
      textArea.value = State.roomCode;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      finishCopy();
    } catch (err) {
      App.showToast("Could not copy code.");
    }
  }
};
