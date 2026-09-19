import { getRedis } from '@/lib/redis';

import type { Feedback, FeedbackStatus, PublicFeedback } from './types';

const ITEM = (id: string) => `mm:fb:item:${id}`;
const ALL = 'mm:fb:all';
const COUNTER = 'mm:fb:counter';
const LIMIT = (who: string) => `mm:fb:limit:${who}`;

const MAX_PER_HOUR = 12;

// Local dev without Redis: a process-local copy of the same shape.
const memory = globalThis as typeof globalThis & {
  __mmFeedback?: { items: Map<string, Feedback>; counter: number; limits: Map<string, number> };
};
function local() {
  memory.__mmFeedback ??= { items: new Map(), counter: 0, limits: new Map() };
  return memory.__mmFeedback;
}

/** False once this sender has used up the hour's allowance. */
export async function allow(who: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    const count = (local().limits.get(who) ?? 0) + 1;
    local().limits.set(who, count);
    return count <= MAX_PER_HOUR;
  }
  const count = await redis.incr(LIMIT(who));
  if (count === 1) await redis.expire(LIMIT(who), 3600);
  return count <= MAX_PER_HOUR;
}

export async function addFeedback(draft: Omit<Feedback, 'id' | 'status' | 'createdAt'>): Promise<Feedback> {
  const redis = getRedis();
  const number = redis ? await redis.incr(COUNTER) : ++local().counter;
  const item: Feedback = { ...draft, id: `FB-${number}`, status: 'open', createdAt: Date.now() };
  if (redis) {
    await redis.multi().set(ITEM(item.id), JSON.stringify(item)).zadd(ALL, item.createdAt, item.id).exec();
  } else {
    local().items.set(item.id, item);
  }
  return item;
}

export async function getFeedback(id: string): Promise<Feedback | null> {
  const redis = getRedis();
  if (!redis) return local().items.get(id) ?? null;
  const raw = await redis.get(ITEM(id));
  return raw ? (JSON.parse(raw) as Feedback) : null;
}

/** Newest first. */
export async function listFeedback(limit = 200): Promise<Feedback[]> {
  const redis = getRedis();
  if (!redis) return [...local().items.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  const ids = await redis.zrevrange(ALL, 0, limit - 1);
  if (ids.length === 0) return [];
  const raws = await redis.mget(ids.map(ITEM));
  return raws.filter((r): r is string => r !== null).map((r) => JSON.parse(r) as Feedback);
}

export async function resolveFeedback(
  id: string,
  patch: { status: FeedbackStatus; resolution?: string; commit?: string },
): Promise<Feedback | null> {
  const current = await getFeedback(id);
  if (!current) return null;
  const next: Feedback = {
    ...current,
    ...patch,
    resolvedAt: patch.status === 'open' ? undefined : Date.now(),
  };
  const redis = getRedis();
  if (redis) await redis.set(ITEM(id), JSON.stringify(next));
  else local().items.set(id, next);
  return next;
}

/**
 * Songs with an open complaint sit out until someone has looked at them.
 * That makes a report take effect on the very next game, with nobody awake.
 */
export async function benchedSongIds(): Promise<number[]> {
  const open = (await listFeedback(500)).filter((f) => f.status === 'open' && f.kind === 'song' && f.song);
  return [...new Set(open.map((f) => f.song!.id))];
}

export function toPublic(item: Feedback): PublicFeedback {
  const copy: Partial<Feedback> = { ...item };
  delete copy.context;
  return copy as PublicFeedback;
}
