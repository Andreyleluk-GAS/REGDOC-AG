/** @type {import('tailwindcss').Config} */
export default {
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
      extend: {
        colors: {
          brandGreen: '#1a5d1a',
          brandRed: '#d32f2f',
        }
      },
    },
    plugins: [],
  }