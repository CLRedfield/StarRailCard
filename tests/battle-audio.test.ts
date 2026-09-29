import { describe, expect, it } from 'vitest';
import { applyCommand, createMatch, defaultCatalog } from '../src/game';
import type { GameCommand, GameState } from '../src/game/types';
import { BattleSoundTracker, commandSuccessSound } from '../src/lib/battleAudio';
import { buildPresentationSteps, type BattlePresentation } from '../src/lib/useBattlePresentation';

const catalog = defaultCatalog();
catalog.cards.push(
  { id: 'audio-poison', name: '海瑟音', hp: 100, attack: 3, defense: 3, dice: [6, 6, 6, 6, 6] },
  { id: 'audio-attacker', name: '音效测试进攻', hp: 100, attack: 3, defense: 3, dice: [6, 6, 6, 6, 6] },
  { id: 'audio-defender', name: '音效测试防守', hp: 100, attack: 3, defense: 3, dice: [6, 6, 6, 6, 6] },
);
const idle = (state: GameState): BattlePresentation => ({ state, busy: false, phase: 'idle' });
function command(state: GameState, action: GameCommand) {
  const result = applyCommand(state, action);
  if (result.error) throw new Error(result.error);
  return result.state;
}
function settle(poison = true) {
  let state = createMatch({ mode: 'classic', weather: 'off', catalog, players: [
    { id: 'one', name: '进攻方', cardId: poison ? 'audio-poison' : 'audio-attacker' },
    { id: 'two', name: '防守方', cardId: 'audio-defender' },
  ] }, 7119);
  if (!poison) state.weatherId = catalog.weather.find(weather => weather.name === '飓风')!.id;
  state.players[0].dice.slice(0, 3).forEach(die => die.value = poison ? 2 : 6);
  state = command(state, { type: 'confirm', playerId: 'one', diceIds: state.players[0].dice.slice(0, 3).map(die => die.id) });
  state.players[1].dice.slice(0, 3).forEach(die => die.value = poison ? 6 : 1);
  return { previous: state, resolved: command(state, { type: 'confirm', playerId: 'two', diceIds: state.players[1].dice.slice(0, 3).map(die => die.id) }) };
}

describe('battle sound event routing', () => {
  it.each([false, true])('plays poison on each poison impact, with one blocked attack sound (reduced motion: %s)', reduced => {
    const { previous, resolved } = settle();
    const tracker = new BattleSoundTracker();
    expect(tracker.consume(idle(previous), 'match')).toEqual([]);
    const sounds = buildPresentationSteps(previous, resolved, reduced).flatMap(({ frame }) => {
      const next = tracker.consume(frame, 'match');
      expect(tracker.consume(structuredClone(frame), 'match')).toEqual([]);
      if (frame.activeEvent?.damageKind?.startsWith('poison')) expect(next).toEqual(['poison']);
      return next;
    });
    expect(sounds.filter(sound => sound === 'attack')).toHaveLength(1);
    expect(sounds.filter(sound => sound === 'poison')).toHaveLength(2);
    expect(sounds).not.toContain('damage');
    expect(tracker.consume(idle(resolved), 'match')).toEqual(['roll']);
    expect(tracker.consume(idle(structuredClone(resolved)), 'match')).toEqual([]);
  });

  it.each([false, true])('plays one attack and one contact per genuine combo hit (reduced motion: %s)', reduced => {
    const { previous, resolved } = settle(false);
    const tracker = new BattleSoundTracker(); tracker.consume(idle(previous), 'match');
    const sounds = buildPresentationSteps(previous, resolved, reduced).flatMap(({ frame }) => tracker.consume(frame, 'match'));
    expect(sounds).toEqual(['attack', 'damage', 'attack', 'damage']);
  });

  it('does not lose a health event when a newer reroll event lands before it', () => {
    const previous = createMatch({ mode: 'coop', weather: 'off', coopStageId: '1001', players: [
      { id: 'one', name: '刃', cardId: '264031' }, { id: 'two', name: '队友', cardId: '264014' },
    ], bossPhases: [{ cardId: '20101' }] }, 7119);
    const resolved = command(previous, { type: 'reroll', playerId: 'one', diceIds: [previous.players[0].dice[0].id] });
    const tracker = new BattleSoundTracker(); tracker.consume(idle(previous), 'match');
    const sounds = buildPresentationSteps(previous, resolved).flatMap(({ frame }) => tracker.consume(frame, 'match'));
    expect(sounds.filter(sound => sound === 'roll')).toHaveLength(1);
    expect(sounds.filter(sound => sound === 'damage')).toHaveLength(1);
    expect(tracker.consume(idle(resolved), 'match')).toEqual([]);
  });

  it('silences restored snapshots, reconnect history, and returning to the table', () => {
    const { previous, resolved } = settle();
    const tracker = new BattleSoundTracker(); tracker.consume(idle(previous), 'match');
    expect(tracker.consume(idle(resolved), 'recovered-match')).toEqual([]);
    expect(tracker.consume(idle(structuredClone(resolved)), 'recovered-match')).toEqual([]);
    tracker.consume(idle(resolved), 'recovered-match', false);
    expect(tracker.consume(idle(resolved), 'recovered-match')).toEqual([]);
  });

  it('only gives the completing human a confirmation chime, never local selection or AI', () => {
    const confirm: GameCommand = { type: 'confirm', playerId: 'one', diceIds: [] };
    expect(commandSuccessSound(confirm, false)).toBe('confirm');
    expect(commandSuccessSound(confirm, true)).toBeUndefined();
    expect(commandSuccessSound({ type: 'select', playerId: 'one', diceIds: [] }, false)).toBeUndefined();
    expect(commandSuccessSound({ type: 'buyTactic', playerId: 'one', offerIndex: 0 }, false)).toBe('click');
  });
});
