// Feedback from the people playing. Every item gets a public id and a public
// status, so whoever sent it can see what became of it at /feedback.

export type FeedbackKind = 'note' | 'song';

/** What is wrong with a song, when the feedback is about one. */
export type SongIssue = 'album' | 'year' | 'clip' | 'obscure' | 'other';

export const SONG_ISSUES: Record<SongIssue, string> = {
  album: 'Wrong album',
  year: 'Wrong year',
  clip: 'Bad clip or wrong version',
  obscure: 'Nobody knows this song',
  other: 'Something else',
};

export type FeedbackStatus = 'open' | 'fixed' | 'declined';

export interface FeedbackSong {
  id: number;
  title: string;
  artist: string;
  album: string;
  year: number;
}

export interface Feedback {
  /** "FB-12" */
  id: string;
  createdAt: number;
  kind: FeedbackKind;
  issue?: SongIssue;
  text: string;
  song?: FeedbackSong;
  status: FeedbackStatus;
  /** What was done about it, in a sentence. */
  resolution?: string;
  /** The commit that fixed it. */
  commit?: string;
  resolvedAt?: number;
  /** Private: shown to whoever works the queue, never on the public page. */
  context: {
    from: 'host' | 'player' | 'solo' | 'visitor';
    playerName?: string;
    room?: string;
    phase?: string;
    roundIndex?: number;
    questionKind?: string;
    /** What the player typed this round: the usual reason an answer "should have counted". */
    answer?: string;
    userAgent?: string;
    appVersion?: string;
  };
}

export type PublicFeedback = Omit<Feedback, 'context'>;
