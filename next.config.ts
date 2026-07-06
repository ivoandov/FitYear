import type { NextConfig } from "next";

// Content-Security-Policy. Permissive-but-real starting point (tighten later).
// - default 'self'; scripts/styles allow 'unsafe-inline' because Next injects
//   inline bootstrap + we use inline styles (share card, global-error). Dropping
//   'unsafe-inline' needs nonces, which is a follow-up (would break hydration if
//   done naively).
// - img: 'self' + data:/blob: (html2canvas share card, next/image) + GCS +
//   Supabase (defensive; displayed images are same-origin proxied).
// - connect: 'self' (/api incl. the AI stream) + Supabase (auth + JWKS).
// - media: 'self' (login intro mp4). font: 'self' + data: (self-hosted fonts).
// - frame-ancestors 'none' (clickjacking); object-src 'none'.
const CSP = [
  "default-src 'self'",
  // 'unsafe-inline' is required for Next's inline bootstrap; 'unsafe-eval'
  // because a bundled animation dep probes `Function('')` for JIT on every
  // authed page (it degrades gracefully when blocked, but fires a CSP
  // violation each load that would spam monitoring). Given 'unsafe-inline' is
  // already present, adding 'unsafe-eval' is a negligible extra relaxation.
  // TIGHTEN LATER: move to nonce-based script-src and drop both 'unsafe-*'.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://storage.googleapis.com https://*.supabase.co",
  "media-src 'self'",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Strip "Powered by Vercel" and gzip responses by default — small but free wins.
  compress: true,
  poweredByHeader: false,
  // Drop console.* (except console.error) from the production client bundle so
  // we stop shipping the ~dozen console.logs that leak user ids / workout names.
  // Server console.error stays for logging.
  compiler: {
    removeConsole: { exclude: ["error"] },
  },
  // Tree-shake icon barrels at build time. Without this, each `import { Plus }
  // from "lucide-react"` pulled in the full module graph; this rewrites those
  // imports to direct deep paths so only used icons end up in the client bundle.
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns"],
  },
  // Canonical domain: 308 anything that lands on the bare Vercel hostname
  // over to fityear.flyhi.ai. Keeps SEO clean and prevents cookie-domain
  // confusion between the two URLs. Includes the team-suffixed alias because
  // Vercel exposes both fityear.vercel.app and fityear-<team>.vercel.app.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "fityear.vercel.app" }],
        destination: "https://fityear.flyhi.ai/:path*",
        permanent: true,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "fityear-ivos-projects-55424ce4.vercel.app" }],
        destination: "https://fityear.flyhi.ai/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
