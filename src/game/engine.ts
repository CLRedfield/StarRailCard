import { coopRules, defaultCatalog } from './catalog';
import type { BossPhase, CardDefinition, CommandResult, DieFace, GameCommand, GameEvent, GameState, LegalActions, MatchConfig, PlayerPreview, PlayerState, RolledDie, RoundModifiers, Side } from './types';

const key = (name: string) => name.replace(/[「」“”·•.\s（）()！!ⅠⅡⅢ]/g, '');
const card = (s: GameState, p: PlayerState): CardDefinition => s.catalog.cards.find(c => c.id === p.cardId)!;
const isBoss = (p: PlayerState) => /^20[1-6]0[1-4]$/.test(p.cardId);
const ruleName = (s: GameState, p: PlayerState) => isBoss(p) ? '' : card(s, p).name;
const named = (s: GameState, p: PlayerState, ...names: string[]) => names.some(n => key(ruleName(s, p)).includes(key(n)));
const selected = (p: PlayerState) => p.dice.filter(d => p.selectedIds.includes(d.id));
const allies = (s: GameState) => s.players.filter(p => p.side === 0);
const enemies = (s: GameState, p: PlayerState) => s.players.filter(q => q.side !== p.side);
const weatherName = (s: GameState) => s.catalog.weather.find(w => w.id === s.weatherId)?.name || '';
const isAttack = (s: GameState, p: PlayerState) => p.side === s.attackingSide;
const finished = (s: GameState) => s.phase === 'finished';
const clone = <T>(value: T): T => structuredClone(value);
const cloneState = (s: GameState): GameState => ({ ...clone({ ...s, catalog: undefined }), catalog: s.catalog });
const emptyModifiers = (): RoundModifiers => ({ attack: 0, defense: 0, double: 1, combo: 0, pierce: false, penetration: 0, forcefield: false, unyielding: false, counter: false, hack: false, arise: false, siphon: 0, reflect: 0, nextStrength: 0, prismaticRefund: 0, attackSync: false, defenseSync: false, fullSupport: false, upgrade: false });
function unusedDice(s: GameState, p: PlayerState): RolledDie[] {
  // Shared dice retain their original roller; a die taken by an ally is no
  // longer unused. Count only the final pool, after every exchange.
  return [...p.dice.filter(d => !p.selectedIds.includes(d.id)), ...s.swapPool.filter(d => d.ownerId === p.id)];
}
const effectiveDefense = (p: PlayerState, defense: number) => p.modifiers.pierce ? 0 : Math.max(0, defense - (p.modifiers.penetration || 0));
function upgradeSelectedDice(s: GameState, p: PlayerState, sourceLabel?: string) {
  const upgrades: string[] = [];
  for (const d of selected(p).filter(d => !d.prismatic)) {
    const index = d.poolIndex ?? p.dice.indexOf(d);
    if (index < 0 || index >= card(s, p).dice.length) continue;
    const before = Math.max(d.sides, p.statuses[`die${index}`] || 0);
    const after = before < 6 ? 6 : before < 8 ? 8 : 12;
    p.statuses[`die${index}`] = after;
    if (after > before) upgrades.push(`D${before}→D${after}`);
  }
  if (sourceLabel) emit(s, 'effect', `${sourceLabel}：${upgrades.length ? upgrades.join('、') : '选中普通骰已达升级上限'}，后续回合生效`, { playerId: p.id, targetId: p.id, sourceLabel });
}
// Party objectives own defeat/scoring and round advancement. Character resolution
// remains the same code path as a normal battle; this context never enters saves.
export interface CharacterEncounterRules {
  skipPreparationIds?: string[];
  skipEnd?: boolean;
  skipAttackIds?: string[];
  attackTargetIds?: string[];
}
const detachedEncounters = new WeakMap<GameState, CharacterEncounterRules>();
const preparesCharacter = (s: GameState, p: PlayerState) => !detachedEncounters.get(s)?.skipPreparationIds?.includes(p.id);
function hashSeed(seed: number | string): number { if (typeof seed === 'number') return (seed >>> 0) || 1; let value = 2166136261; for (const ch of seed) value = Math.imul(value ^ ch.charCodeAt(0), 16777619); return (value >>> 0) || 1; }
function random(s: GameState): number { let x = s.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s.seed = x >>> 0; return s.seed / 4294967296; }
const pick = <T>(s: GameState, list: T[]) => list[Math.floor(random(s) * list.length)];
function emit(s: GameState, type: GameEvent['type'], text: string, rest: Partial<GameEvent> = {}) {
  const event: GameEvent = { id: s.nextId++, type, text, ...rest };
  s.log.push(event); if (s.log.length > 160) s.log.shift();
  if (s.lastResolution?.turn === s.turn && s.lastResolution.events) { s.lastResolution.events.push(clone(event)); s.lastResolution.eventEndId = event.id; }
  return event;
}
function heal(s: GameState, p: PlayerState, amount: number, sourceLabel = '恢复生命') { if (s.phase === 'finished') return; const n = Math.max(0, Math.min(p.maxHp - p.hp, Math.floor(amount))); if (!n) return; const hpBefore = p.hp; p.hp += n; emit(s, 'heal', `${p.name} · ${sourceLabel}：恢复${n}点生命`, { playerId: p.id, targetId: p.id, targetCardId: p.cardId, amount: n, hpBefore, hpAfter: p.hp, sourceLabel }); }
function rewardDebuff(s: GameState, p: PlayerState) { if (s.mode === 'coop' && p.side === 0 && !p.statuses.roundDebuff) { p.statuses.roundDebuff = 1; p.tacticPoints++; } }
function poison(s: GameState, source: PlayerState, target: PlayerState, count: number, sourceLabel = `${card(s, source).name}附毒`) { if (!count || s.phase === 'finished') return; const poisonBefore = target.statuses.poison; target.statuses.poison += count; rewardDebuff(s, source); emit(s, 'effect', `${sourceLabel}：${target.name}中毒${poisonBefore}→${target.statuses.poison}层`, { playerId: source.id, targetId: target.id, sourceLabel, poisonBefore, poisonAfter: target.statuses.poison }); }
function winner(s: GameState, side: Side | null, reason: string) { if (s.phase === 'finished') return; s.winner = side; s.phase = 'finished'; s.activePlayerId = null; s.reason = reason; emit(s, 'victory', reason, { amount: side ?? undefined }); }
function bossEntry(s: GameState, p: PlayerState) {
  if (p.cardId === '20103') p.statuses.overload += 10;
  if (['20401', '20403', '20404'].includes(p.cardId)) for (const q of s.players) q.baseDefense++;
  if (['20502', '20503', '20504'].includes(p.cardId)) p.statuses.bossLucky = 1;
}
function setBossPhase(s: GameState, p: PlayerState, phase: BossPhase) { const c = s.catalog.cards.find(c => c.id === phase.cardId); if (!c) throw new Error(`未知首领角色 ${phase.cardId}`); p.cardId = c.id; p.maxHp = phase.hp ?? c.hp; p.hp = p.maxHp; p.attackLevel = phase.attack ?? c.attack; p.baseDefense = phase.defense ?? c.defense; p.defenseLevel = p.baseDefense; p.prismaticId = c.prismaticId; p.prismaticUses = c.prismaticUses ?? 2; p.modifiers = emptyModifiers(); p.statuses = { strength: 0, toughness: 0, poison: 0, thorns: 0, overload: 0, interference: 0, evolution: 0, venom: 0 }; bossEntry(s, p); }
function checkDefeat(s: GameState, p: PlayerState) {
  if (p.hp > 0 || s.phase === 'finished') return;
  if (detachedEncounters.has(s)) return;
  if (s.mode === 'coop' && p.side === 0) { s.sharedLives--; if (s.sharedLives <= 0) winner(s, 1, '队伍共享生命耗尽'); else { p.hp = 1; p.tacticPoints += 3; emit(s, 'revive', `${p.name}重返战场，共享生命剩余${s.sharedLives}`, { playerId: p.id, targetId: p.id, targetCardId: p.cardId, amount: s.sharedLives, hpBefore: 0, hpAfter: 1, sharedLivesAfter: s.sharedLives, sourceLabel: '共斗复起' }); } }
  else if (s.mode === 'coop' && p.side === 1 && s.bossPhase + 1 < s.bossPhases.length) { const previousCardId = p.cardId; s.bossPhase++; setBossPhase(s, p, s.bossPhases[s.bossPhase]); emit(s, 'boss-phase', `首领进入第${s.bossPhase + 1}阶段`, { playerId: p.id, targetId: p.id, previousCardId, targetCardId: p.cardId, amount: s.bossPhase + 1, hpBefore: 0, hpAfter: p.hp, maxHpAfter: p.maxHp, statusesAfter: clone(p.statuses), bossPhaseAfter: s.bossPhase, sourceLabel: '首领换阶段' }); }
  else winner(s, p.side === 0 ? 1 : 0, `${p.name}的生命归零`);
}
function damage(s: GameState, p: PlayerState, amount: number, source?: PlayerState, direct = false, details: Partial<GameEvent> = {}): number {
  if (s.phase === 'finished' || p.hp <= 0) return 0;
  let n = Math.max(0, Math.floor(amount));
  if (p.modifiers.unyielding) n = Math.min(n, Math.max(0, p.hp - 1));
  const hpBefore = p.hp, actual = Math.min(p.hp, n); p.hp = Math.max(0, p.hp - n); p.totalDamageTaken += actual;
  const damageKind = details.damageKind ?? (direct ? 'instant' : 'attack');
  const sourceLabel = details.sourceLabel ?? (direct ? source ? `${card(s, source).name}技能` : '瞬间伤害' : '攻击');
  if (n || damageKind === 'attack' || amount > 0) {
    const layers = details.poisonBefore !== undefined ? `；中毒${details.poisonBefore}→${details.poisonAfter}层` : details.thornsBefore !== undefined ? `；荆棘${details.thornsBefore}→${details.thornsAfter}层` : '';
    const event = emit(s, 'damage', `${sourceLabel}：${p.name}${actual ? `受到${actual}点伤害` : p.modifiers.unyielding && amount > 0 ? '不屈保命' : '格挡'}（生命${hpBefore}→${p.hp}${layers}）`, { ...details, playerId: source?.id, targetId: p.id, attackerCardId: source?.cardId, targetCardId: p.cardId, amount: actual, hpBefore, hpAfter: p.hp, damageKind, sourceLabel });
    if (s.lastResolution?.turn === s.turn) s.lastResolution.strikes.push({ ...details, eventId: event.id, attackerId: source?.id ?? p.id, defenderId: p.id, attackerCardId: source?.cardId, targetCardId: p.cardId, attack: details.attack ?? 0, defense: details.defense ?? 0, amount: actual, hpBefore, hpAfter: p.hp, damageKind, sourceLabel, kind: damageKind === 'attack' || damageKind === 'counter' || damageKind === 'reflect' ? damageKind : 'instant' });
    if (source && s.mode === 'coop' && source.side === 0 && !direct) source.statuses.roundDamage = (source.statuses.roundDamage || 0) + actual; if (!direct) p.statuses.roundTaken = (p.statuses.roundTaken || 0) + actual;
  }
  checkDefeat(s, p); return actual;
}
function rollDie(s: GameState, p: PlayerState, d: RolledDie) {
  const definition = d.typeId && s.catalog.prismatics.find(x => x.id === d.typeId);
  let faces: DieFace[] = definition ? definition.faces : Array.from({ length: d.sides }, (_, i) => ({ value: i + 1 }));
  const low = Math.min(...faces.map(f => f.value)); const high = Math.max(...faces.map(f => f.value));
  if (weatherName(s) === '青蛙雨' || p.cardId === '20501') faces = faces.filter(f => f.value > low);
  if ((named(s, p, '基层员工') || weatherName(s) === '晴天雨' && !isAttack(s, p)) && high > low) faces = faces.filter(f => f.value < high);
  if (p.statuses.lucky || p.statuses.bossLucky) faces = faces.filter(f => f.value === Math.max(...faces.map(x => x.value)));
  if (!faces.length) faces = definition ? definition.faces : [{ value: 1 }];
  const f = pick(s, faces); d.value = f.value; d.effect = f.effect; d.amount = f.amount; d.forced = f.effect === 'fated';
}
function makeDie(s: GameState, p: PlayerState, sides: number, typeId?: string): RolledDie { const d: RolledDie = { id: `d${s.nextId++}`, ownerId: p.id, sides, value: 1, prismatic: !!typeId, typeId }; rollDie(s, p, d); return d; }
function fillOffers(s: GameState, p: PlayerState) { p.offers = []; const candidates = s.catalog.tactics.filter(t => !s.tacticsWeights || (s.tacticsWeights[t.id] || 0) > 0); while (p.offers.length < 3 && candidates.length) { const weights = candidates.map(t => s.tacticsWeights?.[t.id] ?? 1); let value = random(s) * weights.reduce((a, b) => a + b, 0); let i = 0; while (i < weights.length - 1 && (value -= weights[i]) >= 0) i++; p.offers.push(candidates.splice(i, 1)[0].id); } }
function setWeather(s: GameState) {
  if (s.weatherSchedule === 'off' || s.turn % 2 !== 0 || s.turn > 8) return;
  const next = Array.isArray(s.weatherSchedule) ? s.weatherSchedule[s.turn / 2 - 1] : pick(s, s.catalog.weather.filter(w => w.rounds === undefined || w.rounds.includes(s.turn)))?.id;
  if (!next) return; s.weatherId = next;
  emit(s, 'weather', `天气变为${weatherName(s)}`);
  if (weatherName(s) === '云海') s.players.forEach(p => p.prismaticUses++);
  if (weatherName(s) === '毒雾') s.players.forEach(p => p.statuses.poison += 2);
  if (weatherName(s) === '毒云') s.players.forEach(p => p.statuses.venom = 1);
}
function startRound(s: GameState) {
  setWeather(s); s.swapPool = [];
  for (const p of s.players) {
    p.modifiers = emptyModifiers(); p.confirmed = false; p.rollLocked = false; p.shopReady = false; p.prismaticRolled = false; p.selectedIds = []; p.rollsUsed = 0; p.statuses.failedAttacks = 0;
    p.statuses.roundDamage = p.statuses.roundTaken = p.statuses.roundCounter = p.statuses.roundDebuff = p.statuses.shopRefresh = 0;
    p.statuses.roundResurgence = 0;
    if (s.mode === 'coop' && p.side === 0) p.tacticPoints += 2;
    if (p.cardId === '20101') p.statuses.overload += 2;
    p.defenseLevel = p.baseDefense + p.statuses.evolution;
    const attacking = isAttack(s, p);
    p.rerolls = attacking ? named(s, p, '爻光') ? 4 : 2 : named(s, p, '开拓妖精', '自动机兵', '财富蕉师', '砂金（试用版）') ? 1 : 0;
    if (named(s, p, '刃')) p.rerolls += 2;
    p.rerolls = Math.max(0, p.rerolls - p.statuses.interference + (weatherName(s) === '鱼雨' ? 1 : 0) + (weatherName(s) === '幻日' ? 2 : 0));
    if (attacking && p.statuses.nextStrength) { p.modifiers.attack += p.statuses.nextStrength; p.statuses.nextStrength = 0; }
    if (!attacking && p.statuses.nextToughness) { p.modifiers.defense += p.statuses.nextToughness; p.statuses.nextToughness = 0; }
    if (!attacking && p.statuses.danGuard) { p.defenseLevel += 3; p.modifiers.counter = true; p.statuses.danGuard = 0; }
    if (!attacking && p.statuses.frostGuard) { p.defenseLevel++; p.statuses.frostGuard = 0; }
    if (weatherName(s) === '雨夹雪' && p.hp < p.maxHp) { p.defenseLevel += 2; p.modifiers.counter = true; }
    if (weatherName(s) === '高温' && p.hp < Math.max(...enemies(s, p).map(e => e.hp))) p.statuses.weatherStrength = (p.statuses.weatherStrength || 0) + 2;
    else if (weatherName(s) !== '高温') p.statuses.weatherStrength = 0;
    if (weatherName(s) === '酸雨' && p.hp > Math.max(...enemies(s, p).map(e => e.hp))) p.statuses.poison++;
    p.dice = card(s, p).dice.map((side, i) => ({ ...makeDie(s, p, p.statuses[`die${i}`] || side), poolIndex: i }));
  }
  s.phase = s.mode === 'coop' && s.tacticsEnabled !== false && s.turn % 2 === 1 ? 'tactics' : 'roll';
  if (s.phase === 'tactics') for (const p of allies(s)) fillOffers(s, p);
  const attacker = s.players.find(p => p.side === s.attackingSide)!;
  s.activePlayerId = attacker.id;
  emit(s, 'turn', `第${s.turn}回合 · ${s.mode === 'classic' ? attacker.name : s.attackingSide === 0 ? '我方' : '对手'}进攻`);
}

export function createMatch(config: MatchConfig, seed: number | string = Date.now()): GameState {
  const catalog = clone(config.catalog ?? defaultCatalog());
  const expected = config.mode === 'coop' ? 3 : 2;
  const inputs = config.mode === 'coop' && config.players.length === 2 && config.bossPhases?.length ? [...config.players, { id: 'boss', name: catalog.cards.find(c => c.id === config.bossPhases![0].cardId)?.name || '首领', cardId: config.bossPhases[0].cardId, isAI: true }] : config.players;
  if (inputs.length !== expected) throw new Error(`${config.mode}模式需要${expected}名角色`);
  const s: GameState = { version: 1, mode: config.mode, phase: 'roll', turn: 1, seed: hashSeed(seed), nextId: 1, players: [], activePlayerId: null, attackingSide: 0, weatherId: null, weatherSchedule: config.weather ?? (config.mode === 'classic' ? 'random' : 'off'), sharedLives: 3, bossPhase: 0, bossPhases: clone(config.bossPhases || []), swapPool: [], winner: null, maxTurns: config.maxTurns ?? 200, log: [], catalog };
  s.attackingSide = config.startingSide === 'random' ? (random(s) < 0.5 ? 0 : 1) : config.startingSide ?? 0;
  const rules = coopRules(config.coopStageId); s.tacticsEnabled = rules.enabled; s.tacticsWeights = rules.weights;
  for (const [i, input] of inputs.entries()) {
    const c = catalog.cards.find(c => c.id === input.cardId); if (!c) throw new Error(`找不到角色卡 ${input.cardId}`);
    const p: PlayerState = { id: input.id, name: input.name || c.name, cardId: c.id, side: i < expected - 1 ? 0 : 1, isAI: !!input.isAI, gild: input.gild ?? 0, hp: c.hp, maxHp: c.hp, attackLevel: c.attack, defenseLevel: c.defense, baseDefense: c.defense, dice: [], selectedIds: [], rerolls: 0, rollsUsed: 0, prismaticId: input.prismaticId ?? c.prismaticId, prismaticUses: c.prismaticUses ?? (c.prismaticId || input.prismaticId ? 2 : 0), prismaticRolled: false, statuses: { strength: 0, toughness: 0, poison: 0, thorns: 0, overload: 0, interference: 0, evolution: 0, venom: 0 }, modifiers: emptyModifiers(), tactics: [], tacticPoints: 0, offers: [], confirmed: false, rollLocked: false, shopReady: false, totalDamageTaken: 0, selectedOnes: 0, selectedFours: 0, selectedSixes: 0, specialTriggers: 0, accumulatedPower: 0, unyieldingUsed: false, bananaUsed: false };
    if (named(s, p, '基层员工')) p.statuses.strength = 5;
    s.players.push(p);
  }
  if (new Set(s.players.map(p => p.id)).size !== s.players.length) throw new Error('玩家标识必须唯一');
  if (s.mode === 'coop' && s.bossPhases.length) setBossPhase(s, s.players.at(-1)!, s.bossPhases[0]);
  else s.players.forEach(p => { if (isBoss(p)) bossEntry(s, p); });
  startRound(s); return s;
}

function prismAllowed(s: GameState, p: PlayerState): boolean {
  const d = s.catalog.prismatics.find(d => d.id === p.prismaticId); if (!d || p.prismaticUses <= 0 || p.prismaticRolled || named(s, p, '知更鸟')) return false;
  const n = key(d.name); const atk = isAttack(s, p);
  if (d.condition === 'Attack' && !atk || d.condition === 'Defense' && atk) return false;
  // Original and upgraded dice share names, but their published thresholds differ.
  const hpLimit = d.description?.match(/生命值\s*≤\s*(\d+)/);
  const earliestTurn = d.description?.match(/回合数\s*≥\s*(\d+)/);
  if (hpLimit && p.hp > Number(hpLimit[1]) || earliestTurn && s.turn < Number(earliestTurn[1])) return false;
  if (/复仇|Revenge/i.test(n)) return atk && p.totalDamageTaken >= 25;
  if (/遗语|LastWords/i.test(n)) return p.hp <= 8;
  if (/复读|Repeater/i.test(n)) return atk && p.selectedFours >= 2;
  if (/仙人球|星盾|誓言|固守|守御|防守|防御|Cactus|AstralShield|Oath|Defense/i.test(n)) return !atk;
  if (/奇迹|Miracle/i.test(n)) return atk && p.selectedOnes >= 9;
  if (/大红按钮|爆弹|BigRedButton/i.test(n)) return atk && s.turn >= 5;
  if (/赌徒|Gambler/i.test(n)) return s.turn <= 4;
  if (/剧毒|毒液|Venom/i.test(n)) return enemies(s, p).some(e => e.statuses.poison > 0);
  if (/蓄势|蓄力|Charging/i.test(n)) return !atk && s.turn >= 3;
  if (/好运|幸运|鸿运|Luck/i.test(n)) return p.selectedSixes >= 6;
  if (/强攻|猛攻|进攻|Onslaught/i.test(n)) return atk;
  if (/坚韧|忍耐|持久|耐久|Endurance/i.test(n)) return s.turn >= 5;
  return true;
}
function required(s: GameState, p: PlayerState): { min: number; max: number; exact: number } {
  const count = p.dice.length; const atk = isAttack(s, p);
  const number = Math.max(1, (atk ? p.attackLevel + p.statuses.evolution : p.defenseLevel) + (weatherName(s) === '暴雨' ? 1 : 0));
  if (atk && named(s, p, '绯英')) return { min: 1, max: count, exact: 0 };
  return { min: Math.min(number, count), max: Math.min(number, count), exact: Math.min(number, count) };
}
function validSelection(s: GameState, p: PlayerState): boolean { const range = required(s, p); return p.selectedIds.length >= range.min && p.selectedIds.length <= range.max && p.dice.filter(d => d.forced).every(d => p.selectedIds.includes(d.id)); }
export function getLegalActions(s: GameState, playerId: string): LegalActions {
  const p = s.players.find(p => p.id === playerId); if (!p) return { canAct: false, canSelect: false, canReroll: false, canPrismatic: false, canConfirm: false, canSwap: false, canShop: false, canUseTactics: false, requiredDice: 0, minDice: 0, maxDice: 0, reason: '玩家不存在' };
  const r = required(s, p); const simultaneous = s.mode === 'coop' && p.side === 0 && s.players.find(q => q.id === s.activePlayerId)?.side === 0;
  const canRoll = s.phase === 'roll' && !p.rollLocked && (p.id === s.activePlayerId || simultaneous);
  const canSwap = s.phase === 'swap' && p.side === 0 && !p.confirmed;
  const canShop = s.phase === 'tactics' && p.side === 0 && !p.shopReady;
  return { canAct: canRoll || canSwap || canShop, canSelect: canRoll, canReroll: canRoll && p.rerolls > 0, canPrismatic: canRoll && prismAllowed(s, p), canConfirm: (canRoll || canSwap) && validSelection(s, p), canSwap, canShop, canUseTactics: canSwap && p.tactics.length > 0, requiredDice: r.exact, minDice: r.min, maxDice: r.max };
}

function pattern(p: PlayerState) { const ds = selected(p); const values = ds.map(d => d.value); const counts = new Map<number, number>(); values.forEach(n => counts.set(n, (counts.get(n) || 0) + 1)); const sorted = [...new Set(values)].sort((a, b) => a - b); return { ds, values, counts, pairs: [...counts.values()].reduce((a, n) => a + Math.floor(n / 2), 0), same: counts.size === 1, even: values.length > 0 && values.every(n => n % 2 === 0), odd: values.length > 0 && values.every(n => n % 2 === 1), unique: counts.size === values.length, consecutive: sorted.length === values.length && sorted.every((n, i) => !i || n === sorted[i - 1] + 1), threeRun: sorted.some(n => sorted.includes(n + 1) && sorted.includes(n + 2)) }; }
function basicValue(s: GameState, p: PlayerState): number { const atk = isAttack(s, p); const bonus = atk ? p.statuses.strength + p.statuses.overload + p.modifiers.attack + (p.statuses.weatherStrength || 0) : p.statuses.toughness + p.modifiers.defense; return Math.max(0, Math.floor((selected(p).reduce((n, d) => n + d.value, 0) + bonus) * p.modifiers.double)); }
function pureTraits(s: GameState, p: PlayerState): RoundModifiers {
  const m = clone(p.modifiers), x = pattern(p), atk = isAttack(s, p), n = ruleName(s, p);
  if (['20201', '20203'].includes(p.cardId) && atk) m.combo = Math.max(m.combo, 1);
  if (p.cardId === '20204' && atk) m.combo = Math.max(m.combo, 2);
  if (['20301', '20303'].includes(p.cardId)) m.counter = true;
  if (['20302', '20303', '20304'].includes(p.cardId) && !atk) m.defense += s.swapPool.reduce((sum, d) => sum + d.value, 0);
  if (p.cardId === '20304' && !atk) m.reflect = Math.max(m.reflect, 0.5);
  if (p.cardId === '20104' && atk) m.siphon = Math.max(m.siphon, 0.5);
  if (['20402', '20403', '20404'].includes(p.cardId) && atk) { const opponents = enemies(s, p); if (opponents.length === 2 && selected(opponents[0]).some(d => selected(opponents[1]).some(e => d.value === e.value))) m.attack += p.cardId === '20404' ? 15 : 8; }
  if (['102', '105'].includes(p.cardId) && !atk && x.even) m.defense++;
  if (atk) {
    if (n.includes('奇美拉') && x.pairs) m.attack += (x.counts.get(4) || 0) >= 2 ? 7 : 3;
    if (n.includes('造物')) m.attack += Math.max(0, Math.max(0, ...x.counts.values()) - 2) * 7;
    if (n.includes('黄泉') && x.values.every(v => v === 4) && x.values.length) m.pierce = true;
    if (n.includes('流萤')) { if (x.pairs >= 2) m.combo = Math.max(1, m.combo); if (p.hp === p.maxHp) m.attack += 5; }
    if (n.includes('白厄')) m.siphon = Math.max(0.5, m.siphon);
    if (n.includes('绯英')) { if (x.values.length <= 3) m.combo = Math.max(1, m.combo); if (x.values.length === 1) m.penetration = Math.max(m.penetration || 0, 7); }
    if (n.includes('开拓者')) m.attack += (p.cardId === '106' ? 5 : 2) * x.values.filter(v => v === 6).length;
    if (n.includes('姬子') && (x.same || x.consecutive)) m.attack += 12;
    if (n.includes('火花花') && p.hp < p.maxHp) m.hack = true;
  }
  if (n.includes('资深员工')) { if (atk) m.attack += x.counts.size; else m.defense += x.counts.size; }
  if (n === '火花' && x.pairs) m.hack = true;
  if (n.includes('银狼')) { if (x.values.includes(1)) m.arise = true; if (x.values.includes(6)) m.hack = true; }
  if (n.includes('昔涟') && p.accumulatedPower > 24 || n.includes('大黑塔') && p.specialTriggers >= 4) m.arise = true;
  if (!atk && n.includes('白厄') && x.same && !p.unyieldingUsed) m.unyielding = true;
  if (!atk && n.includes('自动机兵') && x.threeRun) m.forcefield = true;
  if (n.includes('蝶遐')) { m.pierce = m.forcefield = m.unyielding = m.counter = true; m.combo = 1; }
  const w = weatherName(s);
  if (atk) {
    if (w === '飓风' || w === '云隙光' && p.hp < Math.max(...enemies(s, p).map(e => e.hp))) m.combo = Math.max(1, m.combo);
    if (w === '日食' && x.counts.size > 1) m.attack += 4;
    if (w === '干旱') m.attack += 3 * Math.max(...enemies(s, p).map(e => e.defenseLevel));
    if (w === '烈日') m.siphon = Math.max(0.5, m.siphon);
    if (w === '晴' || w === '决胜时刻') m.attack += 5;
    if (w === '月食' && enemies(s, p).some(e => e.defenseLevel >= 4)) m.attack += 8;
    if (w === '日月同辉' && p.hp <= 3) m.double *= 2;
  }
  if (w === '大雪' && x.values.includes(7)) { if (atk) m.attack += 4; else m.defense += 4; }
  if (w === '雷雨') { if (atk) m.attack += p.gild * 2; else m.defense += p.gild * 2; }
  return m;
}

export function getPlayerPreview(state: GameState, playerId: string): PlayerPreview {
  const s = { ...state, players: state.players.map(p => ({ ...p, modifiers: { ...p.modifiers } })) }, p = s.players.find(p => p.id === playerId); if (!p) return { value: 0, diceRequired: 0, canConfirm: false, damageEstimate: 0, effects: [] };
  p.modifiers = pureTraits(s, p); for (const d of selected(p)) { if (d.effect === 'double') p.modifiers.double *= 2; if (d.effect === 'combo') p.modifiers.combo = 1; if (d.effect === 'forcefield') p.modifiers.forcefield = true; if (d.effect === 'counter') p.modifiers.counter = true; }
  let value = basicValue(s, p); const teammate = s.players.find(q => q.side === p.side && q.id !== p.id);
  if (teammate) { teammate.modifiers = pureTraits(s, teammate); if (p.modifiers.attackSync && isAttack(s, p) || p.modifiers.defenseSync && !isAttack(s, p)) value = Math.max(value, basicValue(s, teammate)); if (teammate.modifiers.fullSupport) value *= 2; }
  if (p.modifiers.fullSupport) value = 0;
  if (weatherName(s) === '彩虹' && isAttack(s, p) && value <= 10) p.modifiers.pierce = true;
  if (weatherName(s) === '暴雪' && !isAttack(s, p) && value <= 8) p.modifiers.forcefield = true;
  const effects = Object.entries(p.modifiers).filter(([k, v]) => ['combo', 'pierce', 'forcefield', 'unyielding', 'counter', 'hack', 'arise'].includes(k) && v).map(([k]) => ({ combo: '连击', pierce: '洞穿', forcefield: '力场', unyielding: '不屈', counter: '反击', hack: '骇入', arise: '跃升' }[k]!));
  if (p.modifiers.penetration && !p.modifiers.pierce) effects.push(`穿透${p.modifiers.penetration}防御`);
  const e = enemies(s, p)[0]; const defense = e ? basicValue(s, e) : 0;
  let damageEstimate = isAttack(s, p) && !(e?.modifiers.forcefield && !p.modifiers.pierce) ? Math.max(0, value - effectiveDefense(p, defense)) * (1 + p.modifiers.combo) : 0;
  if (e?.modifiers.unyielding) damageEstimate = Math.min(damageEstimate, Math.max(0, e.hp - 1));
  if (isAttack(s, p) && named(s, p, '希儿')) {
    const resurgence = unusedDice(s, p).reduce((sum, d) => sum + d.value, 0);
    effects.push(`命中后再现${resurgence}点瞬伤`, '未造成攻击伤害时升级');
    if (damageEstimate > 0) damageEstimate += e?.modifiers.unyielding ? Math.min(resurgence, Math.max(0, e.hp - 1 - damageEstimate)) : resurgence;
  }
  return { value, diceRequired: required(s, p).exact, canConfirm: validSelection(s, p), damageEstimate, effects };
}

function resolveDieEffects(s: GameState, p: PlayerState) {
  for (const d of selected(p)) {
    if (s.phase === 'finished') break;
    if (d.value === 1) p.selectedOnes++; if (d.value === 4) p.selectedFours++; if (d.value === 6) p.selectedSixes++;
    if (!d.effect) continue; if (d.prismatic) p.specialTriggers++;
    const amount = d.amount ?? d.value;
    switch (d.effect) {
      case 'double': p.modifiers.double *= 2; break;
      case 'heal': heal(s, p, d.value, '曜彩骰治疗'); break;
      case 'combo': p.modifiers.combo = 1; break;
      case 'counter': p.modifiers.counter = true; break;
      case 'forcefield': p.modifiers.forcefield = true; break;
      case 'unyielding': p.modifiers.unyielding = true; break;
      case 'overload': { const before = p.statuses.overload; p.statuses.overload += d.value; emit(s, 'effect', `${p.name}超载${before}→${p.statuses.overload}层`, { playerId: p.id, targetId: p.id, overloadBefore: before, overloadAfter: p.statuses.overload, sourceLabel: '曜彩骰超载' }); break; }
      case 'lastStand': { const cost = p.hp - 1; p.modifiers.attack += cost; p.modifiers.defense += cost; damage(s, p, cost, p, true, { damageKind: 'self-cost', sourceLabel: '曜彩骰·背水' }); break; }
      case 'hack': p.modifiers.hack = true; break;
      case 'refund': p.prismaticUses++; break;
      case 'thorns': { const before = p.statuses.thorns; p.statuses.thorns += amount; emit(s, 'effect', `${p.name}荆棘${before}→${p.statuses.thorns}层`, { playerId: p.id, targetId: p.id, thornsBefore: before, thornsAfter: p.statuses.thorns, sourceLabel: '曜彩骰荆棘' }); break; }
      case 'instant': enemies(s, p).forEach(e => damage(s, e, amount, p, true, { sourceLabel: s.catalog.prismatics.find(x => x.id === d.typeId)?.name || '曜彩骰瞬伤' })); break;
      case 'strength': if (/蓄势|蓄力|Charging/i.test(s.catalog.prismatics.find(x => x.id === d.typeId)?.name || '')) p.statuses.nextStrength = (p.statuses.nextStrength || 0) + d.value; else p.statuses.strength += amount; break;
      case 'toughness': p.statuses.toughness += amount; break;
      case 'poison': enemies(s, p).forEach(e => poison(s, p, e, amount, `${s.catalog.prismatics.find(x => x.id === d.typeId)?.name || '曜彩骰'}附毒`)); break;
      case 'venom': for (const e of enemies(s, p)) { const before = e.statuses.venom; e.statuses.venom = 1; emit(s, 'effect', `${e.name}获得猛毒，中毒伤害×2（不叠加）`, { playerId: p.id, targetId: e.id, venomBefore: before, venomAfter: 1, sourceLabel: '曜彩骰猛毒' }); } rewardDebuff(s, p); break;
      case 'lucky': p.statuses.lucky = 1; break;
      case 'reflect': p.modifiers.reflect = Math.max(p.modifiers.reflect, 0.3); break;
      case 'siphon': p.modifiers.siphon = Math.max(p.modifiers.siphon, 0.5); break;
    }
  }
}
function transformDice(s: GameState) {
  for (const p of s.players.filter(p => preparesCharacter(s, p) && ['20601', '20602'].includes(p.cardId))) { for (const d of selected(p).filter(d => !d.prismatic && (p.cardId === '20601' || d.value > 3))) d.value = 6; for (const e of enemies(s, p)) for (const d of selected(e).filter(d => !d.prismatic && (p.cardId === '20601' || d.value < 4))) d.value = 1; }
  for (const p of s.players.filter(p => preparesCharacter(s, p))) if (p.modifiers.arise) { const dice = selected(p).filter(d => !d.prismatic); if (dice.length) { const min = Math.min(...dice.map(d => d.value)); const d = pick(s, dice.filter(d => d.value === min)); const before = d.value; d.value = d.sides; emit(s, 'effect', `${p.name}发动跃升`, { playerId: p.id, targetId: p.id, effectKind: 'arise', diceChanges: [{ dieId: d.id, before, after: d.value }] }); } }
  const changes: { die: RolledDie; player: PlayerState; targetId: string }[] = [];
  for (const p of s.players.filter(p => preparesCharacter(s, p))) if (p.modifiers.hack) for (const e of enemies(s, p)) { const dice = selected(e).filter(d => !d.prismatic); if (dice.length) { const max = Math.max(...dice.map(d => d.value)); changes.push({ die: pick(s, dice.filter(d => d.value === max)), player: p, targetId: e.id }); } }
  for (const { die, player, targetId } of changes) { const before = die.value; die.value = 2; rewardDebuff(s, player); emit(s, 'effect', `${player.name}发动骇入`, { playerId: player.id, targetId, effectKind: 'hack', diceChanges: [{ dieId: die.id, before, after: die.value }] }); }
}
function triggeredTraits(s: GameState, p: PlayerState) {
  const x = pattern(p), atk = isAttack(s, p), n = ruleName(s, p);
  if (atk) {
    if (n.includes('大地兽') && x.even) enemies(s, p).forEach(e => poison(s, p, e, 2));
    if (n.includes('斯科特') && x.threeRun) enemies(s, p).forEach(e => { if (e.statuses.interference >= 2) damage(s, e, 5, p, true); e.statuses.interference++; rewardDebuff(s, p); });
    if (n.includes('黄泉') && p.cardId === '264013' && p.modifiers.pierce) p.attackLevel++;
    if (n.includes('卡芙卡')) enemies(s, p).forEach(e => poison(s, p, e, x.counts.size));
    if (p.cardId === '264018') { p.statuses.toughness += x.values.filter(v => v % 2).length; while (p.statuses.toughness >= 7) { p.statuses.toughness -= 7; enemies(s, p).forEach(e => damage(s, e, 7, p, true)); } }
    if (n.includes('星期日') && x.unique && p.statuses.thorns) { const amount = p.statuses.thorns; for (const e of enemies(s, p)) { const before = e.statuses.thorns; e.statuses.thorns += amount; emit(s, 'effect', `星期日转移荆棘：${e.name}${before}→${e.statuses.thorns}层`, { playerId: p.id, targetId: e.id, thornsBefore: before, thornsAfter: e.statuses.thorns, sourceLabel: '星期日转移荆棘' }); } p.statuses.thorns = 0; emit(s, 'effect', `星期日转移荆棘：${p.name}${amount}→0层`, { playerId: p.id, targetId: p.id, thornsBefore: amount, thornsAfter: 0, sourceLabel: '星期日转移荆棘' }); }
    if (n.includes('海瑟音')) for (const e of enemies(s, p)) poison(s, p, e, x.values.filter(v => v % 2 === 0).length, '海瑟音附毒');
  }
  if (n.includes('三月七') && x.pairs) enemies(s, p).forEach(e => damage(s, e, x.pairs * 3, p, true));
  if (!atk && n.includes('开拓妖精') && x.pairs) enemies(s, p).forEach(e => damage(s, e, 4, p, true));
  if (!atk && n.includes('自动机兵') && x.threeRun) p.statuses.nextStrength = 8;
  if (!atk && n.includes('白厄') && x.same && !p.unyieldingUsed) p.unyieldingUsed = true;
  if (n.includes('阮') && n.includes('梅') && !n.includes('造物')) p.statuses.evolution = Math.max(0, Math.min(3, p.statuses.evolution + (x.consecutive ? 1 : -1)));
  const w = weatherName(s);
  if (w === '小雨' && x.values.includes(6) && p.statuses.poison) { const before = p.statuses.poison; p.statuses.poison = 0; emit(s, 'effect', `天气·小雨：${p.name}清除${before}层中毒`, { targetId: p.id, poisonBefore: before, poisonAfter: 0, sourceLabel: '天气·小雨' }); }
  if (w === '中雪' && [...x.counts.values()].some(v => v >= 3)) heal(s, p, 10);
  if (atk && w === '霜' && x.pairs) p.statuses.frostGuard = 1;
  if (atk && w === '细雪' && p.rollsUsed === 0) p.statuses.nextToughness = 3;
  if (atk && w === '沙尘' && x.odd) p.statuses.strength += 3;
  if (atk && w === '晴雷') enemies(s, p).forEach(e => damage(s, e, 3, p, true, { sourceLabel: '天气·晴雷' }));
  if (atk && w === '时空暴' && x.values.length && x.values.every(v => v === 6)) { const e = enemies(s, p)[0]; const old = p.hp, other = e.hp; p.hp = other; e.hp = old; for (const [q, hpBefore] of [[p, old], [e, other]] as const) emit(s, 'effect', `天气·时空暴：${q.name}生命${hpBefore}→${q.hp}`, { playerId: p.id, targetId: q.id, targetCardId: q.cardId, hpBefore, hpAfter: q.hp, sourceLabel: '天气·时空暴' }); }
  if (!atk && w === '暴雪' && basicValue(s, p) <= 8) p.modifiers.forcefield = true;
  if (atk && w === '彩虹' && basicValue(s, p) <= 10) p.modifiers.pierce = true;
  if (p.modifiers.upgrade || atk && n.includes('知更鸟') && x.even) {
    upgradeSelectedDice(s, p);
  }
}
function comboSource(s: GameState, p: PlayerState): string | undefined {
  if (!p.modifiers.combo) return;
  const sources: string[] = [], x = pattern(p), n = ruleName(s, p), w = weatherName(s);
  if (['20201', '20203', '20204'].includes(p.cardId)) sources.push('首领技能');
  if (n.includes('流萤') && x.pairs >= 2 || n.includes('绯英') && x.values.length <= 3 || n.includes('蝶遐')) sources.push(card(s, p).name);
  for (const die of x.ds.filter(d => d.effect === 'combo')) sources.push(s.catalog.prismatics.find(d => d.id === die.typeId)?.name || '曜彩骰');
  if (w === '飓风' || w === '云隙光' && p.hp < Math.max(...enemies(s, p).map(e => e.hp))) sources.push(w);
  if (p.modifiers.tacticCombo) sources.push('连续攻击战术');
  return [...new Set(sources.length ? sources : ['连续攻击效果'])].join('、');
}
function attack(s: GameState, a: PlayerState, d: PlayerState, av: number, dv: number, strikeIndex: number, strikeCount: number, combo?: string): boolean {
  const firstId = s.nextId;
  const someoneFell = () => s.phase === 'finished' || s.log.some(e => e.id >= firstId && e.type === 'damage' && e.hpAfter === 0 && (e.targetId === a.id || e.targetId === d.id));
  const pierce = a.modifiers.pierce, defense = effectiveDefense(a, dv); const n = !pierce && d.modifiers.forcefield ? 0 : Math.max(0, av - defense);
  const dealt = damage(s, d, n, a, false, { damageKind: 'attack', sourceLabel: strikeIndex > 1 ? `连击·${combo || '连续攻击效果'}` : '攻击', strikeIndex, strikeCount, comboSource: combo, attack: av, defense: dv });
  if (someoneFell()) return true;
  if (dealt > 0 && named(s, a, '希儿') && !a.statuses.roundResurgence) {
    a.statuses.roundResurgence = 1;
    const remaining = unusedDice(s, a), amount = remaining.reduce((sum, die) => sum + die.value, 0);
    damage(s, d, amount, a, true, { damageKind: 'instant', sourceLabel: '希儿·再现' });
    if (someoneFell()) return true;
  }
  if (!n && ['20202', '20203', '20204'].includes(a.cardId)) a.statuses.failedAttacks++;
  if (d.cardId === '20502' && av > 20 || d.cardId === '20503' && av > 27) d.statuses.bossLucky = 0;
  if (a.modifiers.siphon && dealt) heal(s, a, dealt * a.modifiers.siphon, '虹吸');
  if (!n && named(s, a, '不死途')) damage(s, d, av * 0.7, a, true, { sourceLabel: '不死途瞬伤', attack: av, defense: dv });
  if (someoneFell()) return true;
  if (!pierce && d.modifiers.counter && defense > av) { damage(s, a, defense - av, d, true, { damageKind: 'counter', sourceLabel: '反击', attack: defense, defense: av }); if (s.mode === 'coop' && d.side === 0) d.statuses.roundCounter = 1; }
  if (someoneFell()) return true;
  if (n > 0) {
    if (named(s, d, '遐蝶')) { if (n >= 8) { d.attackLevel++; d.baseDefense++; } else if (n <= 5) damage(s, a, 3, d, true, { sourceLabel: '遐蝶瞬伤' }); }
    if (someoneFell()) return true;
    if (named(s, d, '狸猫记者')) damage(s, a, pattern(d).odd ? 4 : 2, d, true, { sourceLabel: '狸猫记者瞬伤' });
    if (someoneFell()) return true;
    if (named(s, d, '卡芙卡') && a.statuses.poison) { const before = a.statuses.poison; a.statuses.poison--; emit(s, 'effect', `卡芙卡受击：${a.name}中毒${before}→${a.statuses.poison}层`, { playerId: d.id, targetId: a.id, poisonBefore: before, poisonAfter: a.statuses.poison, sourceLabel: '卡芙卡受击减毒' }); }
    if (named(s, d, '星期日')) for (const target of [a, d]) { const before = target.statuses.thorns; target.statuses.thorns += 5; emit(s, 'effect', `星期日受击：${target.name}荆棘${before}→${target.statuses.thorns}层`, { playerId: d.id, targetId: target.id, thornsBefore: before, thornsAfter: target.statuses.thorns, sourceLabel: '星期日受击荆棘' }); }
  }
  const reflect = Math.max(d.modifiers.reflect, n > 0 && named(s, d, '不死途') ? 0.3 : 0); if (reflect) damage(s, a, dv * reflect, d, true, { damageKind: 'reflect', sourceLabel: '反伤', attack: dv, defense: av });
  return someoneFell();
}
function resolveRound(s: GameState) {
  // Ordered phases are explicit: die effects → transforms → traits/weather → thorns → attacks → poison/end.
  // Capture before any instant damage; later boss phases must not replace this card identity.
  s.lastResolution = { turn: s.turn, attackingSide: s.attackingSide, weatherId: s.weatherId, weatherName: weatherName(s) || '无天气', eventStartId: s.nextId, eventEndId: s.nextId - 1, players: s.players.map(p => ({ id: p.id, cardId: p.cardId, side: p.side, role: isAttack(s, p) ? 'attack' : 'defense', value: getPlayerPreview(s, p.id).value, dice: clone(selected(p)), effects: [], hp: p.hp, maxHp: p.maxHp })), strikes: [], events: [] };
  const ordered = [...s.players].sort((a, b) => Number(isAttack(s, b)) - Number(isAttack(s, a)));
  for (const p of ordered) { if (!preparesCharacter(s, p) || detachedEncounters.has(s) && p.hp <= 0) continue; resolveDieEffects(s, p); if (finished(s)) return; }
  for (const p of s.players.filter(p => preparesCharacter(s, p))) { const m = pureTraits(s, p); p.modifiers.arise = m.arise; p.modifiers.hack = m.hack; }
  transformDice(s);
  for (const p of s.players.filter(p => preparesCharacter(s, p))) p.modifiers = pureTraits(s, p);
  for (const p of ordered) { if (!preparesCharacter(s, p) || detachedEncounters.has(s) && p.hp <= 0) continue; triggeredTraits(s, p); if (finished(s)) return; }
  const values = new Map(s.players.map(p => [p.id, basicValue(s, p)]));
  for (const p of s.players) { const teammate = s.players.find(q => q.side === p.side && q.id !== p.id); if (teammate) { if (p.modifiers.attackSync && isAttack(s, p) || p.modifiers.defenseSync && !isAttack(s, p)) values.set(p.id, Math.max(values.get(p.id)!, values.get(teammate.id)!)); if (p.modifiers.fullSupport) { values.set(p.id, 0); values.set(teammate.id, values.get(teammate.id)! * 2); } } }
  // Retain the actual comparison values before attacks and startRound reset modifiers/dice.
  // This metadata consumes neither RNG nor event IDs and cannot influence the rules.
  const effectNames: Record<string, string> = { combo: '连击', pierce: '洞穿', forcefield: '力场', unyielding: '不屈', counter: '反击', hack: '骇入', arise: '跃升', siphon: '虹吸', reflect: '反伤' };
  for (const entry of s.lastResolution.players) { const p = s.players.find(p => p.id === entry.id)!; if (entry.cardId === p.cardId) { entry.value = values.get(p.id)!; entry.dice = clone(selected(p)); entry.effects = Object.entries(effectNames).filter(([name]) => p.modifiers[name]).map(([, label]) => label); if (p.modifiers.penetration && !p.modifiers.pierce) entry.effects.push(`穿透${p.modifiers.penetration}防御`); } }
  emit(s, 'effect', `第${s.turn}回合结算 · ${weatherName(s) || '无天气'} · ${s.lastResolution.players.map(p => `${s.players.find(q => q.id === p.id)!.name}${p.role === 'attack' ? '攻击' : '防御'}${p.value}［${p.dice.map(d => d.value).join('、')}］`).join('；')}`, { sourceLabel: '攻防结算' });
  for (const p of s.players) {
    if (!preparesCharacter(s, p)) continue;
    const value = values.get(p.id)!; if (isAttack(s, p) && named(s, p, '爻光') && value >= 18) { const before = p.statuses.thorns; p.statuses.thorns = 0; p.prismaticUses++; emit(s, 'effect', `爻光清除${before}层荆棘并恢复1次曜彩骰`, { playerId: p.id, targetId: p.id, thornsBefore: before, thornsAfter: 0, sourceLabel: '爻光清荆棘' }); }
    if (p.statuses.thorns) { const thorns = p.statuses.thorns; p.statuses.thorns = 0; damage(s, p, thorns, undefined, true, { damageKind: 'thorns', sourceLabel: '荆棘', thornsBefore: thorns, thornsAfter: 0 }); }
    if (finished(s)) return;
    if (!isAttack(s, p) && p.statuses.overload) damage(s, p, p.statuses.overload / 2, undefined, true, { damageKind: 'overload', sourceLabel: '防御超载' });
    if (finished(s)) return;
  }
  if (finished(s)) return;
  const attackers = s.players.filter(p => isAttack(s, p) && !detachedEncounters.get(s)?.skipAttackIds?.includes(p.id) && (!detachedEncounters.has(s) || p.hp > 0));
  for (const a of attackers) {
    let targets = enemies(s, a).filter(p => !detachedEncounters.get(s)?.attackTargetIds || detachedEncounters.get(s)!.attackTargetIds!.includes(p.id)); const bossRule = s.bossPhases[s.bossPhase]?.target;
    if (s.mode === 'coop' && a.side === 1 && (bossRule && bossRule !== 'all' || ['20102', '20103', '20104'].includes(a.cardId))) { const high = bossRule !== 'lowestDefense'; const scores = targets.map(p => values.get(p.id)!); const target = high ? Math.max(...scores) : Math.min(...scores); targets = [targets.find(p => values.get(p.id) === target)!]; }
    const count = 1 + a.modifiers.combo, source = comboSource(s, a), fallen = new Set<string>(), attackStartId = s.nextId;
    let attackerFell = false;
    for (let hit = 0; hit < count && !finished(s) && !attackerFell; hit++) for (const d of targets) {
      if (fallen.has(d.id) || finished(s)) continue;
      const firstId = s.nextId;
      if (attack(s, a, d, values.get(a.id)!, values.get(d.id)!, hit + 1, count, source)) {
        fallen.add(d.id);
        attackerFell = s.log.some(e => e.id >= firstId && e.type === 'damage' && e.targetId === a.id && e.hpAfter === 0);
        if (attackerFell) break;
      }
    }
    // Describe executed attacks, not a combo hit that was cancelled by death.
    for (const target of targets) {
      const actualCount = s.lastResolution.events!.filter(e => e.id >= attackStartId && e.damageKind === 'attack' && e.playerId === a.id && e.targetId === target.id).length;
      for (const event of [...s.log, ...s.lastResolution.events!]) if (event.id >= attackStartId && event.damageKind === 'attack' && event.playerId === a.id && event.targetId === target.id) event.strikeCount = actualCount;
      for (const strike of s.lastResolution.strikes) if (strike.eventId! >= attackStartId && strike.damageKind === 'attack' && strike.attackerId === a.id && strike.defenderId === target.id) strike.strikeCount = actualCount;
    }
    if (finished(s)) return;
    // This extra trigger belongs to the whole attack, never to each combo hit.
    if (!attackerFell && named(s, a, '海瑟音') && pattern(a).even) for (const d of targets.filter(d => !fallen.has(d.id))) {
      const stacks = d.statuses.poison;
      if (stacks) damage(s, d, stacks * (d.statuses.venom ? 2 : 1), a, true, { damageKind: 'poison-trigger', sourceLabel: '海瑟音引爆', poisonBefore: stacks, poisonAfter: stacks });
      if (finished(s)) return;
    }
    if (attackerFell) continue;
    if (named(s, a, '希儿')) {
      const attacks = s.lastResolution.events!.filter(e => e.id >= attackStartId && e.damageKind === 'attack' && e.playerId === a.id);
      if (attacks.length && attacks.every(e => !e.amount)) upgradeSelectedDice(s, a, '希儿·再现升级');
    }
    if (named(s, a, '垃圾桶')) a.statuses.strength += pattern(a).even ? 4 : 2;
    if (named(s, a, '风堇')) { const allSix = pattern(a).values.every(v => v === 6); a.statuses.strength = Math.floor(values.get(a.id)! * (allSix ? 1 : 0.5)); if (allSix) heal(s, a, 6); }
    if (named(s, a, '丹恒') && values.get(a.id)! >= 18) a.statuses.danGuard = 1;
  }
  if (!detachedEncounters.get(s)?.skipEnd) settleRoundEnd(s, values);
  if (s.winner !== null) return;
  if (detachedEncounters.has(s)) return;
  if (s.turn >= s.maxTurns) { winner(s, null, '达到本房间回合上限，本局和棋'); return; }
  s.turn++; s.attackingSide = s.attackingSide === 0 ? 1 : 0; startRound(s);
}

function settleRoundEnd(s: GameState, values: Map<string, number>, playerIds?: string[]) {
  for (const p of s.players) {
    if (playerIds && !playerIds.includes(p.id)) continue;
    if (s.winner !== null) break;
    p.accumulatedPower += values.get(p.id)!;
    if (named(s, p, '昔涟') && p.accumulatedPower > 24) p.attackLevel = 5;
    if (p.statuses.poison) { const before = p.statuses.poison; p.statuses.poison = Math.max(0, before - 1); damage(s, p, before * (p.statuses.venom ? 2 : 1), undefined, true, { damageKind: 'poison-tick', sourceLabel: '回合末中毒', poisonBefore: before, poisonAfter: p.statuses.poison }); }
    if (finished(s)) return;
    if (p.statuses.failedAttacks) { damage(s, p, p.statuses.failedAttacks * 4, undefined, true, { sourceLabel: '首领攻击受阻' }); p.statuses.strength += p.statuses.failedAttacks * 2; }
    if (!isAttack(s, p) && named(s, p, '财富蕉师') && !p.statuses.roundTaken) heal(s, p, 5);
    if (s.mode === 'coop' && p.side === 0) { const dealt = p.statuses.roundDamage; p.tacticPoints += dealt >= 15 ? 3 : dealt >= 10 ? 2 : dealt >= 5 ? 1 : 0; if (!isAttack(s, p) && !p.statuses.roundTaken) p.tacticPoints += 3; if (p.statuses.roundCounter) p.tacticPoints += 2; }
    if (named(s, p, '大黑塔')) p.prismaticUses++;
    p.prismaticUses += p.modifiers.prismaticRefund;
    if (named(s, p, '财富蕉师') && p.hp <= 5 && !p.bananaUsed) { p.baseDefense++; p.bananaUsed = true; }
  }
}

function beginSwap(s: GameState) { s.phase = 'swap'; s.activePlayerId = allies(s)[0].id; s.swapPool = allies(s).flatMap(p => p.dice.filter(d => !p.selectedIds.includes(d.id))); for (const p of allies(s)) { p.dice = selected(p); p.confirmed = false; } }
function confirm(s: GameState, p: PlayerState) {
  p.confirmed = true;
  if (s.phase === 'swap') { if (allies(s).every(q => q.confirmed)) { const boss = s.players.find(q => q.side === 1)!; if (boss.rollLocked) resolveRound(s); else { s.phase = 'roll'; s.activePlayerId = boss.id; } } return; }
  p.rollLocked = true;
  if (s.mode === 'classic') { const next = s.players.find(q => !q.rollLocked); if (next) s.activePlayerId = next.id; else resolveRound(s); }
  else if (p.side === 0) { if (allies(s).every(q => q.rollLocked)) beginSwap(s); else s.activePlayerId = allies(s).find(q => !q.rollLocked)!.id; }
  else if (allies(s).every(q => q.rollLocked)) resolveRound(s);
  else s.activePlayerId = allies(s).find(q => !q.rollLocked)!.id;
}
function useTactic(s: GameState, p: PlayerState, index: number) {
  const id = p.tactics[index]; const t = s.catalog.tactics.find(t => t.id === id); if (!t) throw new Error('战术卡不存在');
  if (t.kind === 'attack' && !isAttack(s, p) || t.kind === 'defense' && isAttack(s, p)) throw new Error('此战术卡不能在当前攻防回合使用');
  const n = t.name, m = p.modifiers, teammate = s.players.find(q => q.side === p.side && q.id !== p.id);
  const tier = /III|Ⅲ|III|3/.test(n) ? 3 : /II|Ⅱ|2/.test(n) ? 2 : 1;
  if (n.includes('攻击提升')) m.attack += [0, 3, 5, 7][tier];
  else if (n.includes('防御提升')) { m.defense += [0, 5, 6, 8][tier]; if (tier === 2) m.counter = true; if (tier === 3) m.reflect = Math.max(m.reflect, 0.5); }
  else if (n.includes('攻击支援') && teammate) teammate.modifiers.attack += 5;
  else if (n.includes('防御支援') && teammate) teammate.modifiers.defense += 5;
  else if (n.includes('攻击同步')) m.attackSync = true;
  else if (n.includes('防御同步')) m.defenseSync = true;
  else if (n.includes('自我治愈')) heal(s, p, tier === 1 ? 8 : 10);
  else if (n.includes('跃升')) m.arise = true;
  else if (n.includes('骇入')) m.hack = true;
  else if (n.includes('剧毒')) enemies(s, p).forEach(e => { poison(s, p, e, [0, 2, 4, 3][tier]); if (tier === 3) e.statuses.venom = 1; });
  else if (n.includes('曜彩恢复')) m.prismaticRefund++;
  else if (n.includes('虹吸')) m.siphon = Math.max(0.5, m.siphon);
  else if (n.includes('升级')) m.upgrade = true;
  else if (n.includes('穿透')) m.pierce = true;
  else if (n.includes('连续')) { m.combo = 1; m.tacticCombo = true; }
  else if (n.includes('背水')) { const bonus = p.hp - 1; damage(s, p, bonus, p, true, { damageKind: 'self-cost', sourceLabel: '背水战术' }); m.attack += bonus; m.defense += bonus; }
  else if (n.includes('全力支援')) m.fullSupport = true;
  else if (t.effect === 'attack') m.attack += t.amount || 3;
  else if (t.effect === 'heal') heal(s, p, t.amount || 8);
  else throw new Error(`尚不识别战术 ${n}`);
  p.tactics.splice(index, 1); emit(s, 'tactic', `${p.name}使用${n}`, { playerId: p.id });
}

export function applyCommand(state: GameState, command: GameCommand): CommandResult {
  if (state.phase === 'finished') return { state, events: [], error: '对局已经结束' };
  const s = cloneState(state), p = s.players.find(p => p.id === command.playerId); if (!p) return { state, events: [], error: '玩家不存在' };
  const firstId = s.nextId;
  try {
    if (command.type === 'surrender') { winner(s, p.side === 0 ? 1 : 0, `${p.name}认输`); return { state: s, events: s.log.filter(e => e.id >= firstId) }; }
    const legal = getLegalActions(s, p.id);
    switch (command.type) {
      case 'select': {
        if (!legal.canSelect) throw new Error('现在不能选择骰子');
        const ids = [...new Set(command.diceIds)]; if (ids.length !== command.diceIds.length || ids.some(id => !p.dice.some(d => d.id === id))) throw new Error('选择了无效骰子');
        // Selection also identifies dice to reroll. The attack/defense count is
        // enforced only when confirming use, not while selecting reroll targets.
        p.selectedIds = ids; emit(s, 'select', `${p.name}选择骰子`, { playerId: p.id }); break;
      }
      case 'reroll': {
        if (!legal.canReroll) throw new Error('没有可用重投次数');
        const ids = [...new Set(command.diceIds)]; if (!ids.length || ids.length !== command.diceIds.length || ids.some(id => !p.dice.some(d => d.id === id))) throw new Error('重投骰子无效');
        p.rerolls--; p.rollsUsed++; for (const d of p.dice.filter(d => ids.includes(d.id))) rollDie(s, p, d);
        p.selectedIds = [];
        if (named(s, p, '刃')) damage(s, p, 2, undefined, true, { damageKind: 'self-cost', sourceLabel: '刃重投耗血' });
        if (named(s, p, '爻光') && p.rollsUsed > 2) p.statuses.thorns += 2;
        if (weatherName(s) === '幻日') p.statuses.thorns += 2;
        if (named(s, p, '开拓者') && p.dice.some(d => ids.includes(d.id) && !d.prismatic && d.value === 6)) p.rerolls++;
        emit(s, 'reroll', `${p.name}重投骰子`, { playerId: p.id, dice: clone(p.dice.filter(d => ids.includes(d.id))) }); break;
      }
      case 'prismatic': {
        if (!legal.canPrismatic) throw new Error('曜彩骰使用条件尚未满足');
        const n = named(s, p, '缇宝') ? 2 : 1; p.prismaticUses--; p.prismaticRolled = true;
        for (let i = 0; i < n; i++) p.dice.push(makeDie(s, p, 6, p.prismaticId));
        emit(s, 'roll', `${p.name}投掷曜彩骰`, { playerId: p.id, dice: clone(p.dice.slice(-n)) }); break;
      }
      case 'confirm': {
        if (command.diceIds !== undefined) {
          if (!(legal.canSelect || legal.canSwap)) throw new Error('现在不能确认骰子');
          const ids = [...new Set(command.diceIds)];
          if (ids.length !== command.diceIds.length || ids.some(id => !p.dice.some(d => d.id === id))) throw new Error('选择了无效骰子');
          // Swaps already commit the chosen set. Confirmation cannot discard an exchanged die.
          if (legal.canSwap && (ids.length !== p.selectedIds.length || ids.some(id => !p.selectedIds.includes(id)))) throw new Error('交换阶段不能重新选择骰子');
          p.selectedIds = ids;
        }
        const currentLegal = getLegalActions(s, p.id);
        if (!currentLegal.canConfirm) throw new Error(`请选择${currentLegal.requiredDice || '至少1'}颗骰子，并保留所有命定骰`);
        confirm(s, p); break;
      }
      case 'swap': {
        if (!legal.canSwap) throw new Error('现在不能交换骰子');
        const own = p.dice.findIndex(d => d.id === command.ownDieId); const pool = s.swapPool.findIndex(d => d.id === command.poolDieId);
        if (own < 0 || pool < 0 || !p.selectedIds.includes(command.ownDieId)) throw new Error('骰子已被交换，请重试');
        if (p.dice[own].forced) throw new Error('命定骰必须保留');
        const incoming = s.swapPool[pool], outgoing = p.dice[own]; s.swapPool[pool] = outgoing; p.dice[own] = incoming; p.selectedIds = p.selectedIds.map(id => id === outgoing.id ? incoming.id : id);
        // The incoming die occupies the selected pool slot for permanent upgrades.
        // ownerId still records its original roller for shared-pool effects.
        const occupied = new Set(p.dice.filter(d => d !== incoming).map(d => d.poolIndex));
        incoming.poolIndex = outgoing.poolIndex ?? card(s, p).dice.findIndex((_, i) => !occupied.has(i));
        emit(s, 'swap', `${p.name}交换骰子`, { playerId: p.id }); break;
      }
      case 'buyTactic': {
        if (!legal.canShop) throw new Error('商店当前不可用'); if (p.tactics.length >= 3) throw new Error('最多持有3张战术卡');
        const t = s.catalog.tactics.find(t => t.id === p.offers[command.offerIndex]); if (!t) throw new Error('商品已售出'); if (p.tacticPoints < t.cost) throw new Error('战术点不足');
        p.tacticPoints -= t.cost; p.tactics.push(t.id); p.offers[command.offerIndex] = ''; emit(s, 'tactic', `${p.name}购买${t.name}`, { playerId: p.id }); break;
      }
      case 'refreshTactics': if (!legal.canShop || p.tacticPoints < 1) throw new Error('刷新需要1战术点'); if (p.statuses.shopRefresh >= 1) throw new Error('每次战术环节只能刷新一次'); p.statuses.shopRefresh++; p.tacticPoints--; fillOffers(s, p); break;
      case 'leaveTactics': if (!legal.canShop) throw new Error('当前不在战术环节'); p.shopReady = true; if (allies(s).every(q => q.shopReady)) s.phase = 'roll'; break;
      case 'discardTactic': if (!(legal.canShop || legal.canUseTactics) || !p.tactics[command.handIndex]) throw new Error('不能丢弃此战术卡'); p.tactics.splice(command.handIndex, 1); break;
      case 'useTactic': if (!legal.canUseTactics) throw new Error('战术卡只能在交换阶段使用'); useTactic(s, p, command.handIndex); break;
      default: throw new Error('未知对局指令');
    }
    return { state: s, events: s.log.filter(e => e.id >= firstId) };
  } catch (e) { return { state, events: [], error: e instanceof Error ? e.message : String(e) }; }
}

/** The state is public in this dice game. Return a copy so a UI cannot mutate the authority. */
export function projectState(state: GameState, _viewerId?: string): GameState { return clone(state); }

function combinations<T>(items: T[], size: number): T[][] { const out: T[][] = []; const visit = (start: number, chosen: T[]) => { if (chosen.length === size) { out.push(chosen); return; } for (let i = start; i <= items.length - size + chosen.length; i++) visit(i + 1, [...chosen, items[i]]); }; visit(0, []); return out; }
function bestSelection(s: GameState, p: PlayerState): string[] {
  const r = required(s, p); let score = -Infinity, best: string[] = [];
  for (let size = r.min; size <= r.max; size++) for (const ds of combinations(p.dice, size)) {
    if (p.dice.some(d => d.forced && !ds.includes(d))) continue;
    const q = { ...p, selectedIds: ds.map(d => d.id) }, copy = { ...s, players: s.players.map(x => x.id === p.id ? q : x) }; const preview = getPlayerPreview(copy, p.id);
    let value = preview.value + (preview.effects.includes('连击') ? preview.value * 0.7 : 0) + (preview.effects.includes('洞穿') ? 16 : 0) + (preview.effects.includes('力场') ? 25 : 0) + (preview.effects.includes('不屈') && p.hp < 12 ? 20 : 0) + (preview.effects.includes('骇入') ? 4 : 0);
    if (named(s, p, '三月七')) value += pattern(q).pairs * 6;
    if (named(s, p, '卡芙卡')) value += pattern(q).counts.size * 4;
    if (named(s, p, '知更鸟') && pattern(q).even) value += 12;
    if (named(s, p, '海瑟音') && pattern(q).even) value += 14;
    if (isAttack(s, p) && named(s, p, '希儿')) value = preview.damageEstimate + preview.value * 0.15;
    if (isAttack(s, p) && named(s, p, '绯英') && ds.length === 1) value += 7;
    if (value > score) { score = value; best = q.selectedIds; }
  }
  return best;
}
export function chooseAiCommand(s: GameState, playerId?: string): GameCommand | null {
  if (s.phase === 'finished') return null;
  const p = playerId ? s.players.find(p => p.id === playerId) : s.players.find(p => p.isAI && getLegalActions(s, p.id).canAct); if (!p) return null;
  const l = getLegalActions(s, p.id); if (!l.canAct) return null;
  if (l.canShop) {
    if (p.tactics.length < 3) { const index = p.offers.findIndex(id => { const t = s.catalog.tactics.find(t => t.id === id); return t && t.cost <= p.tacticPoints && t.kind !== 'defense'; }); if (index >= 0) return { type: 'buyTactic', playerId: p.id, offerIndex: index }; }
    return { type: 'leaveTactics', playerId: p.id };
  }
  if (l.canSwap) {
    const usable = p.tactics.findIndex(id => { const t = s.catalog.tactics.find(t => t.id === id); return t && (t.kind === 'any' || t.kind === 'attack' && isAttack(s, p) || t.kind === 'defense' && !isAttack(s, p)); });
    if (usable >= 0) return { type: 'useTactic', playerId: p.id, handIndex: usable };
    // Evaluate an atomic exchange using the same character-aware objective as ordinary selection.
    let bestGain = 0, swap: GameCommand | null = null; const base = getPlayerPreview(s, p.id);
    const baseScore = base.value * (base.effects.includes('连击') ? 1.7 : 1) + (base.effects.includes('洞穿') ? 16 : 0);
    for (const own of p.dice.filter(d => !d.forced)) for (const pool of s.swapPool) {
      const q = { ...p, dice: p.dice.map(d => d.id === own.id ? pool : d), selectedIds: p.selectedIds.map(id => id === own.id ? pool.id : id) }, copy = { ...s, players: s.players.map(x => x.id === p.id ? q : x), swapPool: s.swapPool.map(d => d.id === pool.id ? own : d) }; const preview = getPlayerPreview(copy, p.id); const score = preview.value * (preview.effects.includes('连击') ? 1.7 : 1) + (preview.effects.includes('洞穿') ? 16 : 0);
      if (score - baseScore > bestGain) { bestGain = score - baseScore; swap = { type: 'swap', playerId: p.id, ownDieId: own.id, poolDieId: pool.id }; }
    }
    return swap || { type: 'confirm', playerId: p.id };
  }
  if (l.canPrismatic && (isAttack(s, p) || p.hp <= p.maxHp * 0.65 || named(s, p, '大黑塔'))) return { type: 'prismatic', playerId: p.id };
  const best = bestSelection(s, p);
  if (l.canReroll && p.rollsUsed < (named(s, p, '刃') ? 3 : 2)) { const reroll = p.dice.filter(d => !best.includes(d.id) && d.value < d.sides * 0.7 && !d.forced).map(d => d.id); if (reroll.length) return { type: 'reroll', playerId: p.id, diceIds: reroll }; }
  return best.length ? { type: 'confirm', playerId: p.id, diceIds: best } : null;
}

export function runAI(state: GameState, maxCommands = 200): CommandResult {
  let current = state; const events: GameEvent[] = [];
  for (let i = 0; i < maxCommands; i++) { const cmd = chooseAiCommand(current); if (!cmd) break; const result = applyCommand(current, cmd); if (result.error) return { state: current, events, error: result.error }; current = result.state; events.push(...result.events); }
  return { state: current, events };
}

/** Build a transient battle for a multiplayer objective without copying any
 * character rules. The caller supplies the target and owns its mode rules. */
export function createCharacterEncounter(players: PlayerState[], options: {
  catalog: GameState['catalog']; seed: number; nextId: number; turn: number; attackingSide: Side; weatherId?: string | null;
}): GameState {
  return { version: 1, mode: 'classic', phase: 'roll', turn: options.turn, seed: options.seed, nextId: options.nextId,
    players: clone(players), activePlayerId: players[0]?.id ?? null, attackingSide: options.attackingSide,
    weatherId: options.weatherId ?? null, weatherSchedule: 'off', sharedLives: 999, bossPhase: 0, bossPhases: [],
    swapPool: [], winner: null, maxTurns: 9999, log: [], catalog: options.catalog, tacticsEnabled: false };
}

/** Initialize dice and character round traits through the original engine. */
export function prepareCharacterEncounter(state: GameState): GameState {
  const s = cloneState(state); startRound(s); s.activePlayerId = s.players[0]?.id ?? null; return s;
}

/** Resolve exactly one encounter. Falling characters stay down until the party
 * mode revives them, and no classic victory or new round is created. */
export function resolveCharacterEncounter(state: GameState, rules: CharacterEncounterRules = {}): GameState {
  const s = cloneState(state); detachedEncounters.set(s, rules); resolveRound(s); detachedEncounters.delete(s); return s;
}

/** End-of-round bookkeeping can be deferred until every party objective and
 * boss action has resolved, so poison/refunds tick once regardless of targets. */
export function settleCharacterRound(state: GameState, playerIds?: string[], resolvedValues: Record<string, number> = {}): GameState {
  const s = cloneState(state); detachedEncounters.set(s, {});
  settleRoundEnd(s, new Map(s.players.map(p => [p.id, resolvedValues[p.id] ?? basicValue(s, p)])), playerIds);
  detachedEncounters.delete(s); return s;
}
