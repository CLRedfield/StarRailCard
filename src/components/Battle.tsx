import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, CloudLightning, Gem, Heart, List, RotateCcw, Shield, Sparkles, Swords, X, WifiOff, HelpCircle } from 'lucide-react';
import type { BattleResolution, GameCommand, GameEvent, GameState, PlayerState, PlayerPreview, ResolutionStrike } from '../game/types';
import { getLegalActions, getPlayerPreview } from '../game';
import { cardById, diceById, tactics, weather } from '../data';
import type { Profile } from '../lib/storage';
import type { BattlePresentation, DefeatedPlayer } from '../lib/useBattlePresentation';
import DiceTray, { type PendingDiceRoll } from './DiceTray';
import { reconcileDiceSelection, selectLocalDice, withLocalDiceSelection, type DiceSelectionDraft } from '../lib/diceSelection';
import { asset, cleanText } from './CardView';
import Modal from './Modal';
import BattleEffects from './BattleEffects';
import ResolutionEffects from './ResolutionEffects';
import DefeatEffects from './DefeatEffects';
import BattleTutorial from './BattleTutorial';
import type { TutorialProgress } from '../lib/tutorial';
import './BattleLayout.css';
import './PortraitBattle.css';

const statusNames: Record<string, string> = { strength: '力量', toughness: '坚韧', poison: '中毒', thorns: '荆棘', overload: '过载', interference: '干扰', evolution: '进化', venom: '猛毒' };
export default function Battle({ state: authoritativeState, playerId, send, onExit, profile, paused, busy, resolving, previews, resolution, activeEffect, activeEvent, activeStrike, pendingRoll, selectionKey = '', defeats = [], presentationPhase = 'idle', pauseReason, isOnline, tutorial, onTutorialChange }: { state: GameState; playerId: string; send: (c: GameCommand) => void; onExit: () => void; profile: Profile; paused?: boolean; busy?: boolean; resolving?: boolean; previews?: Record<string, PlayerPreview>; resolution?: BattleResolution; activeEffect?: GameEvent; activeEvent?: GameEvent; activeStrike?: ResolutionStrike; pendingRoll?: PendingDiceRoll; selectionKey?: string; defeats?: DefeatedPlayer[]; presentationPhase?: BattlePresentation['phase']; pauseReason?: string | null; isOnline?: boolean; tutorial?: TutorialProgress; onTutorialChange?: (progress: TutorialProgress) => void }) {
  const draft = useRef<DiceSelectionDraft | undefined>(undefined);
  const [, redrawSelection] = useState(0);
  draft.current = reconcileDiceSelection(draft.current, authoritativeState, playerId, selectionKey);
  const state = withLocalDiceSelection(authoritativeState, playerId, draft.current.ids);
  const player = state.players.find(p => p.id === playerId) || state.players[0];
  const enemy = state.players.find(p => p.side !== player.side)!;
  const partner = state.players.find(p => p.side === player.side && p.id !== player.id);
  const [showLog, setShowLog] = useState(false), [showHelp, setShowHelp] = useState(false), [confirmExit, setConfirmExit] = useState(false);
  const [swapOwn, setSwapOwn] = useState<string | null>(null);
  const [inspect, setInspect] = useState<PlayerState | null>(null);
  const [inspectTactic, setInspectTactic] = useState<number | null>(null);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [diceRolling, setDiceRolling] = useState(false);
  const table = useRef<HTMLElement>(null);
  const playerPreview = (id: string) => previews?.[id] || getPlayerPreview(state, id);
  const legal = getLegalActions(state, player.id), preview = playerPreview(player.id);
  const inspectedTactic = inspectTactic === null ? undefined : tactics.find(t => t.id === player.tactics[inspectTactic]);
  const currentWeather = weather.find(w => w.id === state.weatherId);
  const attack = state.attackingSide === player.side;
  const disabled = paused || busy || diceRolling || state.phase === 'finished';
  const sendAction = (c: GameCommand) => { if (!disabled) send(c); };
  const selectIds = (ids: string[]) => {
    if (disabled || !legal.canSelect) return;
    draft.current = selectLocalDice(draft.current!, ids, authoritativeState, playerId);
    redrawSelection(n => n + 1);
  };
  useEffect(() => setSwapOwn(null), [state.turn, state.phase]);
  const select = (id: string) => {
    if (state.phase === 'swap') { setSwapOwn(id); return; }
    const ids = draft.current!.ids;
    selectIds(ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };
  const hud = (p: PlayerState, opponent = false) => {
    const card = cardById[p.cardId], pp = playerPreview(p.id);
    const defeated = presentationPhase === 'defeat' && defeats.some(entry => entry.player.id === p.id) || state.phase === 'finished' && p.hp <= 0;
    const dealingHit = presentationPhase === 'strike' && activeStrike?.attackerId === p.id;
    const takingHit = presentationPhase === 'impact' && activeEvent?.type === 'damage' && activeEvent.targetId === p.id && (activeEvent.amount || 0) > 0;
    return <div key={`${p.id}:${takingHit ? activeEvent?.id : 'rest'}`} data-battle-player={p.id} className={`player-hud ${dealingHit ? 'dealing-hit' : ''} ${takingHit ? 'taking-hit' : ''} ${opponent ? 'opponent' : ''} ${defeated ? 'defeated-player' : ''} ${state.activePlayerId === p.id ? 'current' : ''}`}>
      <button data-battle-card={p.id} className="hud-portrait" onClick={() => setInspect(p)} title="查看角色技能"><img src={asset(card?.image)} alt={card?.name}/><span>{p.gild ? '✦'.repeat(p.gild) : '★'}</span></button>
      <div className="hud-info"><div className="hud-name"><strong>{card?.name || p.name}</strong><small>{p.name} {p.isAI ? '· AI' : ''}</small>{p.confirmed && <Check size={15}/>}</div><div className="hp-track"><div style={{ width: `${Math.max(0, p.hp / p.maxHp * 100)}%` }}/><span><Heart size={12} fill="currentColor"/>{p.hp}<small> / {p.maxHp}</small></span></div><div className="hud-levels"><span><Swords size={12}/>{p.attackLevel || '∞'}</span><span><Shield size={12}/>{p.defenseLevel}</span>{Object.entries(p.statuses).filter(([k, n]) => n > 0 && statusNames[k]).map(([k, n]) => <span className="status-badge" key={k} title={k}>{statusNames[k]} {n}</span>)}</div></div><div className="hud-power">{p.side === state.attackingSide ? <Swords size={16}/> : <Shield size={16}/>}<b>{pp.value}</b></div>
    </div>;
  };
  const tray = (p: PlayerState, own = false, compact = false) => {
    const roll = [...state.log].reverse().find(e => e.playerId === p.id && (e.type === 'roll' || e.type === 'reroll'));
    const actions = getLegalActions(state, p.id);
    const committed = p.rollLocked || p.confirmed || resolving && !!resolution;
    const visible = committed ? p.dice.filter(d => p.selectedIds.includes(d.id)) : actions.canSelect ? p.dice : [];
    return <div className={`player-dice-position ${committed ? 'committed' : ''}`}><DiceTray dice={visible} selected={own && swapOwn ? [swapOwn] : p.selectedIds} onSelect={own ? select : undefined} selectionSurface={own ? table : undefined} onSelectionChange={own && legal.canSelect && !showLog && !showHelp && !confirmExit && !inspect && !inspectedTactic ? selectIds : undefined} draggableDice={own && legal.canSwap} disabled={!own || disabled || !(legal.canSelect || legal.canSwap)} compact={compact || committed} animateNewDice={!committed} pendingRoll={own && pendingRoll && (!roll || roll.id <= pendingRoll.afterEventId) ? pendingRoll : undefined} rollEventKey={roll?.id} rollingIds={roll?.dice?.map(d => d.id)} onRollingChange={own ? setDiceRolling : undefined} reducedMotion={profile.settings.reducedMotion} lowQuality={profile.settings.quality === 'low'}/></div>;
  };
  return <section ref={table} className={`battle-page ${state.mode} ${attack ? 'attacking' : 'defending'} ${resolving ? 'resolving' : ''} ${resolving && resolution ? 'round-resolution' : ''} presentation-${presentationPhase} phase-${state.phase} ${player.tactics.length ? 'has-tactics' : ''}`}>
    <div className="battle-topbar"><button className="back-button" disabled={resolving} onClick={() => state.phase === 'finished' ? onExit() : setConfirmExit(true)}><ArrowLeft size={18}/>返回</button><span>{state.mode === 'coop' ? '又上骰了！战力党！ / 双人共斗' : '银河战力党 / 经典对决'}</span><div><button className="icon-button" title="对局规则" onClick={() => setShowHelp(true)}><HelpCircle size={19}/></button><button className="icon-button" title="对局记录" onClick={() => setShowLog(true)}><List size={19}/></button></div></div>
    {tutorial && onTutorialChange && !isOnline && <BattleTutorial state={state} playerId={playerId} progress={tutorial} onProgressChange={onTutorialChange} resolving={resolving}/>}
    <div className="arena-layout">
      <aside className="round-rail"><span className="rail-label">COSMICON</span><div className="round-medallion"><span>∞</span><small>回合</small><b>{state.turn}</b></div>{state.mode === 'coop' && <span className="boss-phase">阶段 {state.bossPhase + 1}/{Math.max(state.bossPhases.length, 1)}</span>}<div className="vertical-line"/><span className="rail-label">ROLL ON!</span></aside>
      <div className="arena-frame"><div className="arena-inner">
        <div className="enemy-zone">{hud(enemy, true)}{tray(enemy, false, state.mode === 'coop')}</div>
        <div className="phase-line"><span className="line"/><div className="phase-announcement" key={`${state.turn}-${state.activePlayerId}-${state.phase}`}><span>ROUND {String(state.turn).padStart(2, '0')}</span><b>{resolving ? '伤害结算' : state.phase === 'swap' ? '交换骰子' : state.phase === 'tactics' ? '战术准备' : state.phase === 'finished' ? '对局结束' : state.activePlayerId === playerId ? (attack ? '我方进攻' : '我方防御') : '等待对方行动'}</b></div><span className="line"/></div>
        {state.mode === 'coop' && state.phase === 'swap' && <div className="swap-zone"><div className="swap-label"><span>共享交换区</span><small>{swapOwn ? '点击交换区中的骰子完成交换' : '先选中自己的骰子，或拖动骰子至此'}</small></div><DiceTray dice={state.swapPool} compact pool animateNewDice={false} selected={[]} disabled={!swapOwn || disabled || !legal.canSwap} onSelect={poolDieId => { if (swapOwn) { sendAction({ type: 'swap', playerId, ownDieId: swapOwn, poolDieId }); setSwapOwn(null); } }} onDropDie={(ownDieId, poolDieId) => sendAction({ type: 'swap', playerId, ownDieId, poolDieId })} reducedMotion={profile.settings.reducedMotion} lowQuality={profile.settings.quality === 'low'}/></div>}
        <div className={`friendly-zone ${partner ? 'duo' : ''}`}><div className="friendly-half"><div className="power-display">{attack ? <Swords/> : <Shield/>}<strong>{preview.value}</strong><span>{preview.effects.slice(0, 3).join(' · ') || (attack ? '攻击值' : '防御值')}</span></div>{tray(player, true)}{hud(player)}</div>{partner && <div className="friendly-half partner"><div className="power-display">{attack ? <Swords/> : <Shield/>}<strong>{playerPreview(partner.id).value}</strong><span>队友 · {partner.confirmed ? '已确认' : partner.isAI ? '思考中' : '准备中'}</span></div>{tray(partner)}{hud(partner)}</div>}</div>
        {state.mode === 'coop' && <div className="shared-lives"><Heart size={20} fill="currentColor"/><b>{state.sharedLives} / 3</b><span>共斗生命</span></div>}
        <ResolutionEffects state={state} playerId={playerId} phase={presentationPhase} resolution={resolution} activeEffect={activeEffect} activeEvent={activeEvent} activeStrike={activeStrike} reducedMotion={profile.settings.reducedMotion}/>
        <BattleEffects state={state} playerId={playerId} reducedMotion={profile.settings.reducedMotion} suppressCues={resolving}/>
        {presentationPhase === 'defeat' && <DefeatEffects state={state} playerId={playerId} defeats={defeats} reducedMotion={profile.settings.reducedMotion}/>}
      </div></div>
      <aside className="action-rail">
        <button className={`weather-button ${weatherOpen ? 'active' : ''}`} onClick={() => setWeatherOpen(!weatherOpen)}>{currentWeather ? <img src={asset(`assets/weather/${currentWeather.id}.png`)} alt="" width={30} height={30}/> : <CloudLightning size={25}/>}<span>{currentWeather?.name || '晴空'}</span><ChevronDown size={12}/></button>
        {weatherOpen && <div className="weather-popover"><strong>{currentWeather?.name || '天气'}</strong><p>{currentWeather ? cleanText(currentWeather.description) : '当前没有生效的天气。'}</p></div>}
        <div className="rail-spacer"/>
        {state.mode === 'coop' && <div className="tactic-wallet">◈ <b>{player.tacticPoints}</b><small>战术点</small></div>}
        <button className="prismatic-action" disabled={disabled || !legal.canPrismatic} onClick={() => sendAction({ type: 'prismatic', playerId })}><span className="round-action-icon prism">{diceById[player.prismaticId || '']?.image ? <img src={asset(diceById[player.prismaticId!].image)} alt=""/> : <Gem size={28}/>}</span><strong>{diceById[player.prismaticId || '']?.name || '曜彩骰'}</strong><small>剩余 {player.prismaticUses} 次</small></button>
        <button className="reroll-action" title="重新投掷当前选中的骰子，未选中的保持不变" disabled={disabled || !legal.canReroll || !player.selectedIds.length} onClick={() => sendAction({ type: 'reroll', playerId, diceIds: [...player.selectedIds] })}><span className="round-action-icon"><RotateCcw size={27}/><span className="action-count">{player.rerolls}</span></span><strong>重投</strong><small>{player.selectedIds.length ? `重投选中的 ${player.selectedIds.length} 颗` : '先选择要重投的骰子'}</small></button>
        <button className="confirm-action" disabled={disabled || !legal.canConfirm} onClick={() => sendAction({ type: 'confirm', playerId, diceIds: [...draft.current!.ids] })}><span className="round-action-icon"><Check size={34}/></span><strong>{state.phase === 'swap' ? '确认交换' : '确认使用'}</strong><small>{player.selectedIds.length} / {legal.requiredDice || '∞'}</small></button>
      </aside>
    </div>
    <div className="battle-bottom"><span className="battle-instruction">{paused ? '连接中断，等待恢复…' : resolving ? '伤害结算…' : busy ? '正在确认本次操作…' : diceRolling ? '骰子投掷中…' : legal.canSwap ? '点击或拖动骰子进行交换，双方确认后结算' : legal.canSelect ? `点击或按住划选 · 重投所选，或选好${legal.requiredDice || '任意数量'}颗确认使用` : legal.canShop ? '挑选战术卡，然后继续对局' : state.phase === 'finished' ? '本局已结束' : '对手正在思考，请稍候…'}</span><span className="last-event">{state.log.at(-1)?.text}</span></div>
    {state.mode === 'coop' && player.tactics.length > 0 && <div className="tactic-hand">{player.tactics.map((id, i) => { const t = tactics.find(x => x.id === id); return <div key={`${id}-${i}`} className="hand-card"><button onClick={() => setInspectTactic(i)} aria-label={`查看战术：${t?.name || id}`}><Sparkles size={15}/><strong>{t?.name || id}</strong><p>{t?.description}</p></button><button className="discard-tactic" title="弃置此战术卡" disabled={disabled} onClick={() => sendAction({ type: 'discardTactic', playerId, handIndex: i })}><X size={12}/></button></div>; })}</div>}
    {inspectedTactic && inspectTactic !== null && <Modal title={inspectedTactic.name} onClose={() => setInspectTactic(null)}><div className="prose"><p>{cleanText(inspectedTactic.description)}</p><p>{legal.canUseTactics ? '在交换阶段使用，效果立即生效。' : '双方完成选骰后，可在交换阶段使用。'}</p></div><div className="modal-actions"><button className="secondary" onClick={() => setInspectTactic(null)}>返回牌桌</button><button className="primary" disabled={!legal.canUseTactics || disabled} onClick={() => { sendAction({ type: 'useTactic', playerId, handIndex: inspectTactic }); setInspectTactic(null); }}>使用战术 <Sparkles size={16}/></button></div></Modal>}
    {legal.canShop && !paused && <Modal title="战术商店" onClose={() => sendAction({ type: 'leaveTactics', playerId })} wide><div className="shop-explanation"><span>战术点 <b>◈ {player.tacticPoints}</b></span><span>手牌 {player.tactics.length} / 3 · 在交换阶段使用</span></div><div className="tactic-offers">{player.offers.map((id, i) => { const t = tactics.find(x => x.id === id); return <article className={`tactic-offer rank-${t?.rank}`} key={`${id}-${i}`}><div className="tactic-art">{t && <img src={asset(`assets/tactics/${t.id}.png`)} alt=""/>}</div><h3>{t?.name || '已购买'}</h3><p>{t?.description || '本格商品已售出'}</p><span className="tactic-type">{t?.kind === 'attack' ? '攻击' : t?.kind === 'defend' ? '防御' : '通用'}</span><button className="secondary" disabled={disabled || !t || player.tacticPoints < t.cost || player.tactics.length >= 3} onClick={() => sendAction({ type: 'buyTactic', playerId, offerIndex: i })}>购买 <span>◈ {t?.cost || 0}</span></button></article>; })}</div><div className="modal-actions"><button className="secondary" disabled={disabled || player.tacticPoints < 1 || player.statuses.shopRefresh >= 1} onClick={() => sendAction({ type: 'refreshTactics', playerId })}>刷新商品 · ◈ 1</button><button className="primary" disabled={disabled} onClick={() => sendAction({ type: 'leaveTactics', playerId })}>准备完毕 <ArrowLeft className="flip" size={18}/></button></div></Modal>}
    {paused && <div className="connection-overlay"><WifiOff size={32}/><h2>等待重新连接</h2><p>{pauseReason || '已暂停对局，恢复连接后继续。'}</p><button className="secondary" onClick={onExit}>返回大厅</button></div>}
    {state.phase === 'finished' && <div className="result-overlay"><span className="result-eyebrow">COSMICON COLLECTIVE</span><div className="result-emblem">{state.winner === player.side ? '✦' : '◇'}</div><h1>{state.winner === player.side ? '对局胜利' : state.winner === null ? '对局结束' : '再接再厉'}</h1><p>{state.reason || `在第 ${state.turn} 回合结束对局`}</p><div className="result-stats"><span>回合 <b>{state.turn}</b></span><span>剩余生命 <b>{player.hp}</b></span>{state.mode === 'coop' && <span>共斗生命 <b>{state.sharedLives}</b></span>}</div><button className="primary" onClick={onExit}>返回{isOnline ? '房间' : '活动'} <ArrowLeft className="flip" size={18}/></button><button className="text-button" onClick={() => setShowLog(true)}>查看对局记录</button></div>}
    {showLog && <Modal title="对局记录" onClose={() => setShowLog(false)}><div className="battle-log">{state.log.slice().reverse().map(e => <p key={e.id}><small>#{e.id}</small><span>{e.text}{e.hpBefore !== undefined && e.hpAfter !== undefined && <small className="log-detail">生命 {e.hpBefore} → {e.hpAfter}{e.poisonBefore !== undefined ? ` · 毒 ${e.poisonBefore} → ${e.poisonAfter}` : ''}{e.thornsBefore !== undefined ? ` · 荆棘 ${e.thornsBefore} → ${e.thornsAfter}` : ''}</small>}</span></p>)}</div></Modal>}
    {showHelp && <Modal title="牌桌指南" onClose={() => setShowHelp(false)}><div className="prose"><h3>选中骰子，再决定重投或使用</h3><p>点击骰子，蓝色边框表示选中。也可以从牌桌空白处按住并滑入骰排，沿途的骰子都会选中；从已选骰子起手可批量取消。点击「重投」只重新投掷选中的骰子，其他骰子保持原点数。可以同时重投任意数量；曜彩骰也能重投，一次操作只消耗一次重投次数。</p><p>选好本回合要用于攻防的骰子，再点击「确认使用」。攻击等级与防御等级限制确认时的数量，不限制一次重投的数量；绿色按钮显示已选数量与要求。</p><h3>共斗交换</h3><p>双方确认选骰后，未选的骰子进入共享池。先点自己的已选骰，再点共享池中的目标；也可以拖放交换。在这一阶段可以使用手中的战术卡。</p></div></Modal>}
    {inspect && <Modal title={cardById[inspect.cardId]?.name || inspect.name} onClose={() => setInspect(null)}><div className="prose"><p>{cleanText(cardById[inspect.cardId]?.description || '')}</p><p>攻击等级 {inspect.attackLevel || '不限'} · 防御等级 {inspect.defenseLevel} · 曜彩骰剩余 {inspect.prismaticUses}</p><div className="status-list">{Object.entries(inspect.statuses).filter(([, v]) => v > 0).map(([k, v]) => <span key={k}>{statusNames[k] || k} ×{v}</span>)}</div></div></Modal>}
    {confirmExit && <Modal title="离开对局" onClose={() => setConfirmExit(false)}><div className="prose"><p>离开将认输并结束本局。已获得的卡牌和养成进度会保留。</p></div><div className="modal-actions"><button className="secondary" onClick={() => setConfirmExit(false)}>继续对局</button><button className="primary" disabled={busy || resolving || paused} onClick={() => { send({ type: 'surrender', playerId }); setConfirmExit(false); }}>确认认输</button></div></Modal>}
  </section>;
}
