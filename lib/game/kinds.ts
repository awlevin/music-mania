import type { QuestionKind } from './types';

export interface KindInfo {
  /** "Name the ___" */
  noun: string;
  placeholder: string;
  /** One line under the announcement of a new kind of question. */
  hint: string;
  numeric: boolean;
}

export const KINDS: Record<QuestionKind, KindInfo> = {
  title: { noun: 'song', placeholder: 'Song title', hint: 'Type the title of the song you hear.', numeric: false },
  artist: { noun: 'artist', placeholder: 'Artist or band', hint: 'Type who performs it. Any one credited artist counts.', numeric: false },
  year: { noun: 'year', placeholder: 'Year, like 1999', hint: 'Type the year it came out. The closer you are, the more you score.', numeric: true },
  album: { noun: 'album', placeholder: 'Album title', hint: 'Type the album it first appeared on. This is the hard one.', numeric: false },
};
