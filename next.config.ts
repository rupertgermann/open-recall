import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Turbopack config (Next.js 16+ default bundler)
  // Empty config acknowledges we're aware of Turbopack usage
  turbopack: {
    root: __dirname,
  },
  // Webpack fallback (for production builds or --webpack flag)
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
