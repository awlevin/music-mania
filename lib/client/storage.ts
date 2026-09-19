// Seats survive a reload: the TV keeps its host token and each phone keeps
// its player token, per room, in localStorage.

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: the seat lasts until the tab closes. Good enough.
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

export const hostTokens = {
  get: (code: string) => read<string>(`mm:host:${code}`),
  set: (code: string, token: string) => write(`mm:host:${code}`, token),
};

export const seats = {
  get: (code: string) => read<string>(`mm:seat:${code}`),
  set: (code: string, token: string) => write(`mm:seat:${code}`, token),
  clear: (code: string) => remove(`mm:seat:${code}`),
};

export const lastName = {
  get: () => read<string>('mm:name') ?? '',
  set: (name: string) => write('mm:name', name),
};
