import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The mocks expose only browser audio boundaries, so tests verify audible
// behavior and resource requests rather than the player's private state.
function parameter() {
  return { value: 0, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() };
}
function source() {
  return { buffer: null, type: '', frequency: parameter(), connect: vi.fn(), disconnect: vi.fn(),
    start: vi.fn(), stop: vi.fn(), onended: undefined as (() => void) | undefined };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

let now: number;
let page: EventTarget & { hidden: boolean };
let browser: EventTarget;
let decoded: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<object>>>;
let fetchMock: ReturnType<typeof vi.fn>;
let mediaPlay: ReturnType<typeof vi.fn<() => Promise<void>>>;
let contexts: FakeAudioContext[];
let mediaElements: FakeAudio[];
let audio: typeof import('../src/lib/audio');

class FakeAudioContext extends EventTarget {
  state = 'suspended';
  currentTime = 0;
  destination = {};
  buffers: ReturnType<typeof source>[] = [];
  oscillators: ReturnType<typeof source>[] = [];
  gains: Array<{ gain: ReturnType<typeof parameter>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];
  constructor() { super(); contexts.push(this); }
  resume = vi.fn(async () => { this.state = 'running'; this.dispatchEvent(new Event('statechange')); });
  close = vi.fn(async () => { this.state = 'closed'; });
  decodeAudioData = (...args: unknown[]) => decoded(...args);
  createMediaElementSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
  createBufferSource() { const node = source(); this.buffers.push(node); return node; }
  createOscillator() { const node = source(); this.oscillators.push(node); return node; }
  createGain() {
    const node = { gain: parameter(), connect: vi.fn(), disconnect: vi.fn() };
    this.gains.push(node); return node;
  }
}
class FakeAudio {
  paused = true;
  loop = false;
  preload = '';
  setAttribute = vi.fn();
  removeAttribute = vi.fn();
  load = vi.fn();
  pause = vi.fn(() => { this.paused = true; });
  constructor(public src: string) { mediaElements.push(this); }
  play = vi.fn(async () => { await mediaPlay(); this.paused = false; });
}

beforeEach(async () => {
  vi.resetModules();
  now = 0; contexts = []; mediaElements = [];
  page = Object.assign(new EventTarget(), { hidden: false }); browser = new EventTarget();
  decoded = vi.fn<(...args: unknown[]) => Promise<object>>().mockResolvedValue({ duration: .4 });
  fetchMock = vi.fn().mockImplementation(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  mediaPlay = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  vi.stubGlobal('document', page); vi.stubGlobal('window', browser);
  vi.stubGlobal('AudioContext', FakeAudioContext); vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  audio = await import('../src/lib/audio');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('local audio playback', () => {
  it('waits for a gesture before creating audio or fetching samples', async () => {
    audio.setMusic(.5);
    audio.playSound('confirm', .8);
    await flush();
    expect(contexts).toHaveLength(0);
    expect(mediaElements).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches and decodes only four short samples across repeated gestures and effects', async () => {
    audio.unlockAudio(); audio.unlockAudio();
    await flush();
    audio.playSound('roll', .8); audio.playSound('confirm', .8);
    now += 100; audio.unlockAudio(); audio.playSound('roll', .8);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new Set(fetchMock.mock.calls.map(([url]) => url)).size).toBe(4);
    expect(decoded).toHaveBeenCalledTimes(4);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].buffers).toHaveLength(3);
    expect(contexts[0].buffers.every(node => node.start.mock.calls.length === 1)).toBe(true);
  });

  it('streams looping music separately and applies zero volume immediately', async () => {
    audio.setMusic(.6); audio.unlockAudio(); await flush();
    expect(mediaElements).toHaveLength(1);
    expect(mediaElements[0].src).toMatch(/audio\/bgm_duel\.mp3$/);
    expect(mediaElements[0].loop).toBe(true);
    expect(mediaElements[0].paused).toBe(false);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('bgm_'))).toBe(true);
    expect(contexts[0].gains[0].gain.setTargetAtTime).toHaveBeenCalledWith(.42, 0, .06);
    audio.setMusic(0);
    expect(mediaElements[0].paused).toBe(true);
    expect(contexts[0].gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0);
    audio.playSound('confirm', 0);
    expect(contexts[0].buffers).toHaveLength(0);
  });

  it('stops active effects when the effects setting is muted, and cancels pending ones', async () => {
    audio.unlockAudio(); await flush();
    audio.playSound('attack', 1);
    const playing = contexts[0].buffers[0];
    audio.setEffectsVolume(0);
    expect(playing.stop).toHaveBeenCalledTimes(1);
    now += 100; audio.playSound('poison', 1);
    expect(contexts[0].buffers).toHaveLength(1);
    audio.setEffectsVolume(.5);
    now += 100; audio.playSound('poison', .5);
    expect(contexts[0].buffers).toHaveLength(2);
  });

  it('pauses music and stops effects while hidden, then resumes only music', async () => {
    audio.setMusic(.5); audio.unlockAudio(); await flush();
    audio.playSound('attack', .8);
    const playing = contexts[0].buffers[0];
    page.hidden = true; page.dispatchEvent(new Event('visibilitychange'));
    expect(mediaElements[0].paused).toBe(true);
    expect(playing.stop).toHaveBeenCalledTimes(1);
    now += 100; audio.playSound('confirm', .8);
    expect(contexts[0].buffers).toHaveLength(1);
    page.hidden = false; page.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(mediaElements[0].paused).toBe(false);
    expect(mediaElements[0].play).toHaveBeenCalledTimes(2);
    expect(contexts[0].buffers).toHaveLength(1);
  });

  it('handles rejected autoplay and retries on the next deliberate gesture', async () => {
    mediaPlay.mockRejectedValueOnce(new DOMException('Gesture required', 'NotAllowedError'));
    audio.setMusic(.5); audio.unlockAudio(); await flush();
    expect(mediaElements[0].paused).toBe(true);
    expect(mediaElements[0].play).toHaveBeenCalledTimes(1);
    audio.unlockAudio(); await flush();
    expect(mediaElements[0].play).toHaveBeenCalledTimes(2);
    expect(mediaElements[0].paused).toBe(false);
  });

  it('falls back to a quiet cue when decoding fails without rejecting playback', async () => {
    decoded.mockRejectedValue(new Error('Unsupported codec'));
    audio.unlockAudio(); audio.playSound('confirm', .5); await flush();
    expect(contexts[0].buffers).toHaveLength(0);
    expect(contexts[0].oscillators.length).toBeGreaterThan(0);
    expect(contexts[0].oscillators.every(node => node.start.mock.calls.length === 1)).toBe(true);
  });

  it('discards a late first effect rather than playing an obsolete action', async () => {
    const delayed = deferred<object>(); decoded.mockReturnValue(delayed.promise);
    audio.unlockAudio(); audio.playSound('roll', .7); await flush();
    now = 1000; delayed.resolve({ duration: .4 }); await flush();
    expect(contexts[0].buffers).toHaveLength(0);
    expect(contexts[0].oscillators).toHaveLength(0);
    now += 100; audio.playSound('roll', .7);
    expect(contexts[0].buffers).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(['hidden', 'muted'] as const)('does not replay a pending effect after it was %s', async reason => {
    const delayed = deferred<object>(); decoded.mockReturnValue(delayed.promise);
    audio.unlockAudio(); audio.playSound('attack', .7); await flush();
    if (reason === 'hidden') {
      page.hidden = true; page.dispatchEvent(new Event('visibilitychange'));
      page.hidden = false; page.dispatchEvent(new Event('visibilitychange'));
    } else { audio.setEffectsVolume(0); audio.setEffectsVolume(.7); }
    now += 100; delayed.resolve({ duration: .4 }); await flush();
    expect(contexts[0].buffers).toHaveLength(0);
    expect(contexts[0].oscillators).toHaveLength(0);
  });

  it('coalesces same-frame duplicate effects while preserving distinct actions', async () => {
    audio.unlockAudio(); await flush();
    audio.playSound('attack', .7); audio.playSound('attack', .7); audio.playSound('poison', .7);
    expect(contexts[0].buffers).toHaveLength(2);
    now += 100; audio.playSound('attack', .7);
    expect(contexts[0].buffers).toHaveLength(3);
  });
});
