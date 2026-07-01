/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@supabase/ssr"],
};

module.exports = nextConfig;
