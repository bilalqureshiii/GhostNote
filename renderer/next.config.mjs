import { fileURLToPath } from 'url';
import { dirname } from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Electron shell above us has its own lockfile; pin the root here so
  // Turbopack doesn't guess and warn on every build.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },

  // Static export: no Node server ships with the widget.
  output: 'export',

  // Electron serves the export over a custom app:// protocol, so Next's
  // absolute /_next/... URLs resolve correctly without a dev server.
  images: { unoptimized: true },

  // The widget is a single always-mounted surface; double-invoking effects in
  // dev just makes the GSAP timelines run twice.
  reactStrictMode: false,
};

export default nextConfig;
