/** @type {import('tailwindcss').Config} */
export default {
  content: [
  './index.html',
  './src/**/*.{js,ts,jsx,tsx}'
],
  theme: {
    extend: {
      colors: {
        // Surface tokens resolve through CSS variables so the warm and neutral
        // sets can be swapped per category without changing any structure.
        paper: {
          DEFAULT: 'rgb(var(--paper) / <alpha-value>)',
          panel: 'rgb(var(--paper-panel) / <alpha-value>)',
          line: 'rgb(var(--paper-line) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          secondary: 'rgb(var(--ink-secondary) / <alpha-value>)',
          tertiary: 'rgb(var(--ink-tertiary) / <alpha-value>)',
        },
        // Brand and semantic colours are fixed in both surface sets.
        teal: {
          DEFAULT: '#1A6A62',
          hover: '#134F49',
          dark: '#0E3B37',
          tint: '#EFF5F4',
          selected: '#D8E7E5',
        },
        clay: {
          DEFAULT: '#B85F3A',
          dark: '#9C4E2E',
          tint: '#F6E7DF',
        },
      },
      fontFamily: {
        display: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        control: '0.875rem',
        card: '1.125rem',
      },
      maxWidth: {
        prose: '68ch',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
}
