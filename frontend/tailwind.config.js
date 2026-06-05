/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        darkBg: "#08080a",
        darkPanel: "rgba(18, 18, 24, 0.8)",
        darkBorder: "rgba(255, 255, 255, 0.08)",
        arivuEmerald: {
          light: "#34d399",
          DEFAULT: "#10b981",
          dark: "#047857",
        },
        arivuIndigo: {
          light: "#818cf8",
          DEFAULT: "#6366f1",
          dark: "#4338ca",
        }
      },
      boxShadow: {
        emeraldGlow: "0 0 25px rgba(16, 185, 129, 0.15)",
        indigoGlow: "0 0 25px rgba(99, 102, 241, 0.15)",
        combinedGlow: "0 0 35px rgba(99, 102, 241, 0.1) , 0 0 35px rgba(16, 185, 129, 0.1)",
      },
      backdropBlur: {
        xs: "2px",
      }
    },
  },
  plugins: [],
}
