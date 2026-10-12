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
        // Contentplanning — waarden in app/globals.css (--cp-*).
        cp: {
          ink: 'var(--cp-ink)', zacht: 'var(--cp-ink-zacht)', 'op-ink': 'var(--cp-op-ink)', vlak: 'var(--cp-vlak)',
          achtergrond: 'var(--cp-achtergrond)', rand: 'var(--cp-rand)', klaar: 'var(--cp-klaar)', vandaag: 'var(--cp-vandaag)',
          r1: 'var(--cp-r1)', 'r1-zacht': 'var(--cp-r1-zacht)', r2: 'var(--cp-r2)', 'r2-zacht': 'var(--cp-r2-zacht)', r3: 'var(--cp-r3)', 'r3-zacht': 'var(--cp-r3-zacht)',
        },
      },
      fontSize: {
        'cp-titel': ['var(--cp-tekst-titel)', { lineHeight: '1.15', fontWeight: '700' }],
        'cp-kop': ['var(--cp-tekst-kop)', { lineHeight: '1.3', fontWeight: '600' }],
        'cp-basis': ['var(--cp-tekst-basis)', { lineHeight: '1.5' }],
        'cp-klein': ['var(--cp-tekst-klein)', { lineHeight: '1.4' }],
      },

      fontFamily: {
        // LET OP — de fallback staat BINNEN var(), en dat is bewust.
        // Bij `var(--font-sans)` zonder fallback wordt de HELE font-family-regel
        // ongeldig zodra die variabele ontbreekt (bv. als het lettertype bij de
        // build niet opgehaald kon worden). De browser valt dan terug op zijn
        // eigen standaard — een serif, oftewel Times New Roman. Met een fallback
        // binnen var() blijft de regel altijd geldig en zakken we netjes door
        // naar de systeemletters. Een serif kan zo nooit meer verschijnen.
        cp: ['var(--cp-font)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
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
        cp: 'var(--cp-radius)',
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
