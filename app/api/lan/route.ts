import { lanIps } from '@/server/lan';

export const dynamic = 'force-dynamic';

/** Dev only: lets a host opened on localhost print a QR code phones can reach. */
export function GET(): Response {
  if (process.env.NODE_ENV === 'production') return Response.json({ ip: null });
  return Response.json({ ip: lanIps()[0] ?? null });
}
