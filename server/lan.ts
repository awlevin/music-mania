import { networkInterfaces } from 'node:os';

/** This machine's LAN IPv4 addresses. Phones reach `next dev` through one of them. */
export function lanIps(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address);
}
