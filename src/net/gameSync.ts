import type { GameCommand, GameEvent, GameState } from '../game/types';
import type { CommandContext, StateCodec } from './types';

/** Only the acting player's dice/actions scope a roll command, never a teammate's selection. */
export function gameCommandScope(state: GameState, command: GameCommand, context: CommandContext): string {
  const actor = state.players.find(player => player.id === command.playerId);
  if (!actor) throw new Error('操作角色不存在');
  const inventory = ['buyTactic', 'refreshTactics', 'useTactic', 'discardTactic'].includes(command.type)
    ? [actor.tactics, actor.offers, actor.tacticPoints] : undefined;
  return JSON.stringify([context.matchId, state.turn, state.phase, state.attackingSide, state.bossPhase,
    actor.id, actor.dice, actor.rerolls, actor.rollsUsed, actor.prismaticRolled, actor.prismaticUses,
    actor.confirmed, actor.rollLocked, actor.shopReady, inventory]);
}

interface GameDelta { changes: Partial<GameState>; events: GameEvent[]; firstEventId: number }

/** The catalog is immutable for a match. Log IDs are monotonic and already bounded by the engine. */
export const gameStateCodec: StateCodec<GameState> = {
  encode(previous, next): GameDelta {
    const changes: Partial<GameState> = {};
    for (const key of Object.keys(next) as (keyof GameState)[]) {
      if (key === 'catalog' || key === 'log') continue;
      if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) Object.assign(changes, { [key]: next[key] });
    }
    const lastEventId = previous.log.at(-1)?.id ?? 0;
    return { changes, events: next.log.filter(event => event.id > lastEventId), firstEventId: next.log[0]?.id ?? 0 };
  },
  decode(previous, payload): GameState {
    const delta = payload as GameDelta;
    if (!delta || typeof delta !== 'object' || !delta.changes || typeof delta.changes !== 'object'
      || !Array.isArray(delta.events) || !Number.isSafeInteger(delta.firstEventId)) throw new Error('局面更新不完整');
    if (Object.keys(delta.changes).some(key => !Object.hasOwn(previous, key) && key !== 'lastResolution' && key !== 'reason'
      || key === 'catalog' || key === 'log' || key === '__proto__')) throw new Error('局面字段无效');
    const log = delta.firstEventId ? previous.log.filter(event => event.id >= delta.firstEventId) : [];
    let lastId = log.at(-1)?.id ?? 0;
    for (const event of delta.events) {
      if (!event || !Number.isSafeInteger(event.id) || event.id <= lastId) throw new Error('事件顺序无效');
      log.push(event); lastId = event.id;
    }
    return { ...previous, ...delta.changes, catalog: previous.catalog, log };
  },
};
