import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCommand, createMatch, defaultCatalog } from '../src/game';
import type { GameCommand, GameState } from '../src/game/types';
import { BATTLE_PRESENTATION_TIMING as timing, BattlePresentationController, buildPresentationSteps, collectDefeatedPlayers, makeImpactSnapshot } from '../src/lib/useBattlePresentation';

const options = { active: true, reducedMotion: false, matchKey: 'defeat-fixture' };
const catalog = defaultCatalog();
for (const id of ['presentation-dummy', 'presentation-boss-one', 'presentation-boss-two']) {
  catalog.cards.push({ id, name: id, hp: 100, attack: 3, defense: 2, dice: [6, 6, 6, 6, 6] });
}

function command(state: GameState, action: GameCommand) {
  const result = applyCommand(state, action);
  expect(result.error).toBeUndefined();
  return result.state;
}
function choose(state: GameState, playerId: string, values: number[]) {
  const player = state.players.find(player => player.id === playerId)!;
  values.forEach((value, index) => player.dice[index].value = value);
  return command(state, { type: 'select', playerId, diceIds: player.dice.slice(0, values.length).map(die => die.id) });
}
function lethalClassic() {
  let state = createMatch({ mode: 'classic', catalog, weather: 'off', players: [
    { id: 'one', name: 'Attacker', cardId: 'presentation-dummy' },
    { id: 'two', name: 'Defender', cardId: 'presentation-dummy' },
  ] }, 17);
  state.players[1].hp = 1;
  state = choose(state, 'one', [6, 6, 6]);
  state = command(state, { type: 'confirm', playerId: 'one' });
  state = choose(state, 'two', [1, 1]);
  return { previous: state, resolved: command(state, { type: 'confirm', playerId: 'two' }) };
}
function coopSettlement(kind: 'boss-phase' | 'revive' | 'terminal-revive') {
  let state = createMatch({ mode: 'coop', catalog, weather: 'off', coopStageId: '1001', players: [
    { id: 'one', name: 'Ally one', cardId: 'presentation-dummy' },
    { id: 'two', name: 'Ally two', cardId: 'presentation-dummy' },
  ], bossPhases: [{ cardId: 'presentation-boss-one', hp: kind === 'boss-phase' ? 1 : 100 }, { cardId: 'presentation-boss-two', hp: 100 }] }, 17);
  if (kind !== 'boss-phase') {
    state.players[0].hp = 1;
    state.players[0].statuses.poison = 1;
    if (kind === 'terminal-revive') { state.sharedLives = 2; state.players[0].statuses.thorns = 1; }
  }
  for (const playerId of ['one', 'two']) {
    state = choose(state, playerId, [6, 6, 6]);
    state = command(state, { type: 'confirm', playerId });
  }
  for (const playerId of ['one', 'two']) state = command(state, { type: 'confirm', playerId });
  state = choose(state, 'boss', [1, 1]);
  return { previous: state, resolved: command(state, { type: 'confirm', playerId: 'boss' }) };
}
function begin(previous: GameState, resolved: GameState, reducedMotion = false) {
  const publish = vi.fn();
  const controller = new BattlePresentationController(previous, publish);
  controller.update(previous, { ...options, reducedMotion });
  controller.update(resolved, { ...options, reducedMotion });
  return { controller, publish };
}
function selfDamageRevival() {
  const previous = createMatch({ mode: 'coop', weather: 'off', coopStageId: '1001', players: [
    { id: 'one', name: 'Blade', cardId: '264031' }, { id: 'two', name: 'Ally', cardId: '264014' },
  ], bossPhases: [{ cardId: '20101' }] }, 17);
  previous.players[0].hp = 2;
  const resolved = command(previous, { type: 'reroll', playerId: 'one', diceIds: [previous.players[0].dice[0].id] });
  return { previous, resolved };
}
const impactAt = timing.settle + timing.compare + timing.strike;
const defeatAt = impactAt + timing.impact;
function advanceUntil(controller: BattlePresentationController, predicate: (frame: ReturnType<BattlePresentationController['getSnapshot']>) => boolean) {
  for (let count = 0; count < 100 && !predicate(controller.getSnapshot()); count++) vi.advanceTimersToNextTimer();
  expect(predicate(controller.getSnapshot())).toBe(true);
}

describe('zero-health presentation and result ordering', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the actual lethal hit, zero HP and 1700 ms defeat before revealing results', () => {
    const { previous, resolved } = lethalClassic();
    const untouched = structuredClone({ previous, resolved });
    expect(resolved.phase).toBe('finished');
    expect(resolved.lastResolution?.strikes[0]).toMatchObject({ defenderId: 'two', amount: 1 });
    const { controller } = begin(previous, resolved);
    vi.advanceTimersByTime(timing.settle + timing.compare);
    expect(controller.getSnapshot().phase).toBe('strike');
    expect(controller.getSnapshot().state?.players[1].hp).toBe(1);
    vi.advanceTimersByTime(timing.strike);
    expect(controller.getSnapshot().phase).toBe('impact');
    expect(controller.getSnapshot().state?.players[1].hp).toBe(0);
    expect(controller.getSnapshot().state?.phase).not.toBe('finished');
    vi.advanceTimersByTime(timing.impact);
    expect(controller.getSnapshot().phase).toBe('defeat');
    expect(controller.getSnapshot().defeats).toMatchObject([{ kind: 'defeat', player: { id: 'two', hp: 0 } }]);
    vi.advanceTimersByTime(1699);
    expect(controller.getSnapshot().phase).toBe('defeat');
    expect(controller.getSnapshot().state?.phase).not.toBe('finished');
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot()).toEqual({ state: resolved, busy: false, phase: 'idle' });
    expect(vi.getTimerCount()).toBe(0);
    expect({ previous, resolved }).toEqual(untouched);
  });

  it('keeps a short static comparison, individual impact and static defeat with reduced motion', () => {
    const { previous, resolved } = lethalClassic();
    const { controller, publish } = begin(previous, resolved, true);
    vi.advanceTimersByTime(timing.reducedCompare - 1);
    expect(controller.getSnapshot().phase).toBe('compare');
    expect(controller.getSnapshot().state?.players[1].hp).toBe(1);
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot().phase).toBe('impact');
    expect(controller.getSnapshot().state?.players[1].hp).toBe(0);
    vi.advanceTimersByTime(timing.reducedImpact);
    expect(controller.getSnapshot().phase).toBe('defeat');
    expect(controller.getSnapshot().state?.players[1].hp).toBe(0);
    vi.advanceTimersByTime(449);
    expect(controller.getSnapshot().state?.phase).not.toBe('finished');
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot().state).toBe(resolved);
    expect(publish.mock.calls.map(([frame]) => frame.phase)).toEqual(['idle', 'compare', 'impact', 'defeat', 'idle']);
  });

  it('does not classify a healthy surrender as death', () => {
    const { previous } = lethalClassic();
    const resolved = command(previous, { type: 'surrender', playerId: 'one' });
    expect(resolved.players.every(player => player.hp > 0)).toBe(true);
    expect(collectDefeatedPlayers(previous, resolved)).toEqual([]);
    const { controller, publish } = begin(previous, resolved);
    expect(controller.getSnapshot()).toEqual({ state: resolved, busy: false, phase: 'idle' });
    expect(vi.getTimerCount()).toBe(0);
    vi.runAllTimers();
    expect(publish.mock.calls.some(([frame]) => frame.phase === 'defeat')).toBe(false);
    expect(controller.getSnapshot().state).toBe(resolved);
  });

  it.each(['boss-phase', 'revive'] as const)('holds the old card at zero before restoring %s state', kind => {
    const { previous, resolved } = coopSettlement(kind);
    const playerId = kind === 'boss-phase' ? 'boss' : 'one';
    const oldPlayer = previous.players.find(player => player.id === playerId)!;
    const nextPlayer = resolved.players.find(player => player.id === playerId)!;
    expect(nextPlayer.hp).toBeGreaterThan(0);
    expect(resolved.turn).toBe(previous.turn + 1);
    expect(collectDefeatedPlayers(previous, resolved)).toMatchObject([{ kind, player: { id: playerId, hp: 0, cardId: oldPlayer.cardId } }]);
    const { controller } = begin(previous, resolved);
    advanceUntil(controller, frame => frame.phase === 'defeat' && frame.defeats?.some(entry => entry.player.id === playerId) === true);
    const shown = controller.getSnapshot().state!;
    expect(controller.getSnapshot().phase).toBe('defeat');
    expect(shown.players.find(player => player.id === playerId)).toMatchObject({ hp: 0, cardId: oldPlayer.cardId });
    expect(shown.bossPhase).toBe(previous.bossPhase);
    if (kind === 'boss-phase') expect(nextPlayer.cardId).not.toBe(oldPlayer.cardId);
    else expect(shown.sharedLives).toBe(previous.sharedLives - 1);
    vi.advanceTimersByTime(timing.defeat);
    expect(controller.getSnapshot().activeEvent?.type).toBe(kind);
    expect(controller.getSnapshot().state?.players.find(player => player.id === playerId)?.hp).toBeGreaterThan(0);
    vi.runAllTimers();
    expect(controller.getSnapshot().state).toBe(resolved);
    expect(controller.getSnapshot().state?.players.find(player => player.id === playerId)?.hp).toBe(nextPlayer.hp);
  });

  it('classifies the final death after revival exhausts shared lives in the same resolution', () => {
    const { previous, resolved } = coopSettlement('terminal-revive');
    expect(resolved.phase).toBe('finished');
    expect(resolved.players[0].hp).toBe(0);
    expect(resolved.log.some(event => event.id >= previous.nextId && event.type === 'revive')).toBe(true);
    expect(collectDefeatedPlayers(previous, resolved)).toMatchObject([{ kind: 'defeat', player: { id: 'one', hp: 0 } }]);
    const steps = buildPresentationSteps(previous, resolved);
    const ownImpacts = steps.filter(step => step.frame.phase === 'impact' && (step.frame.activeEvent?.targetId || step.frame.activeEvent?.playerId) === 'one');
    expect(ownImpacts.map(step => step.frame.activeEvent?.damageKind || step.frame.activeEvent?.type)).toEqual(['thorns', 'revive', 'poison-tick']);
    expect(ownImpacts.map(step => step.frame.state?.players[0].hp)).toEqual([0, 1, 0]);
    const defeats = steps.filter(step => step.frame.phase === 'defeat');
    expect(defeats.map(step => step.frame.defeats?.[0].kind)).toEqual(['revive', 'defeat']);
    expect(defeats.map(step => step.frame.state?.sharedLives)).toEqual([1, 0]);
  });

  it('plays a boss phase recovery before the next ally hits the replacement', () => {
    const { previous, resolved } = coopSettlement('boss-phase');
    const steps = buildPresentationSteps(previous, resolved);
    const impacts = steps.filter(step => step.frame.phase === 'impact');
    expect(impacts.map(step => step.frame.activeEvent?.type)).toEqual(['damage', 'boss-phase', 'damage']);
    expect(impacts.map(step => step.frame.state?.players.find(player => player.id === 'boss')?.hp)).toEqual([0, 100, 84]);
    expect(impacts.map(step => step.frame.state?.players.find(player => player.id === 'boss')?.cardId)).toEqual(['presentation-boss-one', 'presentation-boss-two', 'presentation-boss-two']);
  });

  it.each([false, true])('shows same-turn self-damage revival without an invented attack (reduced: %s)', reduced => {
    const { previous, resolved } = selfDamageRevival();
    expect(resolved.turn).toBe(previous.turn);
    expect(resolved.players[0].hp).toBe(1);
    expect(collectDefeatedPlayers(previous, resolved)).toMatchObject([{ kind: 'revive', player: { id: 'one', hp: 0 } }]);
    const { controller, publish } = begin(previous, resolved, reduced);
    expect(controller.getSnapshot().phase).toBe('impact');
    expect(controller.getSnapshot().state?.players[0].hp).toBe(0);
    vi.advanceTimersByTime(reduced ? timing.reducedImpact : timing.status);
    expect(controller.getSnapshot().phase).toBe('defeat');
    expect(controller.getSnapshot().state?.players[0].hp).toBe(0);
    vi.advanceTimersByTime((reduced ? timing.reducedDefeat : timing.defeat) - 1);
    expect(controller.getSnapshot().phase).toBe('defeat');
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot().activeEvent?.type).toBe('revive');
    expect(controller.getSnapshot().state?.players[0].hp).toBe(1);
    vi.advanceTimersByTime(reduced ? timing.reducedImpact : timing.recovery);
    expect(controller.getSnapshot().state).toBe(resolved);
    expect(publish.mock.calls.some(([frame]) => ['compare', 'strike'].includes(frame.phase))).toBe(false);
  });

  it('does not replay historical defeat on restore, repeated snapshots or re-entry after exit', () => {
    const { previous, resolved } = lethalClassic();
    const restored = new BattlePresentationController(resolved, vi.fn());
    restored.update(resolved, options);
    expect(restored.getSnapshot()).toEqual({ state: resolved, busy: false, phase: 'idle' });
    expect(vi.getTimerCount()).toBe(0);
    const { controller } = begin(previous, resolved);
    vi.advanceTimersByTime(defeatAt);
    controller.update(resolved, { ...options, active: false });
    expect(vi.getTimerCount()).toBe(0);
    controller.update(resolved, options);
    controller.update(structuredClone(resolved), options);
    expect(controller.getSnapshot().phase).toBe('idle');
    expect(controller.getSnapshot().busy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(collectDefeatedPlayers(resolved, resolved)).toEqual([]);
  });

  it('keeps zero HP when reduced motion is enabled during the death sequence', () => {
    const { previous, resolved } = lethalClassic();
    const { controller } = begin(previous, resolved);
    vi.advanceTimersByTime(defeatAt + 400);
    controller.update(resolved, { ...options, reducedMotion: true });
    expect(controller.getSnapshot().phase).toBe('defeat');
    expect(controller.getSnapshot().state?.players[1].hp).toBe(0);
    vi.advanceTimersByTime(timing.reducedDefeat);
    expect(controller.getSnapshot().state).toBe(resolved);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a revived player at zero when reduced motion is switched on during impact', () => {
    const { previous, resolved } = coopSettlement('revive');
    const { controller } = begin(previous, resolved);
    advanceUntil(controller, frame => frame.phase === 'impact' && frame.activeEvent?.damageKind === 'poison-tick');
    expect(controller.getSnapshot().state?.players[0].hp).toBe(0);
    controller.update(resolved, { ...options, reducedMotion: true });
    vi.advanceTimersByTime(timing.reducedImpact);
    expect(controller.getSnapshot().phase).toBe('defeat');
    expect(controller.getSnapshot().state?.players[0].hp).toBe(0);
    vi.advanceTimersByTime(timing.reducedDefeat);
    expect(controller.getSnapshot().state?.players[0].hp).toBe(1);
  });

  it('does not introduce a comparison when reduced motion is enabled during self-damage impact', () => {
    const { previous, resolved } = selfDamageRevival();
    const { controller, publish } = begin(previous, resolved);
    expect(controller.getSnapshot().phase).toBe('impact');
    controller.update(resolved, { ...options, reducedMotion: true });
    vi.advanceTimersByTime(timing.reducedImpact);
    expect(controller.getSnapshot().phase).toBe('defeat');
    expect(controller.getSnapshot().state?.players[0].hp).toBe(0);
    vi.advanceTimersByTime(timing.reducedDefeat);
    expect(controller.getSnapshot().activeEvent?.type).toBe('revive');
    vi.advanceTimersByTime(timing.reducedImpact);
    expect(controller.getSnapshot()).toEqual({ state: resolved, busy: false, phase: 'idle' });
    expect(publish.mock.calls.some(([frame]) => ['compare', 'strike'].includes(frame.phase))).toBe(false);
  });

  it('does not reclassify already defeated players in an impact snapshot', () => {
    const { previous, resolved } = lethalClassic();
    const impact = makeImpactSnapshot(previous, resolved);
    expect(collectDefeatedPlayers(impact, resolved)).toEqual([]);
    expect(impact.players[1].cardId).toBe(previous.players[1].cardId);
  });
});
