import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@packetforge/engine", "@packetforge/labs", "@packetforge/storage"],
};

export default nextConfig;
