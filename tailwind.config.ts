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
        // Design 16 nov 2026: zacht, licht, een tikje koel grijs (glas, witte
        // kaarten op een lichtgrijze achtergrond). `gray` blijft het merkpalet,
        // zodat elke bestaande gray-klasse vanzelf meegaat. Lichtere randen.
        gray: {
          50: '#f7f7f9', 100: '#f1f1f4', 200: '#e6e6eb', 300: '#d3d3da', 400: '#9a9aa4',
          500: '#71717b', 600: '#52525b', 700: '#3c3c44', 800: '#28282e', 900: '#17171b', 950: '#0b0b0e',
        },
        accent: {
          DEFAULT: '#17171b',
          foreground: '#ffffff',
        },
        brand: '#17171b',
        // Het geel van NextGenMedia, spaarzaam: een stip, een balkje, de selectie.
        geel: { DEFAULT: '#fff848', warm: '#f5cf2b', zacht: '#fffbd1' },
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
      // Ruim afgeronde hoeken (design 16 nov 2026), overal dezelfde schaal:
      // kaarten en vensters voelen zacht aan, kleine knoppen worden "squircles".
      borderRadius: {
        DEFAULT: '0.5rem',
        sm: '0.375rem',
        md: '0.75rem',
        lg: '1rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.75rem',
        cp: 'var(--cp-radius)',
      },
      // Zachte, diffuse schaduwen: kaarten zweven licht boven de grijze achtergrond.
      boxShadow: {
        sm: '0 1px 2px rgba(20, 20, 28, 0.04), 0 2px 8px -4px rgba(20, 20, 28, 0.06)',
        DEFAULT: '0 1px 3px rgba(20, 20, 28, 0.05), 0 6px 16px -8px rgba(20, 20, 28, 0.08)',
        md: '0 1px 2px rgba(20, 20, 28, 0.03), 0 12px 28px -14px rgba(20, 20, 28, 0.12)',
        lg: '0 2px 6px rgba(20, 20, 28, 0.03), 0 20px 44px -20px rgba(20, 20, 28, 0.16)',
        xl: '0 4px 12px rgba(20, 20, 28, 0.04), 0 30px 64px -28px rgba(20, 20, 28, 0.22)',
        '2xl': '0 8px 20px rgba(20, 20, 28, 0.05), 0 40px 90px -36px rgba(20, 20, 28, 0.30)',
      },
      // Lichtere letter: wat vroeger "vet" was, is nu half-vet. Zo blijft de
      // hiërarchie, maar met de luchtige uitstraling van het nieuwe design.
      fontWeight: {
        semibold: '500',
        bold: '600',
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
