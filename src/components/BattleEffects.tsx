import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameEvent, GameState, PlayerState } from '../game/types';
import { cardById } from '../data';
import { eventFeedbackLabel } from '../lib/useBattlePresentation';
import { asset, cleanText } from './CardView';
import VfxParticles from './VfxParticles';
import './BattleEffects.css';

interface Props { state: GameState; playerId: string; reducedMotion?: boolean; suppressCues?: boolean }
interface FloatEffect { id: number; targetId: string; kind: 'damage' | 'heal'; cause?: GameEvent['damageKind']; amount: number; label: string; x: number; y: number; lane: number; delay: number; expires: number }
interface Cue { id: number; kind: GameEvent['type']; text: string; cardId?: string; phase?: number }

/** Visual feedback only: each mounted board starts after its existing event history. */
export default function BattleEffects({ state, playerId, reducedMotion = false, suppressCues = false }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set(state.log.map(e => e.id)));
  const opening = useRef({ eligible: state.turn === 1 && state.phase !== 'finished' && state.log.every(e => e.type === 'turn'), players: state.players, played: false });
  const [intro, setIntro] = useState(false);
  const [floats, setFloats] = useState<FloatEffect[]>([]);
  const [cues, setCues] = useState<Cue[]>([]);
  const cue = cues[0];

  useEffect(() => {
    // Co-op opens its tactics dialog first; let the opening appear when it closes.
    if (opening.current.eligible && !opening.current.played && state.turn === 1 && state.phase === 'roll') {
      opening.current.played = true;
      setIntro(true);
    }
  }, [state.turn, state.phase]);
  useEffect(() => {
    if (!intro) return;
    const timer = window.setTimeout(() => setIntro(false), reducedMotion ? 1100 : 1900);
    return () => window.clearTimeout(timer);
  }, [intro, reducedMotion]);

  useEffect(() => {
    const next = state.log.filter(e => !seen.current.has(e.id));
    if (!next.length) return;
    next.forEach(event => seen.current.add(event.id));
    // A reroll can land before its self-cost recovery is displayed. Track actual
    // event IDs rather than a maximum, so its later-revealed recovery is not lost.
    if (seen.current.size > 480) seen.current = new Set([...seen.current].sort((a, b) => b - a).slice(0, 320));
    const board = layer.current?.getBoundingClientRect();
    const huds = Array.from(layer.current?.parentElement?.querySelectorAll<HTMLElement>('[data-battle-player]') || []);
    const localSide = state.players.find(p => p.id === playerId)?.side ?? 0;
    const friends = state.players.filter(p => p.side === localSide);
    const lanes = new Map<string, number>();
    const incoming: FloatEffect[] = [];
    for (const e of next) {
      if ((e.type !== 'damage' && e.type !== 'heal') || !e.amount) continue;
      const target = e.type === 'damage' ? e.targetId : e.playerId;
      const p = state.players.find(p => p.id === target);
      if (!p) continue;
      const hud = huds.find(h => h.dataset.battlePlayer === target)?.getBoundingClientRect();
      const lane = lanes.get(p.id) || 0; lanes.set(p.id, lane + 1);
      const delay = Math.min(lane, 4) * 95;
      const fallbackX = p.side !== localSide || friends.length === 1 ? 50 : friends.findIndex(f => f.id === p.id) === 0 ? 25 : 75;
      incoming.push({
        id: e.id, targetId: p.id, kind: e.type, cause: e.damageKind, amount: e.amount, label: eventFeedbackLabel(e), lane, delay,
        x: hud && board?.width ? Math.max(10, Math.min(90, (hud.left + hud.width * .68 - board.left) / board.width * 100)) : fallbackX,
        y: hud && board?.height ? Math.max(12, Math.min(90, (hud.top + hud.height * .4 - board.top) / board.height * 100)) : p.side === localSide ? 85 : 15,
        expires: Date.now() + (reducedMotion ? 650 : 950) + delay,
      });
    }
    if (incoming.length) setFloats(current => [...current.filter(existing => !incoming.some(next => next.targetId === existing.targetId)), ...incoming].slice(-14));
    // ResolutionEffects shows these in order. Do not replay them as a late cue backlog.
    const notices = (suppressCues ? [] : next).filter(e => !e.effectKind && ['effect', 'tactic', 'revive', 'weather', 'boss-phase'].includes(e.type)).map(e => ({
      id: e.id, kind: e.type, text: cleanText(e.text),
      phase: e.type === 'boss-phase' ? e.amount : undefined,
      cardId: e.type === 'boss-phase' ? state.bossPhases[(e.amount || state.bossPhase + 1) - 1]?.cardId : undefined,
    }));
    if (notices.length) setCues(current => [...current, ...notices].slice(-8));
  }, [state.log, state.players, state.bossPhase, state.bossPhases, playerId, reducedMotion, suppressCues]);

  useEffect(() => {
    if (!floats.length) return;
    const timer = window.setTimeout(() => setFloats(current => current.filter(f => f.expires > Date.now())), Math.max(1, Math.min(...floats.map(f => f.expires)) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [floats]);
  useEffect(() => {
    if (!cue || intro || suppressCues) return;
    const timer = window.setTimeout(() => setCues(current => current.filter(c => c.id !== cue.id)), cue.kind === 'boss-phase' ? 2100 : 1350);
    return () => window.clearTimeout(timer);
  }, [cue?.id, cue?.kind, intro, suppressCues]);

  const openingSide = opening.current.players.find(p => p.id === playerId)?.side ?? 0;
  const team = (players: PlayerState[], opponent: boolean) => <div className={`battle-intro-team ${opponent ? 'enemy' : 'friendly'} ${players.length > 1 ? 'duo' : ''}`}>
    {players.map(p => { const card = cardById[p.cardId]; return <div className="battle-intro-fighter" key={p.id}>
      {card?.image && <img src={asset(card.image)} alt="" draggable={false}/>}
      <div className="battle-intro-name"><small>{opponent ? state.mode === 'coop' ? '共斗首领' : '对手' : players.length > 1 ? '共斗搭档' : '出战角色'}</small><strong>{card?.name || p.name}</strong></div>
    </div>; })}
  </div>;
  const stageCard = cue?.cardId ? cardById[cue.cardId] : undefined;
  return <div ref={layer} className={`battle-effects ${reducedMotion ? 'reduced' : ''}`} aria-hidden="true">
    {floats.map(f => {
      const tier = f.amount >= 15 ? 'tier-massive' : f.amount >= 8 ? 'tier-heavy' : 'tier-normal';
      const particlePreset = f.kind === 'heal'
        ? 'heal-aurora'
        : f.cause?.startsWith('poison')
          ? 'poison-emerald'
          : f.cause === 'thorns'
            ? 'thorns-rose'
            : f.amount >= 10
              ? 'heavy-crimson'
              : 'slash-gold';
      return <div key={f.id} className={`battle-float ${f.kind} cause-${f.cause || 'generic'} ${tier}`} style={{ left: `${f.x}%`, top: `${f.y}%`, '--float-offset': `${((f.lane % 3) - 1) * 30}px`, '--float-delay': `${f.delay}ms` } as CSSProperties}>
        {!reducedMotion && (f.amount >= 6 || f.kind === 'heal') && (
          <VfxParticles preset={particlePreset} count={f.amount >= 15 ? 10 : 6} spread={f.amount >= 15 ? 58 : 42} x={50} y={40} reducedMotion={reducedMotion} />
        )}
        <span>{f.kind === 'heal' ? '+' : '−'}{f.amount}</span><small>{f.label}</small>
      </div>;
    })}
    {cue && !intro && !suppressCues && <div key={cue.id} className={`battle-event-cue cue-${cue.kind} ${cue.kind === 'boss-phase' ? 'stage' : ''}`}>
      {stageCard?.image && <img className="battle-stage-art" src={asset(stageCard.image)} alt=""/>}
      <div><small>{cue.kind === 'boss-phase' ? 'BOSS PHASE SHIFT' : cue.kind === 'revive' ? '重返战场' : cue.kind === 'tactic' ? '战术生效' : cue.kind === 'weather' ? '天气变化' : '技能发动'}</small><strong>{cue.kind === 'boss-phase' ? `第 ${cue.phase || state.bossPhase + 1} 阶段` : cue.text}</strong>{cue.kind === 'boss-phase' && <span>{stageCard?.name || cue.text}</span>}</div>
    </div>}
    {intro && <div className="battle-intro">
      <div className="battle-intro-caption">{state.mode === 'coop' ? '又上骰了，战力党！' : '上骰了，战力党！'}</div>
      <div className="battle-intro-lineup">{team(opening.current.players.filter(p => p.side === openingSide), false)}<div className="battle-intro-versus"><span>VS</span><small>对局开始</small></div>{team(opening.current.players.filter(p => p.side !== openingSide), true)}</div>
      <div className="battle-intro-rule">COSMICON COLLECTIVE</div>
    </div>}
  </div>;
}
