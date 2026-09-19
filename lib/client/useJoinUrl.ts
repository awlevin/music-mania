'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

const noStore = () => () => {};

/** The address phones open. On localhost it swaps in this machine's LAN IP. */
export function useJoinUrl(code: string): { url: string; display: string } | null {
  const here = useSyncExternalStore(
    noStore,
    () => window.location.origin,
    () => null,
  );
  const [lan, setLan] = useState<string | null>(null);

  useEffect(() => {
    const { protocol, hostname, port } = window.location;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') return;
    let cancelled = false;
    fetch('/api/lan')
      .then((r) => r.json())
      .then(({ ip }: { ip: string | null }) => {
        if (!cancelled && ip) setLan(`${protocol}//${ip}${port ? `:${port}` : ''}`);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const origin = lan ?? here;
  if (!origin) return null;
  return { url: `${origin}/play/${code}`, display: origin.replace(/^https?:\/\//, '') };
}
