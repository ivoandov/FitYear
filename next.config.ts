import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Strip "Powered by Vercel" and gzip responses by default — small but free wins.
  compress: true,
  poweredByHeader: false,
  // Tree-shake icon barrels at build time. Without this, each `import { Plus }
  // from "lucide-react"` pulled in the full module graph; this rewrites those
  // imports to direct deep paths so only used icons end up in the client bundle.
  experimental: {
    optimizePackageImports: ["lucide-react", "react-icons", "date-fns"],
  },
  // Canonical domain: 308 anything that lands on the bare Vercel hostname
  // over to fityear.flyhi.ai. Keeps SEO clean and prevents cookie-domain
  // confusion between the two URLs. Includes the team-suffixed alias because
  // Vercel exposes both fityear.vercel.app and fityear-<team>.vercel.app.
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
