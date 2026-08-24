import type { NextConfig } from "next";

const basePath =
  process.env.BASE_PATH !== undefined ? process.env.BASE_PATH : "";

const nextConfig: NextConfig = {
  output: process.env.OUTPUT_MODE === "export" ? "export" : undefined,

  // Генерировать <страница>/index.html вместо <страница>.html, чтобы
  // каталог каждой страницы (например /docs/) содержал index.html и
  // Apache/nginx отдавал его без ошибки 403.
  trailingSlash: true,

  ...(basePath && {
    basePath,
    assetPrefix: basePath,
  }),

  ...(process.env.OUTPUT_MODE === "export" && {
    images: {
      unoptimized: true,
    },
  }),
  allowedDevOrigins: ["*"],

  devIndicators: false,
  poweredByHeader: false,
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    serverSourceMaps: false,
    turbopackSourceMaps: false,
  }
};

export default nextConfig;
