import { gameCommandScope, gameStateCodec } from '../src/net/gameSync';
import { expect, it } from 'vitest';
import { MqttBus, roomTopics } from '../src/net/mqtt';
import { OnlineSession } from '../src/net/session';
import { applyCommand, chooseAiCommand, createMatch } from '../src/game';
import type { GameCommand, GameState } from '../src/game/types';
import { coopStages } from '../src/data';
import type { CommandContext } from '../src/net/types';

/** Opt-in integration test; creates one temporary private room on the public broker. */
it.skipIf(process.env.SRC_MQTT_LIVE !== '1')('synchronizes two real MQTT clients through the public EMQX server', async () => {
  const hostBus = new MqttBus(); const guestBus = new MqttBus();
  const reduce = (state: { points: number }, command: { add: number }) => ({ points: state.points + command.add });
  const host = new OnlineSession({ name: '联机测试房主', bus: hostBus, reduce });
  const guest = new OnlineSession({ name: '联机测试队友', bus: guestBus, reduce });
  let code: string | undefined;
  try {
    const room = await host.createRoom({ mode: 'duel' }); code = room.code;
    await guest.joinRoom(code);
    await host.setReady(true); await guest.setReady(true);
    const deadline = Date.now() + 6000;
    while (!host.getSnapshot().room?.players.every(p => p.ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    await host.startMatch({ points: 0 });
    while (guest.getSnapshot().game === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    const result = await guest.sendCommand({ add: 7 });
    expect(result.points).toBe(7);
    expect(host.getSnapshot().game?.points).toBe(7);
    expect(guest.getSnapshot().version).toBe(host.getSnapshot().version);
  } finally {
    await guest.leave().catch(() => {}); await host.leave().catch(() => {});
    if (code && hostBus.connected) {
      const topics = roomTopics(code);
      await hostBus.publish(topics.room, null, true).catch(() => {});
      await hostBus.publish(topics.state, null, true).catch(() => {});
    }
    guest.destroy(); host.destroy();
  }
}, 40000);

for (const mode of ['classic', 'coop'] as const) it.skipIf(process.env.SRC_MQTT_LIVE !== '1')(`finishes a complete ${mode} match through real EMQX clients`, async () => {
  const started = Date.now();
  const hostBus = new MqttBus(); let guestBus = new MqttBus();
  const reduce = (state: GameState, command: GameCommand, context: CommandContext) => {
    const actor = state.players.find(player => player.id === command.playerId);
    if (!actor || actor.id !== context.playerId && !(context.seat === 0 && actor.isAI)) throw new Error('不能操作其他玩家的角色');
    const result = applyCommand(state, command);
    if (result.error) throw new Error(result.error);
    return result.state;
  };
  const host = new OnlineSession({ name: '完整状态测试房主', bus: hostBus, reduce, commandScope: gameCommandScope, stateCodec: gameStateCodec });
  let guest = new OnlineSession({ name: '完整状态测试队友', bus: guestBus, reduce, commandScope: gameCommandScope, stateCodec: gameStateCodec });
  let code: string | undefined;
  // Wait for actual MQTT snapshot notifications; there is no per-command polling delay.
  const wait = (test: () => boolean) => {
    if (test()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const finish = () => { clearTimeout(timeout); offHost(); offGuest(); };
      const check = () => { if (test()) { finish(); resolve(); } };
      const offHost = host.subscribe(check); const offGuest = guest.subscribe(check);
      const timeout = setTimeout(() => { finish(); reject(new Error(`${mode}: waiting for synchronized MQTT snapshots timed out`)); }, 12000);
      check();
    });
  };
  try {
    const room = await host.createRoom({ mode: mode === 'classic' ? 'duel' : 'coop' }); code = room.code;
    await guest.joinRoom(code); await host.setReady(true); await guest.setReady(true);
    await wait(() => host.getSnapshot().room?.players.every(p => p.ready) === true);
    const players = [{ id: host.getSnapshot().myId, name: '房主', cardId: '264026' }, { id: guest.getSnapshot().myId, name: '朋友', cardId: '264014' }];
    // This published stage has two boss phases and enables the full tactics/swap loop.
    const stage = coopStages.find(candidate => candidate.id === '1002')!;
    const first = createMatch({ mode, players, ...(mode === 'coop' ? { coopStageId: stage.id, bossPhases: stage.bossCardIds.map(cardId => ({ cardId })) } : {}) }, 4321);
    await host.startMatch(first); await wait(() => guest.getSnapshot().game !== null);
    expect(guest.getSnapshot().game).toEqual(first);
    let state = first;
    let operations = 0;
    let reconnects = 0;
    const operationCounts = { host: 0, guest: 0, boss: 0 };
    const bossPhases = new Set([state.bossPhase]);
    const visitedPhases = new Set([state.phase]);
    while (state.phase !== 'finished' && operations < 250) {
      const command = state.players.map(player => chooseAiCommand(state, player.id)).find(candidate => candidate !== null);
      expect(command, `${mode} stalled in ${state.phase} on turn ${state.turn}`).toBeTruthy();
      if (!command) throw new Error('No legal AI command');
      const sender = command.playerId === players[1].id ? guest : host;
      const actor = command.playerId === 'boss' ? 'boss' : sender === guest ? 'guest' : 'host';
      const nextVersion = host.getSnapshot().version + 1;
      const previousTurn = state.turn;
      state = await sender.sendCommand(command);
      operationCounts[actor]++; operations++;
      bossPhases.add(state.bossPhase); visitedPhases.add(state.phase);
      await wait(() => host.getSnapshot().version === nextVersion && guest.getSnapshot().version === nextVersion);
      if (state.turn !== previousTurn || state.phase === 'finished') expect(guest.getSnapshot().game).toEqual(host.getSnapshot().game);
      if (state.lastResolution && state.phase !== 'finished' && reconnects === 0) {
        // A refreshed guest must retain its seat, sequence, and exact comparison metadata.
        const checkpoint = guest.getCheckpoint()!;
        expect(checkpoint.game?.lastResolution).toEqual(state.lastResolution);
        guest.destroy();
        guestBus = new MqttBus();
        guest = new OnlineSession({ name: '完整状态测试队友', bus: guestBus, reduce, commandScope: gameCommandScope, stateCodec: gameStateCodec });
        await guest.restore(checkpoint);
        await wait(() => guest.getSnapshot().status === 'playing' && guest.getSnapshot().version === host.getSnapshot().version);
        expect(guest.getSnapshot().myId).toBe(players[1].id);
        expect(guest.getSnapshot().game?.lastResolution).toEqual(host.getSnapshot().game?.lastResolution);
        reconnects++;
      }
    }
    expect(state.phase, `${mode} exceeded the 250-command safety limit`).toBe('finished');
    expect(state.winner).toBe(0);
    expect(state.reason).not.toContain('回合上限');
    expect(operationCounts.host).toBeGreaterThan(0);
    expect(operationCounts.guest).toBeGreaterThan(0);
    expect(guest.getSnapshot().game).toEqual(state);
    expect(host.getSnapshot().game).toEqual(state);
    expect(guest.getSnapshot().game?.winner).toBe(host.getSnapshot().game?.winner);
    expect(reconnects).toBe(1);
    expect(state.lastResolution?.turn).toBe(state.turn);
    expect(state.lastResolution?.players).toHaveLength(mode === 'classic' ? 2 : 3);
    expect(state.lastResolution?.players.every(player => Number.isFinite(player.value) && player.dice.length > 0)).toBe(true);
    expect(guest.getSnapshot().game?.lastResolution).toEqual(host.getSnapshot().game?.lastResolution);
    if (mode === 'coop') {
      expect(operationCounts.boss).toBeGreaterThan(0);
      expect([...bossPhases]).toEqual(stage.bossCardIds.map((_, index) => index));
      expect(state.players.find(player => player.id === 'boss')?.hp).toBe(0);
      expect(visitedPhases.has('tactics')).toBe(true);
      expect(visitedPhases.has('swap')).toBe(true);
    }
    console.info(`[MQTT full match] ${JSON.stringify({ mode, seed: 4321, turns: state.turn, operations, operationCounts, bossPhases: [...bossPhases], reconnects, finalValues: state.lastResolution?.players.map(player => ({ role: player.role, value: player.value })), winner: state.winner, elapsedMs: Date.now() - started })}`);
  } finally {
    await guest.leave().catch(() => {}); await host.leave().catch(() => {});
    if (code && hostBus.connected) { const t = roomTopics(code); await hostBus.publish(t.room, null, true).catch(() => {}); await hostBus.publish(t.state, null, true).catch(() => {}); }
    guest.destroy(); host.destroy();
  }
}, 180000);


it.skipIf(process.env.SRC_MQTT_LIVE !== '1')('reuses the same real MQTT sessions across two room epochs', async () => {
  const hostBus = new MqttBus(), guestBus = new MqttBus();
  const reduce = (state: { points: number }, command: { add: number }) => ({ points: state.points + command.add });
  const host = new OnlineSession({ name: '换房复用房主', bus: hostBus, reduce });
  const guest = new OnlineSession({ name: '换房复用客人', bus: guestBus, reduce });
  const codes: string[] = [];
  const wait = async (test: () => boolean) => {
    const deadline = Date.now() + 12000;
    while (!test() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 80));
    expect(test()).toBe(true);
  };
  try {
    for (const [index, mode] of (['duel', 'coop'] as const).entries()) {
      const room = await host.createRoom({ mode }); codes.push(room.code);
      await guest.joinRoom(room.code);
      expect(guest.getCheckpoint()!.nextSeq).toBe(0);
      await host.setReady(true); await guest.setReady(true);
      await wait(() => host.getSnapshot().room!.players.every(player => player.ready));
      await host.startMatch({ points: 0 });
      await wait(() => guest.getSnapshot().game !== null);
      const result = await guest.sendCommand({ add: index + 3 });
      expect(result.points).toBe(index + 3);
      expect(guest.getCheckpoint()!.nextSeq).toBe(1);
      expect(host.getSnapshot().game).toEqual(guest.getSnapshot().game);
      await host.returnToLobby();
      await wait(() => guest.getSnapshot().status === 'lobby');
      await host.leave();
      await wait(() => guest.getSnapshot().status === 'closed');
    }
    console.info('[MQTT room reuse] two client sessions reused across duel → coop; guest commands start at sequence 1 in both epochs');
  } finally {
    await guest.leave().catch(() => {}); await host.leave().catch(() => {});
    for (const code of codes) if (hostBus.connected) {
      const topics = roomTopics(code);
      await hostBus.publish(topics.room, null, true).catch(() => {});
      await hostBus.publish(topics.state, null, true).catch(() => {});
    }
    guest.destroy(); host.destroy();
  }
}, 60000);
