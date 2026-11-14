import { createClientId, DEFAULT_BROKER, generateRoomCode, MqttBus, NAMESPACE, normalizeBroker, roomTopics } from './mqtt';
import type { CommandReceipt, ConnectionStatus, MessageBus, OnlineSessionOptions, OnlineSnapshot, RoomInfo, RoomMode, SessionCheckpoint } from './types';

export const ONLINE_TIMING = { heartbeat: 5000, stale: 16000, disconnectGrace: 120000, retry: 1500, commandTimeout: 18000 } as const;
const codePattern = /^\d{6}$/;
const idPattern = /^[A-Za-z0-9_-]{3,60}$/;
const copy = <T>(value: T): T => structuredClone(value);
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const cleanName = (name: string) => name.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 16) || '开拓者';
const roomModes: readonly RoomMode[] = ['duel', 'coop', 'treasure', 'raid', 'duos', 'overlord'];
export const isPartyRoomMode = (mode: RoomMode): boolean => mode !== 'duel' && mode !== 'coop';
export const getRoomCapacity = (room: Pick<RoomInfo, 'mode' | 'capacity'>): number => room.capacity ?? (isPartyRoomMode(room.mode) ? 8 : 2);
function validCapacity(mode: RoomMode, capacity: number): boolean {
  return Number.isInteger(capacity) && (isPartyRoomMode(mode)
    ? capacity >= 4 && capacity <= 8 && (mode !== 'duos' || capacity % 2 === 0)
    : capacity === 2);
}
type Envelope = { protocol: 2; epoch: string; sender: string; kind: string; [key: string]: unknown };
interface StatePacket<S> { protocol: 2; epoch: string; sender: string; version: number; matchId: string | null; kind: 'snapshot' | 'update'; game?: S | null; baseVersion?: number; delta?: unknown; sequences: Record<string, number> }
interface Pending<S> { receipt?: CommandReceipt; message: Envelope; created: number; sent: number; resolve: (state: S) => void; reject: (error: Error) => void }

export function parseRoomInvite(input: string): { code: string; broker?: string } {
  const text = input.trim();
  if (codePattern.test(text)) return { code: text };
  try {
    const url = new URL(text, typeof location === 'undefined' ? 'https://starrailcard.local' : location.href);
    const hash = new URLSearchParams(url.hash.slice(1));
    const code = url.searchParams.get('room') || hash.get('room') || '';
    const broker = url.searchParams.get('broker') || hash.get('broker');
    if (codePattern.test(code)) return { code, ...(broker ? { broker: normalizeBroker(broker) } : {}) };
  } catch { /* Fall through to a human-readable validation error. */ }
  throw new Error('请输入六位数字房间号或完整邀请链接');
}
function validRoom(value: unknown, code?: string): value is RoomInfo {
  if (!value || typeof value !== 'object') return false;
  const v = value as RoomInfo;
  return typeof v.code === 'string' && codePattern.test(v.code) && (!code || v.code === code) && typeof v.epoch === 'string' && idPattern.test(v.epoch) && typeof v.hostId === 'string' && idPattern.test(v.hostId)
    && roomModes.includes(v.mode) && validCapacity(v.mode, getRoomCapacity(v)) && typeof v.public === 'boolean' && ['lobby', 'playing', 'paused', 'closed'].includes(v.phase)
    && Number.isSafeInteger(v.revision) && v.revision >= 0 && Number.isFinite(v.createdAt) && Number.isFinite(v.updatedAt)
    && Array.isArray(v.players) && v.players.length >= 1 && v.players.length <= getRoomCapacity(v)
    && v.players.every(p => p && typeof p.id === 'string' && idPattern.test(p.id) && typeof p.name === 'string' && p.name.length <= 32 && Number.isInteger(p.seat) && p.seat >= 0 && p.seat < getRoomCapacity(v) && typeof p.ready === 'boolean')
    && new Set(v.players.map(p => p.id)).size === v.players.length && new Set(v.players.map(p => p.seat)).size === v.players.length
    && v.players.some(p => p.id === v.hostId && p.seat === 0);
}

/** Host-authoritative, versioned room session. The reducer is the only game rule boundary. */
export class OnlineSession<S, C> {
  private bus: MessageBus;
  private options: OnlineSessionOptions<S, C>;
  private value: OnlineSnapshot<S>;
  private subscribers = new Set<(snapshot: OnlineSnapshot<S>) => void>();
  private unsubs: Array<() => void> = [];
  private statusUnsub: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private roomCode: string | null = null;
  private lastSeen: Record<string, number> = {};
  private sequences: Record<string, number> = {};
  private receipts: Record<string, CommandReceipt> = {};
  private controlTimes: Record<string, number> = {};
  private lastControlTime = 0;
  private nextSeq = 0;
  private lastHeartbeat = 0;
  private pending = new Map<string, Pending<S>>();
  private hostQueue: Promise<void> = Promise.resolve();
  private commandQueue: Promise<unknown> = Promise.resolve();
  private matching = false;
  private matchmakingUnsub: (() => void) | null = null;
  private joiningCandidate = false;
  private cachedState: StatePacket<S> | null = null;
  private matchId: string | null = null;
  private outgoing: Promise<void> = Promise.resolve();
  private syncRequestedAt: number | null = null;
  private pendingRecovery = false;

  private enqueueIntent(data: unknown): Promise<void> {
    const job = this.hostQueue.then(() => this.receiveIntent(data));
    this.hostQueue = job.catch(e => this.error(e));
    return job;
  }
  private queuePublish(job: () => Promise<void>) {
    this.outgoing = this.outgoing.then(job).catch(e => this.error(e));
  }
  /** Sequence numbers belong to one room epoch, never to the reusable browser client. */
  private resetRoomCounters() {
    this.nextSeq = 0; this.sequences = {}; this.receipts = {}; this.controlTimes = {}; this.lastControlTime = 0; this.lastSeen = {};
    this.cachedState = null; this.matchId = null; this.syncRequestedAt = null; this.pendingRecovery = false;
  }

  constructor(options: OnlineSessionOptions<S, C>) {
    this.options = options;
    this.bus = options.bus ?? new MqttBus(options.broker ?? DEFAULT_BROKER);
    this.value = { status: 'idle', connection: 'offline', room: null, myId: options.clientId ?? createClientId(), isHost: false, seat: null, game: null, version: 0, matchId: null, recoveryRevision: 0, error: null, pauseReason: null };
    this.attachStatus();
  }
  private now() { return this.options.now?.() ?? Date.now(); }
  get broker(): string { return this.bus.broker; }
  getSnapshot = (): OnlineSnapshot<S> => this.value;
  subscribe = (listener: (snapshot: OnlineSnapshot<S>) => void): (() => void) => { this.subscribers.add(listener); return () => { this.subscribers.delete(listener); }; };
  private emit(patch: Partial<OnlineSnapshot<S>> = {}) { this.value = { ...this.value, ...patch, matchId: this.matchId }; for (const fn of this.subscribers) fn(this.value); }
  private error(error: unknown) { this.emit({ error: error instanceof Error ? error.message : String(error) }); }
  private attachStatus() {
    this.statusUnsub?.();
    this.statusUnsub = this.bus.onStatus((connection: ConnectionStatus) => {
      this.emit({ connection });
      if (connection === 'connected' && this.value.room) {
        if (this.value.isHost && this.pendingRecovery) {
          this.pendingRecovery = false;
          this.emit({ recoveryRevision: this.value.recoveryRevision + 1 });
        }
        void this.heartbeat().then(() => this.value.isHost ? this.broadcast() : this.sendControl('sync')).catch(e => this.error(e));
      } else if (connection !== 'connected' && this.value.room?.phase === 'playing') {
        this.pendingRecovery = true;
        this.emit({ status: 'paused', pauseReason: '连接中断，保留对局两分钟，正在重连…' });
      }
    });
  }
  private async connect() {
    this.emit({ status: 'connecting', error: null });
    await this.bus.connect();
    this.emit({ connection: 'connected' });
    if (this.options.autoTick !== false && !this.timer) this.timer = setInterval(() => { void this.tick().catch(e => this.error(e)); }, 1000);
  }
  private async watch(code: string) {
    this.clearSubscriptions(); this.roomCode = code;
    const t = roomTopics(code);
    this.unsubs.push(await this.bus.subscribe(t.room, data => this.receiveRoom(data)));
    this.unsubs.push(await this.bus.subscribe(t.state, data => this.receiveState(data)));
    this.unsubs.push(await this.bus.subscribe(t.response(this.value.myId), data => this.receiveResponse(data)));
    this.unsubs.push(await this.bus.subscribe(t.heartbeat, data => this.receiveHeartbeat(data)));
    this.unsubs.push(await this.bus.subscribe(t.intent, data => {
      if (!this.value.isHost) return;
      void this.enqueueIntent(data);
    }));
  }
  private clearSubscriptions() { for (const fn of this.unsubs) fn(); this.unsubs = []; }
  private envelope(kind: string, fields: Record<string, unknown> = {}): Envelope {
    return { protocol: 2, epoch: this.value.room!.epoch, sender: this.value.myId, kind, ...fields };
  }
  private async sendControl(kind: string, fields: Record<string, unknown> = {}) {
    if (!this.value.room) return;
    const message = this.envelope(kind, { time: this.now(), ...fields });
    if (this.value.isHost) await this.enqueueIntent(message);
    else await this.bus.publish(roomTopics(this.value.room.code).intent, message);
  }
  private waitUntil(test: (snapshot: OnlineSnapshot<S>) => boolean, timeout: number, message: string): Promise<void> {
    if (test(this.value)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => { off(); reject(new Error(message)); }, timeout);
      const off = this.subscribe(snapshot => { if (test(snapshot)) { clearTimeout(timeoutId); off(); resolve(); } });
    });
  }
  async createRoom(config: { mode: RoomMode; capacity?: number; public?: boolean; code?: string }): Promise<RoomInfo> {
    const capacity = getRoomCapacity(config);
    if (!roomModes.includes(config.mode) || !validCapacity(config.mode, capacity)) throw new Error('房间人数无效：原模式限 2 人，多人模式为 4～8 人，搭档乱斗需偶数人数');
    if (this.value.room?.phase === 'closed') await this.leave();
    if (this.value.room) throw new Error('请先离开当前房间');
    await this.connect();
    let code = config.code ?? generateRoomCode();
    if (!codePattern.test(code)) throw new Error('房间号应为六位数字');
    // Probe retained metadata before allocating a code; stale rooms can be replaced after the grace window.
    for (let attempt = 0; attempt < 5; attempt++) {
      let occupied = false;
      const off = await this.bus.subscribe(roomTopics(code).room, data => { const packet = data as { room?: unknown }; if (validRoom(packet?.room, code) && packet.room.phase !== 'closed' && this.now() - packet.room.updatedAt < ONLINE_TIMING.disconnectGrace) occupied = true; });
      await delay(this.options.discoveryMs ?? 300); off();
      if (!occupied) break;
      if (config.code || attempt === 4) throw new Error('房间号已被占用');
      code = generateRoomCode();
    }
    const room: RoomInfo = { code, epoch: createClientId(), hostId: this.value.myId, mode: config.mode, capacity, public: !!config.public, phase: 'lobby', players: [{ id: this.value.myId, name: cleanName(this.options.name), seat: 0, ready: false }], revision: 0, createdAt: this.now(), updatedAt: this.now() };
    this.resetRoomCounters(); this.lastSeen = { [this.value.myId]: this.now() };
    this.emit({ room, isHost: true, seat: 0, status: this.matching ? 'matching' : 'lobby', game: null, version: 0, pauseReason: null });
    await this.watch(code); await this.save(); await this.broadcast(); await this.heartbeat();
    return this.value.room ?? room;
  }
  async joinRoom(input: string): Promise<RoomInfo> {
    if (this.value.room?.phase === 'closed') await this.leave();
    if (this.value.room) throw new Error('请先离开当前房间');
    const invite = parseRoomInvite(input);
    this.resetRoomCounters();
    this.emit({ game: null, version: 0, seat: null, isHost: false, error: null, pauseReason: null });
    if (invite.broker && invite.broker !== this.bus.broker) {
      if (this.options.bus) throw new Error('邀请链接与当前服务器不一致');
      this.bus.close(); this.bus = new MqttBus(invite.broker); this.attachStatus();
    }
    await this.connect(); await this.watch(invite.code);
    try {
      await this.waitUntil(s => !!s.room, this.options.joinTimeoutMs ?? 7000, '未找到新版房间，请双方更新后重新建房，并确认服务器一致');
      if (this.value.room!.phase !== 'lobby' && !this.value.room!.players.some(p => p.id === this.value.myId)) throw new Error('对局已经开始');
      if (this.value.room!.players.length >= getRoomCapacity(this.value.room!) && !this.value.room!.players.some(p => p.id === this.value.myId)) throw new Error('房间已满');
      if (this.now() - this.value.room!.updatedAt > ONLINE_TIMING.disconnectGrace) throw new Error('房间已过期');
      await this.sendControl('join', { name: cleanName(this.options.name) });
      const resend = setInterval(() => { void this.sendControl('join', { name: cleanName(this.options.name) }).catch(() => {}); }, this.options.retryMs ?? ONLINE_TIMING.retry);
      try {
        await this.waitUntil(s => s.seat !== null || s.error !== null, this.options.joinTimeoutMs ?? 7000, '房间已满或房主暂时离线');
        if (this.value.seat === null) throw new Error(this.value.error || '加入房间失败');
      }
      finally { clearInterval(resend); }
      this.lastSeen[this.value.room!.hostId] = this.now();
      this.emit({ status: this.value.room!.phase });
      await this.sendControl('sync'); await this.heartbeat(); await this.save();
      return this.value.room!;
    } catch (error) { this.clearSubscriptions(); this.roomCode = null; this.resetRoomCounters(); this.emit({ room: null, seat: null, isHost: false, status: 'idle', game: null, version: 0 }); this.error(error); throw error; }
  }
  async quickMatch(mode: RoomMode): Promise<RoomInfo> {
    if (isPartyRoomMode(mode)) throw new Error('多人模式请创建好友房，再通过房间号或邀请链接加入');
    if (this.value.room?.phase === 'closed') await this.leave();
    if (this.value.room) throw new Error('请先离开当前房间');
    await this.connect(); this.matching = true; this.emit({ status: 'matching' });
    const candidates = new Map<string, RoomInfo>();
    this.matchmakingUnsub?.();
    this.matchmakingUnsub = await this.bus.subscribe(`${NAMESPACE}/match/${mode}/+`, data => {
      const packet = data as { protocol?: number; room?: unknown };
      if (packet?.protocol !== 2 || !validRoom(packet.room) || packet.room.mode !== mode || packet.room.phase !== 'lobby' || packet.room.players.length !== 1 || this.now() - packet.room.updatedAt > ONLINE_TIMING.stale) return;
      candidates.set(packet.room.code, packet.room);
      const own = this.value.room;
      // Two players searching together converge on the older available room.
      if (this.matching && own && this.value.isHost && own.players.length === 1 && packet.room.hostId !== own.hostId
        && `${packet.room.createdAt}:${packet.room.code}` < `${own.createdAt}:${own.code}` && !this.joiningCandidate) {
        this.joiningCandidate = true;
        void this.switchMatch(packet.room.code).finally(() => { this.joiningCandidate = false; });
      }
    });
    await delay(this.options.discoveryMs ?? 800);
    const candidate = [...candidates.values()].sort((a, b) => a.createdAt - b.createdAt || a.code.localeCompare(b.code))[0];
    if (candidate) {
      try { const room = await this.joinRoom(candidate.code); this.matching = false; this.matchmakingUnsub?.(); this.matchmakingUnsub = null; return room; } catch { /* A racing join may fill it; create another waiting room. */ }
    }
    const created = await this.createRoom({ mode, public: true });
    // An advertisement can arrive while this client is probing its room code.
    // Re-check that window after allocation rather than waiting for another heartbeat.
    const earlier = [...candidates.values()].filter(r => r.hostId !== created.hostId && `${r.createdAt}:${r.code}` < `${created.createdAt}:${created.code}`)
      .sort((a, b) => a.createdAt - b.createdAt || a.code.localeCompare(b.code))[0];
    if (earlier && this.value.isHost && this.getSnapshot().room?.players.length === 1 && !this.joiningCandidate) {
      this.joiningCandidate = true;
      try { await this.switchMatch(earlier.code); } finally { this.joiningCandidate = false; }
    }
    return this.value.room ?? created;
  }
  private async switchMatch(code: string) {
    const mode = this.value.room?.mode ?? 'duel';
    try { await this.leave(false); this.matching = true; await this.joinRoom(code); this.matching = false; this.matchmakingUnsub?.(); this.matchmakingUnsub = null; }
    catch (error) {
      this.error(error);
      if (!this.value.room && this.bus.connected) { this.matching = true; await this.createRoom({ mode, public: true }); }
      else this.matching = false;
    }
  }
  async setReady(ready: boolean, loadout?: unknown, options?: { resetOthers?: boolean }): Promise<void> {
    if (this.value.room?.phase !== 'lobby' || this.value.seat === null) throw new Error('当前不能修改准备状态');
    // Bound user-controlled loadouts before sending them to the public broker.
    if (JSON.stringify(loadout ?? null).length > 8192) throw new Error('卡牌配置过大');
    // Rapid loadout edits and a following ready click must have distinct order,
    // even in the same millisecond, so a delayed edit cannot undo readiness.
    this.lastControlTime = Math.max(this.now(), this.lastControlTime + 1);
    const resetOthers = this.value.isHost && options?.resetOthers === true;
    await this.sendControl('ready', { time: this.lastControlTime, ready, ...(loadout !== undefined ? { loadout } : {}), ...(resetOthers ? { resetOthers: true } : {}) });
  }
  async startMatch(initialState: S): Promise<void> {
    const room = this.value.room;
    if (!room || !this.value.isHost) throw new Error('只有房主可以开始对局');
    if (room.phase !== 'lobby' || (!isPartyRoomMode(room.mode) && room.players.length !== 2) || room.players.some(p => !p.ready)) {
      throw new Error(isPartyRoomMode(room.mode) ? '等待所有玩家准备完成' : '等待两名玩家准备完成');
    }
    if (this.options.validateState && !this.options.validateState(initialState)) throw new Error('初始对局状态无效');
    this.matchId = createClientId();
    this.emit({ game: copy(initialState), version: this.value.version + 1, room: { ...room, phase: 'playing', revision: room.revision + 1, updatedAt: this.now() }, status: 'playing' });
    this.matching = false; this.matchmakingUnsub?.(); this.matchmakingUnsub = null;
    await this.save(); await this.broadcast();
  }
  /** Call after the game engine reports completion. Retains seats for another match. */
  async returnToLobby(): Promise<void> {
    const room = this.value.room;
    if (!room || !this.value.isHost) throw new Error('只有房主可以返回房间');
    if (room.phase === 'closed') throw new Error('房间已经关闭');
    this.rejectPending('已返回备战房间');
    this.matchId = null;
    this.emit({ game: null, version: this.value.version + 1, room: { ...room, phase: 'lobby', players: room.players.map(p => ({ ...p, ready: false })), revision: room.revision + 1, updatedAt: this.now() }, status: 'lobby', pauseReason: null, error: null });
    await this.save(); await this.broadcast();
  }
  sendCommand(command: C): Promise<S> {
    const epoch = this.value.room?.epoch, matchId = this.matchId;
    const job = this.commandQueue.then(() => {
      if (epoch !== this.value.room?.epoch || matchId !== this.matchId) throw new Error('对局已更换，请重新选择操作');
      return this.dispatchCommand(command);
    });
    this.commandQueue = job.catch(() => {});
    return job;
  }
  private dispatchCommand(command: C): Promise<S> {
    if (!this.value.room || this.value.room.phase !== 'playing' || this.value.status !== 'playing' || !this.bus.connected || this.value.seat === null) return Promise.reject(new Error('对局暂不可操作，请等待所有玩家连接恢复'));
    const id = createClientId();
    const context = { playerId: this.value.myId, seat: this.value.seat, version: this.value.version, matchId: this.matchId! };
    const scope = this.options.commandScope?.(this.value.game!, command, context);
    const message = this.envelope('command', { id, seq: ++this.nextSeq, baseVersion: this.value.version, matchId: this.matchId, ...(scope !== undefined ? { scope } : {}), command });
    return new Promise<S>((resolve, reject) => {
      this.pending.set(id, { message, created: this.now(), sent: this.now(), resolve, reject });
      if (this.value.isHost) void this.enqueueIntent(message).catch(e => this.error(e));
      else void this.bus.publish(roomTopics(this.value.room!.code).intent, message).catch(() => { /* tick retries this exact ID and sequence */ });
    });
  }
  private receiveRoom(data: unknown) {
    const packet = data as { protocol?: number; sender?: string; room?: unknown };
    if (packet?.protocol !== 2 || !validRoom(packet.room, this.roomCode ?? undefined) || packet.sender !== packet.room.hostId) return;
    const current = this.value.room;
    if (current && (packet.room.epoch !== current.epoch || packet.room.revision < current.revision)) return;
    if (this.value.isHost && packet.room.hostId === this.value.myId) return;
    const player = packet.room.players.find(p => p.id === this.value.myId);
    const status = this.matching && packet.room.players.length < getRoomCapacity(packet.room) ? 'matching' : packet.room.phase;
    if (packet.room.phase === 'paused' && current?.phase !== 'paused') this.pendingRecovery = true;
    this.emit({ room: copy(packet.room), seat: player?.seat ?? null, isHost: packet.room.hostId === this.value.myId, status, pauseReason: packet.room.phase === 'paused' ? '等待队友重新连接（最多两分钟）' : null });
    if (packet.room.players.length === getRoomCapacity(packet.room)) { this.matching = false; this.matchmakingUnsub?.(); this.matchmakingUnsub = null; }
    if (this.cachedState) { const saved = this.cachedState; this.cachedState = null; this.receiveState(saved); }
    if (player) void this.save().catch(e => this.error(e));
    if (packet.room.phase === 'closed') this.rejectPending('房间已关闭');
  }
  private requestSync() {
    if (!this.value.room || this.value.isHost || !this.bus.connected) return;
    if (this.syncRequestedAt !== null && this.now() - this.syncRequestedAt < (this.options.retryMs ?? ONLINE_TIMING.retry)) return;
    this.syncRequestedAt = this.now();
    this.pendingRecovery = true;
    void this.sendControl('sync').catch(e => this.error(e));
  }
  private receiveState(data: unknown) {
    const packet = data as StatePacket<S>;
    if (!packet || packet.protocol !== 2 || !Number.isSafeInteger(packet.version) || packet.version < 1 || !['snapshot', 'update'].includes(packet.kind)) return;
    if (!this.value.room) { if (packet.kind === 'snapshot') this.cachedState = packet; return; }
    if (this.value.room.phase === 'closed' || this.value.status === 'closed') return;
    if (packet.epoch !== this.value.room.epoch || packet.sender !== this.value.room.hostId || packet.version < this.value.version || this.value.isHost) return;
    if (packet.kind === 'update' && packet.version === this.value.version) return;
    if (packet.kind === 'snapshot' && packet.version === this.value.version && packet.matchId === this.matchId && !this.pendingRecovery) {
      // Failed commands advance their sender's sequence without changing game
      // version. A fresh sync can therefore carry newer high water marks while
      // its visual state is identical; merge those without emitting/replaying it.
      const sequences = this.safeSequences(packet.sequences);
      let changed = false;
      for (const [id, seq] of Object.entries(sequences)) if (seq > (this.sequences[id] ?? 0)) { this.sequences[id] = seq; changed = true; }
      this.nextSeq = Math.max(this.nextSeq, this.sequences[this.value.myId] ?? 0);
      if (changed) void this.save().catch(e => this.error(e));
      return;
    }
    let game: S | null;
    if (packet.kind === 'snapshot') {
      if (!Object.hasOwn(packet, 'game') || (packet.game !== null && (typeof packet.matchId !== 'string' || !idPattern.test(packet.matchId)))) return;
      game = packet.game!;
    } else {
      if (packet.baseVersion !== this.value.version || packet.matchId !== this.matchId || !this.value.game || !this.options.stateCodec) { this.requestSync(); return; }
      try { game = this.options.stateCodec.decode(this.value.game, packet.delta); } catch { this.requestSync(); return; }
    }
    if (game !== null && this.options.validateState && !this.options.validateState(game)) { this.requestSync(); return; }
    const recovery = packet.kind === 'snapshot' && (this.pendingRecovery || !!(this.options.stateCodec && this.value.game && packet.matchId === this.matchId && packet.version > this.value.version));
    this.matchId = packet.matchId;
    if (packet.kind === 'snapshot') { this.syncRequestedAt = null; this.pendingRecovery = false; }
    this.sequences = this.safeSequences(packet.sequences);
    this.nextSeq = Math.max(this.nextSeq, this.sequences[this.value.myId] ?? 0);
    this.emit({ game: copy(game), version: packet.version, recoveryRevision: this.value.recoveryRevision + (recovery ? 1 : 0) });
    this.settleAcknowledgements();
    void this.save().catch(e => this.error(e));
  }
  private safeSequences(input: unknown): Record<string, number> {
    const result: Record<string, number> = {};
    if (input && typeof input === 'object') for (const player of this.value.room?.players ?? []) {
      const value = (input as Record<string, unknown>)[player.id];
      if (Number.isSafeInteger(value) && Number(value) >= 0) result[player.id] = Number(value);
    }
    return result;
  }
  private receiveHeartbeat(data: unknown) {
    const packet = data as Envelope;
    if (packet?.protocol !== 2 || packet.epoch !== this.value.room?.epoch || !this.value.room?.players.some(p => p.id === packet.sender)) return;
    const wasStale = this.now() - (this.lastSeen[packet.sender] ?? 0) > ONLINE_TIMING.stale;
    this.lastSeen[packet.sender] = this.now();
    if (!this.value.isHost && packet.sender === this.value.room.hostId && this.bus.connected) {
      if (wasStale) void this.heartbeat().catch(e => this.error(e));
      if (Number.isSafeInteger(packet.version) && Number(packet.version) > this.value.version) this.requestSync();
      if (this.value.room.phase === 'playing') this.emit({ status: 'playing', pauseReason: null });
    }
  }
  private async receiveIntent(data: unknown) {
    const message = data as Envelope;
    const room = this.value.room;
    if (!room || !message || message.protocol !== 2 || message.epoch !== room.epoch || typeof message.sender !== 'string' || !idPattern.test(message.sender) || room.phase === 'closed') return;
    let player = room.players.find(p => p.id === message.sender);
    if (message.kind === 'join') {
      if (typeof message.name !== 'string') return;
      if (!player && room.phase === 'lobby' && room.players.length < getRoomCapacity(room)) {
        const seat = Array.from({ length: getRoomCapacity(room) }, (_, index) => index).find(index => !room.players.some(p => p.seat === index))!;
        player = { id: message.sender, name: cleanName(message.name), seat, ready: false };
        this.emit({ room: { ...room, players: [...room.players, player].sort((a, b) => a.seat - b.seat), revision: room.revision + 1, updatedAt: this.now() }, status: 'lobby' });
      }
      if (player) { this.lastSeen[player.id] = this.now(); await this.save(); await this.broadcast(); }
      else await this.bus.publish(roomTopics(room.code).response(message.sender), this.envelope('joinRejected', { error: room.phase === 'lobby' ? '房间已满' : '对局已经开始' }));
      return;
    }
    if (!player) return;
    this.lastSeen[player.id] = this.now();
    if (message.kind === 'sync') { await this.broadcast(); return; }
    if (message.kind === 'ready' && room.phase === 'lobby') {
      if (typeof message.ready !== 'boolean' || !Number.isFinite(message.time) || Number(message.time) < (this.controlTimes[player.id] ?? 0)) return;
      if (JSON.stringify(message.loadout ?? null).length > 8192) return;
      this.controlTimes[player.id] = Number(message.time);
      const resetOthers = player.seat === 0 && message.resetOthers === true;
      this.emit({ room: { ...room, players: room.players.map(p => p.id === player!.id ? { ...p, ready: message.ready as boolean, ...(message.loadout !== undefined ? { loadout: copy(message.loadout) } : {}) } : resetOthers ? { ...p, ready: false } : p), revision: room.revision + 1, updatedAt: this.now() } });
      await this.save(); await this.broadcast(); return;
    }
    if (message.kind === 'leave') {
      if (player.seat === 0 || room.phase !== 'lobby') await this.closeRoom('玩家已离开对局');
      else { this.emit({ room: { ...room, players: room.players.filter(p => p.id !== player!.id).map(p => ({ ...p, ready: false })), revision: room.revision + 1, updatedAt: this.now() } }); await this.save(); await this.broadcast(); }
      return;
    }
    if (message.kind !== 'command' || typeof message.id !== 'string' || !idPattern.test(message.id) || !Number.isSafeInteger(message.seq) || Number(message.seq) < 1) return;
    const key = `${message.sender}:${message.id}`;
    if (this.receipts[key]) {
      // A previous persistence attempt may have failed before its acknowledgement.
      // Retrying the durable write is cheap and must precede even a duplicate ack.
      await this.save(); await this.reply(player.id, this.receipts[key]); return;
    }
    const seq = Number(message.seq), expected = (this.sequences[player.id] ?? 0) + 1;
    if (seq !== expected) {
      if (seq < expected) await this.reply(player.id, { id: message.id, seq, ok: false, error: '操作已处理，请根据最新状态继续', version: this.value.version });
      // Future sequences wait for their missing predecessor and are retried by the sender.
      return;
    }
    let error: string | undefined;
    let game = this.value.game;
    if (this.value.room?.phase !== 'playing' || game === null) error = '对局已暂停或尚未开始';
    else if (message.matchId !== this.matchId) error = '对局已更换，请重新选择操作';
    else if (!Number.isSafeInteger(message.baseVersion) || Number(message.baseVersion) < 1 || Number(message.baseVersion) > this.value.version) error = '局面版本无效，请同步后重试';
    else if (!this.options.commandScope && message.baseVersion !== this.value.version) error = '局面已更新，请重新选择操作';
    else {
      try {
        const context = { playerId: player.id, seat: player.seat, version: this.value.version, matchId: this.matchId! };
        if (this.options.commandScope && message.scope !== this.options.commandScope(game, message.command as C, context)) throw new Error('骰池或操作阶段已更新，请重新选择操作');
        const next = this.options.reduce(copy(game), copy(message.command) as C, context);
        if (this.options.validateState && !this.options.validateState(next)) throw new Error('操作产生了无效状态');
        game = next;
      } catch (e) { error = e instanceof Error ? e.message : '无效操作'; }
    }
    const previous = this.value.game; const baseVersion = this.value.version;
    this.sequences[player.id] = seq;
    if (!error) this.emit({ game: copy(game), version: this.value.version + 1 });
    const receipt: CommandReceipt = { id: message.id, seq, ok: !error, ...(error ? { error } : {}), version: this.value.version };
    this.receipts[key] = receipt;
    // Keep a bounded durable receipt window; older sequences remain blocked by high water marks.
    const keys = Object.keys(this.receipts);
    const receiptLimit = getRoomCapacity(room) * 12;
    for (const old of keys.slice(0, Math.max(0, keys.length - receiptLimit))) delete this.receipts[old];
    await this.save();
    const packet = !error ? this.statePacket(previous, baseVersion) : null;
    if (player.id === this.value.myId) this.receiveResponse(this.envelope('ack', { receipt, sequences: this.sequences }));
    this.queuePublish(async () => {
      await Promise.all([packet ? this.publishState(packet) : Promise.resolve(), player!.id !== this.value.myId ? this.reply(player!.id, receipt) : Promise.resolve()]);
    });
  }
  private async reply(playerId: string, receipt: CommandReceipt) {
    const packet = this.envelope('ack', { receipt, sequences: this.sequences });
    if (playerId === this.value.myId) this.receiveResponse(packet);
    else await this.bus.publish(roomTopics(this.value.room!.code).response(playerId), packet);
  }
  private receiveResponse(data: unknown) {
    const packet = data as Envelope & { receipt?: CommandReceipt; sequences?: Record<string, number> };
    if (packet?.protocol !== 2 || packet.epoch !== this.value.room?.epoch || packet.sender !== this.value.room?.hostId) return;
    if (packet.kind === 'joinRejected' && this.value.seat === null && typeof packet.error === 'string') { this.error(packet.error.slice(0, 120)); return; }
    if (packet.kind !== 'ack') return;
    const receipt = packet.receipt;
    if (!receipt || !Number.isSafeInteger(receipt.version) || typeof receipt.id !== 'string') return;
    const pending = this.pending.get(receipt.id);
    if (!pending || receipt.seq !== pending.message.seq) return;
    pending.receipt = receipt;
    if (!this.value.isHost) {
      const incoming = this.safeSequences(packet.sequences);
      for (const [id, seq] of Object.entries(incoming)) this.sequences[id] = Math.max(this.sequences[id] ?? 0, seq);
    }
    this.nextSeq = Math.max(this.nextSeq, this.sequences[this.value.myId] ?? 0);
    this.settleAcknowledgements();
    // State and ack use separate topics and may arrive in either order. Tick asks
    // for a snapshot only if the state is still missing after the retry window.
    void this.save().catch(e => this.error(e));
  }
  private settleAcknowledgements() {
    for (const [id, pending] of this.pending) {
      const receipt = pending.receipt;
      if (!receipt || receipt.version > this.value.version) continue;
      this.pending.delete(id);
      if (receipt.ok && this.value.game !== null) pending.resolve(copy(this.value.game));
      else { const error = new Error(receipt.error || '操作未生效'); this.error(error); pending.reject(error); }
    }
  }
  private statePacket(previous?: S | null, baseVersion?: number): StatePacket<S> {
    const common = { protocol: 2 as const, sender: this.value.myId, epoch: this.value.room!.epoch, version: this.value.version, matchId: this.matchId, sequences: copy(this.sequences) };
    if (previous && this.value.game && baseVersion !== undefined && this.options.stateCodec) {
      return { ...common, kind: 'update', baseVersion, delta: this.options.stateCodec.encode(previous, this.value.game) };
    }
    return { ...common, kind: 'snapshot', game: copy(this.value.game) };
  }
  private async publishState(packet: StatePacket<S>) {
    if (!this.value.room || this.value.room.phase === 'closed' || this.value.version < 1 || packet.epoch !== this.value.room.epoch) return;
    await this.bus.publish(roomTopics(this.value.room.code).state, packet, packet.kind === 'snapshot');
  }
  private async broadcastState() { if (this.value.room && this.value.version >= 1) await this.publishState(this.statePacket()); }
  private async broadcastMetadata() {
    if (!this.value.room || !this.value.isHost) return;
    await this.bus.publish(roomTopics(this.value.room.code).room, { protocol: 2, sender: this.value.myId, room: this.value.room }, true);
    const topic = `${NAMESPACE}/match/${this.value.room.mode}/${this.value.room.code}`;
    await this.bus.publish(topic, !isPartyRoomMode(this.value.room.mode) && this.value.room.public && this.value.room.phase === 'lobby' && this.value.room.players.length < getRoomCapacity(this.value.room) ? { protocol: 2, room: this.value.room } : null, true);
  }
  private async broadcast() {
    await Promise.all([this.broadcastMetadata(), this.broadcastState()]);
  }
  private async heartbeat() {
    if (!this.value.room || this.value.seat === null || !this.bus.connected) return;
    this.lastHeartbeat = this.now(); this.lastSeen[this.value.myId] = this.now();
    await this.bus.publish(roomTopics(this.value.room.code).heartbeat, this.envelope('heartbeat', { time: this.now(), version: this.value.version }));
  }
  /** Public for fake-clock tests. Production calls this every second. */
  async tick(): Promise<void> {
    const room = this.value.room;
    if (!room || room.phase === 'closed') return;
    const now = this.now();
    if (this.bus.connected && now - this.lastHeartbeat >= ONLINE_TIMING.heartbeat) {
      await this.heartbeat();
      if (this.value.isHost) { this.emit({ room: { ...this.value.room!, updatedAt: now, revision: this.value.room!.revision + 1 } }); await this.broadcastMetadata(); }
      await this.save();
    }
    for (const [id, pending] of this.pending) {
      if (pending.receipt && pending.receipt.version > this.value.version && now - pending.sent >= (this.options.retryMs ?? ONLINE_TIMING.retry)) this.requestSync();
      if (now - pending.created > ONLINE_TIMING.disconnectGrace) {
        this.pending.delete(id); pending.reject(new Error('操作确认超时，请重连后检查最新局面'));
        this.emit({ status: 'paused', pauseReason: '操作未能确认，请重新连接房间恢复最新局面' });
        // Never reuse an uncertain sequence in the same connection: it may be committed.
        if (this.bus.connected) await this.sendControl('sync');
      } else if (this.bus.connected && now - pending.sent >= (this.options.retryMs ?? ONLINE_TIMING.retry)) {
        if (now - pending.created > ONLINE_TIMING.commandTimeout) this.emit({ error: '操作确认较慢，正在重试，请稍候…' });
        pending.sent = now;
        if (this.value.isHost) await this.enqueueIntent(pending.message);
        else await this.bus.publish(roomTopics(room.code).intent, pending.message);
      }
    }
    if (this.value.isHost) {
      const absent = room.players.filter(p => p.id !== this.value.myId && now - (this.lastSeen[p.id] ?? room.createdAt) > ONLINE_TIMING.stale);
      const expired = new Set(absent.filter(p => now - (this.lastSeen[p.id] ?? room.createdAt) > ONLINE_TIMING.disconnectGrace).map(p => p.id));
      if (expired.size) {
        if (room.phase === 'lobby') { this.emit({ room: { ...this.value.room!, players: this.value.room!.players.filter(p => !expired.has(p.id)).map(p => ({ ...p, ready: false })), revision: this.value.room!.revision + 1, updatedAt: now } }); await this.save(); if (this.bus.connected) await this.broadcast(); }
        else await this.closeRoom('队友断线超过两分钟，对局已结束');
      } else if (absent.length && room.phase === 'playing') {
        this.emit({ room: { ...this.value.room!, phase: 'paused', revision: this.value.room!.revision + 1 }, status: 'paused', pauseReason: '等待队友重新连接（最多两分钟）' });
        await this.save(); if (this.bus.connected) await this.broadcast();
      } else if (!absent.length && room.phase === 'paused' && this.bus.connected) {
        this.pendingRecovery = false;
        this.emit({ recoveryRevision: this.value.recoveryRevision + 1, room: { ...this.value.room!, phase: 'playing', revision: this.value.room!.revision + 1 }, status: 'playing', pauseReason: null }); await this.save(); await this.broadcast();
      } else if (!absent.length && room.phase === 'playing' && this.bus.connected && this.value.status === 'paused') {
        this.emit({ status: 'playing', pauseReason: null });
      }
    } else {
      const age = now - (this.lastSeen[room.hostId] ?? room.updatedAt);
      if (age > ONLINE_TIMING.disconnectGrace) { this.emit({ room: { ...room, phase: 'closed' }, status: 'closed', pauseReason: null, error: '房主断线超过两分钟，对局已结束' }); this.rejectPending('房主已离线'); await this.save(); }
      else if (age > ONLINE_TIMING.stale && room.phase !== 'lobby') { this.pendingRecovery = true; this.emit({ status: 'paused', pauseReason: '房主暂时离线，等待恢复（最多两分钟）' }); }
    }
  }
  private async closeRoom(reason: string) {
    if (!this.value.room) return;
    this.emit({ room: { ...this.value.room, phase: 'closed', revision: this.value.room.revision + 1, updatedAt: this.now() }, status: 'closed', error: reason, pauseReason: null });
    this.rejectPending(reason); await this.save();
    if (this.bus.connected) {
      await this.broadcastMetadata();
      await this.bus.publish(roomTopics(this.value.room!.code).state, null, true);
    }
  }
  private rejectPending(reason: string) { for (const pending of this.pending.values()) pending.reject(new Error(reason)); this.pending.clear(); }
  getCheckpoint(): SessionCheckpoint<S> | null {
    if (!this.value.room || this.value.room.phase === 'closed' || this.value.status === 'closed' || this.value.seat === null) return null;
    return copy({ protocol: 2, clientId: this.value.myId, name: cleanName(this.options.name), broker: this.bus.broker, room: this.value.room, game: this.value.game, version: this.value.version, nextSeq: this.nextSeq, matchId: this.matchId, sequences: this.sequences, receipts: this.value.isHost ? this.receipts : {}, savedAt: this.now() });
  }
  private async save() { await this.options.persist?.(this.getCheckpoint()); }
  async restore(saved: SessionCheckpoint<S>): Promise<void> {
    if (this.value.room) throw new Error('请先离开当前房间');
    if (saved && saved.protocol !== 2) throw new Error('联机版本已更新，请双方更新后重新建立房间；养成存档不受影响');
    if (!saved || saved.protocol !== 2 || !validRoom(saved.room) || !saved.room.players.some(p => p.id === saved.clientId) || saved.room.phase === 'closed') throw new Error('联机存档无效');
    if (this.now() - saved.savedAt > ONLINE_TIMING.disconnectGrace) throw new Error('联机存档已超过两分钟恢复期限');
    if (saved.game !== null && this.options.validateState && !this.options.validateState(saved.game)) throw new Error('存档对局状态无效');
    if (saved.broker !== this.bus.broker) { if (this.options.bus) throw new Error('存档服务器与当前连接不符'); this.bus.close(); this.bus = new MqttBus(saved.broker); this.attachStatus(); }
    this.value = { ...this.value, myId: saved.clientId };
    await this.connect();
    const host = saved.clientId === saved.room.hostId;
    this.pendingRecovery = !host;
    const room = copy(saved.room);
    if (host) { room.revision++; room.updatedAt = this.now(); if (room.phase === 'playing') room.phase = 'paused'; }
    this.matchId = saved.matchId;
    this.emit({ recoveryRevision: this.value.recoveryRevision + 1, room, isHost: host, seat: room.players.find(p => p.id === saved.clientId)!.seat, game: copy(saved.game), version: saved.version, status: room.phase, pauseReason: room.phase === 'paused' ? '正在恢复对局，等待队友连接…' : null });
    this.sequences = this.safeSequences(saved.sequences); this.receipts = copy(saved.receipts ?? {}); this.nextSeq = this.sequences[saved.clientId] ?? 0;
    this.lastSeen = {}; for (const p of room.players) this.lastSeen[p.id] = host && p.id !== saved.clientId ? this.now() - ONLINE_TIMING.stale - 1 : this.now();
    await this.watch(room.code);
    if (host) await this.broadcast(); else await this.sendControl('sync');
    await this.heartbeat(); await this.save();
  }
  inviteUrl(base = typeof location === 'undefined' ? 'https://starrailcard.local/' : location.href): string {
    if (!this.value.room) throw new Error('尚未加入房间');
    const url = new URL(base); url.searchParams.set('room', this.value.room.code); url.searchParams.set('broker', this.bus.broker); url.hash = ''; return url.toString();
  }
  async leave(stopMatching = true): Promise<void> {
    if (stopMatching) { this.matching = false; this.matchmakingUnsub?.(); this.matchmakingUnsub = null; }
    if (this.value.room && this.bus.connected) {
      if (this.value.isHost) await this.closeRoom('房主已离开房间'); else await this.sendControl('leave');
    }
    this.clearSubscriptions(); this.roomCode = null; this.rejectPending('已离开房间'); this.resetRoomCounters();
    this.emit({ room: null, isHost: false, seat: null, status: 'idle', game: null, version: 0, pauseReason: null, error: null });
    await this.options.persist?.(null);
  }
  /** Dispose without a leave packet, so refresh/reload can restore its checkpoint. */
  destroy(): void {
    if (this.timer) clearInterval(this.timer); this.timer = null;
    this.clearSubscriptions(); this.matchmakingUnsub?.(); this.statusUnsub?.(); this.bus.close(); this.rejectPending('连接已关闭'); this.subscribers.clear();
  }
}
