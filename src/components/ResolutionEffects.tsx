import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowUp, Crown, Droplets, Heart, Shield, Sparkles, Swords, Zap } from 'lucide-react';
import type { BattleResolution, GameEvent, GameState, ResolutionStrike } from '../game/types';
import { cardById } from '../data';
import { eventFeedbackLabel } from '../lib/useBattlePresentation';
import CardView from './CardView';
import './ResolutionEffects.css';

type PresentationPhase = 'idle' | 'settle' | 'transform' | 'compare' | 'strike' | 'impact' | 'defeat';
interface Props {
  state: GameState;
  phase: PresentationPhase;
  resolution?: BattleResolution;
  activeEffect?: GameEvent;
  activeEvent?: GameEvent;
  activeStrike?: ResolutionStrike;
  playerId: string;
  reducedMotion: boolean;
}
interface Point { x: number; y: number }
interface Anchors { players: Record<string, Point>; dice: Record<string, Point>; width: number; height: number }

/** Coordinates come from the displayed board, including mobile and co-op layouts. */
export default function ResolutionEffects({ state, phase, resolution, activeEffect, activeEvent, activeStrike, playerId, reducedMotion }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const [anchors, setAnchors] = useState<Anchors>({ players: {}, dice: {}, width: 1, height: 1 });
  useLayoutEffect(() => {
    const element = mount.current, board = element?.parentElement;
    if (!element || !board || phase === 'idle') return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const point = (el: Element): Point => {
        const r = el.getBoundingClientRect();
        return { x: (r.left + r.width / 2 - bounds.left) / bounds.width * 100, y: (r.top + r.height / 2 - bounds.top) / bounds.height * 100 };
      };
      setAnchors({
        width: bounds.width, height: bounds.height,
        players: Object.fromEntries(Array.from(board.querySelectorAll<HTMLElement>('[data-battle-player]')).map(el => [el.dataset.battlePlayer!, point(el)])),
        dice: Object.fromEntries(Array.from(board.querySelectorAll<HTMLElement>('[data-die-id]')).map(el => [el.dataset.dieId!, point(el)])),
      });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(board);
    // Confirmed dice finish their short move towards the character before a skill fires.
    const timer = window.setTimeout(measure, 280);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, [phase, activeEffect?.id, activeEvent?.id, resolution?.turn]);

  const ownSide = state.players.find(p => p.id === playerId)?.side ?? 0;
  const location = (id?: string): Point => anchors.players[id || ''] || { x: 50, y: state.players.find(p => p.id === id)?.side === ownSide ? 86 : 14 };
  const showValues = !!resolution && ['compare', 'strike', 'impact'].includes(phase);
  const skill = phase === 'transform' && activeEffect?.effectKind ? activeEffect : undefined;
  const hit = (phase === 'strike' || phase === 'impact') ? activeStrike : undefined;
  const status = phase === 'impact' && activeEvent && !hit ? activeEvent : undefined;
  const statusTarget = status ? location(status.targetId || status.playerId) : undefined;
  const statusKind = status?.damageKind?.startsWith('poison') ? 'poison' : status?.damageKind === 'thorns' ? 'thorns' : status?.type === 'heal' || status?.type === 'revive' ? 'heal' : status?.type === 'boss-phase' ? 'phase-shift' : 'instant';
  const StatusIcon = statusKind === 'poison' ? Droplets : statusKind === 'heal' ? Heart : statusKind === 'thorns' ? Sparkles : Zap;
  const name = (id: string) => { const p = state.players.find(p => p.id === id); return cardById[p?.cardId || '']?.name || p?.name || ''; };
  const panels = (friendly: boolean) => {
    const players = resolution!.players.filter(p => (p.side === ownSide) === friendly);
    const role = players[0]?.role || 'defense';
    return <div className={`resolution-team ${role} ${friendly ? 'friendly' : 'opponent'}`}>
      <div className="resolution-role">{role === 'attack' ? <Swords/> : <Shield/>}<span>{role === 'attack' ? '最终攻击值' : '最终防御值'}</span></div>
      <div className="resolution-values">{players.map(p => {
        const advantage = p.value > Math.max(0, ...resolution!.players.filter(q => q.side !== p.side).map(q => q.value));
        return <div className={`resolution-player ${advantage ? 'advantage' : ''}`} key={p.id}>
          <div className="resolution-number"><strong>{p.value}</strong>{advantage && <Crown aria-label="数值占优"/>}</div><span>{name(p.id)}</span>
          <small>{p.effects.filter(e => ['连击', '洞穿', '力场', '反击', '不屈'].includes(e)).join(' · ') || (p.side === ownSide ? '我方' : '对方')}</small>
        </div>;
      })}</div>
    </div>;
  };

  return <div ref={mount} className={`resolution-effects ${reducedMotion ? 'reduced' : ''} phase-${phase}`} aria-live="polite">
    {showValues && <div className="resolution-comparison" key={`values-${resolution.turn}`}>
      {panels(false)}<div className="resolution-versus"><span>VS</span><small>{resolution.weatherName || '伤害结算'}</small></div>{panels(true)}
    </div>}
    {skill && <div className={`dice-skill ${skill.effectKind}`} key={`skill-${skill.id}`}>
      <svg className="skill-connection" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
        {skill.diceChanges?.map(change => {
          const source = location(skill.playerId), target = anchors.dice[change.dieId] || location(skill.targetId || skill.playerId);
          return <path key={change.dieId} d={`M ${source.x * 10} ${source.y * 6} Q ${target.x * 10 + 70} ${(source.y + target.y) * 3} ${target.x * 10} ${target.y * 6}`}/>;
        })}
      </svg>
      {skill.diceChanges?.map(change => {
        const target = anchors.dice[change.dieId] || location(skill.targetId || skill.playerId);
        return <div className="skill-die-target" key={change.dieId} style={{ left: `${target.x}%`, top: `${target.y}%` }}>
          <i className="skill-ring outer"/><i className="skill-ring inner"/>
          {Array.from({ length: 8 }, (_, i) => <i className="skill-particle" key={i} style={{ '--i': i } as CSSProperties}/>)}
          {skill.effectKind === 'hack' ? <div className="hack-reticle"><i/><i/><i/><i/><span>0101<br/>1010</span></div> : <div className="arise-column"><ArrowUp/><ArrowUp/><ArrowUp/></div>}
          <div className="skill-die-change"><span>{change.before}</span><b>→</b><strong>{change.after}</strong></div>
        </div>;
      })}
      <div className="skill-caption"><small>{name(skill.playerId || '')} · 技能发动</small><strong>{skill.effectKind === 'hack' ? '骇 入' : '跃 升'}</strong><span>{skill.effectKind === 'hack' ? '改写对手骰面' : '提升己方骰面'}</span></div>
    </div>}
    {hit && <div className="attack-card-layer" key={`cards-${activeEvent?.id}`} aria-hidden="true">
      {[hit].filter(hit => hit.kind === 'attack').map(hit => {
        const from = location(hit.attackerId), to = location(hit.defenderId), p = resolution?.players.find(p => p.id === hit.attackerId), card = cardById[p?.cardId || ''];
        return card && <div className="striking-card" key={hit.attackerId} style={{ left: `${from.x}%`, top: `${from.y}%`, '--pose-y': p?.side === ownSide ? '-82%' : '-18%', '--travel-x': `${(to.x - from.x) * anchors.width / 100}px`, '--travel-y': `${(to.y - from.y) * anchors.height / 100}px`, '--card-delay': '0ms' } as CSSProperties}><CardView card={card} compact gild={state.players.find(p => p.id === hit.attackerId)?.gild || 0}/></div>;
      })}
      {resolution?.players.filter(p => p.role === 'defense' && p.id === hit.defenderId).map(p => { const at = location(p.id); return <div key={p.id} className="defense-barrier" style={{ left: `${at.x}%`, top: `${at.y}%` }}><Shield/><i/></div>; })}
    </div>}
    {hit && <svg className={`attack-effects ${phase}`} viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true" key={`attack-${activeEvent?.id}`}>
      <defs><linearGradient id="attack-trail"><stop stopColor="#87eaff" stopOpacity="0"/><stop offset=".55" stopColor="#edfbff"/><stop offset="1" stopColor="#fff3ab"/></linearGradient></defs>
      {[hit].map(hit => {
        const from = location(hit.attackerId), to = location(hit.defenderId), x = to.x * 10, y = to.y * 6;
        return <g key={`${hit.attackerId}-${hit.defenderId}-${activeEvent?.id}`} className={`attack-stroke ${hit.amount === 0 ? 'blocked' : ''}`} style={{ '--hit-delay': '0ms' } as CSSProperties}>
          <path className="attack-trail-glow" d={`M ${from.x * 10} ${from.y * 6} L ${x} ${y}`}/>
          <path className="attack-trail-core" d={`M ${from.x * 10} ${from.y * 6} L ${x} ${y}`}/>
          <g className="attack-contact" style={{ transformOrigin: `${x}px ${y}px` }}>
            <ellipse cx={x} cy={y} rx="45" ry="31"/>
            {hit.amount === 0 ? <path className="guard-symbol" d={`M ${x} ${y - 29} l 24 10 v 19 q -3 19 -24 29 q -21 -10 -24 -29 v -19 Z`}/> : <>
              <path className="impact-slash" d={`M ${x - 50} ${y + 36} L ${x + 49} ${y - 39} M ${x - 34} ${y - 33} L ${x + 33} ${y + 30}`}/>
              {Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return <line key={i} x1={x + Math.cos(a) * 34} y1={y + Math.sin(a) * 23} x2={x + Math.cos(a) * 75} y2={y + Math.sin(a) * 49}/>; })}
            </>}
          </g>
        </g>;
      })}
    </svg>}
    {activeEvent && (phase === 'strike' || phase === 'impact') && <div className={`resolution-hit-caption ${hit ? 'physical' : statusKind}`} key={`caption-${activeEvent.id}`}>
      <strong>{eventFeedbackLabel(activeEvent)}</strong>
      {!!hit?.strikeCount && hit.strikeCount > 1 && <span>第 {hit.strikeIndex || 1} / {hit.strikeCount} 击{hit.comboSource ? ` · ${hit.comboSource}` : ''}</span>}
      {activeEvent.poisonBefore !== undefined && activeEvent.poisonAfter !== undefined && <span>中毒 {activeEvent.poisonBefore} → {activeEvent.poisonAfter} 层{activeEvent.damageKind === 'poison-trigger' ? ' · 不消耗层数' : ''}</span>}
      {activeEvent.thornsBefore !== undefined && activeEvent.thornsAfter !== undefined && <span>荆棘 {activeEvent.thornsBefore} → {activeEvent.thornsAfter} 层</span>}
      {phase === 'impact' && activeEvent.hpBefore !== undefined && activeEvent.hpAfter !== undefined && <small>生命 {activeEvent.hpBefore} → {activeEvent.hpAfter}</small>}
    </div>}
    {status && statusTarget && <div className={`status-contact ${statusKind}`} key={`status-${status.id}`} style={{ left: `${statusTarget.x}%`, top: `${statusTarget.y}%` }} aria-hidden="true">
      <i className="status-ring"/><StatusIcon/>
      {Array.from({ length: 6 }, (_, index) => <i className="status-mote" key={index} style={{ '--i': index } as CSSProperties}/>)}
    </div>}
  </div>;
}

