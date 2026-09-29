import { describe, expect, it } from 'vitest';
import { applyCommand, createMatch, getLegalActions } from '../src/game';
import type { GameCommand, GameState } from '../src/game/types';

const match = () => createMatch({ mode: 'classic', weather: 'off', players: [{ id: 'a', name: 'A', cardId: '264026' }, { id: 'b', name: 'B', cardId: '264014' }] }, 2026);
const apply = (state: GameState, command: GameCommand) => {
  const result = applyCommand(state, command);
  expect(result.error).toBeUndefined();
  return result;
};

describe('original selected-dice reroll interaction', () => {
  it('rerolls selected dice, preserves every unselected die and clears highlighting', () => {
    const initial = match();
    const ids = [initial.players[0].dice[0].id, initial.players[0].dice[2].id];
    const selected = apply(initial, { type: 'select', playerId: 'a', diceIds: ids }).state;
    const before = structuredClone(selected.players[0].dice);
    const result = apply(selected, { type: 'reroll', playerId: 'a', diceIds: selected.players[0].selectedIds });
    const player = result.state.players[0];
    expect(player.selectedIds).toEqual([]);
    expect(player.rerolls).toBe(initial.players[0].rerolls - 1);
    expect(player.dice.filter(d => !ids.includes(d.id))).toEqual(before.filter(d => !ids.includes(d.id)));
    expect(result.events.find(e => e.type === 'reroll')?.dice?.map(d => d.id)).toEqual(ids);
    expect(getLegalActions(result.state, 'a').canConfirm).toBe(false);
  });

  it('permits all five reroll targets while still enforcing three attack dice on confirmation', () => {
    let state = match();
    const ids = state.players[0].dice.map(d => d.id);
    state = apply(state, { type: 'select', playerId: 'a', diceIds: ids }).state;
    expect(state.players[0].selectedIds).toHaveLength(5);
    expect(getLegalActions(state, 'a').canConfirm).toBe(false);
    expect(applyCommand(state, { type: 'confirm', playerId: 'a' }).state).toBe(state);
    state = apply(state, { type: 'reroll', playerId: 'a', diceIds: ids }).state;
    expect(state.players[0].rerolls).toBe(1);
    state = apply(state, { type: 'select', playerId: 'a', diceIds: ids.slice(0, 3) }).state;
    expect(getLegalActions(state, 'a').canConfirm).toBe(true);
  });

  it('can reroll a prismatic die without consuming another prismatic charge', () => {
    let state = apply(match(), { type: 'prismatic', playerId: 'a' }).state;
    const die = state.players[0].dice.find(d => d.prismatic)!;
    const uses = state.players[0].prismaticUses;
    state = apply(state, { type: 'select', playerId: 'a', diceIds: [die.id] }).state;
    const result = apply(state, { type: 'reroll', playerId: 'a', diceIds: [die.id] });
    expect(result.state.players[0].prismaticUses).toBe(uses);
    expect(result.events.find(e => e.type === 'reroll')?.dice?.[0].id).toBe(die.id);
    expect(result.state.players[0].selectedIds).toEqual([]);
  });

  it('emits a distinct animation event even when a reroll produces the same result', () => {
    let state = match();
    const allSixes = state.catalog.prismatics.find(d => d.faces.every(f => f.value === 6))!;
    state.players[0].prismaticId = allSixes.id;
    state = apply(state, { type: 'prismatic', playerId: 'a' }).state;
    const die = state.players[0].dice.find(d => d.prismatic)!;
    const first = apply(state, { type: 'reroll', playerId: 'a', diceIds: [die.id] });
    const second = apply(first.state, { type: 'reroll', playerId: 'a', diceIds: [die.id] });
    expect(first.events.find(e => e.type === 'reroll')?.dice?.[0].value).toBe(6);
    expect(second.events.find(e => e.type === 'reroll')?.dice?.[0].value).toBe(6);
    expect(second.events.find(e => e.type === 'reroll')?.id).not.toBe(first.events.find(e => e.type === 'reroll')?.id);
  });
});
