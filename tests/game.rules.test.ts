import { describe, expect, it } from 'vitest';
import { applyCommand, chooseAiCommand, createMatch, defaultCatalog, getLegalActions, getPlayerPreview } from '../src/game';
import { cards, bossCards } from '../src/data';
import type { GameCommand, GameState, MatchConfig } from '../src/game';

const catalog = defaultCatalog();
catalog.cards.push({ id: 'dummy', name: '训练靶', hp: 200, attack: 3, defense: 2, dice: [6, 6, 6, 6, 6] });
function make(cardId = '264013', mode: 'classic' | 'coop' = 'classic'): GameState { return createMatch({ mode, weather: 'off', catalog, players: mode === 'classic' ? [{ id: 'a', name: '我方', cardId }, { id: 'b', name: '靶', cardId: 'dummy' }] : [{ id: 'a', name: '我方', cardId }, { id: 'ally', name: '队友', cardId: 'dummy' }, { id: 'b', name: '首领', cardId: 'dummy' }] }, 17); }
function cmd(s: GameState, c: GameCommand): GameState { const r = applyCommand(s, c); expect(r.error).toBeUndefined(); return r.state; }
function choose(s: GameState, id: string, values: number[]): GameState { const p = s.players.find(p => p.id === id)!; values.forEach((v, i) => { p.dice[i].value = v; }); return cmd(s, { type: 'select', playerId: id, diceIds: p.dice.slice(0, values.length).map(d => d.id) }); }
function finishClassic(s: GameState, av: number[], dv: number[]): GameState { s = choose(s, 'a', av); s = cmd(s, { type: 'confirm', playerId: 'a' }); s = choose(s, 'b', dv); return cmd(s, { type: 'confirm', playerId: 'b' }); }

describe('deterministic authoritative game rules', () => {
  it('loads 37 player cards, 25 true dice and every face/skill descriptor', () => {
    expect(cards).toHaveLength(37); expect(catalog.prismatics.filter(d => d.name.includes('真') || d.name.includes('大红按钮'))).toHaveLength(25);
    expect(catalog.cards.every(c => c.dice.length > 0 && c.dice.every(n => [4, 6, 8, 12].includes(n)))).toBe(true);
    expect(catalog.prismatics.every(d => d.faces.length > 0 && d.faces.every(f => Number.isFinite(f.value)))).toBe(true);
  });
  it('replays identically and never mutates its input', () => {
    const a = make(), b = make(); expect(a).toEqual(b);
    const before = structuredClone(a); const command: GameCommand = { type: 'reroll', playerId: 'a', diceIds: [a.players[0].dice[0].id] };
    const one = applyCommand(a, command), two = applyCommand(b, command); expect(a).toEqual(before); expect(one).toEqual(two);
    expect(createMatch({ mode: 'classic', catalog, players: [{ id: 'a', name: '', cardId: 'dummy' }, { id: 'b', name: '', cardId: 'dummy' }] }, 12).seed).not.toBe(a.seed);
  });
  it('rejects wrong actor, duplicate dice and wrong selection size without consuming randomness', () => {
    const s = make(); const id = s.players[0].dice[0].id;
    expect(applyCommand(s, { type: 'confirm', playerId: 'b' }).state).toBe(s);
    expect(applyCommand(s, { type: 'select', playerId: 'a', diceIds: [id, id] }).error).toBeTruthy();
    expect(applyCommand(s, { type: 'confirm', playerId: 'a' }).error).toBeTruthy();
    expect(s.turn).toBe(1);
  });
  it('uses exact attack dice count and gives no ordinary defensive rerolls', () => {
    let s = make('dummy'); expect(getLegalActions(s, 'a').requiredDice).toBe(3); expect(s.players[0].rerolls).toBe(2); expect(s.players[1].rerolls).toBe(0);
    s = finishClassic(s, [6, 6, 6], [1, 1]); expect(s.players[1].hp).toBe(184); expect(s.turn).toBe(2); expect(s.activePlayerId).toBe('b');
  });
  it.each([
    [0, 8192, 0], [1, 1, 1], ['random', 1, 0], ['random', 8192, 1],
  ] as const)('initializes a %s opening with seed %i for side %i before rolling and alternates after combat', (startingSide, seed, expectedSide) => {
    const config: MatchConfig = { mode: 'classic', weather: 'off', catalog, startingSide, players: [
      { id: 'a', name: 'A', cardId: 'dummy' }, { id: 'b', name: 'B', cardId: 'dummy' },
    ] };
    let s = createMatch(config, seed);
    expect(s).toEqual(createMatch(config, seed));
    expect(s.players.map(p => [p.id, p.side])).toEqual([['a', 0], ['b', 1]]);
    const attacker = s.players[expectedSide], defender = s.players[1 - expectedSide];
    expect(s.attackingSide).toBe(expectedSide);
    expect(s.activePlayerId).toBe(attacker.id);
    expect(s.log.at(-1)?.text).toBe(`第1回合 · ${attacker.name}进攻`);
    expect(attacker.rerolls).toBe(2); expect(defender.rerolls).toBe(0);
    expect(getLegalActions(s, attacker.id)).toMatchObject({ canSelect: true, canReroll: true, requiredDice: 3 });
    expect(getLegalActions(s, defender.id)).toMatchObject({ canSelect: false, canReroll: false, requiredDice: 2 });
    expect(applyCommand(s, { type: 'confirm', playerId: defender.id }).error).toBeTruthy();
    s = choose(s, attacker.id, [6, 6, 6]); s = cmd(s, { type: 'confirm', playerId: attacker.id });
    expect(s.activePlayerId).toBe(defender.id);
    expect(getLegalActions(s, defender.id)).toMatchObject({ canSelect: true, canReroll: false, requiredDice: 2 });
    s = choose(s, defender.id, [1, 1]); s = cmd(s, { type: 'confirm', playerId: defender.id });
    expect(s.players[expectedSide].hp).toBe(200); expect(s.players[1 - expectedSide].hp).toBe(184);
    expect(s.lastResolution?.attackingSide).toBe(expectedSide);
    expect(s.turn).toBe(2); expect(s.attackingSide).toBe(1 - expectedSide); expect(s.activePlayerId).toBe(defender.id);
    expect(s.players[expectedSide].rerolls).toBe(0); expect(s.players[1 - expectedSide].rerolls).toBe(2);
  });
  it('Acheron all fours pierces forcefield and advances attack level once', () => {
    let s = make(); s.players[1].modifiers.forcefield = true;
    s = finishClassic(s, [4, 4], [6, 6]); expect(s.players[1].hp).toBe(192); expect(s.players[0].attackLevel).toBe(3);
  });
  it('Firefly two pairs performs two independent attacks with full HP bonus', () => {
    let s = make('264014'); s = finishClassic(s, [6, 6, 4, 4], [1, 1]); expect(s.players[1].hp).toBe(154);
  });
  it('Kafka poison ticks after combat, then decays', () => {
    let s = make('264017'); s = finishClassic(s, [1, 2, 3, 4], [6, 6]); expect(s.players[1].hp).toBe(196); expect(s.players[1].statuses.poison).toBe(3);
  });
  it('forcefield blocks normal attacks and counter deals the positive defense difference', () => {
    let s = make('dummy'); s.players[1].modifiers.counter = true; s.players[1].modifiers.forcefield = true;
    s = finishClassic(s, [1, 1, 1], [6, 6]); expect(s.players[1].hp).toBe(200); expect(s.players[0].hp).toBe(191);
  });
  it('destiny is compulsory and a prismatic roll consumes a serialized charge', () => {
    let s = make(); s.players[0].prismaticId = '264404'; s.players[0].prismaticUses = 2;
    s = cmd(s, { type: 'prismatic', playerId: 'a' }); expect(s.players[0].prismaticUses).toBe(1);
    const forced = s.players[0].dice.find(d => d.forced)!; expect(forced).toBeTruthy();
    s = choose(s, 'a', [4, 4]); expect(applyCommand(s, { type: 'confirm', playerId: 'a' }).error).toMatch('命定');
    expect(applyCommand(s, { type: 'prismatic', playerId: 'a' }).error).toBeTruthy();
  });
  it('permits Evanescia to select one die and preview combo plus seven-point penetration', () => {
    let s = make('264027'); expect(getLegalActions(s, 'a').minDice).toBe(1); expect(getLegalActions(s, 'a').maxDice).toBeGreaterThan(3);
    s = choose(s, 'a', [6]); expect(getPlayerPreview(s, 'a').effects).toEqual(expect.arrayContaining(['连击', '穿透7防御']));
  });
  it('keeps newly applied Sunday thorns until the next settlement', () => {
    let s = make('dummy'); s.players[1].cardId = '264030'; s.players[1].maxHp = s.players[1].hp = 200;
    s = finishClassic(s, [6, 6, 6], [1, 1]); expect(s.players[0].statuses.thorns).toBe(5); expect(s.players[1].statuses.thorns).toBe(5);
    // Sunday attacks with four unique values, transferring his five retained stacks.
    s.players[1].attackLevel = 4; s = choose(s, 'b', [1, 2, 3, 4]); s = cmd(s, { type: 'confirm', playerId: 'b' }); s = choose(s, 'a', [6, 6]); s = cmd(s, { type: 'confirm', playerId: 'a' });
    expect(s.players[0].hp).toBe(190); expect(s.players[0].statuses.thorns).toBe(0);
  });
  it('stops pathological battles as an explicit draw rather than favoring either seat', () => {
    let s = createMatch({ mode: 'classic', catalog, maxTurns: 1, weather: 'off', players: [{ id: 'a', name: 'A', cardId: 'dummy' }, { id: 'b', name: 'B', cardId: 'dummy' }] }, 2);
    s = finishClassic(s, [1, 1, 1], [6, 6]); expect(s.phase).toBe('finished'); expect(s.winner).toBeNull(); expect(s.reason).toContain('和棋');
  });
  it('preview is pure and never advances the random stream or mutates status', () => {
    let s = make('264021'); s = choose(s, 'a', [1, 1, 3, 4]); const snapshot = structuredClone(s);
    getPlayerPreview(s, 'a'); getPlayerPreview(s, 'b'); expect(s).toEqual(snapshot);
  });
});

describe('co-op phase synchronization and atomic exchanges', () => {
  function enterSwap(): GameState {
    let s = make('dummy', 'coop'); s = cmd(s, { type: 'leaveTactics', playerId: 'a' }); s = cmd(s, { type: 'leaveTactics', playerId: 'ally' });
    expect(getLegalActions(s, 'ally').canSelect).toBe(true);
    s = choose(s, 'a', [2, 3, 4]); s = choose(s, 'ally', [3, 4, 5]);
    s = cmd(s, { type: 'confirm', playerId: 'a' }); s = cmd(s, { type: 'confirm', playerId: 'ally' }); expect(s.phase).toBe('swap'); return s;
  }
  it('builds shared pool from both unselected dice and rejects stale swap commands', () => {
    let s = enterSwap(); expect(s.swapPool).toHaveLength(4); const own = s.players[0].selectedIds[0], pool = s.swapPool[0].id;
    const c: GameCommand = { type: 'swap', playerId: 'a', ownDieId: own, poolDieId: pool }; s = cmd(s, c); expect(s.players[0].selectedIds).toContain(pool); expect(s.swapPool.some(d => d.id === own)).toBe(true);
    const retry = applyCommand(s, c); expect(retry.error).toBeTruthy(); expect(retry.state).toBe(s);
    const ids = [...s.players.filter(p => p.side === 0).flatMap(p => p.dice), ...s.swapPool].map(d => d.id); expect(new Set(ids).size).toBe(ids.length);
  });
  it('waits for both swap confirmations before activating the boss', () => {
    let s = enterSwap(); s = cmd(s, { type: 'confirm', playerId: 'a' }); expect(s.phase).toBe('swap');
    expect(getLegalActions(s, 'a').canSwap).toBe(false); s = cmd(s, { type: 'confirm', playerId: 'ally' }); expect(s.phase).toBe('roll'); expect(s.activePlayerId).toBe('b');
    s = choose(s, 'b', [6, 6]); s = cmd(s, { type: 'confirm', playerId: 'b' }); expect(s.turn).toBe(2); expect(s.attackingSide).toBe(1);
  });
  it('enforces tactics affordability, phase restriction and three-card hand cap', () => {
    let s = make('dummy', 'coop'); const p = s.players[0]; p.tacticPoints = 100; p.offers = ['42001', '42002', '42003'];
    s = cmd(s, { type: 'buyTactic', playerId: 'a', offerIndex: 0 }); expect(s.players[0].tacticPoints).toBe(98);
    expect(applyCommand(s, { type: 'useTactic', playerId: 'a', handIndex: 0 }).error).toBeTruthy();
    s = cmd(s, { type: 'buyTactic', playerId: 'a', offerIndex: 1 }); s = cmd(s, { type: 'buyTactic', playerId: 'a', offerIndex: 2 });
    s.players[0].offers[0] = '42001'; expect(applyCommand(s, { type: 'buyTactic', playerId: 'a', offerIndex: 0 }).error).toMatch('3');
  });
  it('consumes shared lives and preserves 1 HP when a player falls', () => {
    let s = make('264031', 'coop'); s = cmd(s, { type: 'leaveTactics', playerId: 'a' }); s = cmd(s, { type: 'leaveTactics', playerId: 'ally' });
    s.players[0].hp = 2; const die = s.players[0].dice[0].id;
    s = cmd(s, { type: 'reroll', playerId: 'a', diceIds: [die] }); expect(s.sharedLives).toBe(2); expect(s.players[0].hp).toBe(1);
    s = cmd(s, { type: 'reroll', playerId: 'a', diceIds: [die] }); expect(s.sharedLives).toBe(1);
    s = cmd(s, { type: 'reroll', playerId: 'a', diceIds: [die] }); expect(s.phase).toBe('finished'); expect(s.winner).toBe(1);
  });
  it('auto-creates the AI boss from two allies and obeys the first campaign tactics lock', () => {
    const s = createMatch({ mode: 'coop', coopStageId: '1001', players: [{ id: 'a', name: 'A', cardId: '264014' }, { id: 'ally', name: 'B', cardId: '264026' }], bossPhases: [{ cardId: '20501' }, { cardId: '20502' }] }, 8);
    expect(s.players).toHaveLength(3); expect(s.players[2].id).toBe('boss'); expect(s.players[2].isAI).toBe(true); expect(s.phase).toBe('roll'); expect(s.players[0].tacticPoints).toBe(2);
  });
  it('caps shop refreshes at the official one refresh per tactics segment', () => {
    let s = make('dummy', 'coop'); s.players[0].tacticPoints = 20;
    s = cmd(s, { type: 'refreshTactics', playerId: 'a' }); expect(s.players[0].tacticPoints).toBe(19);
    expect(applyCommand(s, { type: 'refreshTactics', playerId: 'a' }).error).toContain('一次');
  });
});

describe('AI liveness and coverage', () => {
  function simulate(config: MatchConfig, seed: number, limit = 1800) {
    let s = createMatch(config, seed);
    for (let i = 0; i < limit && s.phase !== 'finished'; i++) {
      const c = chooseAiCommand(s); expect(c, `AI stuck turn ${s.turn} phase ${s.phase} card ${s.players[0].cardId}`).not.toBeNull();
      const result = applyCommand(s, c!); expect(result.error, JSON.stringify(c)).toBeUndefined(); s = result.state;
      for (const p of s.players) expect(Number.isFinite(p.hp) && Number.isFinite(p.rerolls)).toBe(true);
    }
    expect(s.phase, `simulation stalled ${s.players[0].cardId}/${s.players.at(-1)?.cardId}`).toBe('finished'); return s;
  }
  it('finishes seeded matches for all 37 collectible characters', () => {
    for (const [i, c] of cards.entries()) simulate({ mode: 'classic', maxTurns: 40, players: [{ id: 'a', name: c.name, cardId: c.id, isAI: true }, { id: 'b', name: '流萤', cardId: '264014', isAI: true }] }, i + 5);
  }, 90_000);
  it('completes every co-op boss variant and phase transition without deadlocks', () => {
    const bosses = bossCards.filter(c => c.id.startsWith('20'));
    for (const [i, b] of bosses.entries()) simulate({ mode: 'coop', maxTurns: 20, players: [{ id: 'a', name: '流萤', cardId: '264014', isAI: true }, { id: 'ally', name: '丹恒', cardId: '264020', isAI: true }, { id: 'boss', name: b.name, cardId: b.id, isAI: true }], bossPhases: [{ cardId: b.id, hp: 15 }, { cardId: b.id, hp: 20 }] }, i + 200);
  }, 90_000);
});
