import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@oneclk/shared'],
  output: 'standalone',
};

export default nextConfig;