import { describe, expect, it } from 'vitest';
import { cards, prismaticDice } from '../src/data';
import { createPartyRoster, normalizePartyLoadout } from '../src/lib/partyLobby';
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
});
