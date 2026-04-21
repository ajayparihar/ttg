const dict = {
  en: {
    'title': 'TIC TAC GROW',
    'subtitle': 'The classic, with an infinite twist.',
    'single_player': 'Single Player',
    'dual_player': 'Dual Player',
    'play_tutorial': 'Play Tutorial',
    'play_friend': 'Play with Friend',
    'your_turn': 'Your Turn',
    'opponent_turn': "Opponent's Turn",
    'ai_turn': "AI's Turn",
    'ai_thinking': 'AI Thinking',
    'board_grows': 'Board Grows!',
    'match_paused': 'Match Paused',
    'match_abandoned': 'Opponent left the match.',
    'invite_copied': 'Invite link copied!',
    'code_copied': 'Code copied!',
    'winner_x': 'Xi Wins!',
    'winner_o': 'Om Wins!',
    'draw': "It's a Draw!",
    'spam_warning': "Don't spam! Wait a bit."
  },
  es: {
    'title': 'TRES EN LÍNEA CRECIENTE',
    'subtitle': 'El clásico, con un giro infinito.',
    'single_player': 'Un Jugador',
    'dual_player': 'Dos Jugadores',
    'play_tutorial': 'Jugar Tutorial',
    'play_friend': 'Jugar con Amigo',
    'your_turn': 'Tu Turno',
    'opponent_turn': 'Turno del Oponente',
    'ai_turn': 'Turno de la IA',
    'ai_thinking': 'IA Pensando',
    'board_grows': '¡El tablero crece!',
    'match_paused': 'Juego Pausado',
    'match_abandoned': 'El oponente abandonó.',
    'invite_copied': '¡Enlace copiado!',
    'code_copied': '¡Código copiado!',
    'winner_x': '¡Xi Gana!',
    'winner_o': '¡Om Gana!',
    'draw': '¡Es un Empate!',
    'spam_warning': '¡No hagas spam! Espera un poco.'
  }
};

let currLang = localStorage.getItem('ttg_lang') || 'en';

export const i18n = {
  setLang(lang) {
    currLang = lang;
    localStorage.setItem('ttg_lang', lang);
    this.translateDOM();
  },
  
  getLang() { return currLang; },

  t(key) {
    return dict[currLang][key] || key;
  },

  translateDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (dict[currLang][key]) {
        // preserve icon if any
        const icon = el.querySelector('i');
        if (icon) {
          el.innerHTML = '';
          el.appendChild(icon);
          el.appendChild(document.createTextNode(' ' + dict[currLang][key]));
        } else {
          el.textContent = dict[currLang][key];
        }
      }
    });
  }
};

// Auto run on load
document.addEventListener('DOMContentLoaded', () => i18n.translateDOM());
