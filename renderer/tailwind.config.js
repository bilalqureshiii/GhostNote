/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Playfair for the title, Inter for anything you actually read.
        display: ['var(--font-playfair)', 'Georgia', 'serif'],
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          bg: 'rgba(12, 12, 15, 0.97)',
          line: 'rgba(255, 255, 255, 0.09)',
          text: '#e7e5e4',
        },
      },
    },
  },
  plugins: [],
};
