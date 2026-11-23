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
        // Huisstijl NextGen Agency (23 nov 2026): monochroom, neutraal grijs zonder
        // tint. Ankers uit de brand guideline: zwart #0F0F0F (900), antraciet
        // #272727 (800), grafiet #4B4B4B (600), lichtgrijs #E0E0E0 (200), wit.
        // `gray` blijft het merkpalet, zodat elke bestaande gray-klasse meegaat.
        gray: {
          50: '#f7f7f7', 100: '#f0f0f0', 200: '#e0e0e0', 300: '#cccccc', 400: '#999999',
          500: '#6e6e6e', 600: '#4b4b4b', 700: '#383838', 800: '#272727', 900: '#0f0f0f', 950: '#050505',
        },
        accent: {
          DEFAULT: '#0f0f0f',
          foreground: '#ffffff',
        },
        brand: '#0f0f0f',
        // Vroeger het geel van NextGenMedia. De klasse blijft (vandaag, Mijn werk,
        // tellers), maar volgt nu de monochrome huisstijl: lichtgrijs.
        geel: { DEFAULT: '#e0e0e0', warm: '#cccccc', zacht: '#f0f0f0' },
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
        // JetBrains Mono: labels en ondertitels (huisstijl), codes en nummers.
        mono: ['var(--font-mono, ui-monospace)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: [
          'var(--font-sans, ui-sans-serif)',
          'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto',
          'Helvetica Neue', 'Arial', 'sans-serif',
        ],
      },
      // Strakkere hoeken (huisstijl NextGen Agency, kaarten ~12-16px), overal
      // dezelfde schaal.
      borderRadius: {
        DEFAULT: '0.375rem',
        sm: '0.25rem',
        md: '0.5rem',
        lg: '0.625rem',
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.25rem',
        cp: 'var(--cp-radius)',
      },
      // Zachte, diffuse schaduwen in neutraal zwart.
      boxShadow: {
        sm: '0 1px 2px rgba(15, 15, 15, 0.04), 0 2px 8px -4px rgba(15, 15, 15, 0.06)',
        DEFAULT: '0 1px 3px rgba(15, 15, 15, 0.05), 0 6px 16px -8px rgba(15, 15, 15, 0.08)',
        md: '0 1px 2px rgba(15, 15, 15, 0.03), 0 12px 28px -14px rgba(15, 15, 15, 0.12)',
        lg: '0 2px 6px rgba(15, 15, 15, 0.03), 0 20px 44px -20px rgba(15, 15, 15, 0.16)',
        xl: '0 4px 12px rgba(15, 15, 15, 0.04), 0 30px 64px -28px rgba(15, 15, 15, 0.22)',
        '2xl': '0 8px 20px rgba(15, 15, 15, 0.05), 0 40px 90px -36px rgba(15, 15, 15, 0.30)',
      },
      // Archivo: half-vet en vet echt half-vet en vet (titels in Archivo Bold).
      fontWeight: {
        semibold: '600',
        bold: '700',
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
