import { useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCheck, ChevronRight, CircleHelp, Crown, Flame, Gem, HandHeart, Heart, Info, List, RotateCcw, Shield, Shuffle, Sparkles, Swords, Target, Trophy, Users, Zap } from 'lucide-react';
import { cardById, diceById } from '../data';
import { getPartyLegalActions, getPartyPreview } from '../game/party';
import type { OverlordMove, PartyCommand, PartyMode, PartyPlayer, PartyStance, PartyState, PartyTarget, PartyUpgrade } from '../game/partyTypes';
import type { RolledDie } from '../game/types';
import { asset, cleanText } from './CardView';
import { CharacterDetails, DiceDetails } from './LoadoutDetails';
import Modal from './Modal';
import './PartyBattle.css';

interface Props {
  state: PartyState;
  playerId: string;
  onCommand: (command: PartyCommand) => void;
  onExit: () => void;
  busy?: boolean;
}

const modes: Record<PartyMode, { name: string; subtitle: string; mission: string; rules: string[] }> = {
  treasure: {
    name: '银河夺宝', subtitle: '4—8 人 · 秘密选点 · 积分争夺', mission: '选一座宝库，押中这一轮',
    rules: ['所有人同时选骰、重投和选择宝库。你的路线在全员确认后一起揭晓。', '火力、坚守、奇巧宝库有不同的挑战方式。留意宝库提示、奖励和每轮事件，决定稳拿资源还是争夺高分。', '每轮得分累计，最后按总分决出赢家。失利也能继续参与；轮间用补给选择强化。'],
  },
  raid: {
    name: '裂界远征', subtitle: '4—8 人 · 协同破盾 · 首领讨伐', mission: '分工处理装置，合力击破首领',
    rules: ['所有人组成一支队伍，同时安排攻击、防守或援护。先看首领预告，再决定分工。', '护盾、蓄力装置和本体是不同目标。装置的耐久与效果会影响本轮结算，集中火力或分头处理由队伍决定。', '同队玩家可在确认前换骰，每人每轮一次。角色倒地后仍会继续参与，但队伍危机会上升；在危机耗尽或轮数用完前击败首领。'],
  },
  duos: {
    name: '双人搭档乱斗', subtitle: '4 / 6 / 8 人 · 两人组队 · 共同争冠', mission: '与你的搭档争夺本轮目标',
    rules: ['每两人组成一队，共享队伍积分。各自选骰，安排攻击、防守或援护，再一起争夺目标。', '确认前可与搭档交换一颗骰子。双方每轮只有一次换骰机会，先沟通谁更需要关键点数。', '比赛采用固定轮数。轮间消耗各自补给选择强化，围绕搭档的能力形成组合；最终按队伍总分排名。'],
  },
  overlord: {
    name: '首领降临', subtitle: '1 位首领 vs 讨伐队 · 招式博弈', mission: '读懂首领预告，准备迎战',
    rules: ['一位玩家扮演首领，其余玩家组成讨伐队。双方同时选骰与安排本轮行动。', '首领从公开候选招式中秘密选一招。讨伐队只能看到预告，需要分配拆装置、攻击本体与援护的人手。', '讨伐队可换骰与援护，首领随着战局进入新阶段。先完成己方胜利条件的一方获胜；结束后可以在房间换人当首领。'],
  },
};

const effectNames: Record<string, string> = { venom: '猛毒', poison: '中毒', double: '翻倍', fated: '命定', heal: '治愈', combo: '连击', reflect: '反伤', counter: '反击', forcefield: '力场', unyielding: '不屈', overload: '超载', lastStand: '背水', hack: '骇入', thorns: '荆棘', instant: '瞬伤', lucky: '强运', toughness: '韧性', strength: '力量', siphon: '虹吸', refund: '曜彩恢复' };
const stanceInfo: Record<PartyStance, { name: string; hint: string; icon: ReactNode }> = {
  assault: { name: '进攻', hint: '用攻击骰型争夺或击破目标', icon: <Swords size={18}/> },
  guard: { name: '坚守', hint: '用防御骰型抵挡压力', icon: <Shield size={18}/> },
  support: { name: '援护', hint: '选一名队友，提供协同支援', icon: <HandHeart size={18}/> },
};
const moveInfo: Record<OverlordMove, { name: string; hint: string; icon: ReactNode }> = {
  sweep: { name: '横扫', hint: '攻击全队；坚守可抵挡部分伤害', icon: <Swords size={19}/> },
  drain: { name: '汲取', hint: '攻击生命比例最低者并回血；队伍援护可阻止回血', icon: <Heart size={19}/> },
  eruption: { name: '爆发', hint: '发动强力全体攻击，危机 +2；蓄力装置被击破则完全打断', icon: <Flame size={19}/> },
};
const upgradeInfo: Record<PartyUpgrade, { name: string; hint: string; icon: ReactNode }> = {
  power: { name: '火力强化', hint: '每级攻击 +2，本局持续生效', icon: <Swords size={18}/> },
  ward: { name: '防护强化', hint: '每级防御 +2，应对首领攻势时也可被动减伤', icon: <Shield size={18}/> },
  fortune: { name: '灵感强化', hint: '每级额外重投 +1，本局持续生效', icon: <Sparkles size={18}/> },
};

function targetIcon(kind: PartyTarget['kind']) {
  if (kind === 'fire') return <Flame size={19}/>;
  if (kind === 'bastion' || kind === 'shield') return <Shield size={19}/>;
  if (kind === 'puzzle') return <Gem size={19}/>;
  if (kind === 'charge') return <Zap size={19}/>;
  if (kind === 'core') return <Crown size={19}/>;
  return <Target size={19}/>;
}
function percent(value: number, max: number) { return max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0; }
function dieLabel(die: RolledDie) { return `${die.prismatic ? '曜彩骰' : `D${die.sides}`} · ${die.value} 点${die.effect ? ` · ${effectNames[die.effect] || die.effect}` : ''}${die.forced ? ' · 命定，不可更换' : ''}`; }
function teamName(state: PartyState, teamId: string) {
  if (state.mode === 'duos') return `第 ${[...new Set(state.players.map(p => p.teamId))].indexOf(teamId) + 1} 队`;
  if (state.players.some(p => p.teamId === teamId && p.role === 'boss')) return '首领';
  if (state.mode === 'raid' || state.mode === 'overlord') return '讨伐队';
  return state.players.find(p => p.teamId === teamId)?.name || '队伍';
}

export default function PartyBattle({ state: authoritative, playerId, onCommand, onExit, busy = false }: Props) {
  const [dialog, setDialog] = useState<'rules' | 'log' | 'exit' | 'prismatic' | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [exchangePlayerId, setExchangePlayerId] = useState('');
  const [exchangeOwnId, setExchangeOwnId] = useState('');
  const [exchangeOtherId, setExchangeOtherId] = useState('');
  const [, redraw] = useState(0);
  const selection = useRef<{ signature: string; ids: string[] } | null>(null);
  const authoritativePlayer = authoritative.players.find(p => p.id === playerId);
  // Other players' network updates must never discard a local selection in progress.
  const signature = authoritativePlayer ? `${authoritative.round}/${authoritative.phase}/${playerId}/${authoritativePlayer.confirmed}/${authoritativePlayer.rollsUsed}/${authoritativePlayer.prismaticUses}/${authoritativePlayer.exchangedThisRound}/${authoritativePlayer.selectedIds.join(',')}/${authoritativePlayer.dice.map(d => `${d.id}:${d.value}:${d.effect || ''}`).join(',')}` : '';
  if (!selection.current || selection.current.signature !== signature) selection.current = { signature, ids: [...(authoritativePlayer?.selectedIds || [])] };
  const selectedIds = selection.current.ids;
  const state: PartyState = authoritativePlayer ? { ...authoritative, players: authoritative.players.map(p => p.id === playerId ? { ...p, selectedIds } : p) } : authoritative;
  const me = state.players.find(p => p.id === playerId);
  if (!me) return <section className="party-battle"><p>你已不在这场对局中。</p><button className="secondary" onClick={onExit}>返回房间</button></section>;
  const legal = getPartyLegalActions(state, playerId);
  const preview = getPartyPreview(state, playerId);
  const mode = modes[state.mode];
  const planning = state.phase === 'planning';
  const canPlan = planning && legal.canPlan && !busy;
  const canSelect = legal.canSelect && !busy;
  const card = state.catalog.cards.find(c => c.id === me.cardId);
  const prism = state.catalog.prismatics.find(d => d.id === me.prismaticId);
  const weather = state.catalog.weather.find(w => w.id === state.weatherId);
  const selectedTarget = state.targets.find(t => t.id === me.plan.targetId);
  const supportPlayers = state.players.filter(p => legal.supportPlayerIds.includes(p.id));
  const allies = state.players.filter(p => p.id !== me.id && p.teamId === me.teamId && p.role !== 'boss');
  const exchangePartner = allies.find(p => p.id === exchangePlayerId) || allies[0];
  const ownExchangeDice = me.dice.filter(d => !d.forced);
  const otherExchangeDice = exchangePartner?.dice.filter(d => !d.forced) || [];
  const ownDieId = ownExchangeDice.some(d => d.id === exchangeOwnId) ? exchangeOwnId : ownExchangeDice[0]?.id || '';
  const otherDieId = otherExchangeDice.some(d => d.id === exchangeOtherId) ? exchangeOtherId : otherExchangeDice[0]?.id || '';
  const allReady = state.players.filter(p => planning ? p.confirmed : p.ready).length;
  const rankedPlayers = [...state.players].sort((a, b) => b.score - a.score);
  const teams = [...new Set(state.players.map(p => p.teamId))].map(id => ({ id, score: state.players.filter(p => p.teamId === id).reduce((n, p) => n + p.score, 0) })).sort((a, b) => b.score - a.score);
  const finished = state.phase === 'finished';
  const won = state.winnerTeamIds.includes(me.teamId);
  const inspectedPlayer = state.players.find(p => p.id === inspectId);
  const inspectedCard = inspectedPlayer && state.catalog.cards.find(c => c.id === inspectedPlayer.cardId);
  const inspectedSource = inspectedCard && cardById[inspectedCard.id];
  const disabled = busy || !planning || me.confirmed;
  const roleLocked = me.rollsUsed > 0 || me.prismaticRolled || me.exchangedThisRound;
  const stanceOptions = state.mode === 'duos' ? {
    ...stanceInfo,
    assault: { ...stanceInfo.assault, name: '全力', hint: '按本轮攻守发挥完整战力' },
    guard: { ...stanceInfo.guard, hint: '防御 +5；进攻时攻击 -4' },
    support: { ...stanceInfo.support, hint: '治疗并强化队友，自己的战力减半' },
  } : stanceInfo;

  const command = (next: PartyCommand) => { if (!busy) onCommand(next); };
  const selectIds = (ids: string[]) => {
    if (!canSelect) return;
    selection.current = { signature, ids: ids.filter(id => me.dice.some(d => d.id === id)) };
    redraw(n => n + 1);
  };
  const plan = (patch: Partial<PartyPlayer['plan']>) => {
    if (canPlan) command({ type: 'plan', playerId, ...me.plan, ...patch });
  };
  const chosenStance = stanceOptions[me.plan.stance];
  const setStance = (stance: PartyStance) => plan({ stance, supportPlayerId: stance === 'support' ? (me.plan.supportPlayerId || supportPlayers[0]?.id) : undefined });
  const rosterPlayer = (p: PartyPlayer) => {
    const definition = state.catalog.cards.find(c => c.id === p.cardId);
    const sameTeam = p.teamId === me.teamId;
    const memberTarget = state.targets.find(t => t.id === p.plan.targetId);
    return <li className="party-member" key={p.id}>
      <img className="party-member-avatar" src={asset(definition?.image || cardById[p.cardId]?.image)} alt=""/>
      <div className="party-member-copy"><b>{p.name}{p.id === playerId && <span>你</span>}{p.role === 'boss' && <Crown size={12} aria-label="首领"/>}</b><p>{definition?.name || '未知角色'}{p.isAI ? ' · AI' : ''}{state.mode === 'duos' ? ` · ${teamName(state, p.teamId)}` : ''}</p><p>生命 {p.hp} / {p.maxHp}</p>{sameTeam && planning && p.role !== 'boss' && <p className="party-member-plan">{stanceOptions[p.plan.stance].name} · {memberTarget?.name || '选择目标中'}{p.plan.stance === 'support' && p.plan.supportPlayerId ? ` → ${state.players.find(other => other.id === p.plan.supportPlayerId)?.name || '队友'}` : ''}</p>}</div>
      <div className="party-member-state"><strong>{p.score}<span className="party-sr-only">分</span></strong>{finished ? <span>{state.winnerTeamIds.includes(p.teamId) ? '胜利' : '已完成'}</span> : (planning ? p.confirmed : p.ready) ? <span className="ready"><Check size={12}/>已准备</span> : <span>{planning ? '计划中' : '整备中'}</span>}</div>
    </li>;
  };

  return <section className={`party-battle party-mode-${state.mode} party-phase-${state.phase}`} aria-label={mode.name}>
    <header className="party-topbar">
      <div className="party-topbar-main"><button className="party-back" aria-label="返回房间" onClick={() => finished ? onExit() : setDialog('exit')}><ArrowLeft size={19}/></button><div><h1>{mode.name}</h1><p>{mode.subtitle}</p></div></div>
      <div className="party-topbar-tools"><button className="icon-button" aria-label="查看玩法规则" onClick={() => setDialog('rules')}><CircleHelp size={20}/></button><button className="icon-button" aria-label="查看对局记录" onClick={() => setDialog('log')}><List size={20}/></button></div>
    </header>
    <div className="party-progress"><div className="party-round">第 <b>{state.round}</b><small>/ {state.maxRounds}</small> 轮</div><div className="party-ready-count" role="status" aria-live="polite">{finished ? <><Trophy size={15}/>比赛结束</> : <><Users size={15}/><strong>{allReady} / {state.players.length}</strong>{planning ? '已锁定计划' : '准备下一轮'}</>}</div></div>
    <div className="party-layout">
      <div className="party-main">
        <section className="party-mission" aria-label="本轮目标">
          <span>{me.role === 'boss' ? '首领视角' : '本轮目标'}</span>
          <h2>{me.role === 'boss' ? '选择招式，挡住讨伐队' : mode.mission}</h2>
          <p>{state.bossTelegraph || (state.mode === 'duos' ? '各自选骰，共享队伍积分。确认前可以与搭档交换关键骰子。' : '选择你的路线。所有人锁定计划后，一起揭晓争夺结果。')}</p>
          <div className="party-event"><Sparkles size={14}/><span><strong>{state.roundRule.name}</strong> · {state.roundRule.description}</span></div>
          {weather && <div className="party-event"><Info size={14}/><span><strong>{weather.name}</strong> · {cleanText(weather.description || '')}</span></div>}
          {(state.mode === 'raid' || state.mode === 'overlord') && <>
            <div className="party-meter-label"><span>首领 · 第 {state.bossPhase} 阶段</span><b>{state.bossHp} / {state.bossMaxHp}</b></div>
            <div className="party-meter" role="progressbar" aria-label="首领剩余生命" aria-valuenow={state.bossHp} aria-valuemin={0} aria-valuemax={state.bossMaxHp}><span style={{ width: `${percent(state.bossHp, state.bossMaxHp)}%` }}/></div>
            <div className="party-meter-label"><span>队伍危机 · 达到上限即失败</span><b>{state.crisis} / {state.maxCrisis}</b></div>
            <div className="party-meter" role="progressbar" aria-label="队伍危机" aria-valuenow={state.crisis} aria-valuemin={0} aria-valuemax={state.maxCrisis}><span style={{ width: `${percent(state.crisis, state.maxCrisis)}%` }}/></div>
          </>}
        </section>

        {planning ? <>
          {me.role === 'boss' ? <section className="party-targets" aria-label="首领招式"><div className="party-section-title"><h2><Crown size={17}/>选择本轮招式</h2><span>确认后锁定</span></div><div className="party-choice-list">{state.bossMoves.map(move => <button key={move} className={`party-choice ${state.bossMove === move ? 'is-selected' : ''}`} disabled={disabled} aria-pressed={state.bossMove === move} onClick={() => command({ type: 'bossMove', playerId, move })}><span className="party-choice-top"><b>{moveInfo[move].name}</b>{moveInfo[move].icon}</span><p>{moveInfo[move].hint}</p><small>{state.bossMove === move ? '已选招式' : '点击选择'}</small></button>)}</div><p className="party-choice-footer">讨伐队只看到候选招式；你的选择在本轮结算时揭晓。</p></section> : <section className="party-targets" aria-label="选择目标">
            <div className="party-section-title"><h2><Target size={17}/>{state.mode === 'treasure' ? '选择宝库' : '选择目标'}</h2><span>全员确认后揭晓</span></div>
            <div className="party-choice-list">{state.targets.map(target => <button key={target.id} className={`party-choice ${me.plan.targetId === target.id ? 'is-selected' : ''}`} disabled={!canPlan || !legal.targetIds.includes(target.id) || state.mode === 'treasure' && roleLocked && (target.id === 'bastion') !== (preview.role === 'defense')} aria-pressed={me.plan.targetId === target.id} onClick={() => plan({ targetId: target.id })}>
              <span className="party-choice-top"><b>{target.name}</b>{targetIcon(target.kind)}</span><p>{target.description}</p>
              {target.maxHp > 0 && state.mode !== 'treasure' && <><small>{target.broken ? '已击破' : `耐久 ${target.hp} / ${target.maxHp}`}</small><span className="party-meter"><span style={{ width: `${percent(target.hp, target.maxHp)}%` }}/></span></>}
              {target.reward > 0 && <small>奖励 {target.reward} 分{target.difficulty > 0 ? ` · 难度 ${target.difficulty}` : ''}</small>}
              {me.plan.targetId === target.id && <small><Check size={11}/> 当前目标</small>}
            </button>)}</div>{state.mode === 'treasure' && <p className="party-choice-footer">{roleLocked ? '攻守已锁定：重投或换骰后，仍可在同类宝库之间调整路线。' : '坚守宝库使用防御骰型，其他宝库使用攻击骰型。请先定路线；重投、换骰或使用曜彩骰后，本轮攻守锁定。'}</p>}
          </section>}

          {me.role !== 'boss' && state.mode !== 'treasure' && <section className="party-tactics" aria-label="本轮战术"><div className="party-section-title"><h2><Swords size={16}/>本轮战术</h2><span>{state.mode === 'duos' ? `本轮我方${preview.role === 'attack' ? '进攻' : '防守'}` : roleLocked ? '攻守已锁定' : '重投前可切换攻守'}</span></div><div className="party-tactic-list">{(['assault', 'guard', 'support'] as PartyStance[]).map(stance => <button key={stance} className={`party-tactic ${me.plan.stance === stance ? 'is-selected' : ''}`} disabled={!canPlan || stance === 'support' && !supportPlayers.length || state.mode !== 'duos' && roleLocked && (stance === 'assault') !== (preview.role === 'attack')} aria-pressed={me.plan.stance === stance} onClick={() => setStance(stance)}>{stanceOptions[stance].icon}<span><b>{stanceOptions[stance].name}</b><small>{stanceOptions[stance].hint}</small></span></button>)}</div>{me.plan.stance === 'support' && <><div className="party-support-controls"><label>援护队友<select disabled={!canPlan} value={me.plan.supportPlayerId || supportPlayers[0]?.id || ''} onChange={e => plan({ supportPlayerId: e.target.value })}>{supportPlayers.map(p => <option key={p.id} value={p.id}>{p.name} · 生命 {p.hp}/{p.maxHp}</option>)}</select></label></div></>}{me.plan.stance !== 'assault' && <p className="party-choice-footer">{preview.objectiveHint}</p>}</section>}
          <section className="party-player-workspace" aria-label="我的骰子">
            <div className="party-own-heading"><div className="party-own-identity"><button className="party-own-portrait" onClick={() => setInspectId(me.id)} aria-label={`查看${card?.name || me.name}角色技能`}><img src={asset(card?.image || cardById[me.cardId]?.image)} alt=""/><span>角色技能</span></button><div><h2>{card?.name || me.name}</h2><p>{me.role === 'boss' ? '首领' : chosenStance.name}{selectedTarget && me.role !== 'boss' ? ` · ${selectedTarget.name}` : ''}</p><div className="party-health"><Heart size={12}/><strong>{me.hp}</strong><small>/ {me.maxHp}</small>{me.supplies > 0 && <small> · 补给 {me.supplies}</small>}</div></div></div><div className="party-power"><span>{preview.role === 'attack' ? '攻击预览' : '防御预览'}</span><strong>{preview.value}</strong><small>{me.plan.targetId === 'puzzle' ? `骰型贡献预估 ${preview.objectiveValue}` : `${selectedIds.length} 颗骰子参与结算`}</small></div></div>
            <div className="party-dice-area">
              <div className="party-dice-toolbar"><span>已选 {selectedIds.length} 颗{legal.requiredDice > 0 ? ` · 需 ${legal.requiredDice} 颗` : ` · 至多 ${legal.maxDice} 颗`}</span><div><button disabled={!canSelect} onClick={() => selectIds(me.dice.map(d => d.id))}>全选</button><button disabled={!canSelect || !selectedIds.length} onClick={() => selectIds([])}>清选</button></div></div>
              <div className="party-dice" role="group" aria-label="点击选择要重投或使用的骰子">{me.dice.map(die => <button key={die.id} className={`party-die d${die.sides} ${die.prismatic ? 'prismatic' : ''} ${selectedIds.includes(die.id) ? 'is-selected' : ''}`} disabled={!canSelect} aria-label={dieLabel(die)} aria-pressed={selectedIds.includes(die.id)} onClick={() => selectIds(selectedIds.includes(die.id) ? selectedIds.filter(id => id !== die.id) : [...selectedIds, die.id])}><span>{die.prismatic ? '曜彩' : `D${die.sides}`}</span><strong>{die.value}</strong><small>{die.effect ? effectNames[die.effect] || '特殊效果' : selectedIds.includes(die.id) ? '已选中' : '点选骰子'}</small></button>)}</div>
              <p className="party-dice-hint">{me.confirmed ? '已锁定本轮计划，等待其他玩家确认。' : '点击骰子选中；重投只改变所选骰子。最后选好用于结算的骰子，再锁定计划。'}</p>
            </div>
            <div className="party-roll-actions"><button disabled={disabled || !legal.canReroll || !selectedIds.length} onClick={() => command({ type: 'reroll', playerId, diceIds: [...selectedIds] })}><RotateCcw size={16}/>重投所选 <span>剩 {me.rerolls} 次</span></button><button disabled={disabled || !legal.canPrismatic} onClick={() => command({ type: 'prismatic', playerId })}><Gem size={16}/>投曜彩骰 <span>剩 {me.prismaticUses} 次</span></button><button className="party-prism-info" disabled={!prism} aria-label="查看曜彩骰效果" onClick={() => setDialog('prismatic')}><Info size={16}/></button></div>
            {preview.effects.length > 0 && <p className="party-choice-footer">本次效果 · {preview.effects.join(' · ')}</p>}
          </section>


          {allies.length > 0 && me.role !== 'boss' && <details className="party-support"><summary><Shuffle size={15}/> 与队友换骰{me.exchangedThisRound ? ' · 本轮已使用' : ' · 每人每轮一次'}</summary><p>双方都未锁定计划时，可互换一颗非命定骰；这会使用双方本轮的换骰机会。</p><div className="party-support-controls"><label>队友<select value={exchangePartner?.id || ''} disabled={disabled || !legal.canExchange} onChange={e => { setExchangePlayerId(e.target.value); setExchangeOtherId(''); }}>{allies.map(p => <option key={p.id} value={p.id} disabled={p.confirmed || p.exchangedThisRound}>{p.name}{p.confirmed ? ' · 已锁定' : p.exchangedThisRound ? ' · 已换骰' : ''}</option>)}</select></label><label>给出我的骰子<select value={ownDieId} disabled={disabled || !legal.canExchange} onChange={e => setExchangeOwnId(e.target.value)}>{ownExchangeDice.map(d => <option key={d.id} value={d.id}>{dieLabel(d)}</option>)}</select></label><label>换取队友的骰子<select value={otherDieId} disabled={disabled || !legal.canExchange} onChange={e => setExchangeOtherId(e.target.value)}>{otherExchangeDice.map(d => <option key={d.id} value={d.id}>{dieLabel(d)}</option>)}</select></label><button className="secondary" disabled={disabled || !legal.canExchange || !exchangePartner || exchangePartner.confirmed || exchangePartner.exchangedThisRound || !ownDieId || !otherDieId} onClick={() => { if (exchangePartner) command({ type: 'exchange', playerId, targetPlayerId: exchangePartner.id, ownDieId, targetDieId: otherDieId }); }}><Shuffle size={15}/>确认交换</button></div></details>}

          <div className="party-commit"><div><strong>{busy ? '正在确认操作…' : me.confirmed ? '计划已锁定' : legal.canConfirm ? '准备好就锁定计划' : '完成本轮选择'}</strong><p>{me.confirmed ? `等待 ${state.players.length - allReady} 位玩家，一起揭晓。` : legal.reason || (legal.requiredDice > 0 ? `请选择 ${legal.requiredDice} 颗骰子参与结算。` : `请选择 ${legal.minDice}—${legal.maxDice} 颗骰子参与结算。`)}</p></div><button className="primary" disabled={disabled || !legal.canConfirm} onClick={() => command({ type: 'confirm', playerId, diceIds: [...selectedIds] })}>{me.confirmed ? <CheckCheck size={18}/> : <Check size={18}/>} {me.confirmed ? '等待揭晓' : '锁定本轮计划'}</button></div>
        </> : <section className="party-resolution" aria-label={finished ? '比赛结果' : '本轮结算'}>
          <span>{finished ? 'MATCH COMPLETE' : `ROUND ${String(state.round).padStart(2, '0')} · RESULT`}</span><h2>{finished ? won ? '胜利，配合得漂亮！' : '本局比赛结束' : '本轮结果已揭晓'}</h2><p>{finished ? state.reason || '查看最终积分和本轮记录。' : '先看看各路战果，选择补给强化，再一起进入下一轮。'}</p>
          <table className="party-results"><caption className="party-sr-only">本轮表现与积分</caption><thead><tr><th scope="col">玩家 / 目标</th><th scope="col">本轮表现</th><th scope="col">得分</th></tr></thead><tbody>{state.results.map((result, index) => { const p = state.players.find(player => player.id === result.playerId); const target = state.targets.find(t => t.id === result.targetId); return <tr key={`${result.playerId}-${index}`}><td>{p?.name || '玩家'}{p?.id === playerId ? '（你）' : ''}<small>{target?.name || (p?.role === 'boss' ? '首领行动' : '团队行动')}</small></td><td>{result.value}<small>{result.damage > 0 ? `造成 ${result.damage} 伤害` : '目标结算'}</small></td><td><strong>{result.score >= 0 ? '+' : ''}{result.score}</strong></td></tr>; })}</tbody></table>
          {state.results.some(r => r.text) && <ul className="party-result-notes">{state.results.filter(r => r.text).map((r, i) => <li key={`${r.playerId}-note-${i}`}>{r.text}</li>)}</ul>}
          {!finished && <><div className="party-section-title"><h2><Sparkles size={17}/>轮间补给</h2><span>补给 {me.supplies} · 每轮限选一次</span></div><div className="party-choice-list">{(['power', 'ward', 'fortune'] as PartyUpgrade[]).map(upgrade => <button key={upgrade} className="party-choice" disabled={busy || !legal.canUpgrade || me.ready || me.upgrades[upgrade] >= 3} onClick={() => command({ type: 'upgrade', playerId, upgrade })}><span className="party-choice-top"><b>{upgradeInfo[upgrade].name}</b>{upgradeInfo[upgrade].icon}</span><p>{upgradeInfo[upgrade].hint}</p><small>{me.upgrades[upgrade] >= 3 ? '已满级' : '补给 1'} · {me.upgrades[upgrade]} / 3 级</small></button>)}</div><div className="party-commit"><div><strong>{me.ready ? '已准备，等待队友' : me.upgradedThisRound ? '强化完成，可以继续' : '也可以保留补给，直接继续'}</strong><p>所有玩家准备后开始下一轮。</p></div><button className="primary" disabled={busy || !legal.canReady || me.ready} onClick={() => command({ type: 'ready', playerId })}>{me.ready ? <CheckCheck size={17}/> : <ArrowRight size={17}/>} {me.ready ? '已准备' : '准备下一轮'}</button></div></>}
          {finished && <div className="party-finish-actions"><button className="primary" onClick={onExit}>返回房间 <ChevronRight size={17}/></button><button className="secondary" onClick={() => setDialog('log')}>完整记录</button></div>}
        </section>}
        {state.log.at(-1) && <p className="party-recent-event"><Info size={14}/><span>{state.log.at(-1)?.text}</span></p>}
      </div>

      <aside className="party-standings" aria-label="玩家积分与准备状态"><h2><span><Trophy size={15}/> {state.mode === 'raid' || state.mode === 'overlord' ? '队伍战况' : '积分榜'}</span><small>{state.players.length} 位玩家</small></h2>{state.mode === 'duos' && <div className="party-team-scores">{teams.map(team => <div className="party-team-score" key={team.id}><span>{teamName(state, team.id)}{team.id === me.teamId ? ' · 我的队伍' : ''}</span><b>{team.score} 分</b></div>)}</div>}<ol className="party-roster">{rankedPlayers.map(rosterPlayer)}</ol><p className="party-standings-note">{planning ? allies.length ? '大家同时行动。可查看队友的目标与战术，敌方计划将在结算时揭晓。' : '大家同时行动。其他玩家的具体计划将在全员锁定后揭晓。' : finished ? '最终排名已确定。返回房间可更换模式、角色与人数，再来一局。' : '补给强化只影响本场比赛，准备完成后等待全员继续。'}</p></aside>
    </div>

    {dialog === 'rules' && <Modal title={`${mode.name} · 玩法规则`} onClose={() => setDialog(null)}><div className="party-dialog"><h3>怎么赢</h3><ol>{mode.rules.map(rule => <li key={rule}>{rule}</li>)}</ol><h3>每轮怎么操作</h3><p>选择目标与战术 → 选中要重投的骰子 → 调整用于结算的骰型 → 必要时与队友换骰 → 锁定计划。所有人同时操作，没有提前淘汰。</p><h3>角色技能与曜彩骰</h3><p>点击自己的角色头像查看技能；点击曜彩按钮旁的详情图标查看骰面。点数只是基础强度，具体技能、骰型和曜彩效果都会影响预览与结算。</p><h3>轮间补给</h3><p>结算后可以消耗 1 点补给强化一次，也可以存下补给直接准备。所有强化仅持续到本局结束。</p></div></Modal>}
    {dialog === 'log' && <Modal title="对局记录" onClose={() => setDialog(null)}><div className="party-log">{state.log.slice().reverse().map(event => <p key={event.id}><small>第 {event.round} 轮</small><span>{event.text}</span></p>)}</div></Modal>}
    {dialog === 'exit' && <Modal title="返回房间" onClose={() => setDialog(null)}><div className="party-dialog"><p>本场比赛还没有结束。返回房间后，可重新查看房间和对局状态。</p></div><div className="modal-actions"><button className="secondary" onClick={() => setDialog(null)}>继续对局</button><button className="primary" onClick={onExit}>返回房间</button></div></Modal>}
    {dialog === 'prismatic' && prism && <Modal title={prism.name} onClose={() => setDialog(null)}><div className="party-dialog">{diceById[prism.id] ? <DiceDetails die={diceById[prism.id]} card={cardById[me.cardId]}/> : <><p>{cleanText(prism.description || '选中曜彩骰参与结算时，其特殊骰面效果才会生效。')}</p><ol>{prism.faces.map((face, i) => <li key={i}>第 {i + 1} 面 · {face.value} 点{face.effect ? ` · ${effectNames[face.effect] || face.effect}${face.amount ? ` ${face.amount}` : ''}` : ''}</li>)}</ol></>}</div></Modal>}
    {inspectedPlayer && inspectedCard && <Modal title={`${inspectedCard.name} · 角色技能`} onClose={() => setInspectId(null)}><div className="party-dialog">{inspectedSource ? <CharacterDetails card={{ ...inspectedSource, ...inspectedCard, description: inspectedCard.description || inspectedSource.description, prismaticId: inspectedCard.prismaticId || null, prismaticUses: inspectedCard.prismaticUses ?? 0, skill: inspectedCard.skill || inspectedSource.skill, image: inspectedCard.image || inspectedSource.image }}/> : <><h3>{inspectedCard.name}</h3><p>生命 {inspectedCard.hp} · 攻击 {inspectedCard.attack || '不限'} · 防御 {inspectedCard.defense}</p><p>{cleanText(inspectedCard.description || '该角色使用当前配置中的骰子与基础属性。')}</p></>}<p>本局强化：火力 {inspectedPlayer.upgrades.power} · 防护 {inspectedPlayer.upgrades.ward} · 灵感 {inspectedPlayer.upgrades.fortune}</p></div></Modal>}
  </section>;
}
