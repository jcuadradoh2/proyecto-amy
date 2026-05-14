/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './promesa.html',
    './assets/app.jsx',
    './assets/app.js',
  ],
  theme: {
    extend: {
      colors: {
        bone:       '#f5ede0',
        paper:      '#faf5ec',
        ink:        '#1f1813',
        'ink-soft': '#4a3d33',
        rose:       '#c7857a',
        'rose-deep':'#a06257',
        blush:      '#e8c2b4',
        coral:      '#c66a4c',
        gold:       '#a6803e',
        'gold-light':'#d4b274',
        wine:       '#6e2a2a',
        muted:      '#8b7560',
        line:       'rgba(31,24,19,0.16)'
      },
      fontFamily: {
        serif:  ['Fraunces', 'Georgia', 'serif'],
        italic: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans:   ['"DM Sans"', 'system-ui', 'sans-serif']
      },
      letterSpacing: {
        'wider-2': '0.18em',
        'wider-3': '0.32em'
      }
    }
  }
};
