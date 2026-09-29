import { cards, cardById, diceById, classicCampaigns, classicStages, coopStages, giftChallenges, streetChallenges, progression, rewards, shopGoods } from '../data';
import type { Currency, RewardDefinition, ShopGoodsDefinition } from '../data';
import type { Profile } from './storage';
import { migrateProfile } from './storage';

export const currencyNames: Record<Currency, string> = { coins: '战力币', victoryCoins: '决胜战力币', paintCoins: '绘彩战力币', dust: '战力粉尘' };
export const levelForXp = (xp: number) => progression.levels.filter(level => xp >= level.xpTotal).length;

function cloneProfile(profile: Profile): Profile {
  return { ...profile, ownedCards: [...profile.ownedCards], ownedDice: [...profile.ownedDice], gild: { ...profile.gild }, completed: [...profile.completed], settings: { ...profile.settings } };
}
function applyReward(profile: Profile, reward: RewardDefinition): void {
  for (const key of ['coins', 'victoryCoins', 'paintCoins', 'dust', 'xp'] as const) profile[key] += reward[key] || 0;
  profile.ownedCards = [...new Set([...profile.ownedCards, ...reward.cardIds.filter(id => cards.some(c => c.id === id))])];
  profile.ownedDice = [...new Set([...profile.ownedDice, ...reward.diceIds.filter(id => !!diceById[id])])];
}

export function createStarterProfile(name = '开拓者'): Profile {
  const profile: Profile = { version: 1, name: name.trim().slice(0, 32) || '开拓者', xp: 0, wins: 0, ownedCards: [], ownedDice: [], gild: {}, completed: [], coins: 0, victoryCoins: 0, paintCoins: 0, dust: 0, selectedCard: '264000', selectedDice: '', settings: { music: .25, effects: .5, reducedMotion: false, quality: 'high', theme: 'light' } };
  applyReward(profile, rewards[progression.starterRewardId]);
  return migrateProfile(profile);
}

function rewardForChallenge(challengeId: string): string | undefined {
  if (challengeId.startsWith('classic-')) {
    const campaign = classicCampaigns.find(c => c.id === challengeId.slice(8));
    return classicStages.find(s => s.id === campaign?.stageIds[0])?.rewardId;
  }
  if (challengeId.startsWith('coop-')) return coopStages.find(s => s.id === challengeId.slice(5))?.rewardId;
  if (challengeId.startsWith('gift-')) return giftChallenges.find(s => s.id === challengeId)?.rewardId;
  if (challengeId.startsWith('street-')) return streetChallenges.find(s => s.id === challengeId)?.rewardId;
  return undefined;
}

/** First-clear payouts and account-level rewards are idempotent. Free play is unranked. */
export function rewardVictory(profile: Profile, challengeId: string, rewardId?: string): Profile {
  const next = cloneProfile(profile);
  next.wins++;
  if (!challengeId || next.completed.includes(challengeId)) return next;
  const extraChallenge = [...giftChallenges, ...streetChallenges].find(c => c.id === challengeId);
  if (extraChallenge && !next.completed.includes(extraChallenge.unlockChallengeId)) return next;
  const recognized = classicCampaigns.some(c => challengeId === `classic-${c.id}`) || coopStages.some(c => challengeId === `coop-${c.id}`) || !!extraChallenge;
  if (!recognized) return next;
  next.completed.push(challengeId);
  const reward = rewards[rewardId || rewardForChallenge(challengeId) || ''];
  if (!reward) return next;
  const previousLevel = levelForXp(next.xp);
  applyReward(next, reward);
  const newLevel = levelForXp(next.xp);
  for (const level of progression.levels) {
    if (level.level > previousLevel && level.level <= newLevel) applyReward(next, level.reward);
  }
  return next;
}

export function goodUnavailableReason(profile: Profile, good: ShopGoodsDefinition): string | undefined {
  const owned = good.type === 'card' ? profile.ownedCards : profile.ownedDice;
  if (owned.includes(good.itemId)) return '已经拥有';
  if (levelForXp(profile.xp) < good.unlockLevel) return `资历达到 ${good.unlockLevel} 级后解锁`;
  if (good.unlockChallenges.some(id => !profile.completed.includes(id))) return '完成对应故事挑战后解锁';
  if (profile[good.currency] < good.cost) return `${currencyNames[good.currency]}不足`;
  return undefined;
}

export function buyGood(profile: Profile, goodId: string): { profile: Profile; error?: string } {
  const good = shopGoods.find(g => g.id === goodId);
  if (!good) return { profile, error: '找不到这件商品' };
  const error = goodUnavailableReason(profile, good);
  if (error) return { profile, error };
  const next = cloneProfile(profile);
  next[good.currency] -= good.cost;
  if (good.type === 'card') next.ownedCards.push(good.itemId);
  else next.ownedDice.push(good.itemId);
  return { profile: next };
}

export function maxGildLevel(cardId: string): number {
  const rarity = cardById[cardId]?.rarity || 1;
  return (progression.foil.maxLevelByRarity[String(rarity) as '1' | '2' | '3'] || 2) - 1;
}
export function gildCost(profile: Profile, cardId: string): number {
  return progression.foil.costs[profile.gild[cardId] || 0] || 0;
}
export function gildCard(profile: Profile, cardId: string): { profile: Profile; error?: string } {
  if (!profile.ownedCards.includes(cardId) || !cardById[cardId]?.collectible) return { profile, error: '请先获得这张角色卡' };
  const current = profile.gild[cardId] || 0;
  if (current >= maxGildLevel(cardId)) return { profile, error: '已经是最高镀闪等级' };
  const cost = gildCost(profile, cardId);
  if (profile.dust < cost) return { profile, error: '战力粉尘不足' };
  const next = cloneProfile(profile);
  next.dust -= cost;
  next.gild[cardId] = current + 1;
  return { profile: next };
}
