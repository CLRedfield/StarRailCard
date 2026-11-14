import { applyPartyCommand } from '../game/party';
import type { PartyCommand, PartyState } from '../game/partyTypes';
import type { CommandContext, StateCodec } from './types';

export function isPartyState(value: unknown): value is PartyState {
  if (!value || typeof value !== 'object') return false;
  const s = value as PartyState;
  return s.kind === 'party' && s.version === 1 && ['treasure', 'raid', 'duos', 'overlord'].includes(s.mode)
    && ['planning', 'results', 'finished'].includes(s.phase) && Number.isSafeInteger(s.round) && s.round > 0
    && Number.isSafeInteger(s.maxRounds) && s.maxRounds >= s.round && Array.isArray(s.players)
    && s.players.length >= 4 && s.players.length <= 8 && (s.mode !== 'duos' || s.players.length % 2 === 0)
    && s.players.every(p => p && typeof p === 'object')
    && new Set(s.players.map(p => p.id)).size === s.players.length && s.players.every(p =>
      typeof p.id === 'string' && typeof p.cardId === 'string' && Array.isArray(p.dice) && Array.isArray(p.selectedIds)
      && Number.isFinite(p.hp) && Number.isFinite(p.maxHp) && Number.isFinite(p.score)
      && p.dice.every(d => d && typeof d.id === 'string' && Number.isFinite(d.value) && Number.isFinite(d.sides))
      && p.selectedIds.every(id => typeof id === 'string') && typeof p.teamId === 'string' && ['hero', 'boss'].includes(p.role)
      && !!p.plan && ['assault', 'guard', 'support'].includes(p.plan.stance) && typeof p.plan.targetId === 'string'
      && !!p.statuses && !!p.modifiers && !!p.upgrades && ['power', 'ward', 'fortune'].every(k => Number.isFinite(p.upgrades[k as keyof typeof p.upgrades])))
    && !!s.catalog && Array.isArray(s.catalog.cards) && s.catalog.cards.every(c => c && typeof c.id === 'string')
    && Array.isArray(s.catalog.prismatics) && Array.isArray(s.catalog.weather) && Array.isArray(s.catalog.tactics)
    && !!s.enemies && typeof s.enemies === 'object'
    && !!s.roundStarts && typeof s.roundStarts === 'object'
    && s.players.every(p => s.roundStarts[p.id] && typeof s.roundStarts[p.id] === 'object')
    && Array.isArray(s.targets) && s.targets.every(t => t && typeof t.id === 'string' && Number.isFinite(t.hp))
    && Array.isArray(s.log) && s.log.every(e => e && typeof e.text === 'string')
    && Array.isArray(s.results) && s.results.every(r => r && typeof r.playerId === 'string')
    && Array.isArray(s.battleEvents) && Array.isArray(s.winnerTeamIds) && Array.isArray(s.bossMoves)
    && (s.swapPools === undefined || (typeof s.swapPools === 'object' && s.swapPools !== null && !Array.isArray(s.swapPools) && Object.values(s.swapPools).every(pool => Array.isArray(pool) && pool.every(d => d && typeof d.id === 'string' && Number.isFinite(d.value) && Number.isFinite(d.sides)))))
    && !!s.roundRule && typeof s.roundRule.name === 'string' && Number.isFinite(s.bossHp) && Number.isFinite(s.crisis);
}

export function reducePartyCommand(state: PartyState, command: PartyCommand, context: CommandContext): PartyState {
  const actor = state.players.find(p => p.id === command?.playerId);
  if (!actor || (actor.id !== context.playerId && !(context.seat === 0 && actor.isAI))) throw new Error('只能操作自己的角色。');
  const result = applyPartyCommand(state, command);
  if (result.error) throw new Error(result.error);
  return result.state;
}

/** Teammates' independent decisions never invalidate this player's pending action. */
export function partyCommandScope(state: PartyState, command: PartyCommand, context: CommandContext): string {
  const p = state.players.find(p => p.id === command?.playerId);
  if (!p) throw new Error('操作角色不存在。');
  const target = command.type === 'exchange' ? state.players.find(q => q.id === command.targetPlayerId) : undefined;
  const pool = command.type === 'poolSwap' ? state.swapPools?.[p.teamId] : undefined;
  return JSON.stringify([context.matchId, state.round, state.phase, p.id, p.dice, p.selectedIds, p.rerolls,
    p.rollsUsed, p.prismaticUses, p.prismaticRolled, p.confirmed, p.ready, p.plan, p.supplies, p.upgrades, p.upgradedThisRound,
    p.exchangedThisRound, target && [target.id, target.dice, target.confirmed, target.exchangedThisRound], pool]);
}

/** Catalog is frozen once per match; ordinary updates only carry mutable party state. */
export const partyStateCodec: StateCodec<PartyState> = {
  encode(previous, next) {
    const changes: Partial<PartyState> = {};
    for (const k of Object.keys(next) as (keyof PartyState)[]) {
      if (k !== 'catalog' && JSON.stringify(previous[k]) !== JSON.stringify(next[k])) Object.assign(changes, { [k]: next[k] });
    }
    return changes;
  },
  decode(previous, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('多人局面更新无效。');
    for (const key of Object.keys(payload)) if (key === 'catalog' || key === '__proto__' || (!Object.hasOwn(previous, key) && key !== 'reason' && key !== 'swapPools')) throw new Error('多人局面字段无效。');
    const next = { ...previous, ...payload, swapPools: (payload as Partial<PartyState>).swapPools ?? previous.swapPools ?? {}, catalog: previous.catalog };
    if (!isPartyState(next)) throw new Error('多人局面不完整。');
    return next;
  },
};
