/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A stray lockfile in the home directory otherwise wins the workspace-root inference.
  outputFileTracingRoot: import.meta.dirname,
  // Not a static export: the Email Images tool needs a Node route to mint presigned R2
  // upload URLs so the bucket credentials never reach the browser. The PDF Optimizer is
  // still entirely client-side — nothing it touches goes over the network.
  images: { unoptimized: true },
  // PptxGenJS requires `fs` and `https` lazily at call time. Left to the bundler those
  // requires get rewritten and break inside the compile route; keeping the package external
  // lets Node load it as-is on the server.
  serverExternalPackages: ['pptxgenjs'],
};

export default nextConfig;
