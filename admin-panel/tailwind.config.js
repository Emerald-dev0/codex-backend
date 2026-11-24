/** @type {import('tailwindcss').Config} */
// Same Figma palette as buildrs-frontend/tailwind.config.js (figma.*).
module.exports = {
  content: ['./pages/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        figma: {
          bg: '#0f131c',
          deep: '#0a0d15',
          alt: '#090e16',
          surface: '#101d2c',
          raised: '#1d263b',
          blue: '#1a3345',
          accent: '#12dce5',
          'accent-bright': '#68f7ff',
          'accent-soft': '#a4edf0',
          purple: '#8a38f5',
          'purple-soft': '#c795e8',
          text: '#ffffff',
          'text-soft': '#c7d2dd',
          'text-alt': '#dee2f6',
          'text-muted': '#9aaeba',
          'text-faint': '#748194',
          'text-ghost': '#59687a',
          success: '#03ba03',
          error: '#ec1414',
          warning: '#e5b84a',
          info: '#1478e8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['Roboto Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { DEFAULT: '8px', lg: '12px', xl: '16px' },
    },
  },
  plugins: [],
};
