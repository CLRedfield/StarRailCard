import { describe, expect, it } from 'vitest';
import { cards, prismaticDice } from '../src/data';
import { createPartyRoster, getDraftPool, normalizeDraftLoadout, normalizePartyLoadout } from '../src/lib/partyLobby';
import { createPartyMatch } from '../src/game/party';
import { isPartyState, partyStateCodec } from '../src/net/partySync';

describe('party preparation and persisted snapshots', () => {
  it('fills missing seats without replacing humans and supports odd-sized raids', () => {
    const humans = [{ id: 'alice', name: 'Alice', loadout: { cardId: cards[0].id } }, { id: 'bob', name: 'Bob', loadout: { cardId: cards[1].id } }];
    const roster = createPartyRoster('raid', humans, 7, undefined, 3);
    expect(roster).toHaveLength(7);
    expect(roster.slice(0, 2).map(p => p.id)).toEqual(['alice', 'bob']);
    expect(roster.slice(2).every(p => p.isAI)).toBe(true);
    expect(new Set(roster.map(p => p.id)).size).toBe(7);
    expect(() => createPartyRoster('duos', humans, 5)).toThrow();
    expect(() => createPartyRoster('raid', [...humans, ...humans], 4)).toThrow();
  });

  it('rotates the chosen boss without changing a human player ID or loadout', () => {
    const humans = [{ id: 'alice', name: 'Alice', loadout: { cardId: cards[0].id } }, { id: 'bob', name: 'Bob', loadout: { cardId: cards[1].id } }];
    expect(createPartyRoster('overlord', humans, 4, 'bob')[0]).toMatchObject({ id: 'bob', cardId: cards[1].id });
    const withAiBoss = createPartyRoster('overlord', humans, 4, 'ai');
    expect(withAiBoss[0].isAI).toBe(true);
    expect(withAiBoss.find(p => p.id === 'alice')?.isAI).toBeUndefined();
    expect(() => createPartyRoster('overlord', humans, 4, 'missing')).toThrow();
  });

  it('rejects NPC loadouts and keeps original default and equipped legal prismatic dice', () => {
    expect(cards.some(c => c.id === normalizePartyLoadout({ cardId: '20101' }).cardId)).toBe(true);
    const character = cards.find(c => c.prismaticId)!;
    expect(normalizePartyLoadout({ cardId: character.id }).prismaticId).toBe(character.prismaticId);
    expect(normalizePartyLoadout({ cardId: character.id, prismaticId: prismaticDice[0].id }).prismaticId).toBe(prismaticDice[0].id);
  });

  it('rejects malformed saved state without throwing and protects the shared catalog in deltas', () => {
    const state = createPartyMatch({ mode: 'raid', players: createPartyRoster('raid', [{ id: 'human', name: 'Human' }], 4) }, 30);
    for (const invalid of [null, {}, { ...state, players: [null, null, null, null] }, { ...state, players: state.players.map(p => ({ ...p, upgrades: null })) }, { ...state, targets: [null] }, { ...state, catalog: null }]) {
      expect(() => isPartyState(invalid)).not.toThrow();
      expect(isPartyState(invalid)).toBe(false);
    }
    expect(isPartyState(JSON.parse(JSON.stringify(state)))).toBe(true);
    expect(() => partyStateCodec.decode(state, { catalog: {} })).toThrow();
  });

  it('supports blind-reveal random_human and random_any boss selection in overlord', () => {
    const humans = [
      { id: 'alice', name: 'Alice', loadout: { cardId: cards[0].id } },
      { id: 'bob', name: 'Bob', loadout: { cardId: cards[1].id } },
    ];
    const humanBosses = new Set(Array.from({ length: 6 }, (_, v) => createPartyRoster('overlord', humans, 5, 'random_human', v)[0].id));
    expect(humanBosses).toEqual(new Set(['alice', 'bob']));

    const anyBosses = Array.from({ length: 5 }, (_, v) => createPartyRoster('overlord', humans, 5, 'random_any', v)[0]);
    expect(anyBosses.some(p => !p.isAI)).toBe(true);
    expect(anyBosses.some(p => p.isAI)).toBe(true);
  });

  it('deals deterministic 3-card + 3-dice blind-box draft pools and enforces them in roster creation', () => {
    const poolA = getDraftPool('ROOM1:42', 'alice');
    const poolB = getDraftPool('ROOM1:42', 'bob');
    expect(poolA.cardIds).toHaveLength(3);
    expect(new Set(poolA.cardIds).size).toBe(3);
    expect(poolA).toEqual(getDraftPool('ROOM1:42', 'alice'));
    expect(poolA.cardIds).not.toEqual(poolB.cardIds);

    const pickedCard = cards.find(c => c.id === poolA.cardIds[1])!;
    const cardPool = getDraftPool('ROOM1:42', 'alice', pickedCard.id);
    if (pickedCard.prismaticId) {
      expect(cardPool.prismaticIds).toHaveLength(3);
      expect(cardPool.prismaticIds[0]).toBe(pickedCard.prismaticId);
      expect(new Set(cardPool.prismaticIds).size).toBe(3);
    }

    const illegalCard = cards.find(c => !poolA.cardIds.includes(c.id))!;
    const coerced = normalizeDraftLoadout({ cardId: illegalCard.id, prismaticId: 'invalid-die', gild: 2 }, 'ROOM1:42', 'alice');
    expect(poolA.cardIds).toContain(coerced.cardId);
    expect(coerced.gild).toBe(2);

    const draftedRoster = createPartyRoster(
      'treasure',
      [{ id: 'alice', name: 'Alice', loadout: { cardId: illegalCard.id } }],
      4,
      undefined,
      9,
      { draftSeed: 'ROOM1:42' },
    );
    expect(poolA.cardIds).toContain(draftedRoster[0].cardId);
    expect(getDraftPool('ROOM1:42', 'party-bot-1').cardIds).toContain(draftedRoster[1].cardId);
  });
});
