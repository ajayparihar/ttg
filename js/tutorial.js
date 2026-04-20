import { State } from './state.js';
import { Render } from './render.js';
import { makeMove } from './game.js';

export const Tutorial = {
  step: 0,
  active: false,

  start() {
    this.active = true;
    this.step = 1;
    this.showStep();
  },

  showStep() {
    const hint = document.getElementById('tutorial-hint');
    hint.style.display = 'block';
    this.clearHighlights();

    switch(this.step) {
      case 1:
        hint.textContent = "Tap the highlighted cell to start.";
        this.highlightCell(1, 1);
        break;
      case 2:
        hint.textContent = "Your opponent moved. Now, block them!";
        this.highlightCell(0, 0);
        break;
      case 3:
        hint.textContent = "It's a tie! Watch the board grow.";
        break;
      case 4:
        hint.textContent = "On 4x4 or larger, you score points for chains of 3+.";
        this.highlightCell(0, 0);
        this.highlightCell(0, 1);
        this.highlightCell(0, 2);
        localStorage.setItem('ttg_tutorial_done', 'true');
        setTimeout(() => {
          hint.style.display = 'none';
          this.active = false;
        }, 8000);
        break;
    }
  },

  nextStep() {
    this.step++;
    this.showStep();
  },

  highlightCell(r, c) {
    const cell = Render.getCell(r, c);
    if (cell) cell.classList.add('tutorial-highlight');
  },

  clearHighlights() {
    document.querySelectorAll('.cell.tutorial-highlight').forEach(el => {
      el.classList.remove('tutorial-highlight');
    });
  },

  handleMove(r, c) {
    if (!this.active) return true;

    if (this.step === 1 && r === 1 && c === 1) {
      setTimeout(() => {
        makeMove(0, 1, true); // Tutor move
        this.nextStep();
      }, 600);
      return true;
    }
    if (this.step === 2 && r === 0 && c === 0) {
      // Setup a tie scenario
      setTimeout(() => {
        // Fill the rest for a tie
        makeMove(0, 2, true);
        setTimeout(() => makeMove(1, 0, true), 300);
        setTimeout(() => makeMove(1, 2, true), 600);
        setTimeout(() => makeMove(2, 0, true), 900);
        setTimeout(() => makeMove(2, 1, true), 1200);
        setTimeout(() => makeMove(2, 2, true), 1500);
      }, 600);
      return true;
    }
    
    return false;
  }
};
