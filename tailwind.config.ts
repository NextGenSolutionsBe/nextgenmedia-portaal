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
        // NextGen-huisstijl: monochroom. `gray` is het merkpalet (neutraal, geen
        // blauwzweem) zodat elke bestaande gray-klasse vanzelf in lijn valt:
        // 900 = bijna zwart #0f0f0f · 800 = donkergrijs #272727 ·
        // 600 = middengrijs #4b4b4b · 200 = lichtgrijs #e0e0e0.
        gray: {
          50: '#fafafa', 100: '#f4f4f4', 200: '#e0e0e0', 300: '#c8c8c8', 400: '#8c8c8c',
          500: '#6b6b6b', 600: '#4b4b4b', 700: '#373737', 800: '#272727', 900: '#0f0f0f', 950: '#080808',
        },
        accent: {
          DEFAULT: '#0f0f0f',
          foreground: '#ffffff',
        },
        brand: '#0f0f0f',
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
        // JetBrains Mono: spaarzaam, voor codes, nummers en compacte technische info.
        mono: ['var(--font-mono, ui-monospace)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: [
          'var(--font-sans, ui-sans-serif)',
          'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto',
          'Helvetica Neue', 'Arial', 'sans-serif',
        ],
      },
      // Bescheiden afgeronde hoeken, overal dezelfde schaal.
      borderRadius: {
        DEFAULT: '0.25rem',
        sm: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.625rem',
        '2xl': '0.75rem',
        '3xl': '0.875rem',
        cp: 'var(--cp-radius)',
      },
      // Weinig schaduw: enkel genoeg om een venster van de pagina te scheiden.
      boxShadow: {
        sm: '0 1px 2px rgba(15, 15, 15, 0.04)',
        DEFAULT: '0 1px 2px rgba(15, 15, 15, 0.06)',
        md: '0 2px 6px rgba(15, 15, 15, 0.06)',
        lg: '0 4px 12px rgba(15, 15, 15, 0.08)',
        xl: '0 8px 24px rgba(15, 15, 15, 0.10)',
        '2xl': '0 12px 32px rgba(15, 15, 15, 0.12)',
      },
      // Geen inloopanimaties op pagina's: de klassen blijven bestaan, maar doen niets.
      animation: {
        'fade-in': 'none',
        'slide-in': 'none',
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
