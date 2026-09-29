import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnlineSession, ONLINE_TIMING, parseRoomInvite } from '../src/net/session';
import { DEFAULT_BROKER, NAMESPACE, roomTopics, topicMatches } from '../src/net/mqtt';
import { FakeBroker } from '../src/net/testing';
import type { CommandContext, SessionCheckpoint } from '../src/net/types';

type Game = { total: number; pool: string[]; hands: [string[], string[]] };
type Command = { type: 'add'; value: number } | { type: 'swap'; own: string; pool: string };
function reduce(state: Game, command: Command, context: CommandContext): Game {
  if (command.type === 'add') {
    if (!Number.isInteger(command.value) || command.value < 1 || command.value > 10) throw new Error('无效增量');
    return { ...state, total: state.total + command.value };
  }
  const hand = state.hands[context.seat];
  if (!hand.includes(command.own) || !state.pool.includes(command.pool)) throw new Error('骰子已被交换');
  hand[hand.indexOf(command.own)] = command.pool;
  state.pool[state.pool.indexOf(command.pool)] = command.own;
  return state;
}
const initial = (): Game => ({ total: 0, pool: ['pool_a'], hands: [['host_a'], ['guest_a']] });
async function flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
const live: OnlineSession<Game, Command>[] = [];
afterEach(() => { for (const session of live.splice(0)) session.destroy(); vi.useRealTimers(); });

function setup() {
  const network = new FakeBroker(); let clock = 1000000;
  const hostBus = network.createBus('host_transport'); const guestBus = network.createBus('guest_transport');
  let checkpoint: SessionCheckpoint<Game> | null = null;
  const common = { reduce, commandScope: (state: Game, _command: Command, context: CommandContext) => JSON.stringify([context.matchId, state.hands[context.seat]]), stateCodec: { encode: (_previous: Game, next: Game) => next, decode: (_previous: Game, value: unknown) => value as Game }, autoTick: false, discoveryMs: 1, joinTimeoutMs: 300, now: () => clock };
  const host = new OnlineSession<Game, Command>({ ...common, name: '房主', clientId: 'player_host', bus: hostBus, persist: state => { checkpoint = state; } });
  const guest = new OnlineSession<Game, Command>({ ...common, name: '朋友', clientId: 'player_guest', bus: guestBus });
  live.push(host, guest);
  return { network, host, guest, hostBus, guestBus, common, advance: (ms: number) => { clock += ms; }, checkpoint: () => checkpoint };
}
async function playing() {
  const x = setup();
  await x.host.createRoom({ mode: 'coop', code: '345678' });
  await x.guest.joinRoom(x.host.inviteUrl('https://example.com/game'));
  await x.host.setReady(true, { card: 1 }); await x.guest.setReady(true, { card: 2 }); await flush();
  await x.host.startMatch(initial()); await flush();
  return x;
}

describe('real room protocol over a controllable MQTT bus', () => {
  it.each(['duel', 'raid'] as const)('shares unready loadout edits in %s and ignores delayed edits after ready', async mode => {
    const x = setup(); await x.host.createRoom({ mode, code: '234567' });
    await x.guest.joinRoom('234567');
    await x.guest.setReady(false, { cardId: 'first', prismaticId: 'dice-a', gild: 0 }); await flush();
    expect(x.host.getSnapshot().room?.players[1]).toMatchObject({ ready: false, loadout: { cardId: 'first' } });
    const oldEdit = x.network.deliveries.find(d => d.to === x.hostBus.id && d.topic.endsWith('/intent') && (d.message as { kind?: string }).kind === 'ready')!;
    // All three controls use the same clock millisecond.
    await Promise.all([
      x.guest.setReady(false, { cardId: 'latest', prismaticId: 'dice-b', gild: 2 }),
      x.guest.setReady(true, { cardId: 'latest', prismaticId: 'dice-b', gild: 2 }),
    ]); await flush();
    await x.network.replay(oldEdit); await flush();
    expect(x.host.getSnapshot().room?.players[1]).toMatchObject({ ready: true, loadout: { cardId: 'latest', prismaticId: 'dice-b', gild: 2 } });
    expect(x.guest.getSnapshot().room).toEqual(x.host.getSnapshot().room);
  });

  it('creates isolated numeric rooms, joins through invites, enforces readiness and synchronizes commands', async () => {
    const x = setup(); await x.host.createRoom({ mode: 'duel', code: '234567' });
    await expect(x.host.startMatch(initial())).rejects.toThrow('等待');
    const url = x.host.inviteUrl('https://example.com/game');
    expect(parseRoomInvite(url)).toEqual({ code: '234567', broker: DEFAULT_BROKER });
    await x.guest.joinRoom(url); await x.host.setReady(true); await x.guest.setReady(true); await flush();
    expect(x.host.getSnapshot().room?.players).toHaveLength(2);
    await expect(x.guest.startMatch(initial())).rejects.toThrow('房主');
    await x.host.startMatch(initial()); await flush();
    await x.guest.sendCommand({ type: 'add', value: 3 }); await flush();
    expect(x.host.getSnapshot().game?.total).toBe(3);
    expect(x.guest.getSnapshot().version).toBe(2);
    expect(x.network.deliveries.every(d => d.topic.startsWith(`${NAMESPACE}/`))).toBe(true);
    expect(x.host.getSnapshot().room?.players[1].seat).toBe(1);
  });

  it('retries a lost acknowledgement without applying the command twice', async () => {
    const x = await playing(); let lost = false;
    x.network.drop = delivery => {
      if (delivery.to === x.guestBus.id && delivery.topic.includes('/response/') && !lost) { lost = true; return true; }
      return false;
    };
    const result = x.guest.sendCommand({ type: 'add', value: 4 }); await flush();
    expect(x.host.getSnapshot().game?.total).toBe(4);
    x.advance(ONLINE_TIMING.retry + 1); await x.guest.tick(); await flush();
    expect((await result).total).toBe(4);
    const original = x.network.deliveries.find(d => d.topic.endsWith('/intent') && (d.message as { kind?: string }).kind === 'command')!;
    await x.network.replay(original); await flush();
    expect(x.host.getSnapshot().game?.total).toBe(4);
    expect(x.host.getSnapshot().version).toBe(2);
  });

  it('ignores older snapshots, foreign epochs, unknown senders and future sequences', async () => {
    const x = await playing();
    const room = x.host.getSnapshot().room!; const t = roomTopics(room.code);
    const packet = (id: string, seq: number, baseVersion: number) => ({ protocol: 2, matchId: x.host.getCheckpoint()!.matchId, scope: JSON.stringify([x.host.getCheckpoint()!.matchId, ['guest_a']]), epoch: room.epoch, sender: 'player_guest', kind: 'command', id, seq, baseVersion, command: { type: 'add', value: 2 } });
    const future = packet('command_two', 2, 2);
    await x.guestBus.publish(t.intent, future); await flush();
    expect(x.host.getSnapshot().game?.total).toBe(0);
    await x.guestBus.publish(t.intent, { ...packet('command_wrong', 1, 1), epoch: 'wrong_epoch' });
    await x.guestBus.publish(t.intent, { ...packet('command_other', 1, 1), sender: 'unknown_player' });
    await x.guestBus.publish(t.intent, packet('command_one', 1, 1)); await flush();
    await x.guestBus.publish(t.intent, future); await flush();
    expect(x.host.getSnapshot().game?.total).toBe(4);
    await x.hostBus.publish(t.state, { protocol: 2, epoch: room.epoch, sender: room.hostId, version: 1, matchId: x.host.getCheckpoint()!.matchId, kind: 'snapshot', game: initial(), sequences: {} }); await flush();
    expect(x.guest.getSnapshot().version).toBe(3);
    expect(x.guest.getSnapshot().game?.total).toBe(4);
  });

  it('serializes simultaneous swaps and rejects an obsolete choice without duplicating a die', async () => {
    const x = await playing();
    const results = await Promise.allSettled([
      x.host.sendCommand({ type: 'swap', own: 'host_a', pool: 'pool_a' }),
      x.guest.sendCommand({ type: 'swap', own: 'guest_a', pool: 'pool_a' }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    const game = x.host.getSnapshot().game!;
    expect(new Set([...game.pool, ...game.hands.flat()]).size).toBe(3);
    expect(x.guest.getSnapshot().game).toEqual(game);
    await x.guest.sendCommand({ type: 'add', value: 1 });
    expect(x.host.getSnapshot().game?.total).toBe(1);
  });

  it('rejects reducer failures without advancing state and permits the next sequence', async () => {
    const x = await playing();
    await expect(x.guest.sendCommand({ type: 'add', value: -1 })).rejects.toThrow('无效增量');
    expect(x.host.getSnapshot().version).toBe(1);
    await x.guest.sendCommand({ type: 'add', value: 2 });
    expect(x.host.getSnapshot().game?.total).toBe(2);
  });

  it('pauses after lost heartbeats, resumes after reconnection and expires after two minutes', async () => {
    const x = await playing();
    x.guestBus.setOnline(false); x.advance(ONLINE_TIMING.stale + 1); await x.host.tick(); await flush();
    expect(x.host.getSnapshot().status).toBe('paused');
    await expect(x.host.sendCommand({ type: 'add', value: 1 })).rejects.toThrow('暂不可操作');
    x.guestBus.setOnline(true); await flush(); await x.guest.tick(); await x.host.tick(); await flush();
    expect(x.host.getSnapshot().status).toBe('playing');
    expect(x.guest.getSnapshot().status).toBe('playing');
    x.guestBus.setOnline(false); x.advance(ONLINE_TIMING.disconnectGrace + 1); await x.host.tick(); await flush();
    expect(x.host.getSnapshot().status).toBe('closed');
    await x.host.createRoom({ mode: 'duel', code: '456789' });
    expect(x.host.getSnapshot().status).toBe('lobby');
    expect(x.host.getSnapshot().room?.code).toBe('456789');
  });

  it('restores host authority, epoch, exact state and deduplication across reload', async () => {
    const x = await playing(); await x.guest.sendCommand({ type: 'add', value: 5 }); await flush();
    const saved = x.checkpoint()!; const epoch = saved.room.epoch;
    const original = x.network.deliveries.find(d => (d.message as { kind?: string }).kind === 'command')!;
    x.host.destroy(); x.advance(20000); await x.guest.tick(); await flush();
    expect(x.guest.getSnapshot().status).toBe('paused');
    const restored = new OnlineSession<Game, Command>({ ...x.common, name: '房主', bus: x.network.createBus('restored_transport') }); live.push(restored);
    await restored.restore(saved); await flush();
    await x.guest.tick(); await restored.tick(); await flush();
    expect(restored.getSnapshot().room?.epoch).toBe(epoch);
    expect(restored.getSnapshot().game?.total).toBe(5);
    await x.network.replay(original); await flush();
    expect(restored.getSnapshot().game?.total).toBe(5);
    await x.guest.sendCommand({ type: 'add', value: 2 });
    expect(restored.getSnapshot().game?.total).toBe(7);
  });

  it('unpauses the host after its transport reconnects without a page reload', async () => {
    const x = await playing();
    x.hostBus.setOnline(false);
    expect(x.host.getSnapshot().status).toBe('paused');
    x.advance(6000); x.hostBus.setOnline(true); await flush();
    await x.guest.tick(); await x.host.tick(); await flush();
    expect(x.host.getSnapshot().status).toBe('playing');
    await x.host.sendCommand({ type: 'add', value: 2 }); await flush();
    expect(x.guest.getSnapshot().game?.total).toBe(2);
  });

  it('discovers retained public matchmaking rooms and cleans advertisements when filled', async () => {
    const x = setup(); await x.host.quickMatch('duel');
    expect(x.host.getSnapshot().status).toBe('matching');
    const room = await x.guest.quickMatch('duel'); await flush();
    expect(room.players).toHaveLength(2);
    expect(x.guest.getSnapshot().room?.code).toBe(x.host.getSnapshot().room?.code);
    expect([...x.network.retained.keys()].filter(t => t.includes('/match/'))).toHaveLength(0);
  });

  it('returns both seats to the lobby and rejects previous-game snapshots after a rematch', async () => {
    const x = await playing(); await x.guest.sendCommand({ type: 'add', value: 8 }); await flush();
    const stale = x.network.deliveries.filter(d => d.topic.endsWith('/state')).at(-1)!;
    await x.host.returnToLobby(); await flush();
    expect(x.guest.getSnapshot().game).toBeNull();
    expect(x.guest.getSnapshot().status).toBe('lobby');
    expect(x.host.getSnapshot().room?.players.every(p => !p.ready)).toBe(true);
    await x.host.setReady(true); await x.guest.setReady(true); await flush();
    await x.host.startMatch(initial()); await flush();
    await x.network.replay(stale); await flush();
    expect(x.guest.getSnapshot().game?.total).toBe(0);
    await x.guest.sendCommand({ type: 'add', value: 1 });
    expect(x.host.getSnapshot().game?.total).toBe(1);
  });

  it('converges simultaneous public searches onto the same room', async () => {
    const x = setup();
    await Promise.all([x.host.quickMatch('coop'), x.guest.quickMatch('coop')]);
    await new Promise(resolve => setTimeout(resolve, 20)); await flush();
    expect(x.host.getSnapshot().room?.code).toBe(x.guest.getSnapshot().room?.code);
    expect(x.host.getSnapshot().room?.players).toHaveLength(2);
  });

  it('restores a guest from an older checkpoint after its last command was committed without an acknowledgement', async () => {
    const x = await playing();
    x.network.drop = d => d.to === x.guestBus.id && (d.topic.includes('/response/') || d.topic.endsWith('/state'));
    const uncertain = x.guest.sendCommand({ type: 'add', value: 6 }).catch(() => undefined); await flush();
    const checkpoint = x.guest.getCheckpoint()!;
    expect(checkpoint.game?.total).toBe(0);
    expect(x.host.getSnapshot().game?.total).toBe(6);
    x.guest.destroy(); await uncertain; x.network.drop = null;
    const replacement = new OnlineSession<Game, Command>({ ...x.common, name: '朋友', bus: x.network.createBus('replacement_guest') }); live.push(replacement);
    await replacement.restore(checkpoint); await flush();
    expect(replacement.getSnapshot().game?.total).toBe(6);
    await replacement.sendCommand({ type: 'add', value: 1 });
    expect(x.host.getSnapshot().game?.total).toBe(7);
  });

  it('never routes host commands through its own broker intent topic', async () => {
    const x = await playing();
    const offset = x.network.deliveries.length;
    await x.host.sendCommand({ type: 'add', value: 3 }); await flush();
    expect(x.host.getSnapshot().game?.total).toBe(3);
    expect(x.network.deliveries.slice(offset).filter(d => d.from === x.hostBus.id && d.topic.endsWith('/intent'))).toHaveLength(0);
    expect(Object.values(x.host.getCheckpoint()!.receipts).every(receipt => !Object.hasOwn(receipt, 'game'))).toBe(true);
  });

  for (const latency of [300, 1000]) it(`rebases independent simultaneous operations at ${latency} ms latency`, async () => {
    const x = await playing();
    vi.useFakeTimers(); x.network.latencyMs = latency;
    const guestResult = x.guest.sendCommand({ type: 'add', value: 4 });
    await flush();
    const hostResult = await x.host.sendCommand({ type: 'add', value: 3 });
    expect(hostResult.total).toBe(3);
    expect(x.guest.getSnapshot().game?.total).toBe(0);
    await vi.advanceTimersByTimeAsync(latency * 3); await flush();
    expect((await guestResult).total).toBe(7);
    expect(x.host.getSnapshot().game).toEqual(x.guest.getSnapshot().game);
    const acks = x.network.deliveries.filter(d => d.topic.includes('/response/'));
    expect(acks.every(d => !Object.hasOwn((d.message as { receipt: object }).receipt, 'game'))).toBe(true);
  });

  it('detects a missing delta and recovers from a full snapshot without replaying commands', async () => {
    const x = await playing(); let lost = false;
    x.network.drop = d => {
      if (d.to === x.guestBus.id && d.topic.endsWith('/state') && (d.message as { kind?: string }).kind === 'update' && !lost) { lost = true; return true; }
      return false;
    };
    await x.host.sendCommand({ type: 'add', value: 2 }); await flush();
    expect(x.guest.getSnapshot().game?.total).toBe(0);
    await x.host.sendCommand({ type: 'add', value: 3 }); await flush();
    expect(x.guest.getSnapshot().game?.total).toBe(5);
    expect(x.guest.getSnapshot().recoveryRevision).toBeGreaterThan(0);
    expect(x.host.getSnapshot().version).toBe(3);
    expect(x.network.deliveries.filter(d => (d.message as { kind?: string }).kind === 'sync').length).toBeGreaterThan(0);
  });

  it('recovers an acknowledged operation when its state packet was lost', async () => {
    const x = await playing(); let lost = false;
    x.network.drop = d => {
      if (d.to === x.guestBus.id && d.topic.endsWith('/state') && (d.message as { kind?: string }).kind === 'update' && !lost) { lost = true; return true; }
      return false;
    };
    const result = x.guest.sendCommand({ type: 'add', value: 8 }); await flush();
    expect(x.guest.getSnapshot().game?.total).toBe(0);
    x.advance(ONLINE_TIMING.retry + 1); await x.guest.tick(); await flush();
    expect((await result).total).toBe(8);
    expect(x.host.getSnapshot().version).toBe(2);
  });

  it('heartbeats do not publish game state or replay the static catalog', async () => {
    const x = await playing(); const offset = x.network.deliveries.length;
    x.advance(ONLINE_TIMING.heartbeat + 1); await x.host.tick(); await x.guest.tick(); await flush();
    const sent = x.network.deliveries.slice(offset);
    expect(sent.some(d => d.topic.endsWith('/heartbeat'))).toBe(true);
    expect(sent.filter(d => d.topic.endsWith('/state'))).toHaveLength(0);
  });

  it('ignores duplicate snapshots without invalidating local selections or presentation', async () => {
    const x = await playing();
    const snapshot = x.network.deliveries.filter(d => d.topic.endsWith('/state') && (d.message as { kind?: string }).kind === 'snapshot').at(-1)!;
    const before = x.guest.getSnapshot().recoveryRevision;
    await x.network.replay(snapshot); await flush();
    expect(x.guest.getSnapshot().recoveryRevision).toBe(before);
    expect(x.guest.getSnapshot().version).toBe(1);
  });

  it('marks both host and guest transport recovery, including same-version snapshots', async () => {
    const x = await playing();
    const hostBefore = x.host.getSnapshot().recoveryRevision;
    x.hostBus.setOnline(false); x.hostBus.setOnline(true); await flush();
    expect(x.host.getSnapshot().recoveryRevision).toBe(hostBefore + 1);
    const guestBefore = x.guest.getSnapshot().recoveryRevision;
    x.guestBus.setOnline(false); x.guestBus.setOnline(true); await flush();
    expect(x.guest.getSnapshot().recoveryRevision).toBe(guestBefore + 1);
    const snapshot = x.network.deliveries.filter(d => d.topic.endsWith('/state') && (d.message as { kind?: string }).kind === 'snapshot').at(-1)!;
    await x.network.replay(snapshot); await flush();
    expect(x.guest.getSnapshot().recoveryRevision).toBe(guestBefore + 1);
  });

  it('restores same-version sequence high water after a rejected command loses its acknowledgement', async () => {
    const x = await playing();
    const before = x.guest.getCheckpoint()!;
    x.network.drop = d => d.to === x.guestBus.id && d.topic.includes('/response/');
    const uncertain = x.guest.sendCommand({ type: 'add', value: -1 }).catch(() => undefined); await flush();
    expect(x.host.getSnapshot().version).toBe(before.version);
    x.guest.destroy(); await uncertain; x.network.drop = null;
    const restored = new OnlineSession<Game, Command>({ ...x.common, name: '朋友', bus: x.network.createBus('restored_guest') }); live.push(restored);
    await restored.restore(before); await flush();
    expect(restored.getCheckpoint()!.nextSeq).toBe(1);
    await restored.sendCommand({ type: 'add', value: 2 });
    expect(x.host.getSnapshot().game?.total).toBe(2);
  });

  it('rejects v1 checkpoints with a clear update instruction', async () => {
    const x = setup();
    await expect(x.host.restore({ protocol: 1 } as unknown as SessionCheckpoint<Game>)).rejects.toThrow('双方更新后重新建立房间');
  });

  it('reuses the same clients across different room epochs without carrying old command sequences', async () => {
    const x = await playing();
    await x.guest.sendCommand({ type: 'add', value: 2 });
    await x.guest.sendCommand({ type: 'add', value: 3 }); await flush();
    const firstEpoch = x.host.getSnapshot().room!.epoch;
    expect(x.guest.getCheckpoint()!.nextSeq).toBe(2);
    await x.host.returnToLobby(); await flush();
    await x.host.leave(); await flush();
    expect(x.guest.getSnapshot().room!.phase).toBe('closed');
    await x.host.createRoom({ mode: 'duel', code: '777321' });
    await x.guest.joinRoom('777321');
    await x.host.setReady(true); await x.guest.setReady(true); await flush();
    expect(x.guest.getCheckpoint()!.nextSeq).toBe(0);
    expect(x.host.getSnapshot().room!.epoch).not.toBe(firstEpoch);
    await x.host.startMatch(initial()); await flush();
    const offset = x.network.deliveries.length;
    expect((await x.guest.sendCommand({ type: 'add', value: 7 })).total).toBe(7);
    await flush();
    const command = x.network.deliveries.slice(offset).find(d => d.to === x.hostBus.id && (d.message as { kind?: string }).kind === 'command')!;
    expect(command.message).toHaveProperty('seq', 1);
    expect(x.guest.getSnapshot().game).toEqual(x.host.getSnapshot().game);
  });

  it('rejects malformed invitations and keeps wildcard matching inside one namespace', () => {
    expect(() => parseRoomInvite('abcdef')).toThrow('六位');
    expect(() => parseRoomInvite('https://example.com/?room=123456&broker=ws://unsafe')).toThrow();
    expect(topicMatches('starrailcard/v2/match/duel/+', 'starrailcard/v2/match/duel/123456')).toBe(true);
    expect(topicMatches('starrailcard/v2/#', 'sgskill3/123456/act')).toBe(false);
  });
});
