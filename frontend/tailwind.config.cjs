/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [__dirname + '/index.html', __dirname + '/js/**/*.js'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: '#f59e0b', dim: '#b45309' },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
