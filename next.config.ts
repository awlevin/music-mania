import type { NextConfig } from 'next';

import { lanIps } from './server/lan';

const nextConfig: NextConfig = {
  // Phones join `npm run dev` by LAN IP. Next refuses its dev socket to
  // origins it was not told about, which would leave them unhydrated.
  allowedDevOrigins: lanIps(),
};

export default nextConfig;
