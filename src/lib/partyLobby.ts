import { cards, cardById, prismaticDice } from '../data';
import type { PlayerConfig } from '../game/types';
import type { PartyMode } from '../game/partyTypes';

export const PARTY_MODES: { id: PartyMode; name: string; subtitle: string; description: string; players: string; image: string; rules: string[] }[] = [
  { id: 'treasure', name: '银河夺宝', subtitle: '猜对手 · 抢星核', description: '三座宝库，三种解法。选对去处，比一味拼点数更重要。', players: '4–8 人', image: '264013', rules: ['同时选骰与规划，确认后等待全员揭晓。', '火力、坚守与奇巧宝库各有优势，避开拥挤路线或争夺高额悬赏。', '固定轮数累计积分，失败也有补给；局间选择强化，所有人玩到最后。'] },
  { id: 'raid', name: '裂界远征', subtitle: '分工破盾 · 合力打断', description: '拆护盾、阻止蓄力、攻击本体。把好骰子交给需要它的队友。', players: '4–8 人', image: '264026', rules: ['阅读首领预告，分配本体、护盾和蓄力装置的攻击任务。', '守护与援护同样重要，倒下后会复起，但会增加队伍危机。', '在回合上限前击败首领；危机满时远征失败。'] },
  { id: 'duos', name: '双人搭档乱斗', subtitle: '两人成队 · 组合制胜', description: '和搭档交换关键骰，轮换攻守与对手，拼出属于你们的获胜组合。', players: '4 / 6 / 8 人', image: '264014', rules: ['按席位顺序每两人一队，积分由两人共同争取。', '交换关键骰、援护搭档，进攻时争取突破，防守时阻挡或反击。', '固定轮数后按队伍总分排名，落后队伍也能靠后续胜场追回。'] },
  { id: 'overlord', name: '首领降临', subtitle: '一人设局 · 全员破局', description: '成为首领操控招式，或加入讨伐队，识破对方下一步。', players: '4–8 人', image: '264019', rules: ['一名玩家担任首领，其他玩家合作讨伐；房主可在开局前选择首领人选。', '首领在预告的招式中选择行动，讨伐队分配输出、拆解和守护。', '首领撑到最后或让危机满即可获胜；讨伐队击败首领获胜。'] },
];

export interface PartyLoadout { cardId: string; prismaticId?: string; gild: number; }
export interface PartyLobbySettings { count: number; maxRounds: number; bossId: string; }
export interface PartyParticipant { id: string; name: string; loadout?: unknown; }
export function validPartyCount(mode: PartyMode, count: number): boolean {
  return Number.isInteger(count) && count >= 4 && count <= 8 && (mode !== 'duos' || count % 2 === 0);
}
export function normalizePartyLoadout(value: unknown): PartyLoadout {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<PartyLoadout>;
  const card = cards.find(c => c.id === v.cardId) || cards[0];
  const prismaticId = card.prismaticId && prismaticDice.some(d => d.id === v.prismaticId) ? v.prismaticId : card.prismaticId || undefined;
  return { cardId: card.id, prismaticId, gild: Math.max(0, Math.min(2, Math.floor(Number(v.gild) || 0))) };
}
export function createPartyRoster(mode: PartyMode, humans: PartyParticipant[], count: number, bossId?: string, variant = 0): PlayerConfig[] {
  if (!validPartyCount(mode, count)) throw new Error(mode === 'duos' ? '搭档模式需要 4、6 或 8 人。' : '请选择 4～8 个席位。');
  if (!humans.length || humans.length > count || new Set(humans.map(p => p.id)).size !== humans.length) throw new Error('房间人数与席位设置不一致。');
  const players: PlayerConfig[] = humans.map(p => ({ id: p.id, name: p.name, ...normalizePartyLoadout(p.loadout) }));
  for (let i = players.length; i < count; i++) {
    const card = cards[(Math.abs(Math.floor(variant)) + i * 7) % cards.length];
    players.push({ id: `party-bot-${i}`, name: `${card.name} · AI`, cardId: card.id, prismaticId: card.prismaticId || undefined, isAI: true });
  }
  if (mode === 'overlord' && bossId) {
    const index = bossId === 'ai' ? players.findIndex(p => p.isAI) : players.findIndex(p => p.id === bossId);
    if (index < 0) throw new Error('请选择一名在场玩家担任首领，或预留一个 AI 席位。');
    players.unshift(...players.splice(index, 1));
  }
  return players;
}

export function partyCardName(id?: string) { return cardById[id || '']?.name || '选择角色'; }
