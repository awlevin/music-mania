import { timingSafeEqual } from 'node:crypto';

/** True when the request carries the queue worker's token. */
export function isAdmin(request: Request): boolean {
  const expected = process.env.FEEDBACK_ADMIN_TOKEN;
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
