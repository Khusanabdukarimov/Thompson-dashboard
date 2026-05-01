/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
        display: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg: 'var(--bg)',
        bg2: 'var(--bg2)',
        bg3: 'var(--bg3)',
        bg4: 'var(--bg4)',
        border: 'var(--border)',
        border2: 'var(--border2)',
        text: 'var(--text)',
        text2: 'var(--text2)',
        text3: 'var(--text3)',
        blue:   { DEFAULT: 'var(--blue)',   2: 'var(--blue2)', bg: 'var(--blue-bg)',   bd: 'var(--blue-border)' },
        green:  { DEFAULT: 'var(--green)',  bg: 'var(--green-bg)',  bd: 'var(--green-border)' },
        amber:  { DEFAULT: 'var(--amber)',  bg: 'var(--amber-bg)',  bd: 'var(--amber-border)' },
        red:    { DEFAULT: 'var(--red)',    bg: 'var(--red-bg)',    bd: 'var(--red-border)' },
        orange: { DEFAULT: 'var(--orange)', bg: 'var(--orange-bg)', bd: 'var(--orange-border)' },
        purple: { DEFAULT: 'var(--purple)', bg: 'var(--purple-bg)', bd: 'var(--purple-border)' },
        teal:   { DEFAULT: 'var(--teal)',   bg: 'var(--teal-bg)',   bd: 'var(--teal-border)' },
      },
      borderRadius: {
        DEFAULT: 'var(--r)',
        lg: 'var(--rlg)',
        xl: 'var(--rxl)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        DEFAULT: 'var(--shadow)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      letterSpacing: {
        tight2: '-0.005em',
      },
    },
  },
  plugins: [],
};
