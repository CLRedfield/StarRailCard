import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCommand, chooseAiCommand, createMatch, getPlayerPreview } from '../src/game';
import type { GameState } from '../src/game/types';
import { BATTLE_PRESENTATION_TIMING as timing, BattlePresentationController, makeImpactSnapshot } from '../src/lib/useBattlePresentation';

const options = { active: true, reducedMotion: false, matchKey: 'test-match' };

function firstSettlement() {
  let previous = createMatch({ mode: 'classic', weather: 'off', players: [
    { id: 'one', name: '银狼', cardId: '264026', isAI: true },
    { id: 'two', name: '流萤', cardId: '264014', isAI: true },
  ] }, 4321);
  for (let step = 0; step < 100; step++) {
    const command = chooseAiCommand(previous);
    if (!command) throw new Error('Fixture match stalled');
    const result = applyCommand(previous, command);
    if (result.error) throw new Error(result.error);
    if (result.state.turn > previous.turn && result.events.some(event => event.type === 'damage')) return { previous, resolved: result.state };
    previous = result.state;
  }
  throw new Error('Fixture match did not resolve damage');
}

function controlledTransforms(loan = false) {
  let state = createMatch({ mode: 'classic', weather: 'off', players: [
    { id: 'one', name: '银狼', cardId: '264026' }, { id: 'two', name: '流萤', cardId: '264014' },
  ] }, 123);
  state.players[0].dice.slice(0, 3).forEach((die, index) => die.value = [1, 6, 4][index]);
  state.players[1].dice.slice(0, 3).forEach((die, index) => die.value = [4, 4, 6][index]);
  if (loan) Object.assign(state.players[0].dice[0], { value: 3, prismatic: true, effect: 'overload', typeId: '264511' });
  for (const playerId of ['one', 'two']) {
    const player = state.players.find(player => player.id === playerId)!;
    const result = applyCommand(state, { type: 'select', playerId, diceIds: player.dice.slice(0, 3).map(die => die.id) });
    if (result.error) throw new Error(result.error);
    state = result.state;
    if (playerId === 'one') state = applyCommand(state, { type: 'confirm', playerId }).state;
  }
  const result = applyCommand(state, { type: 'confirm', playerId: 'two' });
  if (result.error) throw new Error(result.error);
  return { previous: state, resolved: result.state };
}

describe('battle presentation clock', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows restored snapshots immediately without replaying their historical damage', () => {
    const { resolved } = firstSettlement();
    const controller = new BattlePresentationController(resolved, vi.fn());
    controller.update(resolved, options);
    expect(controller.getSnapshot()).toEqual({ state: resolved, busy: false, phase: 'idle' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('holds the settled dice and values, then shows health feedback before the new turn', () => {
    const { previous, resolved } = firstSettlement();
    const untouched = structuredClone({ previous, resolved });
    const controller = new BattlePresentationController(previous, vi.fn());
    controller.update(previous, options);
    controller.update(resolved, options);
    expect(controller.getSnapshot().state?.turn).toBe(previous.turn);
    expect(controller.getSnapshot().busy).toBe(true);
    vi.advanceTimersByTime(199);
    expect(controller.getSnapshot().phase).toBe('settle');
    vi.advanceTimersByTime(1);
    const effects = resolved.log.filter(event => event.id >= previous.nextId && event.effectKind);
    vi.advanceTimersByTime(effects.length * timing.transform);
    const comparison = controller.getSnapshot();
    expect(comparison.phase).toBe('compare');
    for (const player of resolved.lastResolution!.players) {
      expect(comparison.frozenPreviews?.[player.id].value).toBe(player.value);
      expect(comparison.state?.players.find(candidate => candidate.id === player.id)?.hp).toBe(previous.players.find(candidate => candidate.id === player.id)?.hp);
    }
    vi.advanceTimersByTime(timing.compare);
    expect(controller.getSnapshot().phase).toBe('strike');
    vi.advanceTimersByTime(timing.strike);
    const impact = controller.getSnapshot();
    expect(impact.phase).toBe('impact');
    expect(impact.state?.turn).toBe(previous.turn);
    expect(impact.state?.attackingSide).toBe(previous.attackingSide);
    for (const player of previous.players) {
      const shown = impact.state?.players.find(candidate => candidate.id === player.id);
      const final = resolved.lastResolution!.players.find(candidate => candidate.id === player.id)!;
      expect(shown?.dice).toEqual(final.dice);
      expect(shown?.selectedIds).toEqual(final.dice.map(die => die.id));
      expect(shown?.hp).toBe(resolved.players.find(candidate => candidate.id === player.id)?.hp);
      expect(impact.frozenPreviews?.[player.id].value).toBe(final.value);
    }
    expect(impact.state?.log.some(event => event.id >= previous.nextId && event.type === 'damage')).toBe(true);
    expect(impact.state?.log.some(event => event.id >= previous.nextId && event.type === 'turn')).toBe(false);
    vi.advanceTimersByTime(timing.impact - 1);
    expect(controller.getSnapshot().busy).toBe(true);
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot()).toEqual({ state: resolved, busy: false, phase: 'idle' });
    expect({ previous, resolved }).toEqual(untouched);
  });

  it('finishes on the newest network snapshot instead of dropping updates during feedback', () => {
    const { previous, resolved } = firstSettlement();
    const controller = new BattlePresentationController(previous, vi.fn());
    controller.update(previous, options); controller.update(resolved, options);
    const latest = structuredClone(resolved);
    latest.players[0].selectedIds = [latest.players[0].dice[0].id];
    latest.log.push({ id: latest.nextId++, type: 'select', text: 'newer network selection', playerId: 'one' });
    controller.update(latest, options);
    vi.runAllTimers();
    expect(controller.getSnapshot().state).toBe(latest);
    expect(controller.getSnapshot().state?.players[0].selectedIds).toEqual(latest.players[0].selectedIds);
    expect(controller.getSnapshot().busy).toBe(false);
  });

  it('does not delay ordinary selection or reroll snapshots', () => {
    const { previous } = firstSettlement();
    const controller = new BattlePresentationController(previous, vi.fn());
    controller.update(previous, options);
    const rerolled = structuredClone(previous);
    rerolled.seed++;
    rerolled.log.push({ id: rerolled.nextId++, type: 'reroll', text: 'reroll', playerId: 'one' });
    controller.update(rerolled, options);
    expect(controller.getSnapshot().state).toBe(rerolled);
    expect(controller.getSnapshot().busy).toBe(false);
  });

  it('cancels an old match when a new match begins', () => {
    const { previous, resolved } = firstSettlement();
    const controller = new BattlePresentationController(previous, vi.fn());
    controller.update(previous, options); controller.update(resolved, options);
    const replacement = structuredClone(previous);
    controller.update(replacement, { ...options, matchKey: 'new-match' });
    vi.advanceTimersByTime(1000);
    expect(controller.getSnapshot()).toEqual({ state: replacement, busy: false, phase: 'idle' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels feedback on leaving the board and does not replay it on returning', () => {
    const { previous, resolved } = firstSettlement();
    const controller = new BattlePresentationController(previous, vi.fn());
    controller.update(previous, options); controller.update(resolved, options);
    controller.update(resolved, { ...options, active: false });
    vi.advanceTimersByTime(1000);
    controller.update(resolved, options);
    expect(controller.getSnapshot()).toEqual({ state: resolved, busy: false, phase: 'idle' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a short static comparison when reduced motion is enabled', () => {
    const { previous, resolved } = firstSettlement();
    const controller = new BattlePresentationController(previous, vi.fn());
    controller.update(previous, options); controller.update(resolved, options);
    controller.update(resolved, { ...options, reducedMotion: true });
    expect(controller.getSnapshot().phase).toBe('compare');
    expect(controller.getSnapshot().frozenPreviews?.one.value).toBe(resolved.lastResolution?.players[0].value);
    vi.advanceTimersByTime(timing.reducedCompare - 1);
    expect(controller.getSnapshot().busy).toBe(true);
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot().phase).toBe('impact');
    vi.advanceTimersByTime(timing.reducedImpact);
    expect(controller.getSnapshot()).toEqual({ state: resolved, busy: false, phase: 'idle' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('delays the victory overlay until the finishing hit has been shown', () => {
    const { previous, resolved } = firstSettlement();
    const finished: GameState = { ...resolved, turn: previous.turn, phase: 'finished', winner: 0 };
    const controller = new BattlePresentationController(previous, vi.fn());
    controller.update(previous, options); controller.update(finished, options);
    vi.advanceTimersByTime(200);
    expect(controller.getSnapshot().state?.phase).not.toBe('finished');
    vi.runAllTimers();
    expect(controller.getSnapshot().state).toBe(finished);
  });

  it('shows the defeated boss at zero before switching to its next phase', () => {
    const { previous, resolved } = firstSettlement();
    const phaseChanged = structuredClone(resolved);
    phaseChanged.players[1].cardId = '20102'; phaseChanged.players[1].hp = 45;
    const impact = makeImpactSnapshot(previous, phaseChanged);
    expect(impact.players[1].cardId).toBe(previous.players[1].cardId);
    expect(impact.players[1].hp).toBe(0);
    expect(phaseChanged.players[1].hp).toBe(45);
  });

  it('cleans up every timer on unmount', () => {
    const { previous, resolved } = firstSettlement();
    const publish = vi.fn();
    const controller = new BattlePresentationController(previous, publish);
    controller.update(previous, options); controller.update(resolved, options);
    const calls = publish.mock.calls.length;
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(publish).toHaveBeenCalledTimes(calls);
  });

  it('can reconnect after StrictMode effect cleanup without remaining busy', () => {
    const { previous, resolved } = firstSettlement();
    const controller = new BattlePresentationController(previous, vi.fn());
    controller.update(previous, options); controller.update(resolved, options);
    controller.dispose(); controller.update(resolved, options);
    expect(controller.getSnapshot()).toEqual({ state: resolved, busy: false, phase: 'idle' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reveals each exact arise/hack target in order without releasing damage log early', () => {
    const { previous, resolved } = controlledTransforms();
    const effects = resolved.log.filter(event => event.id >= previous.nextId && event.effectKind);
    expect(effects.map(event => event.effectKind)).toEqual(['arise', 'hack']);
    expect(effects[0].targetId).toBe('one');
    expect(effects[0].diceChanges?.[0]).toMatchObject({ before: 1, after: 6 });
    expect(effects[1].targetId).toBe('two');
    expect(effects[1].diceChanges?.[0]).toMatchObject({ before: 6, after: 2 });
    const controller = new BattlePresentationController(previous, vi.fn());
    controller.update(previous, options); controller.update(resolved, options);
    expect(controller.getSnapshot().state?.players[0].dice[0].value).toBe(1);
    vi.advanceTimersByTime(timing.settle);
    expect(controller.getSnapshot().activeEffect?.effectKind).toBe('arise');
    expect(controller.getSnapshot().state?.players[0].dice[0].value).toBe(6);
    expect(controller.getSnapshot().state?.players[1].dice[2].value).toBe(6);
    vi.advanceTimersByTime(timing.transform);
    expect(controller.getSnapshot().activeEffect?.effectKind).toBe('hack');
    expect(controller.getSnapshot().state?.players[1].dice[2].value).toBe(2);
    expect(controller.getSnapshot().state?.log).toEqual(previous.log);
    vi.advanceTimersByTime(timing.transform);
    expect(controller.getSnapshot().phase).toBe('compare');
    expect(controller.getSnapshot().activeEffect).toBeUndefined();
    expect(controller.getSnapshot().frozenPreviews?.one.value).toBe(16);
    expect(controller.getSnapshot().frozenPreviews?.two.value).toBe(10);
    expect(resolved.lastResolution?.strikes[0]).toMatchObject({ attackerId: 'one', defenderId: 'two', attack: 16, defense: 10, amount: 6, kind: 'attack' });
  });

  it('uses the engine comparison value including special dice absent from the planning preview', () => {
    const { previous, resolved } = controlledTransforms(true);
    expect(getPlayerPreview(previous, 'one').value).toBe(13);
    expect(resolved.lastResolution?.players[0].value).toBe(16);
    const controller = new BattlePresentationController(previous, vi.fn());
    controller.update(previous, { ...options, reducedMotion: true });
    controller.update(resolved, { ...options, reducedMotion: true });
    expect(controller.getSnapshot().phase).toBe('compare');
    expect(controller.getSnapshot().frozenPreviews?.one.value).toBe(16);
    expect(controller.getSnapshot().state?.players[0].hp).toBe(previous.players[0].hp);
    vi.advanceTimersByTime(timing.reducedCompare);
    expect(controller.getSnapshot().phase).toBe('impact');
    vi.advanceTimersByTime(timing.reducedImpact);
    expect(controller.getSnapshot().state).toBe(resolved);
  });

  it('captures co-op comparison values after full-support has doubled the teammate', () => {
    const state = createMatch({ mode: 'coop', weather: 'off', coopStageId: '1002', players: [
      { id: 'one', name: '银狼一', cardId: '264026' }, { id: 'two', name: '银狼二', cardId: '264026' },
    ], bossPhases: [{ cardId: '20101' }] }, 888);
    state.phase = 'roll'; state.activePlayerId = 'boss';
    for (const player of state.players) {
      const count = player.side === 0 ? player.attackLevel : player.defenseLevel;
      player.dice.forEach(die => die.value = 2);
      player.selectedIds = player.dice.slice(0, count).map(die => die.id);
      if (player.side === 0) player.rollLocked = player.confirmed = true;
    }
    state.players[0].modifiers.fullSupport = true;
    const result = applyCommand(state, { type: 'confirm', playerId: 'boss' });
    expect(result.error).toBeUndefined();
    expect(result.state.lastResolution?.players.find(player => player.id === 'one')?.value).toBe(0);
    expect(result.state.lastResolution?.players.find(player => player.id === 'two')?.value).toBe(12);
    expect(result.state.lastResolution?.strikes.filter(strike => strike.kind === 'attack').map(strike => strike.attack)).toEqual([0, 12]);
  });
});
