/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A stray lockfile in the home directory otherwise wins the workspace-root inference.
  outputFileTracingRoot: import.meta.dirname,
  // Not a static export: the Email Images tool needs a Node route to mint presigned R2
  // upload URLs so the bucket credentials never reach the browser. The PDF Optimizer is
  // still entirely client-side — nothing it touches goes over the network.
  images: { unoptimized: true },
};

export default nextConfig;
