import { describe, expect, it } from 'vitest';
import { cards, shopGoods, classicCampaigns, coopStages, giftChallenges, streetChallenges, prismaticDice } from '../src/data';
import { buyGood, createStarterProfile, gildCard, levelForXp, maxGildLevel, rewardVictory } from '../src/lib/progression';
import { isProfile, migrateProfile, newProfile, WEB_STARTER_COINS } from '../src/lib/storage';

describe('released progression and shop', () => {
  it('defaults to light theme and accepts legacy saves while rejecting unknown themes', () => {
    const profile = newProfile('264000', '');
    expect(profile.settings.theme).toBe('light');
    expect(isProfile(profile)).toBe(true);
    const legacy = structuredClone(profile);
    delete legacy.settings.theme;
    expect(isProfile(legacy)).toBe(true);
    expect(isProfile({ ...profile, settings: { ...profile.settings, theme: 'dark' } })).toBe(true);
    expect(isProfile({ ...profile, settings: { ...profile.settings, theme: 'unknown' } })).toBe(false);
  });
  it('keeps the original Sparkicle gift and grants only six web welcome coins', () => {
    const p = createStarterProfile();
    expect(p.ownedCards).toEqual(['264000']);
    expect(p.coins).toBe(WEB_STARTER_COINS);
    expect(p.xp).toBe(0);
    expect(p).toMatchObject({ starterSupplyVersion: 1, victoryCoins: 0, paintCoins: 0, dust: 0, completed: [] });
    expect(newProfile('264000', '')).toMatchObject({ coins: WEB_STARTER_COINS, starterSupplyVersion: 1 });
  });
  it('migrates old saves once without resetting balances, inventory or progress', () => {
    const legacy = { ...createStarterProfile(), coins: 17, dust: 120, victoryCoins: 4, paintCoins: 3, xp: 250, wins: 8, completed: ['classic-1'], gild: { '264000': 1 } };
    delete legacy.starterSupplyVersion;
    const before = structuredClone(legacy);
    const migrated = migrateProfile(legacy);
    expect(migrated).toEqual({ ...before, coins: 23, starterSupplyVersion: 1 });
    expect(legacy).toEqual(before);
    expect(migrateProfile(migrated)).toBe(migrated);
  });
  it('upgrades legacy un-awakened selectedDice IDs without re-granting starter coins', () => {
    for (const [legacyId, trueId] of [['264519', '264419'], ['264523', '264424'], ['264524', '264423']] as const) {
      const saved = { ...createStarterProfile(), selectedCard: '264026', selectedDice: legacyId };
      const migrated = migrateProfile(saved);
      expect(migrated.selectedDice).toBe(trueId);
      expect(migrated.coins).toBe(saved.coins);
      expect(migrateProfile(migrated)).toBe(migrated);
    }
  });
  it('keeps the one-time marker across exported JSON and validates imported markers', () => {
    const exported = JSON.parse(JSON.stringify(createStarterProfile()));
    expect(isProfile(exported)).toBe(true);
    expect(migrateProfile(exported).coins).toBe(WEB_STARTER_COINS);
    for (const marker of [0, 2, true, '1', null]) expect(isProfile({ ...exported, starterSupplyVersion: marker })).toBe(false);
    const legacy = { ...exported, coins: 0 };
    delete legacy.starterSupplyVersion;
    expect(isProfile(legacy)).toBe(true);
    expect(migrateProfile(legacy)).toMatchObject({ coins: WEB_STARTER_COINS, starterSupplyVersion: 1 });
  });
  it('can buy a three-card starter set without granting levels or unlocking later goods', () => {
    let profile = createStarterProfile();
    for (const id of ['1111', '1106', '1101']) {
      const result = buyGood(profile, id);
      expect(result.error).toBeUndefined();
      profile = result.profile;
    }
    expect(profile.coins).toBe(0);
    expect(profile.ownedCards).toHaveLength(4);
    expect(profile).toMatchObject({ xp: 0, victoryCoins: 0, paintCoins: 0, completed: [], ownedDice: [] });
    expect(migrateProfile(profile).coins).toBe(0);
  });
  it('uses exact XP thresholds at the level-ten boundary', () => {
    expect([levelForXp(49), levelForXp(50), levelForXp(500), levelForXp(599), levelForXp(600)]).toEqual([0, 1, 10, 10, 11]);
  });
  it('grants a first clear and all crossed level rewards exactly once', () => {
    const original = createStarterProfile();
    const won = rewardVictory(original, 'classic-1');
    expect(won).toMatchObject({ xp: 100, coins: WEB_STARTER_COINS + 2, victoryCoins: 1, dust: 100, wins: 1 });
    expect(won.completed).toEqual(['classic-1']);
    const repeated = rewardVictory(won, 'classic-1');
    expect(repeated.xp).toBe(won.xp);
    expect(repeated.coins).toBe(won.coins);
    expect(repeated.victoryCoins).toBe(won.victoryCoins);
    expect(original.completed).toEqual([]);
  });
  it('does not award story rewards in free play', () => {
    const profile = createStarterProfile();
    const won = rewardVictory(profile, 'free', '8014001');
    expect(won.coins).toBe(profile.coins);
    expect(won.xp + won.victoryCoins + won.paintCoins + won.dust).toBe(0);
  });
  it('uses the correct currency and rejects duplicate purchases without mutation', () => {
    const original = { ...createStarterProfile(), coins: 2 };
    const result = buyGood(original, '1101');
    expect(result.error).toBeUndefined();
    expect(result.profile.coins).toBe(1);
    expect(result.profile.ownedCards).toContain('264001');
    const duplicate = buyGood(result.profile, '1101');
    expect(duplicate.error).toBeTruthy();
    expect(duplicate.profile.coins).toBe(1);
    expect(original.coins).toBe(2);
  });
  it('enforces both experience and story prerequisites', () => {
    const good = shopGoods.find(g => g.unlockLevel > 0 && g.unlockChallenges.length > 0)!;
    const rich = { ...createStarterProfile(), coins: 100, victoryCoins: 100, paintCoins: 100 };
    expect(buyGood(rich, good.id).error).toBeTruthy();
    expect(buyGood({ ...rich, xp: 5000 }, good.id).error).toBeTruthy();
    expect(buyGood({ ...rich, xp: 5000, completed: good.unlockChallenges }, good.id).error).toBeUndefined();
  });
  it('keeps foil cosmetic and caps tiers by original card rarity', () => {
    const originalCard = structuredClone(cards.find(c => c.id === '264000'));
    const start = { ...createStarterProfile(), dust: 300 };
    const gold = gildCard(start, '264000');
    expect(gold.profile.gild['264000']).toBe(1);
    expect(gold.profile.dust).toBe(240);
    expect(gildCard(gold.profile, '264000').error).toBeTruthy();
    expect(cards.find(c => c.id === '264000')).toEqual(originalCard);
  });
  it('unlocks the original level-ten reward card when crossing its threshold', () => {
    const p = { ...createStarterProfile(), xp: 450 };
    expect(rewardVictory(p, 'classic-1').ownedCards).toContain('264021');
  });
  it('requires the declared milestone for gift and street challenges', () => {
    const initial = createStarterProfile();
    const locked = rewardVictory(initial, 'gift-scott');
    expect(locked.ownedCards).not.toContain('264011');
    expect(locked.completed).not.toContain('gift-scott');
    expect(rewardVictory(initial, streetChallenges[0].id).coins).toBe(initial.coins);
    const unlocked = rewardVictory(rewardVictory(initial, 'classic-2'), 'gift-scott');
    expect(unlocked.ownedCards).toContain('264011');
    expect(unlocked.completed).toContain('gift-scott');
  });
  it('makes all 37 cards, 25 true dice and every foil tier obtainable using actual first-clear rewards', () => {
    let profile = createStarterProfile();
    for (const campaign of classicCampaigns) profile = rewardVictory(profile, `classic-${campaign.id}`);
    for (const stage of coopStages.filter(s => s.difficulty === 'story')) profile = rewardVictory(profile, `coop-${stage.id}`);
    for (const gift of giftChallenges) profile = rewardVictory(profile, gift.id);
    for (const street of streetChallenges) profile = rewardVictory(profile, street.id);
    expect(profile.xp).toBe(2700);
    expect(levelForXp(profile.xp)).toBe(25);
    for (const good of shopGoods) {
      const result = buyGood(profile, good.id);
      expect(result.error, `Cannot acquire ${good.name} (${good.id})`).toBeUndefined();
      profile = result.profile;
    }
    expect([...profile.ownedCards].sort()).toEqual(cards.map(c => c.id).sort());
    expect([...profile.ownedDice].sort()).toEqual(prismaticDice.map(d => d.id).sort());
    for (const card of cards) {
      for (let tier = 0; tier < maxGildLevel(card.id); tier++) {
        const result = gildCard(profile, card.id);
        expect(result.error, `Cannot gild ${card.name} at tier ${tier}`).toBeUndefined();
        profile = result.profile;
      }
      expect(profile.gild[card.id]).toBe(maxGildLevel(card.id));
    }
    expect(Math.min(profile.coins, profile.victoryCoins, profile.paintCoins, profile.dust)).toBeGreaterThanOrEqual(0);
    const repeated = rewardVictory(profile, streetChallenges[0].id);
    expect(repeated.coins).toBe(profile.coins);
    expect(repeated.dust).toBe(profile.dust);
  });
});
