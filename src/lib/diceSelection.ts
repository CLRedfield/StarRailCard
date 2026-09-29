import type { GameState } from '../game/types';

export interface DiceSelectionDraft {
  scope: string;
  pool: string;
  reroll: number;
  ids: string[];
}

/** UI-only draft. No RNG, reducer, persistence or transport is invoked here. */
export function reconcileDiceSelection(previous: DiceSelectionDraft | undefined, state: GameState, playerId: string, matchKey: string): DiceSelectionDraft {
  const player = state.players.find(p => p.id === playerId)!;
  const scope = `${matchKey}/${state.turn}/${state.phase}/${playerId}/${player.rollLocked}/${player.confirmed}`;
  const pool = JSON.stringify(player.dice.map(d => [d.id, d.value, d.sides, d.effect, d.amount, d.forced]));
  const reroll = [...state.log].reverse().find(e => e.playerId === playerId && e.type === 'reroll')?.id || 0;
  const available = new Set(player.dice.map(d => d.id));
  if (!previous || previous.scope !== scope || previous.reroll !== reroll || state.phase !== 'roll' || player.rollLocked || player.confirmed) {
    return { scope, pool, reroll, ids: player.selectedIds.filter(id => available.has(id)) };
  }
  if (previous.pool === pool) return previous;
  // Additions (including a prismatic roll) retain valid choices; removed dice cannot be submitted.
  return { scope, pool, reroll, ids: previous.ids.filter(id => available.has(id)) };
}

export function selectLocalDice(draft: DiceSelectionDraft, ids: string[], state: GameState, playerId: string): DiceSelectionDraft {
  const available = new Set(state.players.find(p => p.id === playerId)!.dice.map(d => d.id));
  return { ...draft, ids: [...new Set(ids)].filter(id => available.has(id)) };
}

export function withLocalDiceSelection(state: GameState, playerId: string, ids: string[]): GameState {
  return { ...state, players: state.players.map(p => p.id === playerId ? { ...p, selectedIds: ids } : p) };
}
