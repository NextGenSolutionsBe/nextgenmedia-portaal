import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#fff848',
          foreground: '#000000',
        },
        brand: '#fff848',
      },
      fontFamily: {
        // LET OP — de fallback staat BINNEN var(), en dat is bewust.
        // Bij `var(--font-sans)` zonder fallback wordt de HELE font-family-regel
        // ongeldig zodra die variabele ontbreekt (bv. als het lettertype bij de
        // build niet opgehaald kon worden). De browser valt dan terug op zijn
        // eigen standaard — een serif, oftewel Times New Roman. Met een fallback
        // binnen var() blijft de regel altijd geldig en zakken we netjes door
        // naar de systeemletters. Een serif kan zo nooit meer verschijnen.
        sans: [
          'var(--font-sans, ui-sans-serif)',
          'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto',
          'Helvetica Neue', 'Arial', 'sans-serif',
        ],
      },
      borderRadius: {
        lg: '0.625rem',
        md: '0.5rem',
        sm: '0.375rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-in': 'slideIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [animate],
}

export default config
