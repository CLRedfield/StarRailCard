import { afterEach, describe, expect, it } from 'vitest';
import { getRoomCapacity, OnlineSession, ONLINE_TIMING } from '../src/net/session';
import { roomTopics } from '../src/net/mqtt';
import { FakeBroker } from '../src/net/testing';
import type { CommandContext, RoomMode, SessionCheckpoint } from '../src/net/types';

interface Game { players: { id: string; count: number }[]; round: number }
interface Command { playerId: string; type: 'add' }
const validateState = (value: unknown): value is Game => {
  const state = value as Game;
  return !!state && Array.isArray(state.players) && state.players.length >= 4 && state.players.length <= 8
    && state.players.every(p => typeof p.id === 'string' && Number.isSafeInteger(p.count));
};
function reduce(state: Game, command: Command, context: CommandContext): Game {
  if (context.playerId !== command.playerId) throw new Error('不能操作其他角色');
  const actor = state.players.find(p => p.id === context.playerId);
  if (!actor) throw new Error('操作角色不存在');
  actor.count++;
  return state;
}
const scope = (state: Game, _command: Command, context: CommandContext) => JSON.stringify([context.matchId, state.round, state.players.find(p => p.id === context.playerId)?.count]);
const sessions: OnlineSession<Game, Command>[] = [];
afterEach(() => { for (const session of sessions.splice(0)) session.destroy(); });
async function flush() { for (let i = 0; i < 400; i++) await Promise.resolve(); }

function setup(count: number) {
  const network = new FakeBroker(); let time = 1000000;
  const common = { reduce, commandScope: scope, validateState, autoTick: false, discoveryMs: 1, joinTimeoutMs: 500,
    stateCodec: { encode: (_previous: Game, next: Game) => next, decode: (_previous: Game, value: unknown) => value as Game }, now: () => time };
  const buses = Array.from({ length: count }, (_, i) => network.createBus(`transport_${i}`));
  const checkpoints: (SessionCheckpoint<Game> | null)[] = Array(count).fill(null);
  const clients = buses.map((bus, i) => new OnlineSession<Game, Command>({ ...common, name: `玩家 ${i + 1}`, clientId: `player_${i}`, bus, persist: saved => { checkpoints[i] = saved; } }));
  sessions.push(...clients);
  const initial = (total = count): Game => ({ players: Array.from({ length: total }, (_, i) => ({ id: `player_${i}`, count: 0 })), round: 1 });
  return { network, clients, buses, common, initial, checkpoints, advance: (ms: number) => { time += ms; } };
}
async function joinAll(x: ReturnType<typeof setup>, mode: RoomMode = 'raid', capacity = x.clients.length) {
  const room = await x.clients[0].createRoom({ mode, capacity, code: '456789' });
  await Promise.all(x.clients.slice(1).map(client => client.joinRoom(room.code)));
  await flush();
}
async function readyAll(x: ReturnType<typeof setup>) {
  await Promise.all(x.clients.map(client => client.setReady(true, { cardId: 'example' })));
  await flush();
}
async function playing(count: number) {
  const x = setup(count); await joinAll(x); await readyAll(x); await x.clients[0].startMatch(x.initial()); await flush(); return x;
}

describe('four to eight player friend rooms', () => {
  it('clears closed-room checkpoints and retained game state, ignoring delayed snapshots', async () => {
    const x = await playing(4), topics = roomTopics('456789');
    const oldPacket = structuredClone(x.network.retained.get(topics.state)) as Record<string, unknown>;
    const guestVersion = x.clients[2].getSnapshot().version;
    expect(x.checkpoints.every(Boolean)).toBe(true);
    await x.clients[1].leave(); await flush();
    for (const client of [x.clients[0], x.clients[2], x.clients[3]]) {
      expect(client.getSnapshot().status).toBe('closed');
      expect(client.getCheckpoint()).toBeNull();
    }
    expect(x.checkpoints).toEqual([null, null, null, null]);
    expect(x.network.retained.has(topics.state)).toBe(false);
    expect((x.network.retained.get(topics.room) as { room: { phase: string } }).room.phase).toBe('closed');
    await x.network.publish(x.buses[0].id, topics.state, { ...oldPacket, version: guestVersion + 1 }); await flush();
    expect(x.clients[2].getSnapshot().status).toBe('closed');
    expect(x.clients[2].getSnapshot().version).toBe(guestVersion);
    expect(x.checkpoints[2]).toBeNull();
  });

  const combinations = (['treasure', 'raid', 'duos', 'overlord'] as const).flatMap(mode => [4, 5, 6, 7, 8]
    .filter(count => mode !== 'duos' || count % 2 === 0).map(count => ({ mode, count })));
  it.each(combinations)('synchronizes $mode with $count simultaneous players without cross-player conflicts', async ({ mode, count }) => {
    const x = setup(count); await joinAll(x, mode); await readyAll(x);
    const host = x.clients[0];
    expect(host.getSnapshot().room?.players.map(p => p.seat)).toEqual(Array.from({ length: count }, (_, i) => i));
    await host.startMatch(x.initial()); await flush();
    for (let turn = 0; turn < 3; turn++) {
      await Promise.all(x.clients.map(client => client.sendCommand({ type: 'add', playerId: client.getSnapshot().myId })));
      await flush();
    }
    expect(host.getSnapshot().version).toBe(1 + count * 3);
    expect(host.getSnapshot().game?.players.every(p => p.count === 3)).toBe(true);
    for (const client of x.clients) {
      expect(client.getSnapshot().game).toEqual(host.getSnapshot().game);
      expect(client.getCheckpoint()?.sequences[client.getSnapshot().myId]).toBe(3);
    }
  });

  it('serializes racing final-seat joins and rejects overflow immediately', async () => {
    const x = setup(9);
    await x.clients[0].createRoom({ mode: 'treasure', code: '456789' });
    const results = await Promise.allSettled(x.clients.slice(1).map(client => client.joinRoom('456789')));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(7);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message).toContain('房间已满');
    const room = x.clients[0].getSnapshot().room!;
    expect(room.players).toHaveLength(8);
    expect(new Set(room.players.map(p => p.seat)).size).toBe(8);
    expect(getRoomCapacity(room)).toBe(8);
  });

  it('enforces readiness and validates total participants while allowing AI-filled games', async () => {
    const x = setup(1); await x.clients[0].createRoom({ mode: 'raid' });
    await expect(x.clients[0].startMatch(x.initial(4))).rejects.toThrow('准备');
    await x.clients[0].setReady(true);
    await expect(x.clients[0].startMatch(x.initial(3))).rejects.toThrow('初始对局状态无效');
    await x.clients[0].startMatch(x.initial(4));
    expect(x.clients[0].getSnapshot().status).toBe('playing');
  });

  it('keeps occupied seats stable when someone leaves and reuses the empty seat', async () => {
    const x = setup(5); await joinAll(x, 'treasure'); await readyAll(x);
    await x.clients[2].leave(); await flush();
    expect(x.clients[0].getSnapshot().room?.players.map(p => p.seat)).toEqual([0, 1, 3, 4]);
    expect(x.clients[0].getSnapshot().room?.players.every(p => !p.ready)).toBe(true);
    await x.clients[2].joinRoom('456789'); await flush();
    expect(x.clients[2].getSnapshot().seat).toBe(2);
    expect(x.clients[0].getSnapshot().room?.players.map(p => p.seat)).toEqual([0, 1, 2, 3, 4]);
  });

  it('evicts only expired lobby guests and preserves other guests and their seats', async () => {
    const x = setup(6); await joinAll(x); await readyAll(x);
    x.buses[2].setOnline(false); x.buses[4].setOnline(false);
    x.advance(ONLINE_TIMING.disconnectGrace + 1);
    await Promise.all([1, 3, 5].map(index => x.clients[index].tick())); await flush();
    await x.clients[0].tick(); await flush();
    expect(x.clients[0].getSnapshot().room?.players.map(p => p.seat)).toEqual([0, 1, 3, 5]);
    expect(x.clients[5].getSnapshot().seat).toBe(5);
    expect(x.clients[0].getSnapshot().room?.players.every(p => !p.ready)).toBe(true);
  });

  it('waits for every disconnected guest before resuming an eight-player match', async () => {
    const x = await playing(8);
    x.buses[3].setOnline(false); x.buses[7].setOnline(false);
    x.advance(ONLINE_TIMING.stale + 1);
    await Promise.all(x.clients.filter((_, index) => index > 0 && index !== 3 && index !== 7).map(client => client.tick())); await flush();
    await x.clients[0].tick(); await flush();
    expect(x.clients[0].getSnapshot().status).toBe('paused');
    x.buses[3].setOnline(true); await flush(); await x.clients[0].tick(); await flush();
    expect(x.clients[0].getSnapshot().status).toBe('paused');
    x.buses[7].setOnline(true); await flush(); await x.clients[0].tick(); await flush();
    expect(x.clients.every(client => client.getSnapshot().status === 'playing')).toBe(true);
    await x.clients[7].sendCommand({ type: 'add', playerId: 'player_7' }); await flush();
    expect(x.clients.every(client => client.getSnapshot().game?.players[7].count === 1)).toBe(true);
  });

  it('restores all eight seats and their independent sequence numbers after a host reload', async () => {
    const x = await playing(8);
    await Promise.all(x.clients.map(client => client.sendCommand({ type: 'add', playerId: client.getSnapshot().myId }))); await flush();
    const saved = x.clients[0].getCheckpoint()!;
    const original = x.network.deliveries.find(d => d.topic.endsWith('/intent') && (d.message as { sender: string; kind: string }).sender === 'player_7' && (d.message as { kind: string }).kind === 'command')!;
    x.clients[0].destroy(); x.advance(ONLINE_TIMING.stale + 1);
    await Promise.all(x.clients.slice(1).map(client => client.tick())); await flush();
    const replacement = new OnlineSession<Game, Command>({ ...x.common, name: '房主', bus: x.network.createBus('restored_host') }); sessions.push(replacement);
    await replacement.restore(saved); await flush();
    await Promise.all(x.clients.slice(1).map(client => client.tick())); await replacement.tick(); await flush();
    expect(replacement.getSnapshot().status).toBe('playing');
    expect(replacement.getSnapshot().room?.players).toHaveLength(8);
    await x.network.replay(original); await flush();
    expect(replacement.getSnapshot().game?.players.every(p => p.count === 1)).toBe(true);
    await Promise.all(x.clients.slice(1).map(client => client.sendCommand({ type: 'add', playerId: client.getSnapshot().myId }))); await flush();
    expect(replacement.getSnapshot().game?.players.slice(1).every(p => p.count === 2)).toBe(true);
    expect(x.clients[7].getSnapshot().game).toEqual(replacement.getSnapshot().game);
  });

  it('retains an unacknowledged command while seven other players make progress', async () => {
    const x = await playing(8);
    x.network.drop = delivery => delivery.to === x.buses[7].id && delivery.topic.includes('/response/');
    const pending = x.clients[7].sendCommand({ type: 'add', playerId: 'player_7' }); await flush();
    for (let i = 0; i < 4; i++) {
      await Promise.all(x.clients.slice(0, 7).map(client => client.sendCommand({ type: 'add', playerId: client.getSnapshot().myId })));
      await flush();
    }
    x.network.drop = null; x.advance(ONLINE_TIMING.retry + 1);
    await x.clients[7].tick(); await flush();
    expect((await pending).players[7].count).toBe(1);
    expect(x.clients[0].getSnapshot().version).toBe(30);
    expect(x.clients[0].getSnapshot().game?.players.slice(0, 7).every(p => p.count === 4)).toBe(true);
  });

  it('recovers the eighth guest with stale state after its committed command lost both responses', async () => {
    const x = await playing(8);
    x.network.drop = delivery => delivery.to === x.buses[7].id && (delivery.topic.includes('/response/') || delivery.topic.endsWith('/state'));
    const pending = x.clients[7].sendCommand({ type: 'add', playerId: 'player_7' }).catch(() => undefined); await flush();
    const saved = x.clients[7].getCheckpoint()!;
    expect(saved.game?.players[7].count).toBe(0);
    expect(x.clients[0].getSnapshot().game?.players[7].count).toBe(1);
    x.clients[7].destroy(); await pending; x.network.drop = null;
    const replacement = new OnlineSession<Game, Command>({ ...x.common, name: '重连的玩家', bus: x.network.createBus('restored_guest_7') }); sessions.push(replacement);
    await replacement.restore(saved); await flush();
    expect(replacement.getSnapshot().seat).toBe(7);
    expect(replacement.getSnapshot().game?.players[7].count).toBe(1);
    await replacement.sendCommand({ type: 'add', playerId: 'player_7' }); await flush();
    expect(x.clients[0].getCheckpoint()?.sequences.player_7).toBe(2);
    expect(x.clients[0].getSnapshot().game?.players[7].count).toBe(2);
  });

  it('rejects another actor and ignores unknown senders without borrowing member sequences', async () => {
    const x = await playing(8); const room = x.clients[0].getSnapshot().room!;
    await expect(x.clients[7].sendCommand({ type: 'add', playerId: 'player_0' })).rejects.toThrow('不能操作其他角色');
    expect(x.clients[0].getSnapshot().game?.players[0].count).toBe(0);
    const outsider = x.network.createBus('outsider'); await outsider.connect();
    const matchId = x.clients[0].getSnapshot().matchId!;
    await outsider.publish(roomTopics(room.code).intent, { protocol: 2, epoch: room.epoch, sender: 'unknown_player', kind: 'command', id: 'outsider_command', seq: 1, baseVersion: 1, matchId, scope: JSON.stringify([matchId, 1, 0]), command: { type: 'add', playerId: 'player_0' } });
    await flush(); outsider.close();
    expect(x.clients[0].getCheckpoint()?.sequences.unknown_player).toBeUndefined();
    await x.clients[7].sendCommand({ type: 'add', playerId: 'player_7' }); await flush();
    expect(x.clients[0].getCheckpoint()?.sequences.player_7).toBe(2);
    expect(x.clients[0].getCheckpoint()?.sequences.player_0).toBeUndefined();
    expect(x.clients[0].getSnapshot().game?.players[7].count).toBe(1);
  });

  it('rejects invalid capacity and malformed persisted seats without dropping legacy room support', async () => {
    const x = setup(1);
    for (const capacity of [3, 5, 7, 9, 4.5]) await expect(x.clients[0].createRoom({ mode: 'duos', capacity })).rejects.toThrow('房间人数无效');
    await expect(x.clients[0].createRoom({ mode: 'duel', capacity: 4 })).rejects.toThrow('房间人数无效');
    await x.clients[0].createRoom({ mode: 'overlord', capacity: 8 });
    const saved = x.clients[0].getCheckpoint()!;
    const replacement = new OnlineSession<Game, Command>({ ...x.common, name: '替身', bus: x.network.createBus('replacement') }); sessions.push(replacement);
    const badSeat: SessionCheckpoint<Game> = structuredClone(saved); badSeat.room.players[0].seat = 8;
    await expect(replacement.restore(badSeat)).rejects.toThrow('联机存档无效');
    const badCapacity: SessionCheckpoint<Game> = structuredClone(saved); badCapacity.room.capacity = 9;
    await expect(replacement.restore(badCapacity)).rejects.toThrow('联机存档无效');
    delete saved.room.capacity; x.clients[0].destroy();
    await replacement.restore(saved);
    expect(getRoomCapacity(replacement.getSnapshot().room!)).toBe(8);
  });

  it('uses friend-room invitations for party modes while preserving old matching', async () => {
    const x = setup(1);
    await expect(x.clients[0].quickMatch('treasure')).rejects.toThrow('好友房');
    expect(x.clients[0].getSnapshot().status).toBe('idle');
    await x.clients[0].createRoom({ mode: 'treasure', public: true });
    expect([...x.network.retained.keys()].filter(topic => topic.includes('/match/'))).toHaveLength(0);
  });

  it('allows host to reset other players readiness when room settings change', async () => {
    const x = setup(4);
    await joinAll(x, 'raid', 4);
    await readyAll(x);
    expect(x.clients[0].getSnapshot().room?.players.every(p => p.ready)).toBe(true);
    // Guest resetOthers must never clear host readiness.
    await x.clients[1].setReady(false, { cardId: 'example' }, { resetOthers: true });
    await flush();
    expect(x.clients[0].getSnapshot().room?.players.find(p => p.seat === 0)?.ready).toBe(true);
    // Host resetOthers resets every non-host guest back to unready.
    await x.clients[0].setReady(false, { cardId: 'example', partySettings: { count: 4, maxRounds: 12, bossId: '' } }, { resetOthers: true });
    await flush();
    const room = x.clients[1].getSnapshot().room!;
    expect(room.players.every(p => !p.ready)).toBe(true);
  });
});
