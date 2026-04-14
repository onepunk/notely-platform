/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        notely: {
          dark: '#132E2D',
          accent: '#B8F75D',
          light: '#f8f9fa',
        },
      },
    },
  },
  plugins: [],
};
