import { afterEach, describe, expect, it } from 'vitest';
import { applyPartyCommand, choosePartyAiCommand, createPartyMatch, getPartyLegalActions } from '../src/game/party';
import type { PartyCommand, PartyMode, PartyState } from '../src/game/partyTypes';
import { MqttBus, roomTopics } from '../src/net/mqtt';
import { OnlineSession } from '../src/net/session';
import { isPartyState, partyCommandScope, partyStateCodec, reducePartyCommand } from '../src/net/partySync';
import { FakeBroker } from '../src/net/testing';
import type { FakeDelivery } from '../src/net/testing';

const modes: PartyMode[] = ['treasure', 'raid', 'duos', 'overlord'];
const live: OnlineSession<PartyState, PartyCommand>[] = [];
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const common = { reduce: reducePartyCommand, commandScope: partyCommandScope, stateCodec: partyStateCodec, validateState: isPartyState, autoTick: false, discoveryMs: 1 };
async function flush() { for (let i = 0; i < 500; i++) await Promise.resolve(); }
afterEach(() => { for (const session of live.splice(0)) session.destroy(); });

async function setup(mode: PartyMode, count: number, rounds = 4, seed = 24681, total = count) {
  const network = new FakeBroker();
  const buses = Array.from({ length: count }, (_, i) => network.createBus(`transport_${i}`));
  const clients = buses.map((bus, i) => new OnlineSession<PartyState, PartyCommand>({ ...common, name: `玩家 ${i + 1}`, clientId: `player_${i}`, bus }));
  live.push(...clients);
  const host = clients[0], room = await host.createRoom({ mode, capacity: total });
  await Promise.all(clients.slice(1).map(client => client.joinRoom(room.code)));
  await Promise.all(clients.map(client => client.setReady(true))); await flush();
  const initial = createPartyMatch({ mode, maxRounds: rounds, players: Array.from({ length: total }, (_, i) => ({
    id: `player_${i}`, name: `玩家 ${i + 1}`, cardId: ['264026', '264014', '264013', '264019'][i % 4], isAI: i >= count,
  })) }, seed);
  await host.startMatch(initial); await flush();
  return { network, buses, clients, host, initial };
}
function assertSynchronized(x: Awaited<ReturnType<typeof setup>>) {
  const expected = x.host.getSnapshot();
  for (const client of x.clients) {
    expect(client.getSnapshot().game).toEqual(expected.game);
    expect(client.getSnapshot().version).toBe(expected.version);
  }
}
function confirmCommand(state: PartyState, playerId: string): PartyCommand {
  const player = state.players.find(p => p.id === playerId)!;
  const legal = getPartyLegalActions(state, playerId);
  const forced = player.dice.filter(d => d.forced).map(d => d.id);
  const rest = player.dice.filter(d => !d.forced).map(d => d.id);
  return { type: 'confirm', playerId, diceIds: [...forced, ...rest.slice(0, Math.max(0, legal.requiredDice - forced.length))] };
}

describe('real party game through multiplayer sessions', () => {
  it.each(modes.flatMap(mode => [4, 8].map(count => ({ mode, count }))))('atomically confirms a full $mode round for $count people', async ({ mode, count }) => {
    const x = await setup(mode, count);
    expect(isPartyState(x.initial)).toBe(true);
    await Promise.all(x.clients.map(client => client.sendCommand(confirmCommand(x.initial, client.getSnapshot().myId)))); await flush();
    assertSynchronized(x);
    const resolved = x.host.getSnapshot().game!;
    expect(['results', 'finished']).toContain(resolved.phase);
    expect(resolved.results).toHaveLength(count);
    expect(x.host.getSnapshot().version).toBe(count + 1);
    const last = x.network.deliveries.filter(d => d.topic.endsWith('/intent') && (d.message as { kind?: string }).kind === 'command').at(-1)!;
    await x.network.replay(last); await flush();
    expect(x.host.getSnapshot().game).toEqual(resolved);
    if (resolved.phase === 'results') {
      await Promise.all(x.clients.map(client => client.sendCommand({ type: 'ready', playerId: client.getSnapshot().myId }))); await flush();
      expect(x.host.getSnapshot().game?.round).toBe(2);
      expect(x.host.getSnapshot().game?.phase).toBe('planning');
      assertSynchronized(x);
    }
    expect(Math.max(...x.network.deliveries.map(d => bytes(d.message)))).toBeLessThan(256 * 1024);
    const updates = x.network.deliveries.filter(d => d.topic.endsWith('/state') && (d.message as { kind?: string }).kind === 'update');
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every(d => !Object.hasOwn((d.message as { delta: object }).delta, 'catalog'))).toBe(true);
  });

  it.each(modes)('finishes a complete eight-person %s game and returns every seat to the lobby', async mode => {
    const x = await setup(mode, 8, 4);
    let decisions = 0;
    while (x.host.getSnapshot().game!.phase !== 'finished' && decisions < 600) {
      const state = x.host.getSnapshot().game!;
      const commands = state.players.map(p => choosePartyAiCommand(state, p.id)).filter((c): c is PartyCommand => c !== null);
      expect(commands.length, `${mode} stalled in round ${state.round} ${state.phase}`).toBeGreaterThan(0);
      await Promise.all(commands.map(command => x.clients.find(client => client.getSnapshot().myId === command.playerId)!.sendCommand(command)));
      decisions += commands.length; await flush(); assertSynchronized(x);
    }
    expect(x.host.getSnapshot().game?.phase).toBe('finished');
    expect(x.host.getSnapshot().game?.reason).toBeTruthy();
    if (mode !== 'raid') expect(x.host.getSnapshot().game?.winnerTeamIds.length).toBeGreaterThan(0);
    expect(decisions).toBeLessThan(600);
    const maxPacket = Math.max(...x.network.deliveries.map(d => bytes(d.message)));
    expect(maxPacket, `${mode} largest packet was ${maxPacket} bytes`).toBeLessThan(256 * 1024);
    await x.host.returnToLobby(); await flush();
    for (const client of x.clients) {
      expect(client.getSnapshot().status).toBe('lobby');
      expect(client.getSnapshot().game).toBeNull();
      expect(client.getSnapshot().room?.players).toHaveLength(8);
      expect(client.getSnapshot().room?.players.every(p => !p.ready)).toBe(true);
    }
    await Promise.all(x.clients.slice(1).map(client => client.leave())); await flush();
    expect(x.host.getSnapshot().room?.players).toHaveLength(1);
  }, 20000);

  it('allows only the host to advance AI substitutes through a whole game', async () => {
    const x = await setup('duos', 2, 3, 35671, 4);
    const botCommand = choosePartyAiCommand(x.initial, 'player_2')!;
    expect(botCommand).toBeTruthy();
    await expect(x.clients[1].sendCommand(botCommand)).rejects.toThrow('只能操作自己的角色');
    let operations = 0;
    while (x.host.getSnapshot().game!.phase !== 'finished' && operations++ < 400) {
      const state = x.host.getSnapshot().game!;
      const command = state.players.map(p => choosePartyAiCommand(state, p.id)).find(c => c !== null);
      expect(command, `${state.phase} had no legal AI decision`).toBeTruthy();
      const sender = command!.playerId === 'player_1' ? x.clients[1] : x.host;
      await sender.sendCommand(command!); await flush();
    }
    expect(x.host.getSnapshot().game?.phase).toBe('finished');
    assertSynchronized(x);
  }, 20000);

  it('rejects a delayed exchange when its recipient has rerolled the same die', async () => {
    const x = await setup('raid', 4, 4, 54721);
    const actor = x.initial.players[2], recipient = x.initial.players[1];
    const own = actor.dice.find(d => !d.forced)!, target = recipient.dice.find(d => !d.forced)!;
    const exchange: PartyCommand = { type: 'exchange', playerId: actor.id, targetPlayerId: recipient.id, ownDieId: own.id, targetDieId: target.id };
    const reroll: PartyCommand = { type: 'reroll', playerId: recipient.id, diceIds: [target.id] };
    const preview = applyPartyCommand(x.initial, reroll); expect(preview.error).toBeUndefined();
    expect(preview.state.players[1].dice.find(d => d.id === target.id)?.value).not.toBe(target.value);
    let held: FakeDelivery | undefined;
    x.network.drop = delivery => {
      if (delivery.to === x.buses[0].id && delivery.topic.endsWith('/intent') && (delivery.message as { command?: PartyCommand }).command?.type === 'exchange') { held = delivery; return true; }
      return false;
    };
    const pending = x.clients[2].sendCommand(exchange);
    // Register a rejection handler before releasing the old operation.
    const rejected = expect(pending).rejects.toThrow('骰池或操作阶段已更新');
    await flush(); expect(held).toBeTruthy();
    await x.clients[1].sendCommand(reroll); await flush();
    x.network.drop = null; await x.network.replay(held!); await rejected; await flush();
    expect(x.host.getSnapshot().game?.players[2].dice.some(d => d.id === own.id)).toBe(true);
    expect(x.host.getSnapshot().game?.players[1].dice.some(d => d.id === target.id)).toBe(true);
    assertSynchronized(x);
  });
});

/** Opt-in: creates a temporary private four-person room, then removes retained packets. */
it.skipIf(process.env.SRC_MQTT_LIVE !== '1')('smoke-tests four real MQTT players in a party room', async () => {
  const buses = Array.from({ length: 4 }, () => new MqttBus());
  const clients = buses.map((bus, i) => new OnlineSession<PartyState, PartyCommand>({ ...common, autoTick: true, name: `多人联机测试 ${i + 1}`, bus }));
  let code: string | undefined;
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 15000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    if (!predicate()) throw new Error('多人 MQTT 同步超时');
  };
  try {
    const room = await clients[0].createRoom({ mode: 'treasure', capacity: 4 }); code = room.code;
    await Promise.all(clients.slice(1).map(client => client.joinRoom(room.code)));
    await Promise.all(clients.map(client => client.setReady(true)));
    await until(() => clients[0].getSnapshot().room?.players.every(p => p.ready) === true);
    const game = createPartyMatch({ mode: 'treasure', maxRounds: 2, players: clients.map(client => ({ id: client.getSnapshot().myId, name: '联机测试', cardId: '264026' })) }, 12345);
    expect(bytes(game)).toBeLessThan(256 * 1024);
    await clients[0].startMatch(game);
    await until(() => clients.every(client => client.getSnapshot().game !== null));
    await Promise.all(clients.map(client => client.sendCommand(confirmCommand(game, client.getSnapshot().myId))));
    await until(() => clients.every(client => client.getSnapshot().version === 5));
    for (const client of clients) expect(client.getSnapshot().game).toEqual(clients[0].getSnapshot().game);
    await clients[0].returnToLobby();
    await until(() => clients.every(client => client.getSnapshot().game === null));
  } finally {
    await clients[0].leave().catch(() => {});
    if (code && buses[0].connected) {
      const topics = roomTopics(code);
      await buses[0].publish(topics.room, null, true).catch(() => {});
      await buses[0].publish(topics.state, null, true).catch(() => {});
    }
    for (const client of clients) client.destroy();
  }
}, 60000);
