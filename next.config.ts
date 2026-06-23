import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules / things that must not be bundled by the server compiler.
  serverExternalPackages: ["@libsql/client", "libsql", "node-cron"],
  // A stray lockfile in the home dir confuses workspace-root inference.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
