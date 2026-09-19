import type { Metadata } from 'next';
import Link from 'next/link';

import { Wordmark } from '@/components/ds';
import { listFeedback, toPublic } from '@/lib/feedback/store';
import { SONG_ISSUES } from '@/lib/feedback/types';

import styles from './feedback-board.module.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Feedback board' };

const STATUS_LABEL = { open: 'Open', fixed: 'Fixed', declined: 'Not doing' } as const;

const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export default async function FeedbackBoard() {
  const items = (await listFeedback()).map(toPublic);
  const open = items.filter((i) => i.status === 'open').length;

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <Link href="/" aria-label="Music Mania home">
          <Wordmark className={styles.mark} />
        </Link>
      </header>

      <h1 className={styles.title}>Feedback board</h1>
      <p className={styles.lead}>
        Everything players have told us, and what became of it. Send yours from the game: “Send
        feedback” on your phone after each song, or the gear on the big screen.
        {items.length > 0 && ` ${open} open, ${items.length - open} closed.`}
      </p>

      {items.length === 0 ? (
        <p className={styles.empty}>Nothing yet. Play a game and tell us what was off.</p>
      ) : (
        <ol className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.item} data-status={item.status}>
              <div className={styles.meta}>
                <strong>{item.id}</strong>
                <span>{day.format(item.createdAt)}</span>
                <span className={styles.status}>{STATUS_LABEL[item.status]}</span>
              </div>
              {item.song && (
                <p className={styles.song}>
                  {item.issue ? `${SONG_ISSUES[item.issue]}: ` : ''}
                  <strong>{item.song.title}</strong> by {item.song.artist} ({item.song.album}, {item.song.year})
                </p>
              )}
              {item.text && <p className={styles.text}>{item.text}</p>}
              {item.resolution && (
                <p className={styles.resolution}>
                  {item.resolution}
                  {item.commit && (
                    <>
                      {' '}
                      <a href={`https://github.com/awlevin/music-mania/commit/${item.commit}`}>
                        {item.commit.slice(0, 7)}
                      </a>
                    </>
                  )}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
