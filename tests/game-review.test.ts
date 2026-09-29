import { describe, expect, it } from 'vitest';
import { applyCommand, createMatch, defaultCatalog, getLegalActions } from '../src/game';
import type { GameCommand, GameState } from '../src/game';

const catalog = defaultCatalog();
catalog.cards.push({ id: 'review-dummy', name: '规则验证靶', hp: 100, attack: 3, defense: 2, dice: [6, 6, 6, 6, 6] });
function make(mode: 'classic' | 'coop' = 'classic', defender = 'review-dummy'): GameState {
  return createMatch({ mode, catalog, weather: 'off', coopStageId: '1001', players: [
    { id: 'a', name: 'A', cardId: 'review-dummy' },
    ...(mode === 'coop' ? [{ id: 'ally', name: 'B', cardId: 'review-dummy' }] : []),
    { id: 'enemy', name: '靶', cardId: defender },
  ] }, 123);
}
function cmd(s: GameState, c: GameCommand): GameState {
  const result = applyCommand(s, c); expect(result.error).toBeUndefined(); return result.state;
}
function choose(s: GameState, id: string, values: number[]): GameState {
  const p = s.players.find(p => p.id === id)!;
  values.forEach((v, i) => { p.dice[i].value = v; });
  return cmd(s, { type: 'select', playerId: id, diceIds: p.dice.slice(0, values.length).map(d => d.id) });
}
function finishCoop(s: GameState): GameState {
  for (const id of ['a', 'ally']) { s = choose(s, id, [1, 1, 1]); s = cmd(s, { type: 'confirm', playerId: id }); }
  for (const id of ['a', 'ally']) s = cmd(s, { type: 'confirm', playerId: id });
  s = choose(s, 'enemy', [6, 6]); return cmd(s, { type: 'confirm', playerId: 'enemy' });
}

describe('published original dice constraints', () => {
  it.each([
    ['264506', 11, 1, false], ['264506', 10, 1, true], ['264406', 100, 1, true],
    ['264507', 5, 1, false], ['264507', 4, 1, true], ['264407', 8, 1, true], ['264407', 9, 1, false],
    ['264517', 100, 5, false], ['264517', 100, 7, true], ['264417', 100, 5, true],
    ['264503', 100, 3, false], ['264503', 100, 4, true], ['264403', 100, 1, true],
  ] as const)('validates die %s at %i HP and turn %i', (id, hp, turn, allowed) => {
    const s = make(); const p = s.players[0]; p.prismaticId = id; p.prismaticUses = 2; p.hp = hp; s.turn = turn;
    expect(getLegalActions(s, p.id).canPrismatic).toBe(allowed);
    const result = applyCommand(s, { type: 'prismatic', playerId: p.id });
    if (allowed) { expect(result.error).toBeUndefined(); expect(result.state.players[0].prismaticUses).toBe(1); }
    else { expect(result.error).toBeTruthy(); expect(result.state).toBe(s); expect(result.state.seed).toBe(s.seed); }
  });
  it('retains the weaker original Venom two-stack face independently of its four-stack face', () => {
    const original = catalog.prismatics.find(d => d.id === '264524')!;
    expect(original.faces.filter(f => f.effect === 'poison').map(f => f.amount)).toEqual([2, 4]);
    expect(catalog.prismatics.find(d => d.id === '264423')!.faces.filter(f => f.effect === 'poison').map(f => f.amount)).toEqual([4, 4]);
    let s = make(); s.players[0].dice[0] = { ...s.players[0].dice[0], ...original.faces.find(f => f.effect === 'poison' && f.amount === 2)!, typeId: original.id, prismatic: true };
    s = choose(s, 'a', [2, 1, 1]); s = cmd(s, { type: 'confirm', playerId: 'a' });
    s = choose(s, 'enemy', [6, 6]); s = cmd(s, { type: 'confirm', playerId: 'enemy' });
    expect(s.players[1].hp).toBe(98); expect(s.players[1].statuses.poison).toBe(1);
  });
});

describe('death and human command boundaries', () => {
  it.each([['264004', 1], ['264005', 1], ['264009', 1], ['102', 1], ['105', 1], ['264031', 2]] as const)('preserves %s defensive rerolls at %i', (cardId, count) => {
    let s = make('classic', cardId); s = choose(s, 'a', [1, 1, 1]); s = cmd(s, { type: 'confirm', playerId: 'a' });
    expect(s.players[1].rerolls).toBe(count); expect(getLegalActions(s, 'enemy').canReroll).toBe(true);
    s = cmd(s, { type: 'reroll', playerId: 'enemy', diceIds: [s.players[1].dice[0].id] });
    expect(s.players[1].rerolls).toBe(count - 1);
    expect(s.players[1].hp).toBe(s.players[1].maxHp - (cardId === '264031' ? 2 : 0));
  });
  it('advances the boss stage before the second ally attack and wins without consuming shared lives', () => {
    let s = createMatch({ mode: 'coop', catalog, weather: 'off', coopStageId: '1001', players: [
      { id: 'a', name: 'A', cardId: 'review-dummy' }, { id: 'ally', name: 'B', cardId: 'review-dummy' },
    ], bossPhases: [{ cardId: '20101', hp: 2 }, { cardId: '20102', hp: 5 }] }, 123);
    for (const id of ['a', 'ally']) { s = choose(s, id, [6, 6, 6]); s = cmd(s, { type: 'confirm', playerId: id }); }
    for (const id of ['a', 'ally']) s = cmd(s, { type: 'confirm', playerId: id });
    s = choose(s, 'boss', [1, 1, 1]); s = cmd(s, { type: 'confirm', playerId: 'boss' });
    expect(s.bossPhase).toBe(1); expect(s.phase).toBe('finished'); expect(s.winner).toBe(0); expect(s.sharedLives).toBe(3);
    expect(s.log.filter(e => e.type === 'boss-phase')).toHaveLength(1); expect(s.log.filter(e => e.type === 'victory')).toHaveLength(1);
  });
  it('charges each reflected death and stops immediately when shared lives are exhausted', () => {
    let s = make('coop'); s.sharedLives = 2; s.players[0].hp = s.players[1].hp = 1;
    s.players[2].modifiers.reflect = 0.5;
    s = finishCoop(s);
    expect(s.phase).toBe('finished'); expect(s.winner).toBe(1); expect(s.sharedLives).toBe(0);
    expect(s.log.filter(e => e.type === 'revive')).toHaveLength(1);
    expect(s.log.filter(e => e.type === 'victory')).toHaveLength(1);
    expect(s.turn).toBe(1);
  });
  it('poison deaths consume shared lives and cannot begin another turn after defeat', () => {
    let s = make('coop'); s.sharedLives = 2;
    for (const p of s.players.slice(0, 2)) { p.hp = 1; p.statuses.poison = 1; }
    s = finishCoop(s);
    expect(s.phase).toBe('finished'); expect(s.winner).toBe(1); expect(s.sharedLives).toBe(0);
    expect(s.log.filter(e => e.type === 'revive')).toHaveLength(1); expect(s.turn).toBe(1);
  });
  it('does not allow a confirmed ally to change selection, reroll, or swap while the other decides', () => {
    let s = make('coop'); s = choose(s, 'a', [1, 1, 1]); s = cmd(s, { type: 'confirm', playerId: 'a' });
    const die = s.players[0].dice[0].id;
    expect(applyCommand(s, { type: 'select', playerId: 'a', diceIds: [die] }).state).toBe(s);
    expect(applyCommand(s, { type: 'reroll', playerId: 'a', diceIds: [die] }).state).toBe(s);
    s = choose(s, 'ally', [1, 1, 1]); s = cmd(s, { type: 'confirm', playerId: 'ally' }); s = cmd(s, { type: 'confirm', playerId: 'a' });
    expect(applyCommand(s, { type: 'swap', playerId: 'a', ownDieId: die, poolDieId: s.swapPool[0].id }).state).toBe(s);
    expect(getLegalActions(s, 'ally').canSwap).toBe(true);
  });
  it('ordinary defenders cannot reroll or use attack-only dice while selected defense dice remain changeable', () => {
    let s = make(); s = choose(s, 'a', [1, 1, 1]); s = cmd(s, { type: 'confirm', playerId: 'a' });
    const p = s.players[1]; p.prismaticId = '264417'; p.prismaticUses = 2; s.turn = 7;
    expect(getLegalActions(s, p.id).canSelect).toBe(true); expect(getLegalActions(s, p.id).canReroll).toBe(false);
    expect(getLegalActions(s, p.id).canPrismatic).toBe(false);
    expect(applyCommand(s, { type: 'reroll', playerId: p.id, diceIds: [p.dice[0].id] }).state).toBe(s);
  });
});
