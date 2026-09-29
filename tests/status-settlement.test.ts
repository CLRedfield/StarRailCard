import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { applyCommand, createMatch, defaultCatalog, getLegalActions, getPlayerPreview } from '../src/game';
import type { GameCommand, GameEvent, GameState } from '../src/game';

const catalog = defaultCatalog();
catalog.cards.push({ id: 'status-dummy', name: '结算验证靶', hp: 200, attack: 3, defense: 2, dice: [6, 6, 6, 6, 6] });
const evidence: object[] = [];
const cardId = (name: string) => catalog.cards.find(c => c.name === name)!.id;
function make(attacker = 'status-dummy', defender = 'status-dummy', mode: 'classic' | 'coop' = 'classic') {
  return createMatch({ mode, catalog, weather: 'off', coopStageId: '1001', players: [
    { id: 'a', name: '攻击方', cardId: attacker },
    ...(mode === 'coop' ? [{ id: 'ally', name: '队友', cardId: 'status-dummy' }] : []),
    { id: 'b', name: '防御方', cardId: defender },
  ] }, 'status-review-20260928');
}
function command(s: GameState, c: GameCommand) { const result = applyCommand(s, c); expect(result.error).toBeUndefined(); return result.state; }
function chooseAndConfirm(s: GameState, id: string, values: number[]) {
  const p = s.players.find(p => p.id === id)!;
  values.forEach((n, i) => p.dice[i].value = n);
  return command(s, { type: 'confirm', playerId: id, diceIds: p.dice.slice(0, values.length).map(d => d.id) });
}
function finish(s: GameState, attack = [2, 2, 2], defense = [6, 6]) {
  s = chooseAndConfirm(s, 'a', attack);
  if (s.mode === 'coop') {
    s = chooseAndConfirm(s, 'ally', [1, 1, 1]);
    for (const id of ['a', 'ally']) s = command(s, { type: 'confirm', playerId: id });
  }
  return chooseAndConfirm(s, 'b', defense);
}
const damageEvents = (s: GameState) => s.lastResolution!.events!.filter(e => e.type === 'damage');
function record(name: string, s: GameState) {
  evidence.push({ name, seed: 'status-review-20260928', turn: s.lastResolution?.turn, weather: s.lastResolution?.weatherName,
    players: s.lastResolution?.players.map(p => ({ id: p.id, cardId: p.cardId, role: p.role, value: p.value, dice: p.dice.map(d => ({ value: d.value, effect: d.effect, typeId: d.typeId })) })),
    events: s.lastResolution?.events, final: s.players.map(p => ({ id: p.id, cardId: p.cardId, hp: p.hp, poison: p.statuses.poison, thorns: p.statuses.thorns, overload: p.statuses.overload })), sharedLives: s.sharedLives, bossPhase: s.bossPhase });
}
afterAll(() => { if (process.env.SAVE_STATUS_EVIDENCE === '1') { mkdirSync('artifacts', { recursive: true }); writeFileSync('artifacts/status-settlement-cases.json', JSON.stringify({ generatedAt: new Date().toISOString(), cases: evidence }, null, 2)); } });

describe('Hysilens extra trigger and ordinary poison decay', () => {
  it.each([[0, 0, 3, 2], [4, 0, 7, 6], [4, 1, 14, 6]] as const)('blocks attack but triggers poison independently: initial=%i venom=%i', (initial, venom, amount, remaining) => {
    let s = make(cardId('海瑟音')); s.players[1].statuses.poison = initial; s.players[1].statuses.venom = venom;
    s = finish(s);
    const events = damageEvents(s);
    expect(events.map(e => [e.damageKind, e.amount])).toEqual([['attack', 0], ['poison-trigger', amount], ['poison-tick', amount]]);
    expect(events[1]).toMatchObject({ poisonBefore: initial + 3, poisonAfter: initial + 3, hpBefore: 200, hpAfter: 200 - amount, sourceLabel: '海瑟音引爆' });
    expect(events[2]).toMatchObject({ poisonBefore: initial + 3, poisonAfter: remaining, hpBefore: 200 - amount, hpAfter: 200 - amount * 2 });
    expect(s.players[1].hp).toBe(200 - amount * 2); expect(s.players[1].statuses.poison).toBe(remaining);
    record(`海瑟音2/2/2 · 初始${initial}毒 · 猛毒${venom}`, s);
  });
  it('triggers once after all combo attacks and never charges a second poison stack', () => {
    let s = make(cardId('海瑟音')); s.weatherId = catalog.weather.find(w => w.name === '飓风')!.id;
    s = finish(s);
    expect(damageEvents(s).map(e => e.damageKind)).toEqual(['attack', 'attack', 'poison-trigger', 'poison-tick']);
    expect(s.players[1].hp).toBe(194); expect(s.players[1].statuses.poison).toBe(2);
    record('海瑟音飓风连击仅额外引爆一次', s);
  });
  it('mixed odd/even selection only adds the even count and performs the normal end tick', () => {
    const s = finish(make(cardId('海瑟音')), [2, 3, 4]);
    expect(damageEvents(s).map(e => [e.damageKind, e.amount])).toEqual([['attack', 0], ['poison-tick', 2]]);
    expect(s.players[1].statuses.poison).toBe(1);
  });
  it('stops immediately when the extra trigger kills, without an end tick or phantom combo', () => {
    let s = make(cardId('海瑟音')); s.players[1].hp = 2;
    s = finish(s);
    expect(s.winner).toBe(0); expect(damageEvents(s).map(e => [e.damageKind, e.amount])).toEqual([['attack', 0], ['poison-trigger', 2]]);
    expect(s.players[1].statuses.poison).toBe(3);
  });
  it('does not apply poison merely by rolling, preselecting, or previewing a venom die', () => {
    let s = make(); s.players[0].prismaticId = '264423'; s.players[0].prismaticUses = 2; s.players[1].statuses.poison = 1;
    s = command(s, { type: 'prismatic', playerId: 'a' });
    const before = structuredClone(s);
    s = command(s, { type: 'select', playerId: 'a', diceIds: s.players[0].dice.slice(-3).map(d => d.id) });
    getPlayerPreview(s, 'a');
    expect(s.players[1].statuses).toEqual(before.players[1].statuses); expect(s.players[1].hp).toBe(200);
  });
  it.each(['264524', '264423'])('enforces poison prerequisite for %s', id => {
    let s = make(); s.players[0].prismaticId = id; s.players[0].prismaticUses = 2;
    expect(getLegalActions(s, 'a').canPrismatic).toBe(false);
    expect(applyCommand(s, { type: 'prismatic', playerId: 'a' }).state).toBe(s);
    s.players[1].statuses.poison = 1; expect(getLegalActions(s, 'a').canPrismatic).toBe(true);
  });
  it('reapplying venom retains twofold damage rather than stacking to fourfold', () => {
    let s = make(cardId('海瑟音')); s.players[1].statuses.poison = 4; s.players[1].statuses.venom = 1;
    const face = catalog.prismatics.find(d => d.id === '264423')!.faces.find(f => f.effect === 'venom')!;
    s.players[0].dice[0] = { ...s.players[0].dice[0], ...face, typeId: '264423', prismatic: true };
    s = finish(s, [4, 2, 2]);
    expect(damageEvents(s).filter(e => e.damageKind?.startsWith('poison')).map(e => e.amount)).toEqual([14, 14]);
    expect(s.players[1].statuses.venom).toBe(1);
  });
});

describe('Yaoguang with true destiny: damage is explained by its real combo source', () => {
  it.each([['无天气', 1], ['飓风', 2], ['云隙光', 2]] as const)('%s produces %i actual attacks', (weather, count) => {
    let s = make(cardId('爻光'), cardId('海瑟音')); s.players[1].hp = s.players[1].maxHp = 200;
    if (weather !== '无天气') s.weatherId = catalog.weather.find(w => w.name === weather)!.id;
    const face = catalog.prismatics.find(d => d.id === '264404')!.faces.find(f => f.value === 12)!;
    s.players[0].dice[0] = { ...s.players[0].dice[0], ...face, typeId: '264404', prismatic: true, forced: true };
    s = finish(s, [12, 6, 6], [1, 1, 1]);
    const attacks = damageEvents(s).filter(e => e.damageKind === 'attack');
    expect(attacks).toHaveLength(count); expect(attacks.map(e => e.amount)).toEqual(Array(count).fill(21));
    expect(attacks.map(e => e.strikeIndex)).toEqual(count === 1 ? [1] : [1, 2]);
    if (count > 1) expect(attacks[1]).toMatchObject({ sourceLabel: `连击·${weather}`, comboSource: weather, strikeCount: 2 });
    else expect(attacks[0].comboSource).toBeUndefined();
    record(`爻光真命运12/6/6 · ${weather}`, s);
  });
  it('cloud gap light does not grant a combo when attacker HP is not lower', () => {
    let s = make(cardId('爻光')); s.players[1].hp = 20; s.weatherId = catalog.weather.find(w => w.name === '云隙光')!.id;
    s = finish(s, [6, 6, 6], [6, 6]); expect(damageEvents(s).filter(e => e.damageKind === 'attack')).toHaveLength(1);
  });
  it('lethal first strike records only actual lost HP and suppresses follow-up attacks', () => {
    let s = make(cardId('爻光')); s.players[1].hp = 3; s.weatherId = catalog.weather.find(w => w.name === '飓风')!.id;
    s = finish(s, [6, 6, 6], [1, 1]);
    expect(damageEvents(s)).toHaveLength(1); expect(damageEvents(s)[0]).toMatchObject({ amount: 3, hpBefore: 3, hpAfter: 0, strikeIndex: 1 });
    expect(s.winner).toBe(0); record('飓风第一击击杀后停止', s);
  });
});

describe('status ordering, death boundaries and replayable event metadata', () => {
  it('settles thorns and defensive overload before combat and poison after it', () => {
    let s = make(); s.players[0].statuses.thorns = 4; s.players[1].statuses.thorns = 3; s.players[1].statuses.overload = 6; s.players[1].statuses.poison = 2;
    s = finish(s);
    expect(damageEvents(s).map(e => [e.damageKind, e.amount])).toEqual([['thorns', 4], ['thorns', 3], ['overload', 3], ['attack', 0], ['poison-tick', 2]]);
    expect(s.players.map(p => p.statuses.thorns)).toEqual([0, 0]); expect(s.players[1].hp).toBe(192); expect(s.players[1].statuses.overload).toBe(6);
    record('荆棘、超载、格挡、回合末中毒顺序', s);
  });
  it('Yaoguang clears thorns at 18 attack before taking any thorn damage', () => {
    let s = make(cardId('爻光')); s.players[0].statuses.thorns = 50; const initialHp = s.players[0].hp, initialUses = s.players[0].prismaticUses;
    s = finish(s, [6, 6, 6]);
    expect(s.players[0].hp).toBe(initialHp); expect(s.players[0].prismaticUses).toBe(initialUses + 1);
    expect(s.lastResolution!.events).toContainEqual(expect.objectContaining({ sourceLabel: '爻光清荆棘', thornsBefore: 50, thornsAfter: 0 }));
    expect(damageEvents(s).some(e => e.damageKind === 'thorns')).toBe(false); record('爻光18攻先清荆棘', s);
  });
  it('Sunday on-hit thorns are shown now but retained for the next settlement', () => {
    const s = finish(make('status-dummy', cardId('星期日')), [6, 6, 6], [1, 1, 1]);
    expect(s.players.map(p => p.statuses.thorns)).toEqual([5, 5]);
    expect(s.lastResolution!.events!.filter(e => e.sourceLabel === '星期日受击荆棘')).toHaveLength(2);
    expect(damageEvents(s).some(e => e.damageKind === 'thorns')).toBe(false); record('星期日新荆棘留待下次', s);
  });
  it('counter and reflect are separate damage entries and stop after a lethal counter', () => {
    let s = make(); s.players[1].modifiers.counter = true; s.players[1].modifiers.reflect = 0.5;
    s = finish(s, [1, 1, 1]); expect(damageEvents(s).map(e => [e.damageKind, e.amount])).toEqual([['attack', 0], ['counter', 9], ['reflect', 6]]);
    record('格挡后的反击和反伤独立结算', s);
    let lethal = make(); lethal.players[0].hp = 3; lethal.players[1].modifiers.counter = true; lethal.players[1].modifiers.reflect = 0.5;
    lethal = finish(lethal, [1, 1, 1]); expect(damageEvents(lethal).map(e => e.damageKind)).toEqual(['attack', 'counter']);
  });
  it('unyielding preserves one HP through thorns, overload, attack and poison', () => {
    let s = make('status-dummy', cardId('白厄')); const p = s.players[1]; p.hp = 2; p.statuses.thorns = 4; p.statuses.overload = 6; p.statuses.poison = 5;
    s = finish(s, [6, 6, 6], [1, 1]);
    expect(s.players[1].hp).toBe(1); expect(s.players[1].unyieldingUsed).toBe(true); expect(s.players[1].statuses.poison).toBe(4);
    expect(damageEvents(s).every(e => e.hpAfter! >= 1)).toBe(true); record('不屈覆盖整轮各来源伤害', s);
  });
  it('records each co-op poison death and revival separately, with exact shared lives', () => {
    let s = make('status-dummy', 'status-dummy', 'coop'); s.players[0].hp = 1; s.players[0].statuses.thorns = 1; s.players[0].statuses.poison = 1;
    s = finish(s);
    const steps = s.lastResolution!.events!.filter(e => e.targetId === 'a' && (e.type === 'damage' || e.type === 'revive'));
    expect(steps.map(e => [e.type, e.hpBefore, e.hpAfter])).toEqual([['damage', 1, 0], ['revive', 0, 1], ['damage', 1, 0], ['revive', 0, 1]]);
    expect(steps.filter(e => e.type === 'revive').map(e => e.sharedLivesAfter)).toEqual([2, 1]); expect(s.sharedLives).toBe(1);
    record('共斗同轮荆棘和毒两次死亡复起', s);
  });
  it('boss phase change stops that attacker combo and retains both phase identities', () => {
    let s = make('status-dummy', 'status-dummy', 'coop'); s.bossPhases = [{ cardId: 'status-dummy', hp: 1 }, { cardId: '20102', hp: 200 }]; s.players[2].hp = 1; s.players[0].modifiers.combo = 1;
    s = finish(s, [6, 6, 6], [1, 1]);
    const attacks = damageEvents(s).filter(e => e.damageKind === 'attack');
    expect(attacks.filter(e => e.playerId === 'a')).toHaveLength(1); expect(attacks[0].targetCardId).toBe('status-dummy'); expect(attacks[1].targetCardId).toBe('20102');
    expect(s.lastResolution!.players[2].cardId).toBe('status-dummy');
    expect(s.lastResolution!.events).toContainEqual(expect.objectContaining({ type: 'boss-phase', previousCardId: 'status-dummy', targetCardId: '20102', hpBefore: 0, hpAfter: 200, bossPhaseAfter: 1 }));
    record('首领换阶段保留旧卡与下一队友新卡', s);
  });
  it('captures lethal pre-attack instant damage instead of losing it when making the resolution', () => {
    let s = make(); s.players[1].hp = 2; s.players[0].dice[0].effect = 'instant'; s.players[0].dice[0].amount = 3;
    s = finish(s);
    expect(damageEvents(s)).toHaveLength(1); expect(damageEvents(s)[0]).toMatchObject({ damageKind: 'instant', amount: 2, hpBefore: 2, hpAfter: 0 });
    expect(s.lastResolution!.players[1].hp).toBe(2); expect(s.lastResolution!.strikes[0].eventId).toBe(damageEvents(s)[0].id);
  });
  it('fixed seeds and command sequences produce identical values, ordered IDs and event boundaries', () => {
    const original = make(cardId('海瑟音')), snapshot = structuredClone(original);
    const one = finish(structuredClone(original)), two = finish(structuredClone(original));
    expect(one).toEqual(two); expect(original).toEqual(snapshot);
    const events = one.lastResolution!.events!;
    expect(events.every((event: GameEvent, i) => !i || event.id > events[i - 1].id)).toBe(true);
    expect(one.lastResolution!.eventStartId).toBe(events[0].id); expect(one.lastResolution!.eventEndId).toBe(events.at(-1)!.id);
    expect(one.lastResolution!.strikes.every(strike => events.some(event => event.id === strike.eventId))).toBe(true);
  });
});
