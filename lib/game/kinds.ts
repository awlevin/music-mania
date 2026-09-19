import type { QuestionKind } from './types';

export interface KindInfo {
  /** "Name the ___" */
  noun: string;
  placeholder: string;
  numeric: boolean;
}

export const KINDS: Record<QuestionKind, KindInfo> = {
  title: { noun: 'song', placeholder: 'Song title', numeric: false },
  artist: { noun: 'artist', placeholder: 'Artist or band', numeric: false },
  year: { noun: 'year', placeholder: 'Year, like 1999', numeric: true },
  album: { noun: 'album', placeholder: 'Album title', numeric: false },
};
