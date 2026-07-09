import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    // Next canary's Turbopack filesystem cache can fail to persist on Windows
    // with os error 5, even though the dev server itself can keep running.
    turbopackFileSystemCacheForDev: false,
    // Cache fetch responses in Server Components across HMR refreshes
    // This prevents unnecessary refetching during development
    serverComponentsHmrCache: true,
    // Optimize package imports to only load used modules
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-tabs',
      '@radix-ui/react-scroll-area',
      'react-markdown',
    ],
  },
  // Turbopack config (Next.js 16+ default bundler)
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
