import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyCommand, createMatch, defaultCatalog } from '../src/game';
import type { GameCommand, GameState } from '../src/game/types';
import { BattlePresentationController, buildPresentationSteps, eventFeedbackLabel } from '../src/lib/useBattlePresentation';
import ResolutionEffects from '../src/components/ResolutionEffects';

const options = { active: true, reducedMotion: false, matchKey: 'ordered-damage' };
const catalog = defaultCatalog();
catalog.cards.push(
  { id: 'sequence-poison', name: '海瑟音', hp: 100, attack: 3, defense: 3, dice: [6, 6, 6, 6, 6] },
  { id: 'sequence-attacker', name: '顺序测试进攻', hp: 100, attack: 3, defense: 3, dice: [6, 6, 6, 6, 6] },
  { id: 'sequence-defender', name: '顺序测试防守', hp: 100, attack: 3, defense: 3, dice: [6, 6, 6, 6, 6] },
);
function command(state: GameState, action: GameCommand) {
  const result = applyCommand(state, action);
  if (result.error) throw new Error(result.error);
  return result.state;
}
function settle(settings: { poison?: number; venom?: number; weather?: string; thorns?: number; defenderHp?: number; poisonCharacter?: boolean } = {}) {
  let state = createMatch({ mode: 'classic', weather: 'off', catalog, players: [
    { id: 'one', name: '进攻方', cardId: settings.poisonCharacter === false ? 'sequence-attacker' : 'sequence-poison' },
    { id: 'two', name: '防守方', cardId: 'sequence-defender' },
  ] }, 7119);
  if (settings.weather) state.weatherId = catalog.weather.find(weather => weather.name === settings.weather)!.id;
  state.players[0].statuses.thorns = settings.thorns || 0;
  state.players[1].statuses.poison = settings.poison || 0;
  state.players[1].statuses.venom = settings.venom || 0;
  if (settings.defenderHp !== undefined) state.players[1].hp = settings.defenderHp;
  const attackValues = settings.poisonCharacter === false ? [6, 6, 6] : [2, 2, 2];
  attackValues.forEach((value, index) => state.players[0].dice[index].value = value);
  state = command(state, { type: 'confirm', playerId: 'one', diceIds: state.players[0].dice.slice(0, 3).map(die => die.id) });
  state.players[1].dice.slice(0, 3).forEach(die => die.value = settings.poisonCharacter === false ? 1 : 6);
  const previous = state;
  return { previous, resolved: command(state, { type: 'confirm', playerId: 'two', diceIds: state.players[1].dice.slice(0, 3).map(die => die.id) }) };
}
const health = (state: GameState | undefined, playerId: string) => state?.players.find(player => player.id === playerId)?.hp;

describe('ordered damage presentation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([{ poison: 0, venom: 0, amount: 3, remainder: 2 }, { poison: 4, venom: 0, amount: 7, remainder: 6 }, { poison: 4, venom: 1, amount: 14, remainder: 6 }])('shows blocked attack, non-consuming trigger and consuming poison tick separately: %j', settings => {
    const { previous, resolved } = settle(settings);
    const steps = buildPresentationSteps(previous, resolved);
    const impacts = steps.filter(step => step.frame.phase === 'impact');
    expect(impacts.map(step => step.frame.activeEvent?.damageKind)).toEqual(['attack', 'poison-trigger', 'poison-tick']);
    expect(impacts.map(step => health(step.frame.state, 'two'))).toEqual([100, 100 - settings.amount, 100 - 2 * settings.amount]);
    expect(impacts.map(step => step.frame.state?.players[1].statuses.poison)).toEqual([settings.poison + 3, settings.poison + 3, settings.remainder]);
    expect(steps.filter(step => step.frame.phase === 'strike')).toHaveLength(1);
    expect(impacts.slice(1).every(step => !step.frame.activeStrike)).toBe(true);
    expect(impacts.map(step => eventFeedbackLabel(step.frame.activeEvent!))).toEqual(['攻击', '海瑟音引爆', '回合末中毒']);
    expect(impacts[1].frame.state?.log.some(event => event.damageKind === 'poison-tick')).toBe(false);
  });

  it('makes legal weather combo hits distinct, including intermediate HP and source', () => {
    const { previous, resolved } = settle({ poisonCharacter: false, weather: '飓风' });
    const steps = buildPresentationSteps(previous, resolved);
    const strikes = steps.filter(step => step.frame.phase === 'strike');
    const impacts = steps.filter(step => step.frame.phase === 'impact');
    expect(strikes.map(step => step.frame.activeStrike?.strikeIndex)).toEqual([1, 2]);
    expect(strikes.map(step => health(step.frame.state, 'two'))).toEqual([100, 85]);
    expect(impacts.map(step => health(step.frame.state, 'two'))).toEqual([85, 70]);
    expect(strikes[1].frame.activeStrike?.comboSource).toContain('飓风');
    expect(eventFeedbackLabel(strikes[1].frame.activeEvent!)).toBe('连击·飓风');
    expect(new Set(strikes.map(step => step.frame.activeEvent?.id)).size).toBe(2);
  });

  it('shows thorns before a physical attack without inventing a third strike', () => {
    const { previous, resolved } = settle({ poisonCharacter: false, thorns: 4 });
    const impacts = buildPresentationSteps(previous, resolved).filter(step => step.frame.phase === 'impact');
    expect(impacts.map(step => step.frame.activeEvent?.damageKind)).toEqual(['thorns', 'attack']);
    expect(impacts[0].frame.activeStrike).toBeUndefined();
    expect(health(impacts[0].frame.state, 'one')).toBe(96);
    expect(health(impacts[0].frame.state, 'two')).toBe(100);
    expect(impacts[0].frame.state?.players[0].statuses.thorns).toBe(0);
  });

  it('preserves all individual HP steps under reduced motion, with no flights', () => {
    const { previous, resolved } = settle();
    const steps = buildPresentationSteps(previous, resolved, true);
    expect(steps.map(step => step.frame.phase)).toEqual(['compare', 'impact', 'impact', 'impact']);
    expect(steps.slice(1).map(step => health(step.frame.state, 'two'))).toEqual([100, 97, 94]);
    expect(steps.reduce((sum, step) => sum + step.duration, 0)).toBeLessThan(1500);
  });

  it('renders poison as a local status effect, never an attack-card flight or slash', () => {
    const { previous, resolved } = settle();
    const frame = buildPresentationSteps(previous, resolved).find(step => step.frame.activeEvent?.damageKind === 'poison-trigger')!.frame;
    const html = renderToStaticMarkup(createElement(ResolutionEffects, { state: frame.state!, phase: frame.phase, resolution: frame.resolution, activeEvent: frame.activeEvent, activeStrike: frame.activeStrike, playerId: 'one', reducedMotion: false }));
    expect(html).toContain('海瑟音引爆');
    expect(html).toContain('不消耗层数');
    expect(html).toContain('status-contact poison');
    expect(html).not.toContain('attack-card-layer');
    expect(html).not.toContain('attack-stroke');
  });

  it('plays duplicate network snapshots once and finishes on the newest non-combat update', () => {
    const { previous, resolved } = settle({ poisonCharacter: false, weather: '飓风' });
    const publish = vi.fn();
    const controller = new BattlePresentationController(previous, publish);
    controller.update(previous, options); controller.update(resolved, options);
    for (let n = 0; n < 6; n++) { vi.advanceTimersByTime(80); controller.update(structuredClone(resolved), options); }
    const latest = structuredClone(resolved); latest.players[0].name = '已同步';
    controller.update(latest, options);
    vi.runAllTimers();
    expect(publish.mock.calls.filter(([frame]) => frame.phase === 'strike')).toHaveLength(2);
    expect(publish.mock.calls.filter(([frame]) => frame.phase === 'impact')).toHaveLength(2);
    expect(controller.getSnapshot().state).toBe(latest);
    controller.update(structuredClone(latest), options);
    expect(controller.getSnapshot().busy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('queues new damage received during playback instead of silently skipping it', () => {
    const { previous, resolved } = settle();
    const latest = structuredClone(resolved), hp = latest.players[0].hp;
    latest.players[0].hp -= 2;
    const id = latest.nextId++;
    latest.log.push({ id, type: 'damage', damageKind: 'self-cost', targetId: 'one', sourceLabel: '生命消耗', amount: 2, hpBefore: hp, hpAfter: hp - 2, text: '生命消耗' });
    const publish = vi.fn(), controller = new BattlePresentationController(previous, publish);
    controller.update(previous, options); controller.update(resolved, options); controller.update(latest, options);
    vi.runAllTimers();
    const frames = publish.mock.calls.map(([frame]) => frame).filter(frame => frame.phase === 'impact');
    expect(frames.map(frame => frame.activeEvent.damageKind)).toEqual(['attack', 'poison-trigger', 'poison-tick', 'self-cost']);
    expect(health(frames[2].state, 'one')).toBe(hp);
    expect(health(frames[3].state, 'one')).toBe(hp - 2);
    expect(controller.getSnapshot().state).toBe(latest);
  });

  it('lands Blade reroll dice once while the self-cost and revival retain their own HP', () => {
    const previous = createMatch({ mode: 'coop', weather: 'off', coopStageId: '1001', players: [
      { id: 'one', name: '刃', cardId: '264031' }, { id: 'two', name: '队友', cardId: '264014' },
    ], bossPhases: [{ cardId: '20101' }] }, 7119);
    previous.players[0].hp = 2;
    const resolved = command(previous, { type: 'reroll', playerId: 'one', diceIds: [previous.players[0].dice[0].id] });
    const steps = buildPresentationSteps(previous, resolved);
    expect(steps[0].frame.state?.players[0].dice).toEqual(resolved.players[0].dice);
    expect(steps[0].frame.state?.log.some(event => event.type === 'reroll' && event.id >= previous.nextId)).toBe(true);
    expect(health(steps[0].frame.state, 'one')).toBe(0);
    const revive = steps.find(step => step.frame.activeEvent?.type === 'revive')!;
    expect(health(revive.frame.state, 'one')).toBe(1);
    expect(steps.every(step => step.frame.phase !== 'strike')).toBe(true);
    expect(steps.every(step => step.frame.state?.players[0].dice === steps[0].frame.state?.players[0].dice)).toBe(true);
  });

  it('uses resolution events when a long state log has already been trimmed', () => {
    const { previous, resolved } = settle();
    const trimmed = { ...resolved, log: resolved.log.filter(event => event.id > resolved.lastResolution!.eventEndId!) };
    const impacts = buildPresentationSteps(previous, trimmed).filter(step => step.frame.phase === 'impact');
    expect(impacts.map(step => health(step.frame.state, 'two'))).toEqual([100, 97, 94]);
  });

  it('stops after a lethal first combo strike and resets history on reconnect', () => {
    const { previous, resolved } = settle({ poisonCharacter: false, weather: '飓风', defenderHp: 1 });
    expect(buildPresentationSteps(previous, resolved).filter(step => step.frame.phase === 'strike')).toHaveLength(1);
    const publish = vi.fn(), controller = new BattlePresentationController(previous, publish);
    controller.update(previous, options); controller.update(resolved, options);
    controller.update(resolved, { ...options, matchKey: 'recovered-room' });
    expect(controller.getSnapshot()).toEqual({ state: resolved, busy: false, phase: 'idle' });
    expect(vi.getTimerCount()).toBe(0);
  });
});

