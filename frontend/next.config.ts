// frontend/next.config.ts
import type { NextConfig } from 'next';

const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000';

const nextConfig: NextConfig = {
  output: 'export',
  devIndicators: {
    position: 'top-right',
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
        pathname: '/t/p/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8000',
        pathname: '/tmdb-proxy/**',
      },
    ],
  },
  async rewrites() {
    // Note: rewrites are ignored with output: 'export'. 
    // They are kept here for local development if not using export.
    return [
      { source: '/tmdb-proxy/:path*',    destination: `${apiBase.replace(/\/$/, '')}/tmdb-proxy/:path*` },
      { source: '/ingest/array/:path*', destination: 'https://us-assets.i.posthog.com/array/:path*' },
      { source: '/ingest/:path*',        destination: 'https://us.i.posthog.com/:path*' },
    ];
  },
};

export default nextConfig;
