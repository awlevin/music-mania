import type { RoomState, RoomView, RoundView } from './types';

export type Viewer = { role: 'host' } | { role: 'player'; playerId: string };

/** What one screen is allowed to know. The answer stays server-side until the reveal. */
export function viewFor(state: RoomState, viewer: Viewer, now: number): RoomView {
  const round = state.rounds[state.roundIndex];
  const inRound = state.phase !== 'lobby' && round !== undefined;
  const revealed = state.phase === 'reveal' || state.phase === 'finished';

  let roundView: RoundView | null = null;
  if (inRound) {
    roundView = {
      index: state.roundIndex,
      total: state.rounds.length,
      kind: round.kind,
      guessStartedAt: round.guessStartedAt,
      revealStartedAt: round.revealStartedAt,
    };
    if (viewer.role === 'host') {
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
    phase: state.phase,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      answered: inRound && Boolean(round.answers[p.id]),
    })),
    round: roundView,
    serverNow: now,
  };

  if (viewer.role === 'player') {
    const mine = inRound ? round.answers[viewer.playerId] : undefined;
    view.you = {
      id: viewer.playerId,
      answer: mine ? { text: mine.text, elapsedMs: mine.elapsedMs } : null,
    };
  }
  return view;
}
