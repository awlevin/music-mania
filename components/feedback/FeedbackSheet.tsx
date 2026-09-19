'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';

import { Key } from '@/components/ds';
import { SONG_ISSUES, type SongIssue } from '@/lib/feedback/types';

import styles from './feedback.module.css';

interface Props {
  code?: string;
  token?: string | null;
  /** The song on screen, once revealed. Offers "report this song". */
  songTitle?: string;
  onClose: () => void;
}

/** Tell us what is wrong. The room's context rides along by itself. */
export function FeedbackSheet({ code, token, songTitle, onClose }: Props) {
  const [issue, setIssue] = useState<SongIssue | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sentId, setSentId] = useState('');

  const aboutSong = Boolean(songTitle) && issue !== null;
  const canSend = aboutSong || text.trim().length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSend || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: aboutSong ? 'song' : 'note', issue, text, code, token }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) setError(data.error ?? 'That did not send. Try again.');
      else setSentId(data.id);
    } catch {
      setError('No connection. Try again.');
    }
    setSending(false);
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal
        aria-label="Send feedback"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {sentId ? (
          <div className={styles.done}>
            <h2>Got it. That is {sentId}.</h2>
            <p>
              Every report gets looked at.{' '}
              {aboutSong && 'This song sits out of new games until someone has checked it. '}
              See what happens to yours on the{' '}
              <Link href="/feedback" target="_blank">
                feedback board
              </Link>
              .
            </p>
            <Key variant="paper" block onClick={onClose}>
              Back to the game
            </Key>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2>What should be better?</h2>

            {songTitle && (
              <fieldset className={styles.issues}>
                <legend>
                  Something wrong with <strong>{songTitle}</strong>?
                </legend>
                {(Object.keys(SONG_ISSUES) as SongIssue[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={styles.issue}
                    aria-pressed={issue === key}
                    onClick={() => setIssue(issue === key ? null : key)}
                  >
                    {SONG_ISSUES[key]}
                  </button>
                ))}
              </fieldset>
            )}

            <textarea
              className={styles.text}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 1000))}
              placeholder={
                songTitle ? 'Anything to add? (optional if you picked one above)' : 'A bug, an idea, a song we got wrong…'
              }
              rows={4}
              aria-label="Your feedback"
            />
            <p className={styles.error} role="alert">
              {error}
            </p>
            <div className={styles.actions}>
              <Key variant="quiet" onClick={onClose}>
                Cancel
              </Key>
              <Key type="submit" disabled={!canSend || sending}>
                {sending ? 'Sending…' : 'Send feedback'}
              </Key>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
