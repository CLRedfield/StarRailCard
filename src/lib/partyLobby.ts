import { cards, cardById, prismaticDice } from '../data';
import type { PlayerConfig } from '../game/types';
import type { PartyMode } from '../game/partyTypes';

export const PARTY_MODES: { id: PartyMode; name: string; subtitle: string; description: string; players: string; image: string; rules: string[] }[] = [
  { id: 'treasure', name: '银河夺宝', subtitle: '猜对手 · 抢星核', description: '三座宝库，三种解法。选对去处，比一味拼点数更重要。', players: '4–8 人', image: '264013', rules: ['同时选骰与规划，确认后等待全员揭晓。', '火力、坚守与奇巧宝库各有优势，避开拥挤路线或争夺高额悬赏。', '固定轮数累计积分，失败也有补给；局间选择强化，所有人玩到最后。'] },
  { id: 'raid', name: '裂界远征', subtitle: '分工破盾 · 合力打断', description: '拆护盾、阻止蓄力、攻击本体。把好骰子交给需要它的队友。', players: '4–8 人', image: '264026', rules: ['阅读首领预告，分配本体、护盾和蓄力装置的攻击任务。', '守护与援护同样重要，倒下后会复起，但会增加队伍危机。', '在回合上限前击败首领；危机满时远征失败。'] },
  { id: 'duos', name: '双人搭档乱斗', subtitle: '两人成队 · 组合制胜', description: '和搭档交换关键骰，轮换攻守与对手，拼出属于你们的获胜组合。', players: '4 / 6 / 8 人', image: '264014', rules: ['按席位顺序每两人一队，积分由两人共同争取。', '交换关键骰、援护搭档，进攻时争取突破，防守时阻挡或反击。', '固定轮数后按队伍总分排名，落后队伍也能靠后续胜场追回。'] },
  { id: 'overlord', name: '首领降临', subtitle: '盲抽觉醒 · 诡计拆招', description: '随机揭晓本局首领或自由钦定，首领操控招式与裂界奇策，讨伐队看破虚实合力击破。', players: '4–8 人', image: '264019', rules: ['支持「在场真人盲抽 / 全场随机」钦定首领，开局揭晓身份，杜绝备战针对选卡。', '首领实时掌控部件血量与集火动向，搭配招式与「裂界奇策」设局；二阶段解锁全三式招式。', '轮间全员三选一星神奇物，首领可觉醒专属凶星词条，撑到最后或危机满即获胜。'] },
];

export type PartyBossChoice = '' | 'ai' | 'random_human' | 'random_any' | (string & {});
export interface PartyLoadout { cardId: string; prismaticId?: string; gild: number; }
export interface PartyLobbySettings {
  count: number;
  maxRounds: number;
  bossId: PartyBossChoice;
  draftMode?: boolean;
  draftSeed?: number;
}
export interface PartyParticipant { id: string; name: string; loadout?: unknown; }

function hashSeed(input: string): number {
  let n = 2166136261;
  for (let i = 0; i < input.length; i++) n = Math.imul(n ^ input.charCodeAt(i), 16777619);
  return (n >>> 0) || 1;
}

function pickDistinct<T>(items: readonly T[], count: number, seedKey: string): T[] {
  const pool = [...items];
  let s = hashSeed(seedKey);
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    const idx = (s >>> 0) % pool.length;
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

/** Deterministic 3-card + 3-prismatic blind-box pool per player for Draft Mode. */
export function getDraftPool(seedKey: string | number, playerId: string, selectedCardId?: string): { cardIds: string[]; prismaticIds: string[] } {
  const cardIds = pickDistinct(cards, Math.min(3, cards.length), `draft-cards:${seedKey}:${playerId}`).map(c => c.id);
  const effectiveCardId = selectedCardId && cardIds.includes(selectedCardId) ? selectedCardId : cardIds[0];
  const card = cardById[effectiveCardId] || cards[0];
  if (!card?.prismaticId) return { cardIds, prismaticIds: [] };
  const wildCandidates = prismaticDice.filter(d => d.id !== card.prismaticId);
  const wilds = pickDistinct(wildCandidates, Math.min(2, wildCandidates.length), `draft-dice:${seedKey}:${playerId}:${card.id}`).map(d => d.id);
  return { cardIds, prismaticIds: [card.prismaticId, ...wilds] };
}

export function normalizeDraftLoadout(value: unknown, seedKey: string | number, playerId: string, fallbackGild = 0): PartyLoadout {
  const base = normalizePartyLoadout(value);
  const initialPool = getDraftPool(seedKey, playerId, base.cardId);
  const cardId = initialPool.cardIds.includes(base.cardId) ? base.cardId : initialPool.cardIds[0];
  const finalPool = cardId === base.cardId ? initialPool : getDraftPool(seedKey, playerId, cardId);
  const prismaticId = finalPool.prismaticIds.length === 0
    ? undefined
    : finalPool.prismaticIds.includes(base.prismaticId || '')
      ? base.prismaticId
      : finalPool.prismaticIds[0];
  return { cardId, prismaticId, gild: base.gild || fallbackGild };
}

export function validPartyCount(mode: PartyMode, count: number): boolean {
  return Number.isInteger(count) && count >= 4 && count <= 8 && (mode !== 'duos' || count % 2 === 0);
}
export function normalizePartyLoadout(value: unknown): PartyLoadout {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<PartyLoadout>;
  const card = cards.find(c => c.id === v.cardId) || cards[0];
  const prismaticId = card.prismaticId && prismaticDice.some(d => d.id === v.prismaticId) ? v.prismaticId : card.prismaticId || undefined;
  return { cardId: card.id, prismaticId, gild: Math.max(0, Math.min(2, Math.floor(Number(v.gild) || 0))) };
}
export function createPartyRoster(
  mode: PartyMode,
  humans: PartyParticipant[],
  count: number,
  bossId?: string,
  variant = 0,
  options?: { draftSeed?: number | string }
): PlayerConfig[] {
  if (!validPartyCount(mode, count)) throw new Error(mode === 'duos' ? '搭档模式需要 4、6 或 8 人。' : '请选择 4～8 个席位。');
  if (!humans.length || humans.length > count || new Set(humans.map(p => p.id)).size !== humans.length) throw new Error('房间人数与席位设置不一致。');
  const draftSeed = options?.draftSeed;
  const players: PlayerConfig[] = humans.map(p => ({
    id: p.id,
    name: p.name,
    ...(draftSeed !== undefined ? normalizeDraftLoadout(p.loadout, draftSeed, p.id) : normalizePartyLoadout(p.loadout)),
  }));
  for (let i = players.length; i < count; i++) {
    const botId = `party-bot-${i}`;
    if (draftSeed !== undefined) {
      const pool = getDraftPool(draftSeed, botId);
      const pickedCardId = pool.cardIds[Math.abs(Math.floor(variant) + i) % pool.cardIds.length];
      const dicePool = getDraftPool(draftSeed, botId, pickedCardId);
      const pickedPrism = dicePool.prismaticIds.length
        ? dicePool.prismaticIds[Math.abs(Math.floor(variant) + i * 3) % dicePool.prismaticIds.length]
        : undefined;
      const card = cardById[pickedCardId] || cards[0];
      players.push({ id: botId, name: `${card.name} · AI`, cardId: card.id, prismaticId: pickedPrism, isAI: true });
    } else {
      const card = cards[(Math.abs(Math.floor(variant)) + i * 7) % cards.length];
      players.push({ id: botId, name: `${card.name} · AI`, cardId: card.id, prismaticId: card.prismaticId || undefined, isAI: true });
    }
  }
  if (mode === 'overlord' && bossId) {
    let index = -1;
    if (bossId === 'random_human') {
      const humanCount = humans.length;
      index = Math.abs(Math.floor(variant)) % humanCount;
    } else if (bossId === 'random_any') {
      index = Math.abs(Math.floor(variant)) % players.length;
    } else if (bossId === 'ai') {
      index = players.findIndex(p => p.isAI);
    } else {
      index = players.findIndex(p => p.id === bossId);
    }
    if (index < 0) throw new Error('请选择一名在场玩家担任首领，或预留一个 AI 席位。');
    players.unshift(...players.splice(index, 1));
  }
  return players;
}

export function partyCardName(id?: string) { return cardById[id || '']?.name || '选择角色'; }
