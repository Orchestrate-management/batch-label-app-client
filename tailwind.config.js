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
          // A card, a dialog, a popover: anything that is a sheet ON the ground
          // rather than part of it. See the long note in src/index.css — cards
          // used to be exactly the same colour as the page behind them, so a
          // hairline was the only evidence a card was there at all.
          raised: 'rgb(var(--paper-raised) / <alpha-value>)',
          // Table headers, toolbars and wells: below the card surface, so a
          // header band reads as furniture rather than as the first row of data.
          sunken: 'rgb(var(--paper-sunken) / <alpha-value>)',
          // The heavier line, for boundaries that mean something — the end of a
          // section, the underside of a page header — as distinct from `line`,
          // which rules between rows of the same kind.
          rule: 'rgb(var(--paper-rule) / <alpha-value>)',
          // The border of anything you can type in or pick from. 3.7:1 on the
          // card surface and 3.39:1 on the ground, which is what SC 1.4.11 asks
          // of a control boundary and what `line` (1.2:1) never met. Use it for
          // inputs, selects and checkboxes, and nothing else.
          edge: 'rgb(var(--paper-edge) / <alpha-value>)',
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
        // The reading measure for dense data. Mirrors --content-max in
        // src/index.css so a table can be bounded from a class as well as from
        // the `.page-shell` utility.
        content: '84rem',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      // WARM SHADOWS, NOT GREY ONES. The ground is #F3EEE6, and a neutral black
      // shadow over a warm paper reads as a dirty smudge rather than as depth —
      // it desaturates the exact area it is meant to lift. These are all mixed
      // from the brand ink (30 27 24), so the shade a card casts is the same
      // colour family as the type on it.
      //
      // Three steps, and the app uses no others:
      //   card     a sheet resting on the desk. Almost nothing — it exists to
      //            give the eye an edge, not to make things float.
      //   raised   a control or a row that has come forward under the pointer.
      //   overlay  a dialog or a popover, which genuinely IS above the page and
      //            is the only place a large shadow is honest.
      boxShadow: {
        card: '0 1px 2px 0 rgb(30 27 24 / 0.04), 0 1px 3px 0 rgb(30 27 24 / 0.05)',
        raised: '0 2px 4px -1px rgb(30 27 24 / 0.06), 0 4px 10px -2px rgb(30 27 24 / 0.08)',
        overlay: '0 8px 16px -4px rgb(30 27 24 / 0.12), 0 24px 48px -12px rgb(30 27 24 / 0.18)',
      },
    },
  },
  plugins: [],
}
