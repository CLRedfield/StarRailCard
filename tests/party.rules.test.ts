import { describe, expect, it } from 'vitest';
import { defaultCatalog } from '../src/game/catalog';
import { applyPartyCommand, choosePartyAiCommand, createPartyMatch, getPartyLegalActions, getPartyPreview } from '../src/game/party';
import type { PartyCommand, PartyMode, PartyState } from '../src/game/partyTypes';

const catalog = defaultCatalog();
catalog.cards.push({ id: 'future-character', name: '未来角色', hp: 80, attack: 3, defense: 2, dice: [6, 6, 6, 6, 6] });
function make(mode: PartyMode = 'raid', count = 4, cardId = 'future-character', seed = 17) {
  return createPartyMatch({ mode, catalog, players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `玩家${i}`, cardId, isAI: true })) }, seed);
}
function command(s: PartyState, c: PartyCommand) { const result = applyPartyCommand(s, c); expect(result.error, JSON.stringify(c)).toBeUndefined(); return result.state; }
function finishRound(s: PartyState) {
  const round = s.round;
  for (let n = 0; n < 160 && s.phase === 'planning' && s.round === round; n++) {
    const p = s.players.find(p => !p.confirmed)!; const cmd = choosePartyAiCommand(s, p.id);
    expect(cmd, `AI stalled for ${p.id}`).not.toBeNull(); s = command(s, cmd!);
  }
  expect(s.phase).not.toBe('planning'); return s;
}
function confirmFixed(s: PartyState, playerId: string, values: number[]) {
  const p = s.players.find(p => p.id === playerId)!; values.forEach((v, i) => p.dice[i].value = v);
  return command(s, { type: 'confirm', playerId, diceIds: p.dice.slice(0, values.length).map(d => d.id) });
}

describe('party modes share character combat with independent objectives', () => {
  it.each(['treasure', 'raid', 'duos', 'overlord'] as const)('%s completes deterministically at 4 and 8 seats', mode => {
    for (const count of [4, 8]) {
      let s = make(mode, count), replay = make(mode, count); let commands = 0;
      while (s.phase !== 'finished' && commands++ < 1500) {
        const p = s.players.find(p => getPartyLegalActions(s, p.id).canAct)!;
        expect(p, `${mode} deadlocked in ${s.phase}`).toBeTruthy();
        const c = choosePartyAiCommand(s, p.id); expect(c).toBeTruthy();
        s = command(s, c!); replay = command(replay, c!);
      }
      expect(s.phase).toBe('finished'); expect(s).toEqual(replay); expect(s.round).toBeLessThanOrEqual(s.maxRounds);
      expect(s.reason).toBeTruthy(); expect(s.players.every(p => Number.isFinite(p.hp))).toBe(true);
    }
  }, 30000);

  it('keeps all 6 duos players involved across rotating matches and a scored bye', () => {
    let s = make('duos', 6); s = finishRound(s);
    expect(new Set(s.results.map(r => r.playerId)).size).toBe(6);
    expect(s.results.some(r => r.text.includes('遗迹'))).toBe(true);
    const first = s.targets.map(t => t.id);
    for (const p of s.players) s = command(s, { type: 'ready', playerId: p.id });
    expect(s.targets.map(t => t.id)).not.toEqual(first); expect(s.round).toBe(2);
  });

  it('uses edited catalog stats and accepts new characters without a mode whitelist', () => {
    const modified = structuredClone(catalog); const c = modified.cards.find(c => c.id === 'future-character')!; c.attack = 5; c.hp = 117; c.dice = [8, 8, 8, 8, 8, 8];
    const s = createPartyMatch({ mode: 'raid', catalog: modified, players: make().players.map(p => ({ id: p.id, name: p.name, cardId: p.cardId })) }, 7);
    expect(s.players[0]).toMatchObject({ hp: 117, maxHp: 117, attackLevel: 5 });
    expect(getPartyLegalActions(s, 'p0').requiredDice).toBe(5);
    expect(s.players[0].dice.every(d => d.sides === 8)).toBe(true); expect(catalog.cards.find(c => c.id === 'future-character')!.hp).toBe(80);
  });

  it('does not mutate authority or consume randomness for previews and invalid commands', () => {
    const s = make('raid'); const snapshot = structuredClone(s);
    for (const p of s.players) { getPartyPreview(s, p.id); getPartyLegalActions(s, p.id); choosePartyAiCommand(s, p.id); }
    expect(s).toEqual(snapshot);
    const bad = [{ type: 'confirm', playerId: 'p0', diceIds: ['foreign'] }, { type: 'plan', playerId: 'p0', targetId: 'fake', stance: 'assault' }, { type: 'bossMove', playerId: 'p0', move: 'sweep' }, { type: 'ready', playerId: 'p0' }] as PartyCommand[];
    for (const c of bad) { const r = applyPartyCommand(s, c); expect(r.error).toBeTruthy(); expect(r.state).toBe(s); }
  });

  it('rejects role changes after consuming role-dependent resources', () => {
    let s = make('treasure'); const p = s.players[0]; s = command(s, { type: 'reroll', playerId: p.id, diceIds: [p.dice[0].id] });
    expect(applyPartyCommand(s, { type: 'plan', playerId: p.id, targetId: 'bastion', stance: 'guard' }).error).toContain('不能切换攻守');
    expect(applyPartyCommand(s, { type: 'plan', playerId: p.id, targetId: 'puzzle', stance: 'assault' }).error).toBeUndefined();
  });

  it('atomically exchanges actual dice with an available teammate once per round', () => {
    let s = make('duos'); const [a, b] = s.players, own = a.dice[0], incoming = b.dice[0];
    s = command(s, { type: 'exchange', playerId: a.id, targetPlayerId: b.id, ownDieId: own.id, targetDieId: incoming.id });
    expect(s.players[0].dice[0]).toEqual({ ...incoming, ownerId: a.id }); expect(s.players[1].dice[0]).toEqual({ ...own, ownerId: b.id });
    expect(s.players[1].exchangedThisRound).toBe(true);
    expect(applyPartyCommand(s, { type: 'exchange', playerId: a.id, targetPlayerId: b.id, ownDieId: incoming.id, targetDieId: own.id }).error).toBeTruthy();
    expect(new Set(s.players.flatMap(p => p.dice.map(d => d.id))).size).toBe(s.players.reduce((sum, p) => sum + p.dice.length, 0));
  });

  it('preserves forced dice and disallows touching already confirmed players', () => {
    let s = make('raid'); s.players[0].dice[0].forced = true;
    expect(applyPartyCommand(s, { type: 'confirm', playerId: 'p0', diceIds: s.players[0].dice.slice(1, 4).map(d => d.id) }).error).toContain('命定');
    expect(applyPartyCommand(s, { type: 'exchange', playerId: 'p0', targetPlayerId: 'p1', ownDieId: s.players[0].dice[0].id, targetDieId: s.players[1].dice[0].id }).error).toBeTruthy();
    s = confirmFixed(s, 'p1', [6, 6, 6]);
    expect(applyPartyCommand(s, { type: 'exchange', playerId: 'p0', targetPlayerId: 'p1', ownDieId: s.players[0].dice[1].id, targetDieId: s.players[1].dice[0].id }).error).toBeTruthy();
  });

  it('reuses Acheron pierce and permanent attack growth when challenging an objective', () => {
    let s = make('treasure', 4, '264013'); s.roundRule.kind = 'respite';
    for (const p of s.players) s = command(s, { type: 'plan', playerId: p.id, targetId: 'fire', stance: 'assault' });
    for (const p of s.players) s = confirmFixed(s, p.id, [4, 4]);
    expect(s.players.every(p => p.attackLevel === 3)).toBe(true);
    expect(s.results.every(r => r.damage === 8)).toBe(true);
    expect(s.battleEvents.some(e => e.damageKind === 'attack' && e.amount === 8)).toBe(true);
  });

  it('retains Kafka poison on the challenged objective across rounds', () => {
    let s = make('raid', 4, '264017'); s.roundRule.kind = 'respite';
    for (const p of s.players) s = confirmFixed(s, p.id, [1, 2, 3, 4]);
    expect(s.enemies.core.statuses.poison).toBeGreaterThan(0);
    const layers = s.enemies.core.statuses.poison;
    for (const p of s.players) s = command(s, { type: 'ready', playerId: p.id });
    expect(s.enemies.core.statuses.poison).toBe(layers);
  });

  it('settles refunds and poison exactly once for assault and un-targeted defenders', () => {
    const herta = catalog.cards.find(c => c.name.includes('大黑塔'))!;
    let s = make('raid', 4, herta.id); s.bossMove = 'drain'; s.roundRule.kind = 'respite';
    for (const p of s.players) { p.hp = p.maxHp = 200; p.statuses.poison = 3; }
    s.players[0].hp = 20;
    for (const p of s.players.slice(1)) s = command(s, { type: 'plan', playerId: p.id, targetId: 'core', stance: 'guard' });
    const uses = s.players.map(p => p.prismaticUses);
    for (const p of s.players) s = confirmFixed(s, p.id, Array(getPartyLegalActions(s, p.id).requiredDice).fill(1));
    expect(s.players.map(p => p.prismaticUses)).toEqual(uses.map(n => n + 1));
    expect(s.players.map(p => p.statuses.poison)).toEqual([2, 2, 2, 2]);
    for (const p of s.players) expect(s.battleEvents.filter(e => e.targetId === p.id && e.damageKind === 'poison-tick')).toHaveLength(1);
  });

  it('settles one shared poison tick regardless of how many heroes attack it', () => {
    let s = make('raid', 8); s.bossMove = 'sweep'; s.roundRule.kind = 'respite'; s.enemies.core.statuses.poison = 5;
    for (const p of s.players) s = confirmFixed(s, p.id, [1, 1, 1]);
    expect(s.enemies.core.statuses.poison).toBe(4);
    expect(s.battleEvents.filter(e => e.targetId === s.enemies.core.id && e.damageKind === 'poison-tick')).toHaveLength(1);
  });

  it('restores role preparation completely and losslessly when plans change', () => {
    let s = finishRound(make('raid')); s.players[0].statuses.danGuard = 1; s.players[0].statuses.nextStrength = 7;
    for (const p of s.players) s = command(s, { type: 'ready', playerId: p.id });
    const dice = structuredClone(s.players[0].dice), seed = s.seed;
    expect(s.players[0].modifiers.attack).toBe(7);
    s = command(s, { type: 'plan', playerId: 'p0', targetId: 'core', stance: 'guard' });
    expect(s.players[0].modifiers.counter).toBe(true); expect(s.players[0].statuses.danGuard).toBe(0); expect(s.players[0].statuses.nextStrength).toBe(7);
    expect(s.players[0].defenseLevel).toBe(s.players[0].baseDefense + 3);
    s = command(s, { type: 'plan', playerId: 'p0', targetId: 'core', stance: 'assault' });
    expect(s.players[0].modifiers.counter).toBe(false); expect(s.players[0].statuses.danGuard).toBe(1); expect(s.players[0].modifiers.attack).toBe(7);
    expect(s.players[0].dice).toEqual(dice); expect(s.seed).toBe(seed);
  });

  it('precision rewards only distinct selections, and duo events affect their advertised rules', () => {
    const settle = (mode: PartyMode, event: PartyState['roundRule']['kind'], values: number[]) => {
      let s = make(mode); s.roundRule.kind = event;
      if (mode === 'treasure') for (const p of s.players) s = command(s, { type: 'plan', playerId: p.id, targetId: 'fire', stance: 'assault' });
      for (const p of s.players) { const n = getPartyLegalActions(s, p.id).requiredDice; s = confirmFixed(s, p.id, values.slice(0, n)); }
      return s;
    };
    expect(settle('treasure', 'precision', [6, 6, 6]).results[0].value).toBe(18);
    expect(settle('treasure', 'precision', [6, 5, 4]).results[0].value).toBe(21);
    const base = settle('duos', 'respite', [6, 5, 4]); const precision = settle('duos', 'precision', [6, 5, 4]);
    expect(precision.results[0].value).toBe(base.results[0].value + 6);
    const bounty = settle('duos', 'bounty', [6, 5, 4]);
    expect(bounty.players.reduce((sum, p) => sum + p.score, 0)).toBeGreaterThan(base.players.reduce((sum, p) => sum + p.score, 0));
  });

  it('breaks the shield before core attacks, independent of confirmation order', () => {
    const run = (shieldHp: number) => {
      let s = make('raid'); s.bossMove = 'sweep'; s.roundRule.kind = 'respite'; s.targets.find(t => t.id === 'shield')!.hp = shieldHp;
      s = command(s, { type: 'plan', playerId: 'p0', targetId: 'shield', stance: 'assault' });
      for (const p of s.players.slice(2)) s = command(s, { type: 'plan', playerId: p.id, targetId: 'core', stance: 'guard' });
      for (const id of ['p1', 'p3', 'p2', 'p0']) s = confirmFixed(s, id, Array(getPartyLegalActions(s, id).requiredDice).fill(6));
      return s;
    };
    const broken = run(4), intact = run(100);
    expect(broken.targets.find(t => t.id === 'shield')!.broken).toBe(true);
    expect(broken.results.find(r => r.playerId === 'p1')!.damage).toBe(11);
    expect(intact.results.find(r => r.playerId === 'p1')!.damage).toBe(5);
  });

  it('interrupts the human boss while all guarding heroes still settle once', () => {
    const herta = catalog.cards.find(c => c.name.includes('大黑塔'))!;
    let s = make('overlord', 4, herta.id); s.bossMoves = ['eruption', 'sweep']; s.roundRule.kind = 'respite';
    expect(applyPartyCommand(s, { type: 'bossMove', playerId: 'p1', move: 'eruption' }).error).toBeTruthy();
    expect(applyPartyCommand(s, { type: 'bossMove', playerId: 'p0', move: 'drain' }).error).toBeTruthy();
    s = command(s, { type: 'bossMove', playerId: 'p0', move: 'eruption' });
    s.targets.find(t => t.id === 'charge')!.hp = 1;
    s = command(s, { type: 'plan', playerId: 'p1', targetId: 'charge', stance: 'assault' });
    for (const p of s.players.slice(2)) s = command(s, { type: 'plan', playerId: p.id, targetId: 'core', stance: 'guard' });
    const uses = s.players.map(p => p.prismaticUses);
    for (const p of s.players) s = confirmFixed(s, p.id, Array(getPartyLegalActions(s, p.id).requiredDice).fill(6));
    expect(s.log.some(e => e.text.includes('爆发被全队打断'))).toBe(true);
    expect(s.players.map(p => p.prismaticUses)).toEqual(uses.map(n => n + 1));
    expect(s.battleEvents.filter(e => e.playerId === 'p0' && e.damageKind === 'attack')).toHaveLength(0);
  });

  it('keeps boss health and core bars consistent through healing, poison and next-round preparation', () => {
    let s = make('overlord'); s.players[0].statuses.poison = 4;
    s = finishRound(s); expect(s.phase).toBe('results');
    const check = (state: PartyState) => { const boss = state.players[0], core = state.targets.find(t => t.id === 'core')!; expect(boss.hp).toBe(state.bossHp); expect(core.hp).toBe(state.bossHp); expect(core.maxHp).toBe(state.bossMaxHp); };
    check(s);
    const before = s.bossHp;
    for (const p of s.players) s = command(s, { type: 'ready', playerId: p.id });
    check(s); expect(s.bossHp).toBe(Math.min(s.bossMaxHp, before + (s.roundRule.kind === 'respite' ? 6 : 0)));
    // A phase transition is permanent even if the boss subsequently heals.
    s.bossPhase = 2; s.players[0].hp = s.bossHp = s.bossMaxHp;
    s = finishRound(s);
    if (s.phase === 'results') { for (const p of s.players) s = command(s, { type: 'ready', playerId: p.id }); expect(s.bossPhase).toBe(2); check(s); }
  });

  it('finishes a defeated boss before any between-round healing can revive it', () => {
    let s = make('overlord'); s.bossHp = s.players[0].hp = 1; s.targets.find(t => t.id === 'core')!.hp = 1;
    for (const p of s.players) s = confirmFixed(s, p.id, Array(getPartyLegalActions(s, p.id).requiredDice).fill(6));
    expect(s.phase).toBe('finished'); expect(s.winnerTeamIds).toEqual(['远征队']);
    expect(s.bossHp).toBe(0); expect(s.players[0].hp).toBe(0); expect(s.targets.find(t => t.id === 'core')!.hp).toBe(0);
  });

  it('awards the bounty bonus to a successful six-player bye challenge too', () => {
    const run = (event: PartyState['roundRule']['kind']) => { let s = make('duos', 6); s.roundRule.kind = event; const bye = s.targets.find(t => t.description.includes('轮空'))!;
      for (const p of s.players) { const n = getPartyLegalActions(s, p.id).requiredDice; s = confirmFixed(s, p.id, Array(n).fill(8)); }
      return s.results.filter(r => r.targetId === bye.id);
    };
    const base = run('respite'), bounty = run('bounty'); expect(base).toHaveLength(2);
    expect(bounty.map(r => r.score)).toEqual(base.map(r => r.score + 2));
  });

  it('only resolves after all players confirm, and only advances after all ready', () => {
    let s = make('treasure');
    for (const p of s.players.slice(0, 3)) {
      const legal = getPartyLegalActions(s, p.id); s = confirmFixed(s, p.id, Array(legal.requiredDice).fill(6)); expect(s.phase).toBe('planning');
    }
    s = confirmFixed(s, 'p3', [6, 6, 6]); expect(s.phase).toBe('results');
    const currentRound = s.round;
    s = command(s, { type: 'upgrade', playerId: 'p0', upgrade: 'power' });
    expect(s.players[0].supplies).toBe(0); expect(s.players[0].upgrades.power).toBe(1);
    for (const p of s.players.slice(0, 3)) s = command(s, { type: 'ready', playerId: p.id });
    expect(s.round).toBe(currentRound);
    s = command(s, { type: 'ready', playerId: 'p3' }); expect(s.round).toBe(currentRound + 1); expect(s.players[0].modifiers.attack).toBe(2);
  });

  it('rejects unsupported player counts and never drops a player on defeat', () => {
    expect(() => make('duos', 5)).toThrow(); expect(() => make('raid', 9)).toThrow();
    let s = make('treasure'); for (const p of s.players) p.hp = 1;
    s = finishRound(s); expect(s.players).toHaveLength(4); expect(s.players.every(p => p.hp > 0)).toBe(true);
  });

  it('finishes with the entire playable roster and varied teams, including poison and counter specialists', () => {
    const playable = catalog.cards.filter(c => !/^20[1-6]0[1-4]$/.test(c.id) && c.id !== 'future-character');
    const outcomes: Record<string, number> = {};
    for (const mode of ['raid', 'overlord', 'treasure', 'duos'] as const) {
      for (let offset = 0; offset < playable.length; offset += 4) {
        let s = createPartyMatch({ mode, catalog, players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `玩家${i}`, cardId: playable[(offset + i) % playable.length].id, isAI: true })) }, 100 + offset);
        let count = 0;
        while (s.phase !== 'finished' && count++ < 1200) {
          const actor = s.players.find(p => getPartyLegalActions(s, p.id).canAct); expect(actor).toBeTruthy();
          const cmd = choosePartyAiCommand(s, actor!.id); expect(cmd).toBeTruthy(); s = command(s, cmd!);
        }
        expect(s.phase, `${mode}: ${s.players.map(p => p.cardId).join(',')}`).toBe('finished');
        const key = `${mode}:${s.winnerTeamIds.join(',') || 'defeat'}`; outcomes[key] = (outcomes[key] ?? 0) + 1;
      }
    }
    console.info('Party roster simulation', outcomes);
  }, 30000);
});
