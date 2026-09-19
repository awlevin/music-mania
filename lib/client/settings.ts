'use client';

import { useSyncExternalStore } from 'react';

// Host-screen preferences, kept in this browser.

export interface Settings {
  lobbyMusic: boolean;
}

const KEY = 'mm:settings';
const DEFAULTS: Settings = { lobbyMusic: true };

const listeners = new Set<() => void>();
let cached: Settings | null = null;

function read(): Settings {
  if (cached) return cached;
  try {
    cached = { ...DEFAULTS, ...JSON.parse(window.localStorage.getItem(KEY) ?? '{}') };
  } catch {
    cached = DEFAULTS;
  }
  return cached!;
}

export function updateSettings(patch: Partial<Settings>): void {
  cached = { ...read(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Private mode: the choice lasts until the tab closes.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}
