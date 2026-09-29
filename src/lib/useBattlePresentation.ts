import { useLayoutEffect, useRef, useState } from 'react';
import { getPlayerPreview } from '../game';
import type { BattleResolution, GameEvent, GameState, PlayerPreview, PlayerState, ResolutionStrike } from '../game/types';

export interface DefeatedPlayer { player: PlayerState; kind: 'defeat' | 'revive' | 'boss-phase' }
export interface BattlePresentation {
  state: GameState | undefined;
  busy: boolean;
  phase: 'idle' | 'settle' | 'transform' | 'compare' | 'strike' | 'impact' | 'defeat';
  frozenPreviews?: Record<string, PlayerPreview>;
  resolution?: BattleResolution;
  activeEffect?: GameEvent;
  /** Only this event may change displayed HP or produce a hit at this instant. */
  activeEvent?: GameEvent;
  activeStrike?: ResolutionStrike;
  defeats?: DefeatedPlayer[];
}
export interface PresentationOptions { active: boolean; matchKey: string; reducedMotion: boolean }
export const BATTLE_PRESENTATION_TIMING = { settle: 200, transform: 720, compare: 650, strike: 460, impact: 420, status: 560, recovery: 400, defeat: 1700, reducedCompare: 350, reducedImpact: 260, reducedDefeat: 450 } as const;

export function eventFeedbackLabel(event: GameEvent): string {
  if (event.sourceLabel) return event.sourceLabel;
  if (event.type === 'heal') return '治愈';
  if (event.type === 'revive') return '共享生命 · 复起';
  if (event.type === 'boss-phase') return '首领阶段切换';
  const labels = { attack: '攻击', counter: '反击', reflect: '反伤', 'poison-trigger': '海瑟音引爆', 'poison-tick': '回合末中毒', thorns: '荆棘', overload: '防御超载', instant: '瞬伤', 'self-cost': '生命消耗' };
  return event.damageKind ? labels[event.damageKind] : event.text.includes('瞬间') ? '瞬伤' : '伤害';
}

/** A defeat is an actual zero-health transition, not merely losing or surrendering. */
export function collectDefeatedPlayers(previous: GameState, resolved: GameState): DefeatedPlayer[] {
  const incoming = resolved.log.filter(event => event.id >= previous.nextId);
  return previous.players.flatMap(player => {
    const next = resolved.players.find(candidate => candidate.id === player.id);
    if (!next || player.hp <= 0) return [];
    const phaseChange = incoming.some(event => event.type === 'boss-phase' && event.playerId === player.id);
    const revive = incoming.some(event => event.type === 'revive' && event.playerId === player.id);
    const kind = next.hp <= 0 ? 'defeat' : phaseChange ? 'boss-phase' : revive ? 'revive' : undefined;
    return kind ? [{ player: { ...player, hp: 0 }, kind } as DefeatedPlayer] : [];
  });
}

function continuesMatch(previous: GameState, next: GameState): boolean {
  return previous.mode === next.mode && previous.players.map(p => p.id).join('|') === next.players.map(p => p.id).join('|')
    && next.turn >= previous.turn && next.nextId >= previous.nextId
    && !(previous.phase === 'finished' && next.phase !== 'finished')
    && !(next.turn === 1 && previous.turn === 1 && next.nextId === previous.nextId && next.seed !== previous.seed);
}

/** Legacy callers can still request a single end-of-impact board. Playback uses individual events. */
export function makeImpactSnapshot(previous: GameState, resolved: GameState): GameState {
  const incoming = resolved.log.filter(event => event.id >= previous.nextId && event.type !== 'turn' && event.type !== 'weather');
  const defeated = new Set(collectDefeatedPlayers(previous, resolved).map(entry => entry.player.id));
  return { ...previous, players: previous.players.map(player => {
    const next = resolved.players.find(candidate => candidate.id === player.id);
    return next ? { ...player, hp: defeated.has(player.id) || next.cardId !== player.cardId ? 0 : next.hp } : player;
  }), sharedLives: resolved.sharedLives, log: [...previous.log, ...incoming].slice(-160) };
}

const previewsOf = (state: GameState) => Object.fromEntries(state.players.map(player => [player.id, getPlayerPreview(state, player.id)]));
function applyDisplayedTransform(state: GameState, event: GameEvent, reverse = false): GameState {
  return { ...state, players: state.players.map(player => player.id !== event.targetId ? player : {
    ...player, dice: player.dice.map(die => {
      const change = event.diceChanges?.find(change => change.dieId === die.id);
      return change ? { ...die, value: reverse ? change.before : change.after } : die;
    }),
  }) };
}
export function makeResolutionSnapshot(previous: GameState, resolution: BattleResolution): GameState {
  return { ...previous, players: previous.players.map(player => {
    const final = resolution.players.find(candidate => candidate.id === player.id);
    return final ? { ...player, dice: final.dice.map(die => ({ ...die })), selectedIds: final.dice.map(die => die.id) } : player;
  }) };
}
export function resolutionPreviews(resolution: BattleResolution): Record<string, PlayerPreview> {
  return Object.fromEntries(resolution.players.map(player => [player.id, {
    value: player.value, effects: [...player.effects], diceRequired: player.dice.length, canConfirm: false,
    damageEstimate: resolution.strikes.filter(strike => strike.attackerId === player.id && strike.kind === 'attack').reduce((sum, strike) => sum + strike.amount, 0),
  }]));
}

function eventTarget(event: GameEvent): string | undefined {
  return event.type === 'damage' ? event.targetId : event.type === 'heal' || event.type === 'revive' || event.type === 'boss-phase' ? event.playerId : event.targetId || event.playerId;
}

/** Copy just the fields changed by this event; a later poison tick cannot leak into this hit. */
export function applyPresentationEvent(board: GameState, event: GameEvent, resolved: GameState): GameState {
  const targetId = eventTarget(event);
  const recovery = event.type === 'revive' || event.type === 'boss-phase';
  return { ...board,
    sharedLives: event.sharedLivesAfter ?? board.sharedLives,
    bossPhase: event.bossPhaseAfter ?? board.bossPhase,
    nextId: Math.max(board.nextId, event.id + 1),
    log: board.log.some(existing => existing.id === event.id) ? board.log : [...board.log, event].slice(-160),
    players: board.players.map(player => {
      if (player.id !== targetId) return player;
      const final = resolved.players.find(candidate => candidate.id === player.id);
      const nextCardId = event.targetCardId || final?.cardId || player.cardId;
      const replacement = event.type === 'boss-phase' && final ? { ...player, cardId: nextCardId, maxHp: event.maxHpAfter ?? event.hpAfter ?? final.maxHp, statuses: event.statusesAfter ? { ...event.statusesAfter } : { strength: 0, toughness: 0, poison: 0, thorns: 0, overload: 0, interference: 0, evolution: 0, venom: 0 } } : player;
      const hp = event.hpAfter ?? (event.type === 'damage' ? Math.max(0, player.hp - (event.amount || 0)) : event.type === 'heal' ? Math.min(player.maxHp, player.hp + (event.amount || 0)) : recovery ? final?.hp || 1 : player.hp);
      return { ...replacement, hp, statuses: { ...replacement.statuses,
        ...(event.poisonAfter !== undefined ? { poison: event.poisonAfter } : {}),
        ...(event.thornsAfter !== undefined ? { thorns: event.thornsAfter } : {}),
        ...(event.venomAfter !== undefined ? { venom: event.venomAfter } : {}),
        ...(event.overloadAfter !== undefined ? { overload: event.overloadAfter } : {}),
      } };
    }),
  };
}

export interface PresentationStep { frame: BattlePresentation; duration: number }
function strikeFor(event: GameEvent, resolution?: BattleResolution): ResolutionStrike | undefined {
  if (event.type !== 'damage') return undefined;
  const strike = resolution?.strikes.find(hit => hit.eventId === event.id);
  const kind = event.damageKind || strike?.kind;
  if (kind !== 'attack' && kind !== 'counter' && kind !== 'reflect') return undefined;
  return strike || { ...event, attackerId: event.playerId || '', defenderId: event.targetId || '', attack: 0, defense: 0, amount: event.amount || 0, kind, eventId: event.id };
}

/** Build one ordered visual record per engine event, including HP=0 before each revival. */
export function buildPresentationSteps(previous: GameState, resolved: GameState, reducedMotion = false): PresentationStep[] {
  const turnEnded = resolved.turn > previous.turn || resolved.phase === 'finished' && previous.phase !== 'finished';
  const resolution = turnEnded && resolved.lastResolution?.turn === previous.turn ? resolved.lastResolution : undefined;
  const incoming = Array.from(new Map([...(resolution?.events || []), ...resolved.log].filter(event => event.id >= previous.nextId).map(event => [event.id, event])).values()).sort((a, b) => a.id - b.id);
  const hasHealthEvents = incoming.some(event => ['damage', 'heal', 'revive', 'boss-phase'].includes(event.type) || event.hpAfter !== undefined);
  if (!hasHealthEvents && !resolution) return [];
  const effects = incoming.filter(event => event.effectKind && event.diceChanges?.length);
  // Self-costs can occur during reroll. Land the already authoritative new dice once,
  // while HP still follows the individual damage/revival events below.
  const operationEvents = resolution ? [] : incoming.filter(event => ['roll', 'reroll', 'swap'].includes(event.type));
  const operationBoard = operationEvents.length ? { ...previous, players: previous.players.map(player => {
    const next = resolved.players.find(candidate => candidate.id === player.id);
    return next ? { ...player, dice: next.dice, selectedIds: next.selectedIds, rerolls: next.rerolls, rollsUsed: next.rollsUsed, prismaticRolled: next.prismaticRolled, prismaticUses: next.prismaticUses } : player;
  }), log: [...previous.log, ...operationEvents].slice(-160) } : previous;
  const finalBoard = resolution ? makeResolutionSnapshot(previous, resolution) : operationBoard;
  const frozenPreviews = resolution ? resolutionPreviews(resolution) : undefined;
  const steps: PresentationStep[] = [];
  const add = (state: GameState, phase: BattlePresentation['phase'], duration: number, extra: Partial<BattlePresentation> = {}) => steps.push({ frame: { state, busy: true, phase, resolution, frozenPreviews, ...extra }, duration });
  if (resolution) {
    if (!reducedMotion) {
      let transformed = finalBoard;
      for (const effect of effects.slice().reverse()) transformed = applyDisplayedTransform(transformed, effect, true);
      add(transformed, 'settle', BATTLE_PRESENTATION_TIMING.settle, { frozenPreviews: previewsOf(transformed) });
      for (const effect of effects) {
        transformed = applyDisplayedTransform(transformed, effect);
        add(transformed, 'transform', BATTLE_PRESENTATION_TIMING.transform, { activeEffect: effect, frozenPreviews: previewsOf(transformed) });
      }
    }
    add(finalBoard, 'compare', reducedMotion ? BATTLE_PRESENTATION_TIMING.reducedCompare : BATTLE_PRESENTATION_TIMING.compare);
  }
  let board = finalBoard;
  for (let index = 0; index < incoming.length; index++) {
    const event = incoming[index];
    // The next table (weather, rolled pool, result) appears only after the last impact.
    if (['turn', 'weather', 'roll', 'victory'].includes(event.type)) continue;
    const targetId = eventTarget(event);
    const before = board.players.find(player => player.id === targetId);
    const strike = strikeFor(event, resolution);
    if (strike && !reducedMotion) add(board, 'strike', BATTLE_PRESENTATION_TIMING.strike, { activeEvent: event, activeStrike: strike });
    board = applyPresentationEvent(board, event, resolved);
    if (!['damage', 'heal', 'revive', 'boss-phase'].includes(event.type) && event.hpAfter === undefined) continue;
    const recovery = event.type === 'revive' || event.type === 'boss-phase';
    const duration = reducedMotion ? BATTLE_PRESENTATION_TIMING.reducedImpact : recovery ? BATTLE_PRESENTATION_TIMING.recovery : strike ? BATTLE_PRESENTATION_TIMING.impact : BATTLE_PRESENTATION_TIMING.status;
    add(board, 'impact', duration, { activeEvent: event, activeStrike: strike });
    const after = board.players.find(player => player.id === targetId);
    if (event.type !== 'damage' || !before || !after || before.hp <= 0 || after.hp > 0) continue;
    const nextHealth = incoming.slice(index + 1).find(candidate => ['damage', 'heal', 'revive', 'boss-phase'].includes(candidate.type) && eventTarget(candidate) === targetId);
    const kind = nextHealth?.type === 'revive' || nextHealth?.type === 'boss-phase' ? nextHealth.type : 'defeat';
    const defeats: DefeatedPlayer[] = [{ player: { ...after }, kind }];
    // Consumption happens at KO even though restored HP is held until the recovery event.
    if (nextHealth?.sharedLivesAfter !== undefined) board = { ...board, sharedLives: nextHealth.sharedLivesAfter };
    else if (board.mode === 'coop' && after.side === 0) board = { ...board, sharedLives: Math.max(0, board.sharedLives - 1) };
    add(board, 'defeat', reducedMotion ? BATTLE_PRESENTATION_TIMING.reducedDefeat : BATTLE_PRESENTATION_TIMING.defeat, { activeEvent: event, defeats });
  }
  return steps;
}

/** A small independently testable clock. It never modifies the authoritative game. */
export class BattlePresentationController {
  private latest: GameState | undefined;
  private frame: BattlePresentation;
  private matchKey: string | undefined;
  private active = false;
  private reducedMotion = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private steps: PresentationStep[] = [];
  private pending: Array<{ previous: GameState; resolved: GameState }> = [];

  constructor(initial: GameState | undefined, private publish: (frame: BattlePresentation) => void) {
    this.latest = initial;
    this.frame = { state: initial, busy: false, phase: 'idle' };
  }
  getSnapshot() { return this.frame; }
  private show(frame: BattlePresentation) { this.frame = frame; this.publish(frame); }
  private stopTimer() { if (this.timer !== undefined) clearTimeout(this.timer); this.timer = undefined; }
  dispose() {
    this.stopTimer(); this.steps = []; this.pending = [];
    this.frame = { state: this.latest, busy: false, phase: 'idle' }; this.active = false;
  }
  private advance = () => {
    this.stopTimer();
    const step = this.steps.shift();
    if (step) { this.show(step.frame); this.timer = setTimeout(this.advance, step.duration); return; }
    const next = this.pending.shift();
    if (next) { this.steps = buildPresentationSteps(next.previous, next.resolved, this.reducedMotion); this.advance(); return; }
    this.show({ state: this.latest, busy: false, phase: 'idle' });
  };
  private reduceRemainingMotion() {
    this.stopTimer();
    const phasesToSkip = ['settle', 'transform', 'strike'];
    const duration = (phase: BattlePresentation['phase']) => phase === 'compare' ? BATTLE_PRESENTATION_TIMING.reducedCompare : phase === 'defeat' ? BATTLE_PRESENTATION_TIMING.reducedDefeat : BATTLE_PRESENTATION_TIMING.reducedImpact;
    this.steps = this.steps.filter(step => !phasesToSkip.includes(step.frame.phase)).map(step => ({ ...step, duration: duration(step.frame.phase) }));
    if (phasesToSkip.includes(this.frame.phase)) this.advance();
    else this.timer = setTimeout(this.advance, duration(this.frame.phase));
  }
  update(game: GameState | undefined, options: PresentationOptions) {
    const previous = this.latest;
    const reset = !options.active || !this.active || options.matchKey !== this.matchKey || !previous || !game || !continuesMatch(previous, game);
    const switchedToReduced = options.reducedMotion && !this.reducedMotion;
    this.latest = game; this.active = options.active; this.matchKey = options.matchKey; this.reducedMotion = options.reducedMotion;
    if (reset) {
      this.stopTimer(); this.steps = []; this.pending = [];
      this.show({ state: game, busy: false, phase: 'idle' }); return;
    }
    const nextSteps = buildPresentationSteps(previous, game, options.reducedMotion);
    if (this.frame.busy) {
      if (nextSteps.length) this.pending.push({ previous, resolved: game });
      if (switchedToReduced) this.reduceRemainingMotion();
      return;
    }
    if (!nextSteps.length) { this.show({ state: game, busy: false, phase: 'idle' }); return; }
    this.steps = nextSteps; this.advance();
  }
}

export function useBattlePresentation(game: GameState | undefined, options: PresentationOptions): BattlePresentation {
  const [frame, setFrame] = useState<BattlePresentation>(() => ({ state: game, busy: false, phase: 'idle' }));
  const controller = useRef<BattlePresentationController | null>(null);
  const committedKey = useRef(options.matchKey);
  if (!controller.current) controller.current = new BattlePresentationController(game, setFrame);
  useLayoutEffect(() => { committedKey.current = options.matchKey; controller.current!.update(game, options); }, [game, options.active, options.matchKey, options.reducedMotion]);
  useLayoutEffect(() => () => controller.current!.dispose(), []);
  // A remounted BattleEffects must initialize its event cursor from the restored
  // snapshot, not one render of the previous room's presentation frame.
  return committedKey.current === options.matchKey ? frame : { state: game, busy: false, phase: 'idle' };
}

