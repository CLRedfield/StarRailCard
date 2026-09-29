import { describe, expect, it, vi } from 'vitest';
import { applyCommand, createMatch, getLegalActions, getPlayerPreview } from '../src/game';
import { reconcileDiceSelection, selectLocalDice, withLocalDiceSelection } from '../src/lib/diceSelection';

const match = (mode: 'classic' | 'coop' = 'classic') => createMatch({ mode, ...(mode === 'coop' ? { bossPhases: [{ cardId: '264014' }] } : {}), weather: 'off', players: [
  { id: 'a', name: 'A', cardId: '264026' }, { id: 'b', name: 'B', cardId: '264014' },
] }, 2026);

describe('local dice drafts and atomic submission', () => {
  it('supports repeated selection and previews without changing the authority, RNG, log or transport', () => {
    const state = match(), before = structuredClone(state), transport = vi.fn(applyCommand);
    let draft = reconcileDiceSelection(undefined, state, 'a', 'match-1');
    for (let n = 0; n < 25; n++) {
      draft = selectLocalDice(draft, state.players[0].dice.slice(0, n % 6).map(d => d.id), state, 'a');
      getPlayerPreview(withLocalDiceSelection(state, 'a', draft.ids), 'a');
    }
    draft = selectLocalDice(draft, state.players[0].dice.slice(0, 3).map(d => d.id), state, 'a');
    expect(getLegalActions(withLocalDiceSelection(state, 'a', draft.ids), 'a').canConfirm).toBe(true);
    expect(state).toEqual(before); expect(transport).not.toHaveBeenCalled();
    const result = transport(state, { type: 'confirm', playerId: 'a', diceIds: draft.ids });
    expect(result.error).toBeUndefined(); expect(transport).toHaveBeenCalledTimes(1);
    expect(result.state.players[0].confirmed).toBe(true);
    expect(result.state.players[0].selectedIds).toEqual(draft.ids);
  });

  it('preserves drafts across unrelated teammate state updates', () => {
    const state = match('coop'); state.phase = 'roll';
    let draft = reconcileDiceSelection(undefined, state, 'a', 'match-1');
    draft = selectLocalDice(draft, state.players[0].dice.slice(0, 2).map(d => d.id), state, 'a');
    const update = structuredClone(state); update.players[1].rerolls--; update.players[1].tacticPoints++;
    expect(reconcileDiceSelection(draft, update, 'a', 'match-1')).toBe(draft);
  });

  it('keeps valid choices when a prismatic die arrives, then clears them after a same-face reroll', () => {
    let state = match(), draft = reconcileDiceSelection(undefined, state, 'a', 'match-1');
    draft = selectLocalDice(draft, state.players[0].dice.slice(0, 3).map(d => d.id), state, 'a');
    const chosen = [...draft.ids];
    state = applyCommand(state, { type: 'prismatic', playerId: 'a' }).state;
    draft = reconcileDiceSelection(draft, state, 'a', 'match-1'); expect(draft.ids).toEqual(chosen);
    const unchangedFaces = structuredClone(state);
    unchangedFaces.players[0].selectedIds = [];
    unchangedFaces.log.push({ id: state.nextId + 10, type: 'reroll', playerId: 'a', text: '相同点数', dice: state.players[0].dice });
    expect(reconcileDiceSelection(draft, unchangedFaces, 'a', 'match-1').ids).toEqual([]);
  });

  it('resets on reconnect, new match or new turn and rejects stale/nonexistent IDs', () => {
    const state = match(); let draft = reconcileDiceSelection(undefined, state, 'a', 'match-1');
    draft = selectLocalDice(draft, [state.players[0].dice[0].id, 'old-die', state.players[0].dice[0].id], state, 'a');
    expect(draft.ids).toEqual([state.players[0].dice[0].id]);
    expect(reconcileDiceSelection(draft, state, 'a', 'match-1/recovery-1').ids).toEqual([]);
    expect(reconcileDiceSelection(draft, state, 'a', 'match-2').ids).toEqual([]);
    expect(reconcileDiceSelection(draft, { ...state, turn: 2 }, 'a', 'match-1').ids).toEqual([]);
  });

  it('follows authoritative exchanged dice while the roll is locked', () => {
    const state = match('coop'); state.phase = 'swap'; state.players[0].rollLocked = true;
    state.players[0].selectedIds = state.players[0].dice.slice(0, 3).map(d => d.id);
    const draft = reconcileDiceSelection(undefined, state, 'a', 'match-1');
    const changed = structuredClone(state), die = changed.players[0].dice[0];
    die.id = 'exchanged-die'; changed.players[0].selectedIds[0] = die.id;
    expect(reconcileDiceSelection(draft, changed, 'a', 'match-1').ids).toEqual(changed.players[0].selectedIds);
  });
});
