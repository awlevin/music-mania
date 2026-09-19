// Where rooms live and how screens hear about changes.
//
// Vercel gives no instance affinity: the phone's POST and the TV's event
// stream usually land on different function instances. So the store is the
// only shared truth, every write is a compare-and-set on the room's version,
// and every successful write publishes the new state to whoever is listening.
//
// Redis (REDIS_URL) does that in production. Without it, a process-local map
// does the same job for `next dev`.

import { EventEmitter } from 'node:events';

import Redis from 'ioredis';

import type { RoomState } from '@/lib/game/types';

export type Listener = (state: RoomState) => void;

export interface RoomStore {
  get(code: string): Promise<RoomState | null>;
  /** False when the code is already taken. */
  create(state: RoomState): Promise<boolean>;
  /** Writes `next` only if the stored version is still `expectedVersion`. */
  compareAndSet(expectedVersion: number, next: RoomState): Promise<boolean>;
  subscribe(code: string, listener: Listener): Promise<() => void>;
}

/** Rooms clean themselves up; each write pushes the expiry out again. */
const ROOM_TTL_SECONDS = 6 * 60 * 60;

// ---------------------------------------------------------------------------
// Memory

class MemoryStore implements RoomStore {
  private rooms = new Map<string, { state: RoomState; expiresAt: number }>();
  private bus = new EventEmitter().setMaxListeners(0);

  async get(code: string) {
    const entry = this.rooms.get(code);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.rooms.delete(code);
      return null;
    }
    return entry.state;
  }

  async create(state: RoomState) {
    if (await this.get(state.code)) return false;
    this.put(state);
    return true;
  }

  async compareAndSet(expectedVersion: number, next: RoomState) {
    const current = await this.get(next.code);
    if (!current || current.version !== expectedVersion) return false;
    this.put(next);
    this.bus.emit(next.code, next);
    return true;
  }

  async subscribe(code: string, listener: Listener) {
    this.bus.on(code, listener);
    return () => void this.bus.off(code, listener);
  }

  private put(state: RoomState) {
    this.rooms.set(state.code, { state, expiresAt: Date.now() + ROOM_TTL_SECONDS * 1000 });
  }
}

// ---------------------------------------------------------------------------
// Redis

const key = (code: string) => `mm:room:${code}`;
const channel = (code: string) => `mm:room:${code}:events`;

// Check the version, write, and publish in one atomic step.
const COMPARE_AND_SET = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
if cjson.decode(current).version ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
redis.call('PUBLISH', KEYS[2], ARGV[2])
return 1
`;

class RedisStore implements RoomStore {
  private commands: Redis;
  /** One subscriber connection per instance, shared by every stream on it. */
  private subscriber: Redis;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    const options = { maxRetriesPerRequest: 2, enableReadyCheck: false };
    this.commands = new Redis(url, options);
    this.subscriber = new Redis(url, { ...options, maxRetriesPerRequest: null });
    this.commands.on('error', (err) => console.error('[redis] commands:', err.message));
    this.subscriber.on('error', (err) => console.error('[redis] subscriber:', err.message));
    this.subscriber.on('message', (ch: string, message: string) => {
      const set = this.listeners.get(ch);
      if (!set?.size) return;
      const state = JSON.parse(message) as RoomState;
      for (const listener of set) listener(state);
    });
  }

  async get(code: string) {
    const raw = await this.commands.get(key(code));
    return raw ? (JSON.parse(raw) as RoomState) : null;
  }

  async create(state: RoomState) {
    const ok = await this.commands.set(
      key(state.code),
      JSON.stringify(state),
      'EX',
      ROOM_TTL_SECONDS,
      'NX',
    );
    return ok === 'OK';
  }

  async compareAndSet(expectedVersion: number, next: RoomState) {
    const result = await this.commands.eval(
      COMPARE_AND_SET,
      2,
      key(next.code),
      channel(next.code),
      String(expectedVersion),
      JSON.stringify(next),
      String(ROOM_TTL_SECONDS),
    );
    return result === 1;
  }

  async subscribe(code: string, listener: Listener) {
    const ch = channel(code);
    let set = this.listeners.get(ch);
    if (!set) {
      set = new Set();
      this.listeners.set(ch, set);
    }
    set.add(listener);
    if (set.size === 1) await this.subscriber.subscribe(ch);

    return () => {
      const current = this.listeners.get(ch);
      if (!current?.delete(listener) || current.size > 0) return;
      this.listeners.delete(ch);
      this.subscriber.unsubscribe(ch).catch(() => {});
    };
  }
}

// ---------------------------------------------------------------------------

// On globalThis so dev-server module reloads keep the same rooms and sockets.
const holder = globalThis as typeof globalThis & { __musicManiaStore?: RoomStore };

export function getStore(): RoomStore {
  if (!holder.__musicManiaStore) {
    const url = process.env.REDIS_URL ?? process.env.KV_URL;
    if (!url && process.env.VERCEL) {
      throw new Error('REDIS_URL is not set. Rooms cannot be shared between function instances.');
    }
    holder.__musicManiaStore = url ? new RedisStore(url) : new MemoryStore();
  }
  return holder.__musicManiaStore;
}
