export interface Settings { music: number; effects: number; reducedMotion: boolean; quality: 'high' | 'low'; theme?: 'light' | 'dark'; }
export interface Profile {
  version: 1;
  /** Web adaptation welcome grant, independent of the released activity rewards. */
  starterSupplyVersion?: 1;
  name: string;
  xp: number;
  wins: number;
  ownedCards: string[];
  ownedDice: string[];
  gild: Record<string, number>;
  completed: string[];
  coins: number;
  dust: number;
  victoryCoins: number;
  paintCoins: number;
  selectedCard: string;
  selectedDice: string;
  settings: Settings;
}

export const WEB_STARTER_COINS = 6;

const LEGACY_PRISMATIC_UPGRADES: Record<string, string> = {
  '264502': '264402',
  '264503': '264403',
  '264504': '264404',
  '264505': '264405',
  '264506': '264406',
  '264507': '264407',
  '264508': '264408',
  '264509': '264409',
  '264510': '264410',
  '264511': '264411',
  '264512': '264412',
  '264513': '264413',
  '264516': '264416',
  '264517': '264417',
  '264518': '264418',
  '264519': '264419',
  '264520': '264420',
  '264521': '264421',
  '264522': '264422',
  '264523': '264424',
  '264524': '264423',
};

/** Upgrade legacy un-awakened (2645xx) prismatic IDs to their awakened (2644xx) versions. */
export function upgradeLegacyPrismaticId(id?: string): string {
  return id ? (LEGACY_PRISMATIC_UPGRADES[id] || id) : '';
}

/** Used for new profiles, older local saves and imports; never resets existing progress. */
export function migrateProfile(profile: Profile): Profile {
  const nextDice = upgradeLegacyPrismaticId(profile.selectedDice);
  const needsStarter = profile.starterSupplyVersion !== 1;
  if (!needsStarter && nextDice === profile.selectedDice) return profile;
  return {
    ...profile,
    ...(needsStarter ? { coins: profile.coins + WEB_STARTER_COINS, starterSupplyVersion: 1 as const } : {}),
    selectedDice: nextDice,
  };
}

const DB = 'starrailcard';
let dbPromise: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('state');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
export async function readSave<T>(key: string): Promise<T | undefined> {
  try {
    const db = await database();
    return await new Promise((resolve, reject) => {
      const req = db.transaction('state').objectStore('state').get(key);
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } catch {
    try { return JSON.parse(localStorage.getItem(`starrailcard.${key}`) || 'null') ?? undefined; } catch { return undefined; }
  }
}
export async function writeSave(key: string, value: unknown): Promise<void> {
  try {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { localStorage.setItem(`starrailcard.${key}`, JSON.stringify(value)); }
}
export function newProfile(starter: string, starterDice: string): Profile {
  return migrateProfile({ version: 1, name: '开拓者', xp: 0, wins: 0, ownedCards: [starter], ownedDice: starterDice ? [starterDice] : [], gild: {}, completed: [], coins: 0, dust: 0, victoryCoins: 0, paintCoins: 0, selectedCard: starter, selectedDice: starterDice, settings: { music: .25, effects: .5, reducedMotion: false, quality: 'high', theme: 'light' } });
}
export function isProfile(value: unknown): value is Profile {
  if (!value || typeof value !== 'object') return false;
  const p = value as Profile;
  const strings = (v: unknown) => Array.isArray(v) && v.length < 10000 && v.every(x => typeof x === 'string');
  return p.version === 1 && typeof p.name === 'string' && p.name.length <= 32 && strings(p.ownedCards) && strings(p.ownedDice) && strings(p.completed)
    && (p.starterSupplyVersion === undefined || p.starterSupplyVersion === 1)
    && ['xp', 'wins', 'coins', 'dust', 'victoryCoins', 'paintCoins'].every(k => Number.isFinite(p[k as keyof Profile]) && Number(p[k as keyof Profile]) >= 0)
    && typeof p.selectedCard === 'string' && typeof p.selectedDice === 'string' && !!p.gild && typeof p.gild === 'object'
    && Object.values(p.gild).every(x => Number.isInteger(x) && x >= 0 && x <= 2) && !!p.settings
    && [p.settings.music, p.settings.effects].every(x => Number.isFinite(x) && x >= 0 && x <= 1)
    && typeof p.settings.reducedMotion === 'boolean' && ['high', 'low'].includes(p.settings.quality)
    && (p.settings.theme === undefined || ['light', 'dark'].includes(p.settings.theme));
}
export function exportProfile(profile: Profile) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `StarRailCard-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
