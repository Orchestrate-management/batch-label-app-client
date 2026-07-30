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
        // sets can be swapped per category without changing any structure. The
        // values live in src/index.css.
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
        // Brand and semantic colours are fixed in both surface sets. The scale
        // keys are this app's own (DEFAULT/hover/dark/tint/selected), so no
        // utility class had to be rewritten — only the values are re-anchored to
        // the brand hexes in the marketing repo's public/brand/README.md. They
        // used to be a brighter teal and a redder clay, so the app matched
        // neither www nor its own Logo component, which was already on the new
        // palette.
        teal: {
          DEFAULT: '#14514F', // brand primary (teal-700)
          hover: '#0F3D3B', // brand teal-800
          dark: '#0F3D3B', // sidebar ground
          tint: '#EAF1F0', // brand teal-50
          selected: '#D2E1E0', // brand teal-100
        },
        clay: {
          DEFAULT: '#B4674A', // brand accent (clay-500)
          dark: '#96543B', // brand clay-600
          tint: '#F6E7DF', // brand clay-100
          reversed: '#E5A183', // brand clay-300, the accent when it sits on teal
        },
        // Cards sit on warm paper, so "white" is the brand's card white rather
        // than pure #FFF. Same value the marketing site uses and the same value
        // the reversed mark knocks out to. Regulated artefact surfaces are
        // unaffected: they set #FFFFFF literally in index.css, because that white
        // is mandated by the regulation rather than chosen by us.
        white: '#FBF8F3',
      },
      fontFamily: {
        display: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
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
