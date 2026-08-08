import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  images: {
    // Memory images are served by the backend's /uploads static route, which is a different origin
    // from the dashboard — next/image refuses to optimize a remote host that isn't allow-listed.
    remotePatterns: [
      {
        protocol: apiUrl.startsWith("https") ? "https" : "http",
        hostname: new URL(apiUrl).hostname,
        port: new URL(apiUrl).port || undefined,
        pathname: "/uploads/**",
      },
    ],
    // Uploaded content is arbitrary user-supplied bytes; SVG can carry script, so it stays
    // unoptimized-and-unrendered rather than being passed through the optimizer.
    dangerouslyAllowSVG: false,
  },
};

export default nextConfig;
