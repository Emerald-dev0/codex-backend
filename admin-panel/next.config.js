/** @type {import('next').NextConfig} */
// The admin panel talks to the root Express API through same-origin rewrites,
// so the browser never needs to know the API host (and no CORS is involved).
// API_ORIGIN / NEXT_PUBLIC_API_URL: origin of the root backend (server.js).
const API_ORIGIN = String(process.env.API_ORIGIN || process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3000')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/api$/i, '')
  .replace(/\/+$/, '');

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // This app lives inside the backend repo (which has its own lockfile).
  outputFileTracingRoot: __dirname,
  // Dev server is reached through preview proxies; allow those hosts.
  allowedDevOrigins: ['*.e2b.app', '*.e2b.dev', 'localhost', '127.0.0.1'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` },
      { source: '/uploads/:path*', destination: `${API_ORIGIN}/uploads/:path*` },
    ];
  },
};

module.exports = nextConfig;
