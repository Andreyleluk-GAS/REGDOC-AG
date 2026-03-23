/** @type {import('tailwindcss').Config} */
export default {
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
      extend: {
        colors: {
          regdocNavy: '#1B2A4B',
          regdocCyan: '#00C4CC',
          regdocGrey: '#E1E4E8',
          regdocTeal: '#008080',
          regdocOrange: '#FF7F50',
          regdocMist: '#E8F8F9',
          brandGreen: '#00C4CC',
          brandRed: '#d32f2f',
        },
        fontFamily: {
          sans: ['Roboto', 'ui-sans-serif', 'system-ui', 'sans-serif'],
          display: ['Montserrat', 'Roboto', 'ui-sans-serif', 'sans-serif'],
        },
      },
    },
    plugins: [],
  }