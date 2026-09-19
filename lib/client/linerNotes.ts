// Things to read while the game is paused. `{name}` is whoever paused it.

export const LINER_NOTES = [
  'The needle is in the run-out groove. It will wait as long as you do.',
  'This silence was brought to you by {name}.',
  'Intermission. The band is out back arguing about the setlist.',
  'Now is a good time to accuse someone of using Shazam.',
  'Hydrate. Lead singers and champions both do.',
  'Snack break. The scoreboard remembers everything.',
  'Trash talk is permitted during intermission. Encouraged, even.',
  'Stretch. You have been hunched over that phone like a bass player.',
  'Side B starts when somebody presses the button.',
  'Whoever is in last place: this pause changes nothing. Sorry.',
  'Whoever is in first place: they are all talking about you.',
  'If you hum the last song now, it still does not count.',
  'Refill whatever needs refilling. The record is not going anywhere.',
  'Every great album has a gap between tracks. This is yours.',
  'The jukebox accepts quarters, compliments, and song requests it will ignore.',
  '{name} needed a minute. We have all needed a minute.',
];

/** A shuffle that every re-render of the same pause agrees on. */
export function shuffledNotes(seed: number, name: string): string[] {
  const notes = LINER_NOTES.map((note) => note.replaceAll('{name}', name));
  let state = seed >>> 0 || 1;
  const random = () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
  for (let i = notes.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [notes[i], notes[j]] = [notes[j], notes[i]];
  }
  return notes;
}
