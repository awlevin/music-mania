import type { RoomState, RoomView, RoundView } from './types';

export type Viewer = { role: 'host' } | { role: 'player'; playerId: string };

/** True for whichever device plays the music: the host screen, or the DJ's phone. */
export function playsAudio(state: RoomState, viewer: Viewer): boolean {
  return viewer.role === 'host' || (state.dj !== null && state.dj === viewer.playerId);
}

/** What one screen is allowed to know. The answer stays server-side until the reveal. */
export function viewFor(state: RoomState, viewer: Viewer, now: number): RoomView {
  const plays = playsAudio(state, viewer);
  const round = state.rounds[state.roundIndex];
  const inRound = state.phase !== 'lobby' && round !== undefined;
  const revealed = state.phase === 'reveal' || state.phase === 'finished';

  let roundView: RoundView | null = null;
  if (inRound) {
    roundView = {
      index: state.roundIndex,
      total: state.rounds.length,
      kind: round.kind,
      kindChanged: state.rounds[state.roundIndex - 1]?.kind !== round.kind,
      guessStartedAt: round.guessStartedAt,
      revealStartedAt: round.revealStartedAt,
    };
    if (plays) {
      roundView.previewUrl = round.song.previewUrl;
      roundView.nextPreviewUrl = state.rounds[state.roundIndex + 1]?.song.previewUrl;
    }
    if (revealed) {
      roundView.song = round.song;
      roundView.answers = Object.entries(round.answers).map(([playerId, a]) => ({
        playerId,
        ...a,
      }));
    }
  }

  const view: RoomView = {
    code: state.code,
    version: state.version,
    mode: state.mode,
    phase: state.phase,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      answered: inRound && Boolean(round.answers[p.id]),
      gaveUp: inRound && Boolean(round.answers[p.id]?.gaveUp),
      dj: state.dj === p.id,
    })),
    round: roundView,
    pause: state.pause ?? null,
    serverNow: now,
  };

  const lastRound = state.roundIndex === state.rounds.length - 1;
  if (plays && revealed && lastRound && state.finales?.length) {
    view.finaleUrls = state.finales.map((s) => s.previewUrl);
  }

  if (plays && state.phase === 'lobby' && state.lobbyUrl) {
    view.lobbyUrl = state.lobbyUrl;
  }

  if (viewer.role === 'player') {
    const mine = inRound ? round.answers[viewer.playerId] : undefined;
    view.you = {
      id: viewer.playerId,
      leader: state.players[0]?.id === viewer.playerId,
      dj: plays,
      answer: mine
        ? { text: mine.text, elapsedMs: mine.elapsedMs, gaveUp: Boolean(mine.gaveUp) }
        : null,
    };
  }
  return view;
}
