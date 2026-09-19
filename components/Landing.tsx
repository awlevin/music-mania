'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { Field, Key, VinylRecord, Wordmark } from '@/components/ds';
import { createRoom } from '@/lib/client/api';
import { hostTokens } from '@/lib/client/storage';

import styles from './landing.module.css';

export function Landing() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  const host = async () => {
    setOpening(true);
    setError('');
    const result = await createRoom();
    if (!result.ok) {
      setError(result.error);
      setOpening(false);
      return;
    }
    const room = result.data as { code: string; hostToken: string };
    hostTokens.set(room.code, room.hostToken);
    router.push(`/host/${room.code}`);
  };

  const join = (event: FormEvent) => {
    event.preventDefault();
    if (code.length === 4) router.push(`/play/${code}`);
  };

  return (
    <main className={styles.page}>
      <div className={styles.record} aria-hidden>
        <VinylRecord spinning>
          <span className={styles.recordMark}>?</span>
        </VinylRecord>
      </div>

      <div className={styles.content}>
        <h1 className={styles.mark}>
          <Wordmark />
        </h1>
        <p className={styles.pitch}>
          One screen plays the song. Everyone races to name it from their phone.
        </p>

        <section className={styles.actions}>
          <div className={styles.action}>
            <h2>On the TV or laptop</h2>
            <Key onClick={() => void host()} disabled={opening} block>
              {opening ? 'Opening a room…' : 'Host a game'}
            </Key>
            <p role="alert" data-error={Boolean(error)}>
              {error || 'This screen plays the music. Mirror it to the biggest one you have.'}
            </p>
          </div>

          <form className={styles.action} onSubmit={join} data-tone="artist">
            <h2>On your phone</h2>
            <div className={styles.joinRow}>
              <Field
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
                placeholder="Room code"
                aria-label="Room code"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
              <Key type="submit" variant="tone" disabled={code.length !== 4}>
                Join
              </Key>
            </div>
            <p>Or scan the code on the host screen.</p>
          </form>
        </section>
      </div>
    </main>
  );
}
