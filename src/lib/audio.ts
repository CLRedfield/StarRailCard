// Local Suno assets: short effects decode once; the long music track streams.
export type SoundKind = 'click' | 'confirm' | 'roll' | 'damage' | 'win' | 'heal' | 'arise' | 'hack' | 'attack' | 'poison';
const base = import.meta.env.BASE_URL + 'audio/';
const samples = {
  confirm: { file: 'sfx_confirm.mp3', gain: .65 },
  roll: { file: 'sfx_dice_roll_01.mp3', gain: .8 },
  attack: { file: 'sfx_attack.mp3', gain: .72 },
  poison: { file: 'sfx_poison_trigger.mp3', gain: .78 },
} satisfies Partial<Record<SoundKind, { file: string; gain: number }>>;
type SampleKind = keyof typeof samples;
const clamp = (volume: number) => Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
const isSample = (kind: SoundKind): kind is SampleKind => kind in samples;

let context: AudioContext | undefined;
let music: HTMLAudioElement | undefined;
let musicSource: MediaElementAudioSourceNode | undefined;
let musicGain: GainNode | undefined;
let musicVolume = 0;
let effectsVolume = 1;
let unlocked = false;
let musicStarting = false;
let lifecycleBound = false;
let effectEpoch = 0;
const buffers = new Map<SampleKind, AudioBuffer>();
const loading = new Map<SampleKind, Promise<AudioBuffer | undefined>>();
const voices = new Set<AudioScheduledSourceNode>();
const lastPlayed = new Map<SoundKind, number>();

function stopEffects() {
  effectEpoch++;
  for (const voice of voices) {
    try { voice.stop(); } catch { /* A scheduled source may already have ended. */ }
  }
  voices.clear();
}
function visibilityChanged() {
  if (document.hidden) { music?.pause(); stopEffects(); }
  else syncMusic();
}
function pageHidden() { music?.pause(); stopEffects(); }
function ensureContext() {
  if (context) return context;
  try {
    context = new AudioContext();
    context.addEventListener('statechange', () => {
      if (context?.state === 'running') syncMusic();
    });
    if (!lifecycleBound) {
      document.addEventListener('visibilitychange', visibilityChanged);
      window.addEventListener('pagehide', pageHidden);
      window.addEventListener('pageshow', visibilityChanged);
      lifecycleBound = true;
    }
    return context;
  } catch { return undefined; }
}
function loadSample(kind: SampleKind): Promise<AudioBuffer | undefined> {
  const cached = buffers.get(kind);
  if (cached) return Promise.resolve(cached);
  const pending = loading.get(kind);
  if (pending) return pending;
  const audio = context;
  if (!audio) return Promise.resolve(undefined);
  const request = fetch(base + samples[kind].file)
    .then(response => {
      if (!response.ok) throw new Error('Audio HTTP ' + response.status);
      return response.arrayBuffer();
    })
    .then(data => audio.decodeAudioData(data))
    .then(buffer => {
      if (context === audio) buffers.set(kind, buffer);
      return buffer;
    })
    .catch(() => undefined)
    .finally(() => { loading.delete(kind); });
  loading.set(kind, request);
  return request;
}

export function unlockAudio() {
  const audio = ensureContext();
  if (!audio) return;
  unlocked = true;
  // Resume and play are invoked directly inside the pointer/keyboard gesture.
  if (audio.state !== 'running') void audio.resume().catch(() => undefined);
  for (const kind of Object.keys(samples) as SampleKind[]) void loadSample(kind);
  syncMusic();
}
function syncMusic() {
  if (!unlocked || !context) return;
  if (musicVolume <= 0 || document.hidden) {
    music?.pause();
    if (musicGain) musicGain.gain.setValueAtTime(0, context.currentTime);
    return;
  }
  if (!music) {
    music = new Audio(base + 'bgm_duel.mp3');
    music.loop = true;
    music.preload = 'none';
    music.setAttribute('playsinline', '');
    musicSource = context.createMediaElementSource(music);
    musicGain = context.createGain();
    musicGain.gain.value = 0;
    musicSource.connect(musicGain);
    musicGain.connect(context.destination);
  }
  // GainNode controls volume even when the mobile media element has fixed volume.
  musicGain!.gain.cancelScheduledValues(context.currentTime);
  musicGain!.gain.setTargetAtTime(musicVolume * .7, context.currentTime, .06);
  if (!music.paused || musicStarting) return;
  musicStarting = true;
  void music.play().then(() => {
    if (musicVolume <= 0 || document.hidden) music?.pause();
  }).catch(() => {
    // Autoplay rejection is retried by the next deliberate user gesture.
  }).finally(() => { musicStarting = false; });
}
export function setMusic(volume: number) {
  musicVolume = clamp(volume);
  syncMusic();
}
export function setEffectsVolume(volume: number) {
  effectsVolume = clamp(volume);
  if (effectsVolume === 0) stopEffects();
}
function trackVoice(source: AudioScheduledSourceNode, gain: GainNode) {
  if (voices.size >= 12) {
    const oldest = voices.values().next().value;
    if (oldest) { try { oldest.stop(); } catch { /* Already finished. */ } voices.delete(oldest); }
  }
  voices.add(source);
  source.onended = () => { voices.delete(source); source.disconnect(); gain.disconnect(); };
}
function playBuffer(kind: SampleKind, buffer: AudioBuffer, volume: number) {
  if (!context || context.state !== 'running' || document.hidden) return;
  const source = context.createBufferSource(), gain = context.createGain();
  source.buffer = buffer; gain.gain.value = volume * samples[kind].gain;
  source.connect(gain); gain.connect(context.destination);
  trackVoice(source, gain); source.start();
}
// Small UI/status cues supplement recorded actions, without a synthesized BGM.
function tone(frequency: number, duration: number, volume: number, delay = 0, endFrequency?: number) {
  if (!context || context.state !== 'running' || document.hidden || volume <= 0) return;
  const osc = context.createOscillator(), gain = context.createGain(), time = context.currentTime + delay;
  osc.type = 'sine'; osc.frequency.setValueAtTime(frequency, time);
  if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(volume * .065, time + .008);
  gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
  osc.connect(gain); gain.connect(context.destination);
  trackVoice(osc, gain); osc.start(time); osc.stop(time + duration + .01);
}
function fallback(kind: SoundKind, volume: number) {
  if (kind === 'click') tone(660, .055, volume * .48);
  if (kind === 'damage') { tone(108, .12, volume * .9, 0, 48); tone(190, .055, volume * .35); }
  if (kind === 'heal') [523, 659, 784].forEach((f, i) => tone(f, .24, volume * .55, i * .07));
  if (kind === 'win') [523, 659, 784, 1047].forEach((f, i) => tone(f, .5, volume * .65, i * .14));
  if (kind === 'arise') [294, 440, 587, 880].forEach((f, i) => tone(f, .27, volume * .48, i * .105));
  if (kind === 'hack') [740, 196, 622, 147, 494].forEach((f, i) => tone(f, .065, volume * .35, i * .065));
  if (kind === 'confirm') { tone(660, .1, volume * .6); tone(990, .14, volume * .45, .04); }
  if (kind === 'roll') [0, .12, .26, .43, .65].forEach((delay, i) => tone(210 - i * 15, .05, volume * (.7 - i * .1), delay, 90));
  if (kind === 'attack') tone(320, .16, volume * .65, 0, 70);
  if (kind === 'poison') { tone(440, .17, volume * .55, 0, 130); tone(170, .13, volume * .35, .07, 70); }
}
export function playSound(kind: SoundKind, volume: number) {
  volume = clamp(volume);
  if (!context || !unlocked || volume <= 0 || effectsVolume <= 0 || document.hidden) return;
  const now = performance.now(), debounce = kind === 'click' ? 35 : 65;
  if (now - (lastPlayed.get(kind) ?? -Infinity) < debounce) return;
  lastPlayed.set(kind, now);
  if (!isSample(kind)) { fallback(kind, volume); return; }
  const buffer = buffers.get(kind);
  if (buffer) { playBuffer(kind, buffer, volume); return; }
  const epoch = effectEpoch;
  void loadSample(kind).then(loaded => {
    // Don't replay stale actions after a slow first download or a background pause.
    if (epoch !== effectEpoch || document.hidden || performance.now() - now > 450) return;
    if (loaded) playBuffer(kind, loaded, volume);
    else fallback(kind, volume);
  });
}
function disposeAudio() {
  stopEffects(); music?.pause();
  if (music) { music.removeAttribute('src'); music.load(); }
  musicSource?.disconnect(); musicGain?.disconnect();
  document.removeEventListener('visibilitychange', visibilityChanged);
  window.removeEventListener('pagehide', pageHidden);
  window.removeEventListener('pageshow', visibilityChanged);
  void context?.close().catch(() => undefined);
  context = undefined; music = undefined; musicSource = undefined; musicGain = undefined;
  buffers.clear(); loading.clear(); lastPlayed.clear();
  unlocked = false; lifecycleBound = false; musicStarting = false;
}
if (import.meta.hot) import.meta.hot.dispose(disposeAudio);
