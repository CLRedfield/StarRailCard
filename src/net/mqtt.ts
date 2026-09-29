import mqtt, { type MqttClient } from 'mqtt';
import type { ConnectionStatus, MessageBus } from './types';

export const DEFAULT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
export const BROKER_ALTERNATIVES = [DEFAULT_BROKER, 'wss://broker-cn.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'] as const;
export const NAMESPACE = 'starrailcard/v2';
export const MAX_PAYLOAD_BYTES = 256 * 1024;

export function normalizeBroker(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'wss:' || url.username || url.password || value.length > 240) throw new Error('服务器地址必须是有效的 wss:// 地址');
  return url.toString().replace(/\/$/, '');
}
export function topicMatches(pattern: string, topic: string): boolean {
  const a = pattern.split('/'); const b = topic.split('/');
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '#') return i === a.length - 1;
    if (b[i] === undefined || (a[i] !== '+' && a[i] !== b[i])) return false;
  }
  return a.length === b.length;
}
export function createClientId(): string {
  return `p_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}
export function generateRoomCode(): string {
  const values = new Uint32Array(1); crypto.getRandomValues(values);
  return String(100000 + (values[0] % 900000));
}
export function roomTopics(code: string) {
  const base = `${NAMESPACE}/rooms/${code}`;
  return { room: `${base}/room`, state: `${base}/state`, intent: `${base}/intent`, heartbeat: `${base}/heartbeat`, response: (id: string) => `${base}/response/${id}` };
}

/** The same public EMQX broker as hearthStoneKill2; separate application topics. */
export class MqttBus implements MessageBus {
  readonly broker: string;
  private client: MqttClient | null = null;
  private listeners = new Map<string, Set<(data: unknown, topic: string) => void>>();
  private statuses = new Set<(status: ConnectionStatus) => void>();
  private connecting: Promise<void> | null = null;
  constructor(broker = DEFAULT_BROKER) { this.broker = normalizeBroker(broker); }
  get connected() { return !!this.client?.connected; }
  onStatus(listener: (status: ConnectionStatus) => void) { this.statuses.add(listener); return () => { this.statuses.delete(listener); }; }
  private status(value: ConnectionStatus) { for (const fn of this.statuses) fn(value); }
  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.status('connecting');
    this.connecting = new Promise((resolve, reject) => {
      const client = mqtt.connect(this.broker, { clientId: `src_${createClientId()}`, clean: true, connectTimeout: 9000, reconnectPeriod: 3000, keepalive: 20, resubscribe: true });
      this.client = client;
      let settled = false;
      const timeout = setTimeout(() => { if (!settled) { settled = true; client.end(true); this.connecting = null; this.status('offline'); reject(new Error('连接公共服务器超时，请切换备用服务器')); } }, 11000);
      client.on('connect', () => { this.status('connected'); if (!settled) { settled = true; clearTimeout(timeout); resolve(); } });
      client.on('offline', () => this.status('offline'));
      client.on('close', () => this.status('offline'));
      client.on('reconnect', () => this.status('reconnecting'));
      client.on('error', () => { /* Initial failures are bounded by the timeout; later ones use MQTT reconnect. */ });
      client.on('message', (topic, payload) => {
        if (!payload.length || payload.length > MAX_PAYLOAD_BYTES) return;
        let value: unknown;
        try { value = JSON.parse(payload.toString()); } catch { return; }
        for (const [pattern, callbacks] of this.listeners) if (topicMatches(pattern, topic)) for (const callback of callbacks) callback(value, topic);
      });
    });
    return this.connecting;
  }
  async subscribe(topic: string, listener: (message: unknown, topic: string) => void): Promise<() => void> {
    await this.connect();
    let set = this.listeners.get(topic);
    const first = !set;
    if (!set) { set = new Set(); this.listeners.set(topic, set); }
    set.add(listener);
    if (first) await new Promise<void>((resolve, reject) => this.client!.subscribe(topic, { qos: 1 }, error => error ? reject(error) : resolve()));
    return () => { set!.delete(listener); if (!set!.size) { this.listeners.delete(topic); this.client?.unsubscribe(topic); } };
  }
  async publish(topic: string, message: unknown, retain = false): Promise<void> {
    if (!this.connected) throw new Error('连接暂时中断，正在重连');
    const payload = message === null && retain ? '' : JSON.stringify(message);
    if (new TextEncoder().encode(payload).length > MAX_PAYLOAD_BYTES) throw new Error('联机状态过大');
    await new Promise<void>((resolve, reject) => this.client!.publish(topic, payload, { qos: 1, retain }, error => error ? reject(error) : resolve()));
  }
  close() { this.client?.end(true); this.client = null; this.connecting = null; this.listeners.clear(); this.status('offline'); }
}
