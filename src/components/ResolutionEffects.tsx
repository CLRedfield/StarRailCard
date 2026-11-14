import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowUp, Crown, Droplets, Heart, Shield, Sparkles, Swords, Zap } from 'lucide-react';
import type { BattleResolution, GameEvent, GameState, ResolutionStrike } from '../game/types';
import { cardById } from '../data';
import { eventFeedbackLabel } from '../lib/useBattlePresentation';
import CardView from './CardView';
import VfxParticles, { type VfxPreset } from './VfxParticles';
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

function crescentArc(x: number, y: number, len: number, angleDeg: number, bend: number): string {
  const rad = (angleDeg * Math.PI) / 180;
  const nx = -Math.sin(rad);
  const ny = Math.cos(rad);
  const x1 = x - Math.cos(rad) * len;
  const y1 = y - Math.sin(rad) * len;
  const x2 = x + Math.cos(rad) * len;
  const y2 = y + Math.sin(rad) * len;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${(x + nx * bend).toFixed(1)} ${(y + ny * bend).toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

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
  const statusPreset: VfxPreset = statusKind === 'poison'
    ? 'poison-emerald'
    : statusKind === 'thorns'
      ? 'thorns-rose'
      : statusKind === 'heal'
        ? 'heal-aurora'
        : statusKind === 'phase-shift'
          ? 'heavy-crimson'
          : 'instant-quantum';
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

  const hitBlocked = !!hit && hit.amount === 0;
  const hitHeavy = !!hit && hit.amount >= 10;
  const hitCounter = !!hit && (hit.kind === 'counter' || hit.kind === 'reflect');
  const hitPreset: VfxPreset = hitBlocked
    ? 'shield-cyan'
    : hitCounter
      ? 'counter-violet'
      : hitHeavy
        ? 'heavy-crimson'
        : 'slash-gold';
  const hitTargetPoint = hit ? location(hit.defenderId) : undefined;
  const hitSourcePoint = hit ? location(hit.attackerId) : undefined;
  const hitAngleOffset = hitTargetPoint && hitSourcePoint
    ? Math.atan2(hitTargetPoint.y - hitSourcePoint.y, hitTargetPoint.x - hitSourcePoint.x)
    : 0;

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
      {[hit].filter(h => h.kind === 'attack' || h.kind === 'counter' || h.kind === 'reflect').map(h => {
        const from = location(h.attackerId), to = location(h.defenderId), p = state.players.find(pl => pl.id === h.attackerId), card = cardById[p?.cardId || ''];
        const cls = `striking-card ${h.kind !== 'attack' ? 'is-counter' : ''} ${h.amount >= 10 ? 'is-heavy' : ''}`;
        return card && <div className={cls} key={h.attackerId} style={{ left: `${from.x}%`, top: `${from.y}%`, '--pose-y': p?.side === ownSide ? '-82%' : '-18%', '--travel-x': `${(to.x - from.x) * anchors.width / 100}px`, '--travel-y': `${(to.y - from.y) * anchors.height / 100}px`, '--card-delay': '0ms' } as CSSProperties}><CardView card={card} compact gild={p?.gild || 0}/></div>;
      })}
      {resolution?.players.filter(p => p.role === 'defense' && p.id === hit.defenderId).map(p => { const at = location(p.id); return <div key={p.id} className={`defense-barrier ${hitBlocked ? 'blocked' : ''}`} style={{ left: `${at.x}%`, top: `${at.y}%` }}><Shield/><i/></div>; })}
    </div>}
    {hit && <svg className={`attack-effects ${phase} ${hitCounter ? 'is-counter' : ''} ${hitHeavy ? 'is-heavy' : ''}`} viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true" key={`attack-${activeEvent?.id}`}>
      <defs>
        <linearGradient id="attack-trail"><stop stopColor="#87eaff" stopOpacity="0"/><stop offset=".52" stopColor="#edfbff"/><stop offset="1" stopColor="#fff3ab"/></linearGradient>
        <linearGradient id="attack-trail-heavy"><stop stopColor="#ff738f" stopOpacity="0"/><stop offset=".48" stopColor="#ffe085"/><stop offset="1" stopColor="#ffffff"/></linearGradient>
        <linearGradient id="attack-trail-counter"><stop stopColor="#9c7dff" stopOpacity="0"/><stop offset=".52" stopColor="#d9c6ff"/><stop offset="1" stopColor="#94f3ff"/></linearGradient>
      </defs>
      {[hit].map(h => {
        const from = location(h.attackerId), to = location(h.defenderId);
        const fx = from.x * 10, fy = from.y * 6, x = to.x * 10, y = to.y * 6;
        const dx = x - fx, dy = y - fy, dist = Math.hypot(dx, dy) || 1;
        const sign = ((h.strikeIndex ?? 1) % 2 === 1 ? 1 : -1) * (h.kind === 'attack' ? 1 : -1);
        const bend = Math.min(130, Math.max(46, dist * 0.24)) * sign;
        const nx = -dy / dist, ny = dx / dist;
        const cx = (fx + x) / 2 + nx * bend, cy = (fy + y) / 2 + ny * bend;
        const arcPath = `M ${fx.toFixed(1)} ${fy.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
        const twinPath = `M ${fx.toFixed(1)} ${fy.toFixed(1)} Q ${(cx - nx * bend * 1.45).toFixed(1)} ${(cy - ny * bend * 1.45).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
        const rayCount = hitHeavy ? 16 : hitBlocked ? 10 : 12;
        return <g key={`${h.attackerId}-${h.defenderId}-${activeEvent?.id}`} className={`attack-stroke ${hitBlocked ? 'blocked' : ''} ${hitHeavy ? 'heavy' : ''} ${hitCounter ? 'counter' : ''}`} style={{ '--hit-delay': '0ms' } as CSSProperties}>
          <path className="attack-trail-glow" d={arcPath}/>
          <path className="attack-trail-ribbon" d={twinPath}/>
          <path className="attack-trail-core" d={arcPath}/>
          <g className="attack-contact" style={{ transformOrigin: `${x}px ${y}px` }}>
            <ellipse cx={x} cy={y} rx={hitHeavy ? 62 : 48} ry={hitHeavy ? 41 : 33}/>
            <circle className="impact-shockwave" cx={x} cy={y} r={hitHeavy ? 36 : 28}/>
            {hitBlocked ? <>
              <path className="guard-symbol" d={`M ${x} ${y - 31} l 26 11 v 20 q -3 20 -26 30 q -23 -10 -26 -30 v -20 Z`}/>
              {Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4 + 0.2; return <line key={i} x1={x + Math.cos(a) * 32} y1={y + Math.sin(a) * 24} x2={x + Math.cos(a) * 68} y2={y + Math.sin(a) * 50}/>; })}
            </> : <>
              <path className="impact-slash-glow" d={crescentArc(x, y, hitHeavy ? 88 : 66, -34 * sign, 24 * sign)}/>
              <path className="impact-slash" d={crescentArc(x, y, hitHeavy ? 86 : 64, -34 * sign, 22 * sign)}/>
              <path className="impact-slash secondary-slash" d={crescentArc(x, y, hitHeavy ? 66 : 48, 38 * sign, -18 * sign)}/>
              {hitHeavy && <path className="impact-slash heavy-slash" d={crescentArc(x, y, 76, 8 * sign, 28 * -sign)}/>}
              {Array.from({ length: rayCount }, (_, i) => {
                const a = (i * Math.PI * 2) / rayCount + (sign > 0 ? 0.15 : -0.15);
                const inner = i % 2 === 0 ? 28 : 38;
                const outer = hitHeavy ? (i % 2 === 0 ? 112 : 84) : (i % 2 === 0 ? 84 : 62);
                return <line key={i} x1={x + Math.cos(a) * inner} y1={y + Math.sin(a) * (inner * 0.72)} x2={x + Math.cos(a) * outer} y2={y + Math.sin(a) * (outer * 0.72)}/>;
              })}
            </>}
          </g>
        </g>;
      })}
    </svg>}
    {hit && phase === 'impact' && hitTargetPoint && !reducedMotion && (
      <VfxParticles
        key={`hit-particles-${activeEvent?.id}`}
        preset={hitPreset}
        count={hitHeavy ? 20 : hitCounter ? 16 : hitBlocked ? 12 : 14}
        spread={hitHeavy ? 112 : hitBlocked ? 72 : 88}
        angleOffset={hitAngleOffset}
        x={hitTargetPoint.x}
        y={hitTargetPoint.y}
        reducedMotion={reducedMotion}
      />
    )}
    {activeEvent && (phase === 'strike' || phase === 'impact') && <div className={`resolution-hit-caption ${hit ? (hitCounter ? 'counter' : hitHeavy ? 'heavy physical' : 'physical') : statusKind}`} key={`caption-${activeEvent.id}`}>
      <strong>{eventFeedbackLabel(activeEvent)}</strong>
      {!!hit?.strikeCount && hit.strikeCount > 1 && <span>第 {hit.strikeIndex || 1} / {hit.strikeCount} 击{hit.comboSource ? ` · ${hit.comboSource}` : ''}</span>}
      {activeEvent.poisonBefore !== undefined && activeEvent.poisonAfter !== undefined && <span>中毒 {activeEvent.poisonBefore} → {activeEvent.poisonAfter} 层{activeEvent.damageKind === 'poison-trigger' ? ' · 不消耗层数' : ''}</span>}
      {activeEvent.thornsBefore !== undefined && activeEvent.thornsAfter !== undefined && <span>荆棘 {activeEvent.thornsBefore} → {activeEvent.thornsAfter} 层</span>}
      {phase === 'impact' && activeEvent.hpBefore !== undefined && activeEvent.hpAfter !== undefined && <small>生命 {activeEvent.hpBefore} → {activeEvent.hpAfter}</small>}
    </div>}
    {status && statusTarget && <div className={`status-contact ${statusKind}`} key={`status-${status.id}`} style={{ left: `${statusTarget.x}%`, top: `${statusTarget.y}%` }} aria-hidden="true">
      <i className="status-ring"/><i className="status-ring outer"/><StatusIcon/>
      {statusKind === 'instant' && <><i className="status-cross a"/><i className="status-cross b"/></>}
      {Array.from({ length: 6 }, (_, index) => <i className="status-mote" key={index} style={{ '--i': index } as CSSProperties}/>)}
      <VfxParticles preset={statusPreset} count={statusKind === 'phase-shift' ? 18 : 12} spread={statusKind === 'phase-shift' ? 96 : 68} x={50} y={50} reducedMotion={reducedMotion}/>
    </div>}
  </div>;
}
