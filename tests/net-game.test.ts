import { gameCommandScope, gameStateCodec } from '../src/net/gameSync';
import { describe, expect, it, vi } from 'vitest';
import { applyCommand, chooseAiCommand, createMatch, getLegalActions } from '../src/game';
import type { GameCommand, GameState, MatchConfig } from '../src/game/types';
import { coopStages } from '../src/data';
import { OnlineSession } from '../src/net/session';
import { FakeBroker } from '../src/net/testing';
import type { CommandContext } from '../src/net/types';

async function flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const players = [{ id: 'player_host', name: '房主', cardId: '264026', gild: 2 }, { id: 'player_guest', name: '朋友', cardId: '264014', gild: 2 }];
const config = (mode: 'classic' | 'coop'): MatchConfig => ({ mode, players: mode === 'classic' ? players : [...players, { id: 'boss', name: '海原市长', cardId: coopStages[0].bossCardIds[0], isAI: true }], ...(mode === 'coop' ? { bossPhases: coopStages[0].bossCardIds.map(cardId => ({ cardId })) } : { startingSide: 'random' }) });
function reducer(state: GameState, command: GameCommand, context: CommandContext) {
  const actor = state.players.find(p => p.id === command.playerId);
  if (!actor || (actor.id !== context.playerId && !(context.seat === 0 && actor.isAI))) throw new Error('不能操作其他角色');
  const result = applyCommand(state, command);
  if (result.error) throw new Error(result.error);
  return result.state;
}

describe('actual card game state through the room protocol', () => {
  it('synchronizes either random opener, preserves it on reload and draws again for a rematch', async () => {
    const network = new FakeBroker();
    const common = { reduce: reducer, commandScope: gameCommandScope, stateCodec: gameStateCodec, autoTick: false, discoveryMs: 1 };
    const host = new OnlineSession<GameState, GameCommand>({ ...common, name: '房主', clientId: 'player_host', bus: network.createBus('host') });
    let guest = new OnlineSession<GameState, GameCommand>({ ...common, name: '朋友', clientId: 'player_guest', bus: network.createBus('guest') });
    try {
      const room = await host.createRoom({ mode: 'duel' });
      await guest.joinRoom(room.code);
      for (const [seed, side] of [[1, 0], [8192, 1]] as const) {
        await host.setReady(true); await guest.setReady(true); await flush();
        const game = createMatch(config('classic'), seed);
        await host.startMatch(game); await flush();
        expect(game.attackingSide).toBe(side);
        expect(game.activePlayerId).toBe(players[side].id);
        expect(guest.getSnapshot().game).toEqual(game);
        expect(host.getSnapshot().seat).toBe(0); expect(guest.getSnapshot().seat).toBe(1);

        const checkpoint = guest.getCheckpoint()!;
        guest.destroy();
        guest = new OnlineSession<GameState, GameCommand>({ ...common, name: '朋友', bus: network.createBus(`guest_restored_${seed}`) });
        await guest.restore(checkpoint); await flush();
        expect(guest.getSnapshot().game).toEqual(game);
        expect(guest.getSnapshot().game).toEqual(host.getSnapshot().game);

        const attacker = game.players[side], defender = game.players[1 - side];
        const diceIds = attacker.dice.slice(0, getLegalActions(game, attacker.id).requiredDice).map(die => die.id);
        await (side === 0 ? host : guest).sendCommand({ type: 'confirm', playerId: attacker.id, diceIds }); await flush();
        expect(host.getSnapshot().game!.activePlayerId).toBe(defender.id);
        expect(host.getSnapshot().game!.attackingSide).toBe(side);
        expect(guest.getSnapshot().game).toEqual(host.getSnapshot().game);
        await (side === 0 ? guest : host).sendCommand({ type: 'surrender', playerId: defender.id }); await flush();
        await host.returnToLobby(); await flush();
      }
    } finally { guest.destroy(); host.destroy(); }
  });
  for (const mode of ['classic', 'coop'] as const) it(`keeps ${mode} snapshots and receipts within 256 KiB and synchronizes real commands`, async () => {
    const network = new FakeBroker();
    const host = new OnlineSession<GameState, GameCommand>({ name: '房主', clientId: 'player_host', bus: network.createBus('host'), reduce: reducer, commandScope: gameCommandScope, stateCodec: gameStateCodec, autoTick: false, discoveryMs: 1 });
    const guest = new OnlineSession<GameState, GameCommand>({ name: '朋友', clientId: 'player_guest', bus: network.createBus('guest'), reduce: reducer, commandScope: gameCommandScope, stateCodec: gameStateCodec, autoTick: false });
    try {
      const room = await host.createRoom({ mode: mode === 'classic' ? 'duel' : 'coop' });
      await guest.joinRoom(room.code); await host.setReady(true); await guest.setReady(true); await flush();
      const game = createMatch(config(mode), 987);
      await host.startMatch(game); await flush();
      expect(guest.getSnapshot().game).toEqual(game);
      for (let i = 0; i < 30; i++) {
        const state = host.getSnapshot().game!; if (state.phase === 'finished') break;
        const actor = state.players.find(p => getLegalActions(state, p.id).canAct || getLegalActions(state, p.id).canShop);
        expect(actor).toBeTruthy();
        const command = chooseAiCommand(state, actor!.id); expect(command).toBeTruthy();
        await (actor!.id === 'player_guest' ? guest : host).sendCommand(command!);
        await flush(); expect(guest.getSnapshot().game).toEqual(host.getSnapshot().game);
      }
      const wireSizes = network.deliveries.map(d => bytes(d.message));
      const largest = Math.max(...wireSizes);
      expect(largest).toBeLessThan(256 * 1024);
      const loaded = structuredClone(host.getSnapshot().game!);
      // The engine retains at most 160 events; exercise a full dice-bearing log window.
      const event = loaded.log.find(e => e.dice?.length) || { id: 1, type: 'roll' as const, text: '重掷骰子', dice: loaded.players.flatMap(p => p.dice) };
      loaded.log = Array.from({ length: 160 }, (_, i) => ({ ...event, id: i + 1 }));
      const updates = network.deliveries.filter(d => d.topic.endsWith('/state') && (d.message as { kind?: string }).kind === 'update');
      expect(updates.length).toBeGreaterThan(0);
      for (const update of updates) {
        expect(update.message).not.toHaveProperty('game');
        expect(update.message).not.toHaveProperty('delta.changes.catalog');
        expect(update.message).not.toHaveProperty('delta.changes.log');
      }
      const acknowledgements = network.deliveries.filter(d => d.topic.includes('/response/'));
      expect(acknowledgements.length).toBeGreaterThan(0);
      expect(acknowledgements.every(d => !Object.hasOwn((d.message as { receipt: object }).receipt, 'game'))).toBe(true);
      const delta = gameStateCodec.encode(host.getSnapshot().game!, loaded);
      const fullLogBytes = bytes(delta);
      expect(fullLogBytes).toBeLessThan(256 * 1024);
      console.info(`[network v2 size] ${mode}: initial=${bytes(game)}B, max update=${Math.max(...updates.map(d => bytes(d.message)))}B, max ack=${Math.max(...acknowledgements.map(d => bytes(d.message)))}B`);
    } finally { guest.destroy(); host.destroy(); }
  });
  for (const latency of [300, 1000]) it(`confirms both co-op selections atomically at ${latency} ms latency`, async () => {
    const network = new FakeBroker();
    const common = { reduce: reducer, commandScope: gameCommandScope, stateCodec: gameStateCodec, autoTick: false, discoveryMs: 1 };
    const host = new OnlineSession<GameState, GameCommand>({ ...common, name: '房主', clientId: 'player_host', bus: network.createBus('host') });
    const guest = new OnlineSession<GameState, GameCommand>({ ...common, name: '朋友', clientId: 'player_guest', bus: network.createBus('guest') });
    try {
      const room = await host.createRoom({ mode: 'coop' });
      await guest.joinRoom(room.code); await host.setReady(true); await guest.setReady(true); await flush();
      let game = createMatch({ ...config('coop'), weather: 'off' }, 987);
      if (game.phase === 'tactics') for (const player of players) game = applyCommand(game, { type: 'leaveTactics', playerId: player.id }).state;
      await host.startMatch(game); await flush();
      const diceIds = game.players.slice(0, 2).map(player => player.dice.slice(0, getLegalActions(game, player.id).requiredDice).map(die => die.id));
      expect(diceIds.every(ids => ids.length > 0)).toBe(true);
      const offset = network.deliveries.length;
      vi.useFakeTimers(); network.latencyMs = latency;
      const guestConfirm = guest.sendCommand({ type: 'confirm', playerId: 'player_guest', diceIds: diceIds[1] });
      await flush();
      const hostConfirm = await host.sendCommand({ type: 'confirm', playerId: 'player_host', diceIds: diceIds[0] });
      expect(hostConfirm.players[0].rollLocked).toBe(true);
      expect(guest.getSnapshot().game!.players[0].rollLocked).toBe(false);
      await vi.advanceTimersByTimeAsync(latency * 3); await flush();
      await guestConfirm;
      expect(host.getSnapshot().game!.phase).toBe('swap');
      expect(host.getSnapshot().game!.players.slice(0, 2).every(player => player.rollLocked)).toBe(true);
      expect(guest.getSnapshot().game).toEqual(host.getSnapshot().game);
      const commands = network.deliveries.slice(offset).filter(delivery => delivery.to === 'host' && (delivery.message as { kind?: string }).kind === 'command');
      expect(commands).toHaveLength(1);
      expect(commands[0].message).toHaveProperty('command.type', 'confirm');
      expect(commands[0].message).toHaveProperty('command.diceIds', diceIds[1]);
      expect(host.getSnapshot().version).toBe(3);
    } finally { guest.destroy(); host.destroy(); vi.useRealTimers(); }
  });

  it('round-trips bounded event windows across actual JSON serialization', () => {
    const before = createMatch(config('classic'), 987);
    const next = structuredClone(before);
    const template = before.log.at(-1)!;
    const baseId = template.id;
    next.log = Array.from({ length: 160 }, (_, i) => ({ ...template, id: baseId + i + 1 }));
    next.nextId += 160;
    const payload = JSON.parse(JSON.stringify(gameStateCodec.encode(before, next)));
    expect(gameStateCodec.decode(before, payload)).toEqual(next);
    expect(payload).not.toHaveProperty('changes.catalog');
    expect(payload).not.toHaveProperty('changes.log');
  });

  it('buys a tactic in a new co-op room after reusing the same duel client sessions', async () => {
    const network = new FakeBroker();
    const common = { reduce: reducer, commandScope: gameCommandScope, stateCodec: gameStateCodec, autoTick: false, discoveryMs: 1 };
    const host = new OnlineSession<GameState, GameCommand>({ ...common, name: '房主', clientId: 'player_host', bus: network.createBus('host') });
    const guest = new OnlineSession<GameState, GameCommand>({ ...common, name: '朋友', clientId: 'player_guest', bus: network.createBus('guest') });
    try {
      const firstRoom = await host.createRoom({ mode: 'duel' });
      await guest.joinRoom(firstRoom.code); await host.setReady(true); await guest.setReady(true); await flush();
      await host.startMatch(createMatch(config('classic'), 987)); await flush();
      await guest.sendCommand({ type: 'surrender', playerId: 'player_guest' }); await flush();
      expect(guest.getCheckpoint()!.nextSeq).toBe(1);
      await host.returnToLobby(); await flush(); await host.leave(); await flush();
      const nextRoom = await host.createRoom({ mode: 'coop' });
      await guest.joinRoom(nextRoom.code); await host.setReady(true); await guest.setReady(true); await flush();
      const nextGame = createMatch({ ...config('coop'), coopStageId: '1002' }, 4321);
      nextGame.players[1].offers = [nextGame.catalog.tactics.find(tactic => tactic.cost === 2)!.id];
      await host.startMatch(nextGame); await flush();
      const before = guest.getSnapshot().game!;
      expect(before.phase).toBe('tactics');
      const actor = before.players.find(player => player.id === 'player_guest')!;
      const offerIndex = actor.offers.findIndex(id => before.catalog.tactics.find(tactic => tactic.id === id)!.cost <= actor.tacticPoints);
      expect(offerIndex).toBeGreaterThanOrEqual(0);
      const bought = await guest.sendCommand({ type: 'buyTactic', playerId: 'player_guest', offerIndex }); await flush();
      expect(bought.players.find(player => player.id === 'player_guest')!.tactics).toContain(actor.offers[offerIndex]);
      expect(host.getSnapshot().game).toEqual(guest.getSnapshot().game);
      expect(guest.getCheckpoint()!.nextSeq).toBe(1);
    } finally { guest.destroy(); host.destroy(); }
  });

});
