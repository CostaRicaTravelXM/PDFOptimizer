/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A stray lockfile in the home directory otherwise wins the workspace-root inference.
  outputFileTracingRoot: import.meta.dirname,
  // Fully static: no server, no API routes, no uploads.
  output: 'export',
  images: { unoptimized: true },
};

export default nextConfig;
