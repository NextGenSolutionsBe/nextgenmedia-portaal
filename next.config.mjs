// Content-Security-Policy — bewust eerst in REPORT-ONLY.
// Deze variant blokkeert NIETS; de browser meldt alleen in de console wat er
// geweigerd zou worden. Zo zie je overtredingen zonder risico op een stukke
// pagina. Loopt het een tijdje schoon, hernoem dan de header naar
// 'Content-Security-Policy' (zonder -Report-Only) om hem echt af te dwingen.
//
// Toegestane bronnen zijn afgeleid uit de code:
//  · *.supabase.co        → database, auth en opgeslagen bestanden
//  · framerusercontent.com→ afbeeldingen uit het Framer-CMS
//  · cdnjs.cloudflare.com → pdf.js-worker in de contract-editor
// 'unsafe-inline' is (voorlopig) nodig: Next.js plaatst een inline bootstrap-
// script en Tailwind gebruikt inline stijlen.
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com",
  "worker-src 'self' blob: https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://framerusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://cdnjs.cloudflare.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

// Security response headers. Additive and conservative: these harden the app
// without changing any application behaviour.
const securityHeaders = [
  { key: 'Content-Security-Policy-Report-Only', value: cspReportOnly },
  // Stop the site being framed (clickjacking protection).
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // Don't let browsers MIME-sniff responses away from the declared type.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Only send the origin (not the full path) as referrer to other origins.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable powerful browser features the app doesn't use.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  // Force HTTPS for two years (browsers only honour this over HTTPS).
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Verberg dat dit een Next.js-app is: minder gratis informatie voor een
  // aanvaller die gericht op frameworkversies zoekt.
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // Deze pakketten zijn "barrels": één index die alles doorexporteert.
    // Zonder deze regel verwerkt de bundelaar bij elke import de hele
    // verzameling (lucide-react alleen al zijn er meer dan duizend iconen).
    // Next herschrijft ze dan naar directe imports — kortere builds en een
    // kleinere bundel, zonder dat er één regel code hoeft te veranderen.
    optimizePackageImports: [
      'lucide-react',
      'date-fns',
      'recharts',
      '@radix-ui/react-accordion',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-avatar',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-label',
      '@radix-ui/react-popover',
      '@radix-ui/react-progress',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-select',
      '@radix-ui/react-separator',
      '@radix-ui/react-slot',
      '@radix-ui/react-switch',
      '@radix-ui/react-tabs',
      '@radix-ui/react-toast',
      '@radix-ui/react-tooltip',
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
  // OAuth-ontdekking voor de MCP-connector. Deze documenten MOETEN op
  // /.well-known/ staan — dat schrijven RFC 8414 en RFC 9728 voor, en Claude
  // zoekt er letterlijk daar naar. Een map die met een punt begint werkt niet
  // betrouwbaar in de router van Next, dus leiden we ze om naar gewone routes.
  //
  // De varianten mét pad zijn geen overbodige luxe: een client die
  // https://…/api/mcp wil gebruiken, vraagt eerst
  // /.well-known/oauth-protected-resource/api/mcp op en pas daarna het kale pad.
  async rewrites() {
    return [
      {
        source: '/.well-known/oauth-authorization-server',
        destination: '/api/mcp/oauth/metadata/authorization-server',
      },
      {
        source: '/.well-known/oauth-authorization-server/:pad*',
        destination: '/api/mcp/oauth/metadata/authorization-server',
      },
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/api/mcp/oauth/metadata/protected-resource',
      },
      {
        source: '/.well-known/oauth-protected-resource/:pad*',
        destination: '/api/mcp/oauth/metadata/protected-resource',
      },
    ]
  },
}

export default nextConfig
