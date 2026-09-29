export type RoomMode = 'duel' | 'coop' | 'treasure' | 'raid' | 'duos' | 'overlord';
export type ConnectionStatus = 'offline' | 'connecting' | 'connected' | 'reconnecting';
export interface MessageBus {
  readonly broker: string;
  readonly connected: boolean;
  connect(): Promise<void>;
  subscribe(topic: string, listener: (message: unknown, topic: string) => void): Promise<() => void>;
  publish(topic: string, message: unknown, retain?: boolean): Promise<void>;
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  close(): void;
}
export interface RoomPlayer {
  id: string;
  name: string;
  seat: number;
  ready: boolean;
  loadout?: unknown;
}
export interface RoomInfo {
  code: string;
  epoch: string;
  hostId: string;
  mode: RoomMode;
  /** Older protocol 2 rooms omit this; their mode supplies the default. */
  capacity?: number;
  public: boolean;
  phase: 'lobby' | 'playing' | 'paused' | 'closed';
  players: RoomPlayer[];
  revision: number;
  createdAt: number;
  updatedAt: number;
}
export interface OnlineSnapshot<S> {
  status: 'idle' | 'connecting' | 'matching' | 'lobby' | 'playing' | 'paused' | 'closed';
  connection: ConnectionStatus;
  room: RoomInfo | null;
  myId: string;
  isHost: boolean;
  seat: number | null;
  game: S | null;
  version: number;
  matchId: string | null;
  recoveryRevision: number;
  error: string | null;
  pauseReason: string | null;
}
export interface CommandContext {
  playerId: string;
  seat: number;
  version: number;
  matchId: string;
}
export interface CommandReceipt {
  id: string;
  seq: number;
  ok: boolean;
  error?: string;
  version: number;
}
export interface StateCodec<S> {
  encode(previous: S, next: S): unknown;
  decode(previous: S, payload: unknown): S;
}
export interface SessionCheckpoint<S> {
  protocol: 2;
  clientId: string;
  name: string;
  broker: string;
  room: RoomInfo;
  game: S | null;
  version: number;
  nextSeq: number;
  matchId: string | null;
  sequences: Record<string, number>;
  receipts: Record<string, CommandReceipt>;
  savedAt: number;
}
export interface OnlineSessionOptions<S, C> {
  name: string;
  clientId?: string;
  broker?: string;
  bus?: MessageBus;
  reduce: (state: S, command: C, context: CommandContext) => S;
  /** A command may rebase only while this actor-specific context is unchanged. */
  commandScope?: (state: S, command: C, context: CommandContext) => string;
  /** Omits immutable data and old events from ordinary state updates. */
  stateCodec?: StateCodec<S>;
  validateState?: (state: unknown) => state is S;
  persist?: (checkpoint: SessionCheckpoint<S> | null) => void | Promise<void>;
  now?: () => number;
  /** Disable automatic timers for deterministic tests; call tick() manually. */
  autoTick?: boolean;
  discoveryMs?: number;
  joinTimeoutMs?: number;
  retryMs?: number;
}
