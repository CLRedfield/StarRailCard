import { describe, expect, it } from 'vitest';
import { applyCommand, createMatch, defaultCatalog, getPlayerPreview } from '../src/game';
import type { GameCommand, GameState } from '../src/game';
import { cards, diceById, shopGoods } from '../src/data';
import { buyGood, createStarterProfile } from '../src/lib/progression';

const catalog = defaultCatalog();
catalog.cards.push({ id: 'balance-dummy', name: '平衡训练靶', hp: 200, attack: 3, defense: 2, dice: [8, 8, 8, 8, 8] });
function make(cardId = 'custom-seele', mode: 'classic' | 'coop' = 'classic', startingSide: 0 | 1 = 0) {
  return createMatch({ mode, catalog, weather: 'off', coopStageId: '1001', startingSide, players: [
    { id: 'a', name: 'A', cardId },
    ...(mode === 'coop' ? [{ id: 'ally', name: '队友', cardId: 'balance-dummy' }] : []),
    { id: 'b', name: '靶', cardId: 'balance-dummy' },
  ] }, 47);
}
function command(s: GameState, c: GameCommand) {
  const result = applyCommand(s, c);
  expect(result.error).toBeUndefined();
  return result.state;
}
function select(s: GameState, id: string, indices: number[], values?: number[]) {
  const p = s.players.find(p => p.id === id)!;
  values?.forEach((value, i) => { p.dice[indices[i]].value = value; });
  return command(s, { type: 'select', playerId: id, diceIds: indices.map(i => p.dice[i].id) });
}
function resolve(s: GameState, indices = [0, 1, 2], av = [4, 6, 6], dv = [6, 6]) {
  s = select(s, 'a', indices, av);
  s = command(s, { type: 'confirm', playerId: 'a' });
  s = select(s, 'b', [0, 1], dv);
  return command(s, { type: 'confirm', playerId: 'b' });
}
const resurgence = (s: GameState) => s.lastResolution!.events!.filter(e => e.sourceLabel === '希儿·再现');
const attacks = (s: GameState) => s.lastResolution!.events!.filter(e => e.damageKind === 'attack' && e.playerId === 'a');

describe('Seele fan card and Resurgence', () => {
  it('has the requested stats, local art and an obtainable progression purchase', () => {
    expect(cards.find(c => c.id === 'custom-seele')).toMatchObject({ name: '希儿', hp: 28, attack: 3, defense: 3, dice: [4, 6, 6, 8, 8], image: 'assets/cards/custom-seele.png' });
    expect(shopGoods.find(g => g.id === 'custom-seele')?.cost).toBe(6);
    const bought = buyGood(createStarterProfile(), 'custom-seele');
    expect(bought.error).toBeUndefined();
    expect(bought.profile.ownedCards).toContain('custom-seele');
  });

  it('triggers after even one point of attack damage and uses the actual unused faces', () => {
    let s = make(); s.players[0].dice[3].value = 3; s.players[0].dice[4].value = 8;
    s = resolve(s, [0, 1, 2], [3, 5, 5]);
    expect(attacks(s).map(e => e.amount)).toEqual([1]);
    expect(resurgence(s)).toMatchObject([{ amount: 11, damageKind: 'instant', hpBefore: 199, hpAfter: 188 }]);
    expect(s.players[0].dice.map(d => d.sides)).toEqual([4, 6, 6, 8, 8]);
  });

  it('counts an unused prismatic face but never activates its effect', () => {
    let s = make(); s.players[0].dice[3].value = 2; s.players[0].dice[4].value = 3;
    s.players[0].dice.push({ id: 'unused-prismatic', ownerId: 'a', sides: 6, value: 7, prismatic: true, effect: 'poison', amount: 99 });
    s = resolve(s);
    expect(resurgence(s)[0].amount).toBe(12);
    expect(s.players[1].statuses.poison).toBe(0);
  });

  it('resolves immediately after the first hit, once for the entire combo', () => {
    let s = make(); s.players[0].modifiers.combo = 1; s.players[0].dice[3].value = 2; s.players[0].dice[4].value = 3;
    s = resolve(s);
    expect(s.lastResolution!.events!.filter(e => e.type === 'damage' && e.playerId === 'a').map(e => [e.damageKind, e.amount])).toEqual([['attack', 4], ['instant', 5], ['attack', 4]]);
    expect(resurgence(s)).toHaveLength(1);
    expect(s.players[0].statuses.roundResurgence).toBe(0); // Cleared for the next turn.
  });

  it('upgrades only the chosen pool slots after a fully blocked attack', () => {
    let s = make(); s.players[0].modifiers.combo = 1;
    s = resolve(s, [1, 3, 4], [1, 2, 3]);
    expect(attacks(s).map(e => e.amount)).toEqual([0, 0]);
    expect(resurgence(s)).toHaveLength(0);
    expect(s.players[0].dice.map(d => d.sides)).toEqual([4, 8, 6, 12, 12]);
    expect(s.players[0].dice.every(d => !d.prismatic)).toBe(true);
    expect(s.lastResolution!.events!.filter(e => e.sourceLabel === '希儿·再现升级')).toHaveLength(1);
  });

  it('does not confuse prismatic instant damage or poison with successful attack damage', () => {
    let s = make(); s.players[1].statuses.poison = 3;
    s.players[0].dice[0] = { ...s.players[0].dice[0], prismatic: true, effect: 'instant', amount: 3 };
    s = resolve(s, [0, 1, 2], [1, 1, 1]);
    expect(s.players[1].hp).toBe(194);
    expect(resurgence(s)).toHaveLength(0);
    expect(s.players[0].dice.map(d => d.sides)).toEqual([4, 8, 8, 8, 8]);
  });

  it('caps upgrades at twelve sides, which remain ordinary dice', () => {
    let s = make(); s.players[0].dice[0].sides = 12; s.players[0].statuses.die0 = 12;
    s = resolve(s, [0, 1, 2], [1, 1, 1]);
    expect(s.players[0].dice[0]).toMatchObject({ sides: 12, prismatic: false });
    expect(s.players[0].dice[0].effect).toBeUndefined();
  });

  it('upgrades against a forcefield even when the attack value is higher', () => {
    let s = make(); s.players[1].modifiers.forcefield = true;
    s = resolve(s, [0, 1, 2], [4, 6, 6], [1, 1]);
    expect(s.players[1].hp).toBe(200);
    expect(resurgence(s)).toHaveLength(0);
    expect(s.players[0].dice.map(d => d.sides)).toEqual([6, 8, 8, 8, 8]);
  });

  it('requires actual HP loss against unyielding and respects it for instant damage', () => {
    let s = make(); s.players[1].hp = 1; s.players[1].modifiers.unyielding = true;
    s = resolve(s);
    expect(attacks(s)[0].amount).toBe(0);
    expect(resurgence(s)).toHaveLength(0);
    expect(s.players[0].dice[0].sides).toBe(6);
    s = make(); s.players[1].hp = 3; s.players[1].modifiers.unyielding = true;
    s = resolve(s);
    expect(resurgence(s)).toMatchObject([{ amount: 0, hpAfter: 1 }]);
    expect(s.players[0].dice[0].sides).toBe(4);
  });

  it('does not attack again after victory or a boss-stage defeat', () => {
    let s = make(); s.players[1].hp = 1;
    s = resolve(s);
    expect(s.winner).toBe(0); expect(resurgence(s)).toHaveLength(0);
    s = make('custom-seele', 'coop');
    s.bossPhases = [{ cardId: 'balance-dummy', hp: 1 }, { cardId: 'balance-dummy', hp: 200 }];
    s.players[2].hp = 1;
    s = prepareCoop(s, [4, 6, 6], [1, 1, 1]);
    s = finishCoop(s);
    expect(s.bossPhase).toBe(1); expect(resurgence(s)).toHaveLength(0);
    expect(s.players[2].hp).toBe(200);
  });

  it('never activates either branch during defense', () => {
    let s = make('custom-seele', 'classic', 1);
    s = select(s, 'b', [0, 1, 2], [8, 8, 8]); s = command(s, { type: 'confirm', playerId: 'b' });
    s = select(s, 'a', [0, 1, 2], [1, 1, 1]); s = command(s, { type: 'confirm', playerId: 'a' });
    expect(resurgence(s)).toHaveLength(0);
    expect(s.players[0].dice.map(d => d.sides)).toEqual([4, 6, 6, 8, 8]);
  });

  it('is deterministic and leaves the input state unchanged', () => {
    let s = select(make(), 'a', [0, 1, 2], [4, 6, 6]); s = command(s, { type: 'confirm', playerId: 'a' });
    s = select(s, 'b', [0, 1], [6, 6]);
    const before = structuredClone(s), cmd: GameCommand = { type: 'confirm', playerId: 'b' };
    expect(applyCommand(s, cmd)).toEqual(applyCommand(s, cmd)); expect(s).toEqual(before);
  });
});

function prepareCoop(s: GameState, av = [4, 6, 6], allyValues = [1, 1, 1], indices = [0, 1, 2]) {
  s = select(s, 'a', indices, av); s = command(s, { type: 'confirm', playerId: 'a' });
  s = select(s, 'ally', [0, 1, 2], allyValues); return command(s, { type: 'confirm', playerId: 'ally' });
}
function finishCoop(s: GameState) {
  s = command(s, { type: 'confirm', playerId: 'a' }); s = command(s, { type: 'confirm', playerId: 'ally' });
  s = select(s, 'b', [0, 1], [6, 6]); return command(s, { type: 'confirm', playerId: 'b' });
}
describe('Seele shared dice and upgrade ownership', () => {
  it('excludes dice used by an ally and counts only her final unused dice', () => {
    let s = make('custom-seele', 'coop'); s.players[0].dice[3].value = 7; s.players[0].dice[4].value = 8;
    const borrowed = s.players[0].dice[4].id;
    s = prepareCoop(s);
    s = command(s, { type: 'swap', playerId: 'ally', ownDieId: s.players[1].dice[0].id, poolDieId: borrowed });
    s = finishCoop(s);
    expect(resurgence(s)).toMatchObject([{ amount: 7 }]);
  });

  it('retains noncontiguous selected pool slots across the swap phase', () => {
    let s = make('custom-seele', 'coop');
    s = prepareCoop(s, [1, 1, 1], [1, 1, 1], [1, 3, 4]); s = finishCoop(s);
    expect(s.players[0].dice.map(d => d.sides)).toEqual([4, 8, 6, 12, 12]);
  });

  it('upgrades a borrowed die in the slot it replaced without changing its original owner', () => {
    let s = make('custom-seele', 'coop'); s.players[1].dice[3].value = 1;
    const borrowed = s.players[1].dice[3].id;
    s = prepareCoop(s, [1, 1, 1], [1, 1, 1], [1, 3, 4]);
    s = command(s, { type: 'swap', playerId: 'a', ownDieId: s.players[0].dice[0].id, poolDieId: borrowed });
    expect(s.players[0].dice[0]).toMatchObject({ ownerId: 'ally', poolIndex: 1 });
    s = finishCoop(s);
    expect(s.players[0].dice.map(d => d.sides)).toEqual([4, 12, 6, 12, 12]);
    expect(s.players[1].dice.map(d => d.sides)).toEqual([8, 8, 8, 8, 8]);
  });
});

describe('Blade and Evanescia balance', () => {
  it('gives Blade four attack rerolls and two defensive rerolls, with two HP per use', () => {
    for (const startingSide of [0, 1] as const) {
      let s = make('264031', 'classic', startingSide);
      expect(s.players[0].rerolls).toBe(startingSide === 0 ? 4 : 2);
      if (startingSide === 1) { s = select(s, 'b', [0, 1, 2]); s = command(s, { type: 'confirm', playerId: 'b' }); }
      const before = s.players[0].hp;
      s = command(s, { type: 'reroll', playerId: 'a', diceIds: [s.players[0].dice[0].id] });
      expect(s.players[0].hp).toBe(before - 2);
      expect(s.players[0].rerolls).toBe(startingSide === 0 ? 3 : 1);
    }
  });

  it.each([[6, 6, 2], [3, 4, 12], [2, 2, 12], [8, 8, 0]])('ignores at most seven defense against %i + %i, for %i total combo damage', (d1, d2, total) => {
    let s = make('264027');
    s = select(s, 'a', [2], [6]); s = selectPreviewDefender(s, [d1, d2]);
    const preview = getPlayerPreview(s, 'a');
    expect(preview.effects).toContain('穿透7防御'); expect(preview.effects).not.toContain('洞穿'); expect(preview.damageEstimate).toBe(total);
    s = command(s, { type: 'confirm', playerId: 'a' }); s = command(s, { type: 'confirm', playerId: 'b' });
    expect(s.players[1].hp).toBe(200 - total);
    expect(s.lastResolution!.players[0].effects).toContain('穿透7防御');
  });

  it('leaves forcefields intact and calculates counters from the remaining defense', () => {
    let s = make('264027'); s.players[1].modifiers.forcefield = true;
    s = resolve(s, [2], [6], [1, 1]); expect(s.players[1].hp).toBe(200);
    s = make('264027'); s.players[1].modifiers.counter = true;
    s = resolve(s, [2], [6], [8, 8]); expect(s.players[0].hp).toBe(24); // (16 - 7 - 6) twice.
  });

  it('does not apply seven-point penetration to multi-die attacks', () => {
    let s = make('264027'); s = resolve(s, [1, 2], [6, 6], [6, 6]);
    expect(s.players[1].hp).toBe(200); expect(s.lastResolution!.players[0].effects).not.toContain('穿透7防御');
  });

  it('still allows full piercing from a separate effect', () => {
    let s = make('264027'); s.players[0].modifiers.pierce = true; s.players[1].modifiers.forcefield = true;
    s = resolve(s, [2], [6], [8, 8]); expect(s.players[1].hp).toBe(188);
  });
});

function selectPreviewDefender(s: GameState, values: number[]) {
  const p = s.players.at(-1)!;
  values.forEach((value, i) => { p.dice[i].value = value; });
  p.selectedIds = p.dice.slice(0, values.length).map(d => d.id);
  return s;
}

describe('True default prismatic dice', () => {
  it('assigns collectible 真• prismatic dice to all playable characters with a default die', () => {
    const diceBacked = cards.filter(c => c.prismaticId && c.id !== 'custom-seele');
    expect(diceBacked).toHaveLength(23);
    for (const card of cards) {
      if (card.prismaticId) expect(card.prismaticId.startsWith('2645')).toBe(false);
    }
    for (const card of diceBacked) {
      const die = diceById[card.prismaticId!];
      expect(die, `Missing die for ${card.name} (${card.id})`).toBeDefined();
      expect(die.collectible).toBe(true);
      expect(die.name.startsWith('「真•')).toBe(true);
    }
    expect(cards.find(c => c.id === '264026')?.prismaticId).toBe('264419');
    expect(diceById['264419']?.name).toBe('「真•心跳」');
    expect(cards.find(c => c.id === '264027')?.prismaticId).toBe('264424');
    expect(diceById['264424']?.name).toBe('「真•蓄力」');
    expect(cards.find(c => c.id === '264027')?.description).toContain('忽略对方7点防御值');
    expect(cards.find(c => c.id === '264031')?.prismaticId).toBe('264407');
    expect(cards.find(c => c.id === '264031')?.description).toContain('重投');
    expect(cards.find(c => c.id === '264032')?.prismaticId).toBe('264423');
    expect(diceById['264423']?.name).toBe('「真•毒液」');
    expect(cards.find(c => c.id === 'custom-seele')?.prismaticId).toBe('264401');

    const match = createMatch({ mode: 'classic', catalog, weather: 'off', players: [{ id: 'a', name: 'A', cardId: '264026' }, { id: 'b', name: 'B', cardId: 'balance-dummy' }] }, 1);
    expect(match.players[0].prismaticId).toBe('264419');
  });
});
