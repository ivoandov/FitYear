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
};

export default nextConfig;
