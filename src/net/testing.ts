import { DEFAULT_BROKER, topicMatches } from './mqtt';
import type { ConnectionStatus, MessageBus } from './types';

export interface FakeDelivery { from: string; to: string; topic: string; message: unknown }

/** In-memory MQTT semantics: retained packets, wildcard subscriptions and optional packet loss. */
export class FakeBroker {
  readonly retained = new Map<string, unknown>();
  readonly deliveries: FakeDelivery[] = [];
  readonly clients = new Set<FakeBus>();
  drop: ((delivery: FakeDelivery) => boolean) | null = null;
  latencyMs = 0;
  createBus(id: string) { const bus = new FakeBus(this, id); this.clients.add(bus); return bus; }
  async publish(from: string, topic: string, message: unknown, retain = false): Promise<void> {
    if (retain) { if (message === null) this.retained.delete(topic); else this.retained.set(topic, structuredClone(message)); }
    for (const bus of this.clients) {
      if (!bus.connected) continue;
      for (const [pattern, listeners] of bus.listeners) if (topicMatches(pattern, topic)) for (const listener of listeners) {
        const delivery = { from, to: bus.id, topic, message: structuredClone(message) };
        this.deliveries.push(delivery);
        if (this.drop?.(delivery)) continue;
        const deliver = () => { if (bus.connected && bus.listeners.get(pattern)?.has(listener)) listener(structuredClone(delivery.message), topic); };
        if (this.latencyMs) setTimeout(deliver, this.latencyMs);
        else queueMicrotask(deliver);
      }
    }
  }
  /** Replay a packet to exercise duplication or cross-topic ordering. */
  async replay(delivery: FakeDelivery) { await this.publish(delivery.from, delivery.topic, delivery.message); }
}

export class FakeBus implements MessageBus {
  readonly broker = DEFAULT_BROKER;
  connected = false;
  readonly listeners = new Map<string, Set<(data: unknown, topic: string) => void>>();
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  constructor(private network: FakeBroker, readonly id: string) {}
  async connect() { this.setOnline(true); }
  setOnline(online: boolean) { this.connected = online; for (const fn of this.statusListeners) fn(online ? 'connected' : 'offline'); }
  async subscribe(topic: string, callback: (data: unknown, topic: string) => void): Promise<() => void> {
    let set = this.listeners.get(topic); if (!set) { set = new Set(); this.listeners.set(topic, set); }
    set.add(callback);
    for (const [retainedTopic, value] of this.network.retained) if (topicMatches(topic, retainedTopic)) queueMicrotask(() => callback(structuredClone(value), retainedTopic));
    return () => { set!.delete(callback); if (!set!.size) this.listeners.delete(topic); };
  }
  async publish(topic: string, message: unknown, retain = false) { if (!this.connected) throw new Error('fake transport offline'); await this.network.publish(this.id, topic, message, retain); }
  onStatus(callback: (status: ConnectionStatus) => void) { this.statusListeners.add(callback); return () => { this.statusListeners.delete(callback); }; }
  close() { this.setOnline(false); this.listeners.clear(); this.network.clients.delete(this); }
}
