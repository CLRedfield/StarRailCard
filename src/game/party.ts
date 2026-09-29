import { defaultCatalog } from './catalog';
import { applyCommand, chooseAiCommand, createCharacterEncounter, createMatch, getLegalActions, getPlayerPreview, prepareCharacterEncounter, resolveCharacterEncounter, settleCharacterRound } from './engine';
import type { CardDefinition, GameState, PlayerConfig, PlayerState } from './types';
import type { OverlordMove, PartyCommand, PartyCommandResult, PartyConfig, PartyLegalActions, PartyMode, PartyPlayer, PartyPreview, PartyState, PartyTarget } from './partyTypes';

const SENTINEL = '__party_sentinel';
const sentinel: CardDefinition = { id: SENTINEL, name: '裂界机关', hp: 1000, attack: 3, defense: 2, dice: [6, 6, 6, 6, 6] };
export const PARTY_MODE_NAMES: Record<PartyMode, string> = { treasure: '银河夺宝', raid: '裂界远征', duos: '双人搭档乱斗', overlord: '首领降临' };
/** Tune the modes here; no character table or character skill is forked. */
export const PARTY_RULES = {
  raid: { hpPerHero: 40, shieldPerHero: 2.5, chargePerHero: 2.5, wavePower: 6, crisisLimit: 12 },
  overlord: { hpPerHero: 48, shieldPerHero: 2.5, chargePerHero: 2.5, wavePower: 5, crisisLimit: 12 },
  treasure: { rounds: 8, rewards: [5, 7, 9] }, duos: { rounds: 6, winScore: 4, loseScore: 1 },
} as const;
const moves: Record<OverlordMove, string> = { sweep: '横扫：对全队造成伤害，坚守可减伤', drain: '汲取：攻击最低生命者并恢复首领生命，援护可阻止治疗', eruption: '爆发：造成重创，摧毁蓄力装置可以中断' };
const rules: PartyState['roundRule'][] = [
  { kind: 'bounty', name: '星核悬赏', description: '本轮目标奖励 + 2；合作模式本体受到的伤害 + 20%。' },
  { kind: 'precision', name: '精密回路', description: '选出的骰子全不重复时，目标贡献额外 + 6。' },
  { kind: 'respite', name: '补给窗口', description: '本轮开始恢复 6 点生命；援护治疗额外 + 4。' },
  { kind: 'surge', name: '能量涌动', description: '本轮多 1 次重投，目标与首领攻势更强。' },
];
const clone = <T>(x: T): T => structuredClone(x);
function hash(seed: string | number) { if (typeof seed === 'number') return (seed >>> 0) || 1; let n = 2166136261; for (const c of seed) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return (n >>> 0) || 1; }
function random(s: PartyState) { let n = s.seed; n ^= n << 13; n ^= n >>> 17; n ^= n << 5; s.seed = n >>> 0; return s.seed / 4294967296; }
function log(s: PartyState, text: string, playerId?: string) { s.log.push({ id: s.nextId++, round: s.round, text, playerId }); if (s.log.length > 160) s.log.shift(); }
function syncBossHealth(s: PartyState, source: 'player' | 'shared' = 'shared') {
  const boss = s.players.find(p => p.role === 'boss');
  if (boss) { if (source === 'player') s.bossHp = Math.max(0, Math.min(s.bossMaxHp, boss.hp)); boss.hp = s.bossHp; }
  const core = s.targets.find(t => t.id === 'core'); if (core) { core.hp = s.bossHp; core.maxHp = s.bossMaxHp; core.broken = s.bossHp <= 0; }
}
function copyState(s: PartyState): PartyState { return { ...clone({ ...s, catalog: undefined }), catalog: s.catalog }; }
function makePlayer(input: PlayerConfig, s: PartyState): PlayerState {
  return createMatch({ mode: 'classic', catalog: s.catalog, weather: 'off', players: [input, { id: '__initial-opponent', name: '机关', cardId: SENTINEL }] }, s.seed).players[0];
}
function target(id: string, name: string, kind: PartyTarget['kind'], hp: number, difficulty: number, reward: number, description: string): PartyTarget {
  return { id, name, kind, hp, maxHp: hp, difficulty, reward, description, broken: false };
}
function pairings(s: PartyState): string[][] {
  const teams = [...new Set(s.players.map(p => p.teamId))];
  if (teams.length === 2) return [teams];
  if (teams.length === 3) { const bye = (s.round - 1) % 3; return [teams.filter((_, i) => i !== bye), [teams[bye]]]; }
  const arrangements = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
  return arrangements[(s.round - 1) % 3].map(indices => indices.map(i => teams[i]));
}
function role(s: PartyState, p: PartyPlayer): 'attack' | 'defense' {
  if (p.role === 'boss') return 'attack';
  if (s.mode === 'duos') { const pair = pairings(s).find(t => t.includes(p.teamId))!; return pair.length === 1 || pair[(s.round - 1) % 2] === p.teamId ? 'attack' : 'defense'; }
  return p.plan.targetId === 'bastion' || p.plan.stance !== 'assault' ? 'defense' : 'attack';
}
function opponent(s: PartyState, p: PartyPlayer, id = `trial-${p.id}`): PlayerState {
  if (!s.enemies[id]) { const e = makePlayer({ id: `enemy-${id}`, name: '裂界机关', cardId: SENTINEL }, s); e.side = 1; s.enemies[id] = e; }
  return s.enemies[id];
}
function context(s: PartyState, p: PartyPlayer, enemy?: PlayerState): GameState {
  const e = enemy ?? ((s.mode === 'raid' || s.mode === 'overlord') && p.role !== 'boss' && p.plan.stance === 'assault' ? s.enemies[p.plan.targetId] : undefined) ?? s.enemies[`trial-${p.id}`];
  // All objective types always have a neutral opponent, including previews.
  return createCharacterEncounter([{ ...p, side: 0 }, { ...e, side: 1 }], { catalog: s.catalog, seed: s.seed, nextId: s.nextId, turn: s.round, attackingSide: role(s, p) === 'attack' ? 0 : 1, weatherId: s.weatherId });
}
function sync(s: PartyState, g: GameState) { s.seed = g.seed; s.nextId = g.nextId; s.battleEvents.push(...g.log); if (s.battleEvents.length > 240) s.battleEvents = s.battleEvents.slice(-240); }
function adopt(p: PartyPlayer, source: PlayerState) { Object.assign(p, source); }
function addUpgrades(p: PartyPlayer) { p.modifiers.attack += p.upgrades.power * 2; p.modifiers.defense += p.upgrades.ward * 2; }
function refreshPlan(s: PartyState, p: PartyPlayer) {
  p.plan = { targetId: s.mode === 'treasure' ? ['fire', 'bastion', 'puzzle'][s.players.indexOf(p) % 3] : s.mode === 'duos' ? s.targets.find(t => t.id.includes(p.teamId))!.id : 'core', stance: 'assault' };
  if (p.plan.targetId === 'bastion') p.plan.stance = 'guard';
}
function beginRound(s: PartyState) {
  s.phase = 'planning'; s.results = []; s.battleEvents = []; s.roundStarts = {};
  s.roundRule = clone(rules[Math.floor(random(s) * rules.length)]);
  if (s.mode === 'treasure') s.targets = [
    target('fire', '火力宝库', 'fire', 1000, 8 + s.round, 6, '攻击突破守卫。最高突破者拿大奖，独占额外 + 2。'),
    target('bastion', '坚守宝库', 'bastion', 1000, 11 + s.round, 6, '承受守卫攻击，格挡与反击决定贡献；护住自己也能夺宝。'),
    target('puzzle', '奇巧宝库', 'puzzle', 1000, 10, 6, `骰型贡献：${s.round % 2 ? '对子 + 7、全偶数 + 6' : '各不相同 + 6、连续数字 + 8'}，并计入角色技能伤害。`),
  ];
  if (s.mode === 'treasure') {
    const rewards = [...PARTY_RULES.treasure.rewards];
    for (let i = rewards.length - 1; i > 0; i--) { const j = Math.floor(random(s) * (i + 1)); [rewards[i], rewards[j]] = [rewards[j], rewards[i]]; }
    s.targets.forEach((t, i) => { t.reward = rewards[i]; t.description += ` 本轮星核悬赏 ${t.reward} 分。`; });
  }
  if (s.mode === 'duos') s.targets = pairings(s).map((pair, i) => target(`arena-${pair.join('-')}`, pair.length === 1 ? '遗迹挑战' : `第 ${i + 1} 竞技场`, 'arena', 0, 14 + s.round, 4, pair.length === 1 ? '轮空队共同挑战机关，仍可赢得积分和补给。' : `${pair.join(' 对阵 ')}；攻守逐轮轮换，搭档可以换骰与援护。`));
  if (s.mode === 'raid' || s.mode === 'overlord') {
    const count = s.players.filter(p => p.role !== 'boss').length;
    const phase = Math.max(s.bossPhase, s.bossHp <= s.bossMaxHp * 0.5 ? 2 : 1);
    s.bossPhase = phase;
    const tuning = PARTY_RULES[s.mode]; const shieldHp = Math.ceil(count * (tuning.shieldPerHero + phase - 1));
    s.targets = [target('core', '首领本体', 'core', s.bossHp, 5 + phase * 2, 0, '护盾存在时伤害减半；破盾后集中输出。'),
      target('shield', '护盾核心', 'shield', shieldHp, 2 + phase, 0, '先于本体结算，击破后全队本轮对本体造成完整伤害。'),
      target('charge', '蓄力装置', 'charge', Math.ceil(count * (tuning.chargePerHero + phase - 1)), 1 + phase, 0, '先于本体结算，摧毁即可打断本轮蓄力攻击。护盾也保护装置。')];
    for (const t of s.targets) opponent(s, s.players[0], t.id);
    const first = Math.floor(random(s) * 3); s.bossMoves = [(['sweep', 'drain', 'eruption'] as OverlordMove[])[first], (['sweep', 'drain', 'eruption'] as OverlordMove[])[(first + 1) % 3]];
    s.bossMove = s.bossMoves[Math.floor(random(s) * 2)];
    s.bossTelegraph = s.bossMoves.map(m => moves[m]).join(' / ');
  }
  for (const p of s.players) {
    p.confirmed = p.ready = p.upgradedThisRound = p.exchangedThisRound = false;
    refreshPlan(s, p);
    if (s.roundRule.kind === 'respite') p.hp = Math.min(p.maxHp, p.hp + 6);
    s.roundStarts[p.id] = clone(p);
    const e = opponent(s, p); e.hp = e.maxHp;
    const g = prepareCharacterEncounter(context(s, p, e));
    adopt(p, g.players[0]); p.confirmed = false; p.ready = false;
    p.rerolls += p.upgrades.fortune + (s.roundRule.kind === 'surge' ? 1 : 0);
    addUpgrades(p); s.seed = g.seed; s.nextId = g.nextId;
    s.enemies[`trial-${p.id}`] = g.players[1];
  }
  syncBossHealth(s, 'player');
  log(s, `第 ${s.round} 轮 · ${s.roundRule.name}。${s.roundRule.description}`);
}

export function createPartyMatch(config: PartyConfig, seed: number | string = Date.now()): PartyState {
  if (!(['treasure', 'raid', 'duos', 'overlord'] as string[]).includes(config.mode)) throw new Error('未知多人模式');
  if (config.players.length < 4 || config.players.length > 8 || config.mode === 'duos' && config.players.length % 2) throw new Error('多人需要 4～8 人，双人搭档仅支持 4 / 6 / 8 人');
  if (new Set(config.players.map(p => p.id)).size !== config.players.length || config.players.some(p => !p.id)) throw new Error('玩家标识必须唯一且非空');
  const catalog = clone(config.catalog ?? defaultCatalog()); catalog.cards = [...catalog.cards.filter(c => c.id !== SENTINEL), sentinel];
  if (config.players.some(p => !catalog.cards.some(c => c.id === p.cardId && c.id !== SENTINEL))) throw new Error('所选角色不存在');
  const maxRounds = config.maxRounds ?? (config.mode === 'overlord' || config.mode === 'raid' ? 10 : config.mode === 'duos' ? PARTY_RULES.duos.rounds : PARTY_RULES.treasure.rounds);
  if (!Number.isInteger(maxRounds) || maxRounds < 2 || maxRounds > 20) throw new Error('轮数必须在 2～20 之间');
  const s: PartyState = { kind: 'party', version: 1, mode: config.mode, phase: 'planning', round: 1, maxRounds,
    seed: hash(seed), nextId: 1, catalog, players: [], targets: [], weatherId: null, roundRule: rules[0], crisis: 0, maxCrisis: config.mode === 'overlord' ? PARTY_RULES.overlord.crisisLimit : PARTY_RULES.raid.crisisLimit,
    bossPhase: 1, bossMoves: ['sweep', 'eruption'], bossMove: 'sweep', bossTelegraph: '', bossPlayerId: config.mode === 'overlord' ? config.players[0].id : null,
    bossHp: 0, bossMaxHp: 0, log: [], results: [], battleEvents: [], enemies: {}, roundStarts: {}, winnerTeamIds: [] };
  config.players.forEach((input, i) => { const boss = config.mode === 'overlord' && i === 0;
    s.players.push({ ...makePlayer(input, s), teamId: config.mode === 'treasure' ? `p${i + 1}` : config.mode === 'duos' ? `小队${Math.floor(i / 2) + 1}` : boss ? '首领' : '远征队', role: boss ? 'boss' : 'hero', score: 0, contribution: 0, supplies: 0, upgrades: { power: 0, ward: 0, fortune: 0 }, upgradedThisRound: false, exchangedThisRound: false, ready: false, plan: { targetId: 'core', stance: 'assault' } }); });
  const heroes = s.players.filter(p => p.role !== 'boss');
  s.bossMaxHp = s.bossHp = heroes.length * (config.mode === 'overlord' ? PARTY_RULES.overlord.hpPerHero : PARTY_RULES.raid.hpPerHero);
  if (config.mode === 'overlord') { const boss = s.players[0]; boss.maxHp = boss.hp = s.bossMaxHp; }
  beginRound(s); return s;
}

export function getPartyLegalActions(s: PartyState, playerId: string): PartyLegalActions {
  const p = s.players.find(p => p.id === playerId);
  const empty: PartyLegalActions = { canAct: false, canSelect: false, canReroll: false, canPrismatic: false, canConfirm: false, canPlan: false, canReady: false, canUpgrade: false, canExchange: false, minDice: 0, maxDice: 0, requiredDice: 0, targetIds: [], supportPlayerIds: [] };
  if (!p || s.phase === 'finished') return empty;
  const supportPlayerIds = s.players.filter(q => q.id !== p.id && q.teamId === p.teamId).map(q => q.id);
  if (s.phase === 'results') return { ...empty, canAct: !p.ready, canReady: !p.ready, canUpgrade: !p.ready && !p.upgradedThisRound && p.supplies > 0, supportPlayerIds };
  const legal = getLegalActions(context(s, p), p.id), canAct = !p.confirmed;
  const targetIds = s.targets.filter(t => !t.broken && (s.mode !== 'duos' || t.id.includes(p.teamId))).map(t => t.id);
  return { ...empty, ...legal, canAct, canSelect: canAct, canReroll: canAct && legal.canReroll, canPrismatic: canAct && legal.canPrismatic,
    canConfirm: canAct && legal.canConfirm, canPlan: canAct && p.role !== 'boss', canExchange: canAct && !p.exchangedThisRound && supportPlayerIds.some(id => { const q = s.players.find(q => q.id === id)!; return !q.confirmed && !q.exchangedThisRound; }), targetIds, supportPlayerIds };
}
function patternScore(s: PartyState, p: PartyPlayer) {
  const values = p.dice.filter(d => p.selectedIds.includes(d.id)).map(d => d.value);
  const counts = values.reduce<Record<number, number>>((out, n) => { out[n] = (out[n] ?? 0) + 1; return out; }, {});
  const unique = new Set(values).size === values.length && values.length > 0, sorted = [...new Set(values)].sort((a, b) => a - b);
  const consecutive = unique && sorted.length >= 2 && sorted.every((v, i) => !i || v === sorted[i - 1] + 1);
  const points = s.round % 2 ? Object.values(counts).reduce((sum, n) => sum + Math.floor(n / 2) * 7, 0) + (values.length && values.every(v => v % 2 === 0) ? 6 : 0) : (unique ? 6 : 0) + (consecutive ? 8 : 0);
  return points + (s.roundRule.kind === 'precision' && unique ? 6 : 0);
}
function uniqueSelection(p: PlayerState) { const values = p.dice.filter(d => p.selectedIds.includes(d.id)).map(d => d.value); return values.length > 0 && new Set(values).size === values.length; }
export function getPartyPreview(s: PartyState, playerId: string): PartyPreview {
  const p = s.players.find(p => p.id === playerId); if (!p) return { value: 0, diceRequired: 0, canConfirm: false, damageEstimate: 0, effects: [], role: 'attack', objectiveValue: 0, objectiveHint: '玩家不存在' };
  const g = context(s, p);
  if (s.phase === 'planning') {
    const actor = g.players[0];
    if (s.roundRule.kind === 'precision' && uniqueSelection(p)) actor.modifiers[role(s, p) === 'attack' ? 'attack' : 'defense'] += 6;
    if (s.mode === 'duos' && p.plan.stance === 'support') actor.modifiers.double *= 0.5;
    if (s.mode === 'duos' && p.plan.stance === 'guard') { actor.modifiers.defense += 5; if (role(s, p) === 'attack') actor.modifiers.attack -= 4; }
    if (p.role === 'boss') { actor.modifiers.double *= 0.7; actor.modifiers.attack += s.bossPhase * 2 + (s.bossMove === 'eruption' ? 10 : s.bossMove === 'drain' ? 5 : 0); }
  }
  const preview = getPlayerPreview(g, p.id); const puzzle = p.plan.targetId === 'puzzle';
  return { ...preview, role: role(s, p), objectiveValue: puzzle ? patternScore(s, p) + Math.floor(preview.value / 4) : preview.value,
    objectiveHint: p.plan.stance === 'support' ? '援护队友：牺牲本轮攻击，提供治疗与护盾；危机降低 1（全队每轮最多 2）。' : p.plan.stance === 'guard' && (s.mode === 'raid' || s.mode === 'overlord') ? '坚守本轮首领攻击，防御技能与反击照常触发；本轮不主动攻击目标。' : puzzle ? s.targets.find(t => t.id === 'puzzle')?.description ?? '' : s.targets.find(t => t.id === p.plan.targetId)?.description ?? '' };
}

function validDice(p: PartyPlayer, ids: string[]) { return Array.isArray(ids) && ids.length === new Set(ids).size && ids.every(id => p.dice.some(d => d.id === id)); }
function recover(s: PartyState, p: PartyPlayer) {
  if (p.hp > 0) return;
  if (p.role === 'boss') { s.bossHp = 0; syncBossHealth(s); finish(s, ['远征队'], `${p.name}生命耗尽，远征队胜利！`); return; }
  p.hp = Math.max(1, Math.ceil(p.maxHp * 0.4));
  if (s.mode === 'raid' || s.mode === 'overlord') s.crisis += 2;
  log(s, `${p.name}被击倒，恢复 ${p.hp} 生命继续参战${s.mode === 'raid' || s.mode === 'overlord' ? '，危机 + 2' : ''}。`, p.id);
}
function record(s: PartyState, p: PartyPlayer, value: number, damage: number, score: number, text: string) {
  p.score += score; p.contribution += Math.max(0, damage);
  s.results.push({ playerId: p.id, targetId: p.plan.targetId, value, damage, score, text }); log(s, text, p.id);
}
function resolveTrial(s: PartyState, p: PartyPlayer, t: PartyTarget, enemyId = `trial-${p.id}`, multiplier = 1) {
  const e = opponent(s, p, enemyId); e.hp = e.maxHp = 1000;
  const attackRole = role(s, p) === 'attack';
  e.dice = [{ id: `guard-${s.nextId++}`, sides: 30, value: t.difficulty + (s.roundRule.kind === 'surge' ? 3 : 0), prismatic: false, ownerId: e.id }]; e.selectedIds = [e.dice[0].id];
  const g = context(s, p, e); const before = p.hp;
  if (s.roundRule.kind === 'precision' && uniqueSelection(p)) g.players[0].modifiers[attackRole ? 'attack' : 'defense'] += 6;
  const deferredEnd = s.mode === 'raid' || s.mode === 'overlord';
  const resolved = resolveCharacterEncounter(g, deferredEnd ? { skipEnd: true, skipPreparationIds: e.statuses.partyPreparedRound === s.round ? [e.id] : [] } : {}); const result = resolved.players[0], foe = resolved.players[1];
  foe.statuses.partyPreparedRound = s.round;
  const skillDamage = resolved.log.filter(ev => ev.type === 'damage' && ev.targetId === e.id).reduce((sum, ev) => sum + (ev.amount ?? 0), 0);
  const value = resolved.lastResolution?.players.find(q => q.id === p.id)?.value ?? 0;
  adopt(p, result); s.enemies[enemyId] = foe; sync(s, resolved);
  return { damage: Math.max(0, Math.floor(skillDamage * multiplier)), value, taken: Math.max(0, before - p.hp) };
}
function finish(s: PartyState, teams: string[], reason: string) { s.phase = 'finished'; s.winnerTeamIds = teams; s.reason = reason; log(s, reason); }
function applySupport(s: PartyState) {
  let relief = 0;
  for (const p of s.players.filter(p => p.plan.stance === 'support' && p.role !== 'boss')) {
    const q = s.players.find(q => q.id === p.plan.supportPlayerId && q.teamId === p.teamId && q.id !== p.id); if (!q) continue;
    const amount = 4 + Math.floor(getPartyPreview(s, p.id).value / 3) + (s.roundRule.kind === 'respite' ? 4 : 0);
    q.hp = Math.min(q.maxHp, q.hp + amount); q.modifiers.defense += Math.ceil(amount / 2); q.modifiers.attack += 3;
    if (relief < 2) { s.crisis = Math.max(0, s.crisis - 1); relief++; }
    log(s, `${p.name}援护${q.name}：恢复 ${amount} 生命、护盾 + ${Math.ceil(amount / 2)}、攻击 + 3。`, p.id);
  }
}
function resolveTreasure(s: PartyState) {
  for (const t of s.targets) {
    const contenders = s.players.filter(p => p.plan.targetId === t.id);
    const results = contenders.map(p => { const r = resolveTrial(s, p, t); return { p, ...r, merit: t.kind === 'puzzle' ? patternScore(s, p) + Math.floor(r.damage / 4) : t.kind === 'bastion' ? Math.max(0, r.value - r.taken) + r.damage : r.damage }; });
    const best = Math.max(0, ...results.map(r => r.merit));
    for (const r of results) {
      const win = r.merit === best && best > 0; const score = 1 + (r.merit > 0 ? 1 : 0) + (win ? t.reward + (s.roundRule.kind === 'bounty' ? 2 : 0) : 0) + (contenders.length === 1 && r.merit > 0 ? 2 : 0);
      record(s, r.p, r.value, r.damage, score, `${r.p.name}进入${t.name}，贡献 ${r.merit}${win ? '，夺得星核' : ''}${contenders.length === 1 ? '，独占宝库' : ''}，积分 + ${score}。`);
      recover(s, r.p);
    }
  }
}
function resolveDuos(s: PartyState) {
  for (const pair of pairings(s)) {
    const group = s.players.filter(p => pair.includes(p.teamId));
    if (pair.length === 1) { for (const p of group) { const r = resolveTrial(s, p, s.targets.find(t => t.id.includes(p.teamId))!); const score = r.damage >= 8 ? PARTY_RULES.duos.winScore + (s.roundRule.kind === 'bounty' ? 2 : 0) : 2; record(s, p, r.value, r.damage, score, `${p.name}挑战遗迹机关，造成 ${r.damage} 伤害，积分 + ${score}。`); recover(s, p); } continue; }
    const attackingTeam = pair[(s.round - 1) % 2];
    const players = group.map(p => ({ ...clone(p), side: (p.teamId === pair[0] ? 0 : 1) as 0 | 1 }));
    for (const p of players) { const original = group.find(q => q.id === p.id)!; if (s.roundRule.kind === 'precision' && uniqueSelection(p)) p.modifiers[role(s, original) === 'attack' ? 'attack' : 'defense'] += 6; if (original.plan.stance === 'support') p.modifiers.double *= 0.5; else if (original.plan.stance === 'guard') { p.modifiers.defense += 5; if (role(s, original) === 'attack') p.modifiers.attack -= 4; } }
    const g = resolveCharacterEncounter(createCharacterEncounter(players, { catalog: s.catalog, seed: s.seed, nextId: s.nextId, turn: s.round, attackingSide: attackingTeam === pair[0] ? 0 : 1 })); sync(s, g);
    const damageByTeam = pair.map(team => g.log.filter(ev => ev.type === 'damage' && group.some(p => p.id === ev.targetId && p.teamId !== team)).reduce((sum, ev) => sum + (ev.amount ?? 0), 0));
    // Defenders win by cleanly holding their ground; counters are counted too.
    const attackIndex = pair.indexOf(attackingTeam), defenseIndex = 1 - attackIndex;
    damageByTeam[defenseIndex] += Math.max(0, 10 - damageByTeam[attackIndex]);
    const high = Math.max(...damageByTeam);
    for (const p of group) { const i = pair.indexOf(p.teamId); const win = damageByTeam[i] === high; const score = (win ? PARTY_RULES.duos.winScore + (s.roundRule.kind === 'bounty' ? 2 : 0) : PARTY_RULES.duos.loseScore) + Math.min(2, Math.floor(damageByTeam[i] / 20)); adopt(p, g.players.find(q => q.id === p.id)!); const value = g.lastResolution?.players.find(q => q.id === p.id)?.value ?? 0; record(s, p, value, damageByTeam[i], score, `${p.name}所在${p.teamId}本轮战绩 ${damageByTeam[i]}，${win ? '夺得胜场' : '获得补偿积分'} + ${score}。`); recover(s, p); }
  }
}
function resolveRaid(s: PartyState) {
  const heroes = s.players.filter(p => p.role === 'hero'); const boss = s.players.find(p => p.role === 'boss');
  const resolvedValues: Record<string, number> = {};
  let supportCount = 0;
  for (const id of ['shield', 'charge', 'core']) {
    const t = s.targets.find(t => t.id === id)!;
    for (const p of heroes.filter(p => p.plan.targetId === id)) {
      if (p.plan.stance !== 'assault') { if (p.plan.stance === 'support') supportCount++; continue; }
      const shielded = id !== 'shield' && !s.targets.find(t => t.id === 'shield')!.broken;
      const multiplier = (shielded ? 0.5 : 1) * (id === 'core' && s.roundRule.kind === 'bounty' ? 1.2 : 1);
      const r = resolveTrial(s, p, t, id, multiplier);
      resolvedValues[p.id] = r.value;
      // A destroyed device still grants a small spillover hit against the core.
      const overflow = Math.max(0, r.damage - t.hp); const applied = Math.min(t.hp, r.damage);
      t.hp = Math.max(0, t.hp - r.damage); t.broken = t.hp === 0;
      if (id === 'core') s.bossHp = t.hp; else if (overflow > 0) { const core = s.targets.find(t => t.id === 'core')!; core.hp = s.bossHp = Math.max(0, s.bossHp - Math.floor(overflow / 3)); }
      record(s, p, r.value, applied, Math.max(1, Math.floor(applied / 5)), `${p.name}攻击${t.name}，贡献 ${applied}${shielded ? '（护盾减伤）' : ''}${t.broken ? '，目标击破' : ''}。`); recover(s, p);
    }
    // Shared targets settle once after every contributor, so adding teammates
    // cannot multiply poison ticks. Shield poison can still break it in time.
    const e = clone(s.enemies[id]); e.hp = e.maxHp;
    const end = settleCharacterRound(context(s, heroes[0], e), [e.id]);
    const raw = Math.max(0, e.hp - end.players[1].hp);
    const damage = Math.floor(raw * (id !== 'shield' && !s.targets.find(q => q.id === 'shield')!.broken ? 0.5 : 1));
    s.enemies[id] = end.players[1]; sync(s, end);
    t.hp = Math.max(0, t.hp - damage); t.broken = t.hp === 0;
    if (id === 'core') s.bossHp = t.hp;
    if (damage) log(s, `${t.name}回合末受到 ${damage} 点持续伤害。`);
  }
  if (s.bossHp <= 0) { syncBossHealth(s); finish(s, ['远征队'], '首领已被击败，远征队胜利！'); return; }
  const chargeBroken = s.targets.find(t => t.id === 'charge')!.broken;
  const power = PARTY_RULES[s.mode === 'overlord' ? 'overlord' : 'raid'].wavePower + s.bossPhase * 2 + (s.roundRule.kind === 'surge' ? 3 : 0);
  const interrupted = s.bossMove === 'eruption' && chargeBroken;
  if (interrupted) { log(s, '蓄力装置被摧毁，首领爆发被全队打断！危机降低 1。'); s.crisis = Math.max(0, s.crisis - 1); }
  {
    const victims = interrupted ? [] : s.bossMove === 'drain' ? [heroes.reduce((a, b) => a.hp / a.maxHp <= b.hp / b.maxHp ? a : b)] : heroes;
    const attacker = clone(boss ?? opponent(s, heroes[0], 'raid-boss')); attacker.side = 1; attacker.hp = s.bossHp; attacker.maxHp = s.bossMaxHp;
    if (boss) { attacker.modifiers.double *= 0.7; attacker.modifiers.attack += s.bossPhase * 2 + (s.bossMove === 'eruption' ? 10 : s.bossMove === 'drain' ? 5 : 0); }
    else { attacker.dice = [{ id: `boss-wave-${s.nextId++}`, ownerId: attacker.id, sides: 30, value: power + (s.bossMove === 'eruption' ? 8 : s.bossMove === 'drain' ? 5 : 0), prismatic: false }]; attacker.selectedIds = [attacker.dice[0].id]; }
    // A committed assault leaves no selected dice for the boss's return attack.
    // Guard/support retains the player's chosen defensive dice. The same combat
    // engine applies forcefield, counter, poison, hack, lifesteal and all skills.
    const defenders = heroes.map(p => { const defender = clone(p); defender.side = 0; if (p.plan.stance === 'assault') { defender.selectedIds = []; defender.modifiers.double = 1; } else if (s.roundRule.kind === 'precision' && uniqueSelection(defender)) defender.modifiers.defense += 6; return defender; });
    const combat = resolveCharacterEncounter(createCharacterEncounter([attacker, ...defenders], { catalog: s.catalog, seed: s.seed, nextId: s.nextId, turn: s.round, attackingSide: 1 }),
      { skipEnd: true, skipPreparationIds: [...heroes.filter(p => p.plan.stance === 'assault').map(p => p.id), ...(interrupted ? [attacker.id] : [])], skipAttackIds: interrupted ? [attacker.id] : [], attackTargetIds: victims.map(p => p.id) });
    for (const entry of combat.lastResolution?.players ?? []) if (!(entry.id in resolvedValues)) resolvedValues[entry.id] = entry.value;
    sync(s, combat); s.bossHp = Math.max(0, Math.min(s.bossMaxHp, combat.players[0].hp));
    if (boss) { adopt(boss, combat.players[0]); record(s, boss, combat.lastResolution?.players[0]?.value ?? 0, combat.log.filter(e => e.playerId === boss.id && e.type === 'damage').reduce((sum, e) => sum + (e.amount ?? 0), 0), 0, `${boss.name}${interrupted ? '的爆发被打断' : `发动${moves[s.bossMove].split('：')[0]}，原角色技能参与首领进攻`}。`); }
    else s.enemies['raid-boss'] = combat.players[0];
    for (const p of heroes) { const before = p.hp, originalDice = p.selectedIds; adopt(p, combat.players.find(q => q.id === p.id)!); p.selectedIds = originalDice; if (victims.some(q => q.id === p.id)) log(s, `${p.name}承受首领${moves[s.bossMove].split('：')[0]}，生命 ${before} → ${p.hp}。`, p.id); recover(s, p); }
    if (s.bossMove === 'drain' && supportCount === 0) { const heal = heroes.length * 4; s.bossHp = Math.min(s.bossMaxHp, s.bossHp + heal); log(s, `无人援护阻断，首领汲取恢复 ${heal} 生命。`); }
    else if (s.bossMove === 'drain') log(s, '队友援护阻断了首领汲取治疗！');
    if (s.bossMove === 'eruption' && !interrupted) s.crisis += 2;
  }
  if (boss) boss.hp = s.bossHp; else s.enemies['raid-boss'].hp = s.bossHp;
  for (const p of s.players) {
    const end = settleCharacterRound(context(s, p), [p.id], resolvedValues); adopt(p, end.players[0]); sync(s, end);
    if (p.role === 'hero') recover(s, p); else s.bossHp = Math.max(0, Math.min(s.bossMaxHp, p.hp));
  }
  if (!boss) { const e = s.enemies['raid-boss']; const end = settleCharacterRound(context(s, heroes[0], e), [e.id]); s.enemies['raid-boss'] = end.players[1]; s.bossHp = Math.max(0, Math.min(s.bossMaxHp, end.players[1].hp)); sync(s, end); }
  s.crisis++; // Finite pressure makes support and interrupts matter even at high HP.
  for (const p of heroes.filter(p => p.plan.stance !== 'assault')) { const contribution = s.battleEvents.filter(e => e.playerId === p.id && e.targetId === (boss?.id ?? s.enemies['raid-boss']?.id) && e.type === 'damage').reduce((sum, e) => sum + (e.amount ?? 0), 0); record(s, p, resolvedValues[p.id] ?? 0, contribution, 2, `${p.name}${p.plan.stance === 'support' ? '完成援护' : '坚守阵地'}${contribution ? `，反击造成 ${contribution} 伤害` : ''}。`); }
  syncBossHealth(s);
  if (s.bossHp <= 0) { finish(s, ['远征队'], '首领被防守反击击败，远征队胜利！'); return; }
  if (s.crisis >= s.maxCrisis) finish(s, s.mode === 'overlord' ? ['首领'] : [], '危机达到上限，首领守住了裂界。');
}
function resolveRound(s: PartyState) {
  applySupport(s);
  if (s.mode === 'treasure') resolveTreasure(s); else if (s.mode === 'duos') resolveDuos(s); else resolveRaid(s);
  if (s.phase === 'finished') return;
  if (s.round >= s.maxRounds) {
    if (s.mode === 'raid' || s.mode === 'overlord') finish(s, s.mode === 'overlord' ? ['首领'] : [], '轮数耗尽，首领守住了裂界。');
    else { const scores = new Map<string, number>(); for (const p of s.players) scores.set(p.teamId, (scores.get(p.teamId) ?? 0) + p.score); const best = Math.max(...scores.values()); const winners = [...scores].filter(([, n]) => n === best).map(([id]) => id); finish(s, winners, `${winners.map(id => s.mode === 'treasure' ? s.players.find(p => p.teamId === id)!.name : id).join('、')}以 ${best} 分${winners.length > 1 ? '并列' : ''}获胜！`); }
  } else { s.phase = 'results'; for (const p of s.players) { p.ready = false; p.supplies++; p.hp = Math.min(p.maxHp, p.hp + 3); } syncBossHealth(s, 'player'); log(s, '获得 1 点补给：可选择成长，再准备下一轮。'); }
}

export function applyPartyCommand(state: PartyState, command: PartyCommand): PartyCommandResult {
  if (state.phase === 'finished') return { state, error: '对局已经结束' };
  const s = copyState(state), p = s.players.find(p => p.id === command.playerId);
  if (!p) return { state, error: '玩家不存在' };
  try {
    const legal = getPartyLegalActions(s, p.id);
    if (command.type === 'ready') { if (!legal.canReady) throw new Error('现在不能准备下一轮'); p.ready = true; if (s.players.every(p => p.ready)) { s.round++; beginRound(s); } return { state: s }; }
    if (command.type === 'upgrade') { if (!legal.canUpgrade || !['power', 'ward', 'fortune'].includes(command.upgrade)) throw new Error('当前不能购买成长'); if (p.upgrades[command.upgrade] >= 3) throw new Error('此成长已达到 3 级'); p.upgrades[command.upgrade]++; p.supplies--; p.upgradedThisRound = true; log(s, `${p.name}获得${{ power: '火力', ward: '防护', fortune: '重投' }[command.upgrade]}成长。`, p.id); return { state: s }; }
    if (!legal.canAct || s.phase !== 'planning') throw new Error('已确认计划，请等待其他玩家');
    if (command.type === 'plan') {
      if (!legal.canPlan || !legal.targetIds.includes(command.targetId) || !['assault', 'guard', 'support'].includes(command.stance)) throw new Error('目标或行动无效');
      if (command.stance === 'support' && !legal.supportPlayerIds.includes(command.supportPlayerId ?? '')) throw new Error('援护需要选择另一名队友');
      if (s.mode === 'treasure' && command.stance === 'support') throw new Error('夺宝模式没有固定队友');
      const oldRole = role(s, p), oldPlan = p.plan; p.plan = { targetId: command.targetId, stance: command.stance, supportPlayerId: command.supportPlayerId };
      if (s.mode === 'treasure') p.plan.stance = command.targetId === 'bastion' ? 'guard' : 'assault';
      if (role(s, p) !== oldRole) {
        if (p.rollsUsed || p.prismaticRolled || p.exchangedThisRound) { p.plan = oldPlan; throw new Error('已重投、换骰或使用曜彩骰，本轮不能切换攻守；仍可选择同类目标'); }
        // Reprepare from the same start-of-round snapshot, retaining the actual
        // dice and RNG. Switching back restores unconsumed pending role traits.
        const dice = p.dice, plan = p.plan;
        const initial = { ...p, ...clone(s.roundStarts[p.id]), hp: p.hp, maxHp: p.maxHp, plan };
        // Preserve non-preparation changes (for example a future planning-time
        // support effect), while pending role bonuses come from the snapshot.
        for (const key of ['poison', 'thorns', 'strength', 'toughness', 'interference', 'evolution', 'venom', 'lucky']) initial.statuses[key] = p.statuses[key] ?? 0;
        for (const key of ['nextStrength', 'nextToughness', 'danGuard', 'frostGuard']) initial.statuses[key] = Math.max(initial.statuses[key] ?? 0, p.statuses[key] ?? 0);
        const g = prepareCharacterEncounter(context(s, initial));
        adopt(p, g.players[0]); p.dice = dice; p.plan = plan; p.selectedIds = [];
        p.rerolls += p.upgrades.fortune + (s.roundRule.kind === 'surge' ? 1 : 0); addUpgrades(p);
      }
      return { state: s };
    }
    if (command.type === 'bossMove') { if (p.role !== 'boss' || !s.bossMoves.includes(command.move)) throw new Error('只能选择本轮预告的首领招式'); s.bossMove = command.move; return { state: s }; }
    if (command.type === 'exchange') {
      const q = s.players.find(q => q.id === command.targetPlayerId);
      if (!legal.canExchange || !q || q.confirmed || q.exchangedThisRound || q.teamId !== p.teamId || q.id === p.id) throw new Error('只能与未确认的队友换骰，双方每轮一次');
      const i = p.dice.findIndex(d => d.id === command.ownDieId), j = q.dice.findIndex(d => d.id === command.targetDieId);
      if (i < 0 || j < 0 || p.dice[i].forced || q.dice[j].forced) throw new Error('骰子已变更或命定骰不能交换');
      const own = p.dice[i], incoming = q.dice[j]; p.dice[i] = incoming; q.dice[j] = own;
      const ownSlot = own.poolIndex ?? i; incoming.poolIndex = ownSlot; own.poolIndex = j;
      incoming.ownerId = p.id; own.ownerId = q.id;
      p.selectedIds = p.selectedIds.map(id => id === own.id ? incoming.id : id); q.selectedIds = q.selectedIds.map(id => id === incoming.id ? own.id : id);
      p.exchangedThisRound = q.exchangedThisRound = true; log(s, `${p.name}与${q.name}交换了一颗骰子。`, p.id); return { state: s };
    }
    if (command.type === 'confirm') {
      if (command.diceIds !== undefined) { if (!validDice(p, command.diceIds)) throw new Error('选择了无效骰子'); p.selectedIds = [...command.diceIds]; }
      if (!getPartyLegalActions(s, p.id).canConfirm) throw new Error('请按角色要求选择骰子，并保留所有命定骰');
      if (p.plan.stance === 'support' && !legal.supportPlayerIds.includes(p.plan.supportPlayerId ?? '')) throw new Error('请选择援护队友');
      p.confirmed = p.rollLocked = true; log(s, `${p.name}已提交计划。`, p.id);
      if (s.players.every(p => p.confirmed)) resolveRound(s);
      return { state: s };
    }
    if (!['select', 'reroll', 'prismatic'].includes(command.type)) throw new Error('未知多人指令');
    const result = applyCommand(context(s, p), command); if (result.error) throw new Error(result.error);
    adopt(p, result.state.players[0]); sync(s, result.state); recover(s, p); syncBossHealth(s, 'player');
    return { state: s };
  } catch (error) { return { state, error: error instanceof Error ? error.message : String(error) }; }
}

export function choosePartyAiCommand(s: PartyState, playerId: string): PartyCommand | null {
  const p = s.players.find(p => p.id === playerId); if (!p) return null;
  const legal = getPartyLegalActions(s, p.id); if (!legal.canAct) return null;
  if (s.phase === 'results') {
    if (legal.canUpgrade) { const choices = (p.hp < p.maxHp * 0.6 ? ['ward', 'power', 'fortune'] : ['power', 'ward', 'fortune']) as ('power' | 'ward' | 'fortune')[]; const upgrade = choices.find(k => p.upgrades[k] < 3); if (upgrade) return { type: 'upgrade', playerId, upgrade }; }
    return { type: 'ready', playerId };
  }
  // A deterministic seat/round assignment makes AI cooperate without reading any
  // private intent or consuming authority RNG merely by requesting a suggestion.
  if (!p.rollsUsed && !p.prismaticRolled && !p.selectedIds.length && p.role !== 'boss') {
    const index = s.players.filter(p => p.role === 'hero').indexOf(p);
    let targetId = p.plan.targetId, stance = p.plan.stance, supportPlayerId: string | undefined;
    if (s.mode === 'treasure') { targetId = ['fire', 'bastion', 'puzzle'][hash(`${p.id}:${s.round}:${s.roundRule.kind}`) % 3]; stance = targetId === 'bastion' ? 'guard' : 'assault'; }
    if (s.mode === 'raid' || s.mode === 'overlord') {
      targetId = index % 4 === 0 ? 'shield' : index % 4 === 1 && s.bossMoves.includes('eruption') ? 'charge' : 'core'; stance = 'assault';
      const injured = s.players.filter(q => q.id !== p.id && q.teamId === p.teamId).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      if (index % 4 === 3 && injured && (injured.hp < injured.maxHp * 0.6 || s.crisis >= 5)) { stance = 'support'; supportPlayerId = injured.id; }
    }
    if (p.plan.targetId !== targetId || p.plan.stance !== stance || p.plan.supportPlayerId !== supportPlayerId) return { type: 'plan', playerId, targetId, stance, supportPlayerId };
  }
  const cmd = chooseAiCommand(context(s, p), p.id);
  return cmd && ['select', 'reroll', 'prismatic', 'confirm'].includes(cmd.type) ? cmd as PartyCommand : null;
}
