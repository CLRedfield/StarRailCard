import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft, Check, CheckCheck, ChevronDown, CircleHelp, Crown, Flame, Gem,
  HandHeart, Heart, Info, List, RotateCcw, Shield, Shuffle, Sparkles, Swords,
  Target, Zap,
} from 'lucide-react';
import { cardById, diceById } from '../data';
import { getPartyLegalActions, getPartyPreview } from '../game/party';
import type { OverlordMove, PartyCommand, PartyMode, PartyPlayer, PartyStance, PartyState, PartyTarget, PartyUpgrade } from '../game/partyTypes';
import type { RolledDie } from '../game/types';
import { playSound } from '../lib/audio';
import { asset, cleanText } from './CardView';
import DiceTray from './DiceTray';
import { CharacterDetails, DiceDetails } from './LoadoutDetails';
import Modal from './Modal';
import VfxParticles, { type VfxPreset } from './VfxParticles';
import './BattleLayout.css';
import './PartyBattle.css';

interface Props {
  state: PartyState;
  playerId: string;
  onCommand: (command: PartyCommand) => void;
  onExit: () => void;
  busy?: boolean;
  soundVolume?: number;
  reducedMotion?: boolean;
  lowQuality?: boolean;
}

const COACH_KEY = 'starrailcard.party-coach-v1';

const modes: Record<PartyMode, { name: string; subtitle: string; rules: string[] }> = {
  treasure: {
    name: '银河夺宝',
    subtitle: '4—8 人 · 秘密选点 · 积分争夺',
    rules: [
      '所有人同时选骰、重投并点击上方宝库选定路线；全员确认后统一揭晓结果。',
      '火力、坚守、奇巧宝库的破关条件与星核悬赏各不相同，独占无人争夺的宝库还有额外奖励。',
      '终盘两轮最高悬赏宝库会触发加奖；轮间使用补给升级火力、防护或灵感。',
    ],
  },
  raid: {
    name: '裂界远征',
    subtitle: '4—8 人 · 协同破盾 · 首领讨伐',
    rules: [
      '所有人组成远征队协作迎战首领；先看首领招式预告，再在牌桌上方点击分配攻击目标或切换坚守/援护。',
      '击破「护盾核心」可取消减伤，击破「蓄力装置」能直接打断首领「爆发」并降低危机；首领伤害随轮次递增。',
      '使用「团队换骰池」可直接点池骰再点手里非命定骰交换，不打断队友节奏；坚守防线可大幅削弱「横扫」或拦截「汲取」。',
    ],
  },
  duos: {
    name: '双人搭档乱斗',
    subtitle: '4 / 6 / 8 人 · 两人组队 · 共同争冠',
    rules: [
      '两人一队共享队伍积分与「团队换骰池」，每轮攻守立场随竞技场轮换。',
      '点击「援护」并点选队友头像卡可精准治疗与加盾；守方守住阈值以下攻击可凭防守优势取胜。',
      '轮间各自花费补给强化角色，最终按小队总分决出冠军。',
    ],
  },
  overlord: {
    name: '首领降临',
    subtitle: '1 位首领 vs 讨伐队 · 招式博弈',
    rules: [
      '一位玩家扮演首领秘密抉择本轮招式，其余玩家组成讨伐队共同规划破盾、打断与援护。',
      '讨伐队可通过共享换骰池调整点数、安排队友坚守防线减伤，或在关键回合集火击破蓄力装置。',
      '讨伐队击破首领获胜，首领让危机满额或撑过轮数上限即取胜。',
    ],
  },
};

const statusNames: Record<string, { label: string; tone: 'buff' | 'poison' | 'thorns' | 'debuff' }> = {
  strength: { label: '力量', tone: 'buff' },
  toughness: { label: '坚韧', tone: 'buff' },
  evolution: { label: '进化', tone: 'buff' },
  poison: { label: '中毒', tone: 'poison' },
  venom: { label: '猛毒', tone: 'poison' },
  thorns: { label: '荆棘', tone: 'thorns' },
  overload: { label: '超载', tone: 'debuff' },
  interference: { label: '干扰', tone: 'debuff' },
};

const stanceInfo: Record<PartyStance, { name: string; hint: string; icon: ReactNode }> = {
  assault: { name: '进攻', hint: '以进攻骰型争夺或击破选中目标', icon: <Swords size={15}/> },
  guard: { name: '坚守', hint: '防御阵脚；应对横扫可减伤、对汲取优先承伤并反击', icon: <Shield size={15}/> },
  support: { name: '援护', hint: '点选一位同队队友，为其回血加护并降低危机', icon: <HandHeart size={15}/> },
};

const moveInfo: Record<OverlordMove, { name: string; hint: string; icon: ReactNode }> = {
  sweep: { name: '横扫', hint: '攻击全队；每名坚守队友可大幅削弱本次横扫威力', icon: <Swords size={16}/> },
  drain: { name: '汲取', hint: '攻击前排/低血者并吸血；援护可阻断吸血治疗', icon: <Heart size={16}/> },
  eruption: { name: '爆发', hint: '重创全队且危机 +2；击破蓄力装置即可打断', icon: <Flame size={16}/> },
};

const upgradeInfo: Record<PartyUpgrade, { name: string; hint: string; icon: ReactNode }> = {
  power: { name: '火力强化', hint: '每级进攻额外 +2 点战力，整局持续生效', icon: <Swords size={17}/> },
  ward: { name: '防护强化', hint: '每级防守额外 +2 点战力，挨打也更耐抗', icon: <Shield size={17}/> },
  fortune: { name: '灵感强化', hint: '每级每轮多 1 次重投机会', icon: <Sparkles size={17}/> },
};

function targetIcon(kind: PartyTarget['kind']) {
  if (kind === 'fire') return <Flame size={15}/>;
  if (kind === 'bastion' || kind === 'shield') return <Shield size={15}/>;
  if (kind === 'puzzle') return <Gem size={15}/>;
  if (kind === 'charge') return <Zap size={15}/>;
  if (kind === 'core') return <Crown size={15}/>;
  return <Target size={15}/>;
}

function percent(value: number, max: number) {
  return max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
}

function teamName(state: PartyState, teamId: string) {
  if (state.mode === 'duos') return `第 ${[...new Set(state.players.map(p => p.teamId))].indexOf(teamId) + 1} 队`;
  if (state.players.some(p => p.teamId === teamId && p.role === 'boss')) return '首领';
  if (state.mode === 'raid' || state.mode === 'overlord') return '讨伐队';
  return state.players.find(p => p.teamId === teamId)?.name || '队伍';
}

function dieBrief(die: RolledDie) {
  return `${die.prismatic ? '曜彩' : `D${die.sides}`}:${die.value}`;
}

function loadCoachStep(): 0 | 1 | 2 | null {
  try {
    return window.localStorage.getItem(COACH_KEY) === 'done' ? null : 0;
  } catch {
    return 0;
  }
}

function StatusBadges({ statuses, upgrades }: { statuses?: Record<string, number>; upgrades?: PartyPlayer['upgrades'] }) {
  const activeStatuses = Object.entries(statuses || {}).filter(([k, n]) => n > 0 && statusNames[k]);
  const activeUpgrades = upgrades
    ? ([
        upgrades.power > 0 ? { key: 'u-power', label: `火力+${upgrades.power * 2}` } : null,
        upgrades.ward > 0 ? { key: 'u-ward', label: `防护+${upgrades.ward * 2}` } : null,
        upgrades.fortune > 0 ? { key: 'u-fortune', label: `灵感+${upgrades.fortune}` } : null,
      ].filter(Boolean) as { key: string; label: string }[])
    : [];
  if (!activeStatuses.length && !activeUpgrades.length) return null;
  return (
    <div className="party-status-row">
      {activeStatuses.map(([k, n]) => (
        <span key={k} className={`party-status-badge tone-${statusNames[k].tone}`}>
          {statusNames[k].label} <b>{n}</b>
        </span>
      ))}
      {activeUpgrades.map(u => (
        <span key={u.key} className="party-status-badge tone-upgrade">{u.label}</span>
      ))}
    </div>
  );
}

export default function PartyBattle({
  state: authoritative,
  playerId,
  onCommand,
  onExit,
  busy = false,
  soundVolume = 0,
  reducedMotion = false,
  lowQuality = false,
}: Props) {
  const [dialog, setDialog] = useState<'rules' | 'log' | 'exit' | 'prismatic' | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [armedPoolDieId, setArmedPoolDieId] = useState<string | null>(null);
  const [swapWarning, setSwapWarning] = useState('');
  const [rollingDiceIds, setRollingDiceIds] = useState<string[]>([]);
  const [rollKey, setRollKey] = useState(1);
  const [prismBurstKey, setPrismBurstKey] = useState(0);
  const [upgradeBurst, setUpgradeBurst] = useState<PartyUpgrade | null>(null);
  const [coachStep, setCoachStep] = useState<0 | 1 | 2 | null>(loadCoachStep);
  const [bossGhostPct, setBossGhostPct] = useState(() => percent(authoritative.bossHp, authoritative.bossMaxHp));
  const [targetGhostPct, setTargetGhostPct] = useState<Record<string, number>>(() =>
    Object.fromEntries(authoritative.targets.map(t => [t.id, percent(t.hp, t.maxHp)]))
  );
  const [playerGhostPct, setPlayerGhostPct] = useState<Record<string, number>>(() =>
    Object.fromEntries(authoritative.players.map(p => [p.id, percent(p.hp, p.maxHp)]))
  );
  const [, redraw] = useState(0);
  const table = useRef<HTMLElement>(null);
  const selection = useRef<{ signature: string; ids: string[] } | null>(null);

  const authoritativePlayer = authoritative.players.find(p => p.id === playerId);
  const signature = authoritativePlayer
    ? `${authoritative.round}/${authoritative.phase}/${playerId}/${authoritativePlayer.confirmed}/${authoritativePlayer.rollsUsed}/${authoritativePlayer.prismaticUses}/${authoritativePlayer.exchangedThisRound}/${authoritativePlayer.selectedIds.join(',')}/${authoritativePlayer.dice.map(d => `${d.id}:${d.value}:${d.effect || ''}`).join(',')}`
    : '';
  if (!selection.current || selection.current.signature !== signature) {
    selection.current = { signature, ids: [...(authoritativePlayer?.selectedIds || [])] };
  }
  const selectedIds = selection.current.ids;
  const state: PartyState = authoritativePlayer
    ? { ...authoritative, players: authoritative.players.map(p => (p.id === playerId ? { ...p, selectedIds } : p)) }
    : authoritative;
  const me = state.players.find(p => p.id === playerId);

  const prevSnapshot = useRef({
    round: authoritative.round,
    phase: authoritative.phase,
    rollsUsed: authoritativePlayer?.rollsUsed ?? 0,
    prismaticRolled: authoritativePlayer?.prismaticRolled ?? false,
    upgrades: authoritativePlayer ? { ...authoritativePlayer.upgrades } : { power: 0, ward: 0, fortune: 0 },
  });

  useEffect(() => {
    setArmedPoolDieId(null);
    setSwapWarning('');
  }, [authoritative.round, authoritative.phase, authoritativePlayer?.exchangedThisRound, authoritativePlayer?.confirmed]);

  useEffect(() => {
    const prev = prevSnapshot.current;
    const timers: number[] = [];
    if (authoritative.phase !== prev.phase) {
      if (authoritative.phase === 'finished') {
        const myTeam = authoritativePlayer?.teamId;
        const playerWon = !!myTeam && authoritative.winnerTeamIds.includes(myTeam);
        playSound(playerWon ? 'win' : 'damage', soundVolume);
      } else if (authoritative.phase === 'results') {
        const totalDamage = authoritative.results.reduce((sum, r) => sum + Math.max(0, r.damage), 0);
        playSound(totalDamage > 0 ? 'attack' : 'confirm', soundVolume);
      } else if (authoritative.phase === 'planning' && authoritative.round !== prev.round) {
        playSound('roll', soundVolume);
        setRollKey(k => k + 1);
      }
    }
    if (authoritativePlayer) {
      if (authoritative.round === prev.round && authoritativePlayer.prismaticRolled && !prev.prismaticRolled) {
        playSound('arise', soundVolume);
        setRollKey(k => k + 1);
        if (!reducedMotion) {
          setPrismBurstKey(k => k + 1);
          timers.push(window.setTimeout(() => setPrismBurstKey(0), 750));
        }
      }
      if (authoritative.round === prev.round && authoritativePlayer.rollsUsed > prev.rollsUsed) {
        playSound('roll', soundVolume);
        setRollKey(k => k + 1);
      }
      const bought = (['power', 'ward', 'fortune'] as PartyUpgrade[]).find(
        u => authoritativePlayer.upgrades[u] > (prev.upgrades[u] ?? 0)
      );
      if (bought) {
        playSound('heal', soundVolume);
        if (!reducedMotion) {
          setUpgradeBurst(bought);
          timers.push(window.setTimeout(() => setUpgradeBurst(null), 750));
        }
      }
    }
    prevSnapshot.current = {
      round: authoritative.round,
      phase: authoritative.phase,
      rollsUsed: authoritativePlayer?.rollsUsed ?? 0,
      prismaticRolled: authoritativePlayer?.prismaticRolled ?? false,
      upgrades: authoritativePlayer ? { ...authoritativePlayer.upgrades } : { power: 0, ward: 0, fortune: 0 },
    };
    return () => timers.forEach(t => window.clearTimeout(t));
  }, [authoritative.round, authoritative.phase, authoritative.winnerTeamIds, authoritative.results, authoritativePlayer, soundVolume, reducedMotion]);

  useEffect(() => {
    const bossPct = percent(authoritative.bossHp, authoritative.bossMaxHp);
    if (bossPct >= bossGhostPct || reducedMotion) {
      setBossGhostPct(bossPct);
      return;
    }
    const timer = window.setTimeout(() => setBossGhostPct(bossPct), 180);
    return () => window.clearTimeout(timer);
  }, [authoritative.bossHp, authoritative.bossMaxHp, bossGhostPct, reducedMotion]);

  useEffect(() => {
    const timers: number[] = [];
    setTargetGhostPct(curr => {
      const next = { ...curr };
      let changed = false;
      for (const t of authoritative.targets) {
        const pct = percent(t.hp, t.maxHp);
        const prev = curr[t.id];
        if (prev === undefined || pct >= prev || reducedMotion) {
          if (prev !== pct) { next[t.id] = pct; changed = true; }
        } else {
          timers.push(window.setTimeout(() => setTargetGhostPct(latest => ({ ...latest, [t.id]: pct })), 180));
        }
      }
      return changed ? next : curr;
    });
    return () => timers.forEach(t => window.clearTimeout(t));
  }, [authoritative.targets, reducedMotion]);

  useEffect(() => {
    const timers: number[] = [];
    setPlayerGhostPct(curr => {
      const next = { ...curr };
      let changed = false;
      for (const p of authoritative.players) {
        const pct = percent(p.hp, p.maxHp);
        const prev = curr[p.id];
        if (prev === undefined || pct >= prev || reducedMotion) {
          if (prev !== pct) { next[p.id] = pct; changed = true; }
        } else {
          timers.push(window.setTimeout(() => setPlayerGhostPct(latest => ({ ...latest, [p.id]: pct })), 180));
        }
      }
      return changed ? next : curr;
    });
    return () => timers.forEach(t => window.clearTimeout(t));
  }, [authoritative.players, reducedMotion]);

  if (!me) {
    return (
      <section className="battle-page party-table-page party-missing">
        <p>你已不在这场对局中。</p>
        <button className="secondary" onClick={onExit}>返回房间</button>
      </section>
    );
  }

  const legal = getPartyLegalActions(state, playerId);
  const preview = getPartyPreview(state, playerId);
  const mode = modes[state.mode];
  const planning = state.phase === 'planning';
  const resultsPhase = state.phase === 'results';
  const finished = state.phase === 'finished';
  const canPlan = planning && legal.canPlan && !busy;
  const canSelect = planning && legal.canSelect && !busy && !me.confirmed;
  const disabled = busy || !planning || me.confirmed;
  const card = state.catalog.cards.find(c => c.id === me.cardId);
  const prism = state.catalog.prismatics.find(d => d.id === me.prismaticId);
  const myCardDef = cardById[me.cardId];
  const myPrismDef = me.prismaticId ? diceById[me.prismaticId] : undefined;
  const selectedTarget = state.targets.find(t => t.id === me.plan.targetId);
  const supportPlayers = state.players.filter(p => legal.supportPlayerIds.includes(p.id));
  const teamPool = (me.role !== 'boss' && state.swapPools?.[me.teamId]) || [];
  const armedPoolDie = teamPool.find(d => d.id === armedPoolDieId);
  const allReady = state.players.filter(p => (planning ? p.confirmed : p.ready)).length;
  const rankedPlayers = [...state.players].sort((a, b) => b.score - a.score);
  const myRank = rankedPlayers.findIndex(p => p.id === me.id) + 1;
  const teams = [...new Set(state.players.map(p => p.teamId))]
    .map(id => ({ id, score: state.players.filter(p => p.teamId === id).reduce((n, p) => n + p.score, 0) }))
    .sort((a, b) => b.score - a.score);
  const won = state.winnerTeamIds.includes(me.teamId);
  const inspectedPlayer = state.players.find(p => p.id === inspectId);
  const inspectedCard = inspectedPlayer && state.catalog.cards.find(c => c.id === inspectedPlayer.cardId);
  const inspectedSource = inspectedCard && cardById[inspectedCard.id];
  const roleLocked = me.rollsUsed > 0 || me.prismaticRolled || me.exchangedThisRound;
  const myRole = preview.role;

  const stanceOptions = state.mode === 'duos'
    ? {
        ...stanceInfo,
        assault: { ...stanceInfo.assault, name: '全力', hint: '按本轮攻守发挥完整战力' },
        guard: { ...stanceInfo.guard, hint: '防御 +5；攻方时攻击 -4' },
        support: { ...stanceInfo.support, hint: '治疗并强化搭档，自身双倍加成减半' },
      }
    : stanceInfo;

  const command = (next: PartyCommand) => {
    if (busy) return;
    if (next.type === 'reroll') {
      playSound('roll', soundVolume);
      setRollKey(k => k + 1);
      if (!reducedMotion) {
        setRollingDiceIds([...next.diceIds]);
        window.setTimeout(() => setRollingDiceIds([]), 420);
      }
    } else if (next.type === 'confirm' || next.type === 'ready') {
      playSound('confirm', soundVolume);
    } else if (next.type === 'plan' || next.type === 'bossMove' || next.type === 'poolSwap' || next.type === 'exchange') {
      playSound('click', soundVolume);
    }
    onCommand(next);
  };

  const selectIds = (ids: string[]) => {
    if (!canSelect || armedPoolDieId) return;
    playSound('click', soundVolume);
    selection.current = { signature, ids: ids.filter(id => me.dice.some(d => d.id === id)) };
    redraw(n => n + 1);
  };

  const handleOwnDieClick = (id: string) => {
    if (armedPoolDieId) {
      const ownDie = me.dice.find(d => d.id === id);
      if (!ownDie) return;
      if (ownDie.forced) {
        setSwapWarning('命定骰不可与换骰池交换，请选择另一颗手牌骰。');
        return;
      }
      setSwapWarning('');
      setArmedPoolDieId(null);
      command({ type: 'poolSwap', playerId, ownDieId: ownDie.id, poolDieId: armedPoolDieId });
      return;
    }
    if (!canSelect) return;
    const ids = selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id];
    selectIds(ids);
  };

  const handlePoolDieClick = (poolDieId: string) => {
    if (disabled || !legal.canPoolSwap) return;
    playSound('click', soundVolume);
    setSwapWarning('');
    setArmedPoolDieId(curr => (curr === poolDieId ? null : poolDieId));
  };

  const plan = (patch: Partial<PartyPlayer['plan']>) => {
    if (canPlan) command({ type: 'plan', playerId, ...me.plan, ...patch });
  };

  const targetWouldFlipRole = (t: PartyTarget) => {
    const nextRole = state.mode === 'treasure'
      ? (t.id === 'bastion' ? 'defense' : 'attack')
      : state.mode === 'duos'
        ? myRole
        : 'attack';
    return nextRole !== myRole;
  };

  const stanceWouldFlipRole = (stance: PartyStance) => {
    const nextRole = stance === 'assault' && me.plan.targetId !== 'bastion' ? 'attack' : 'defense';
    return state.mode === 'duos' ? false : nextRole !== myRole;
  };

  const setStance = (stance: PartyStance) => {
    if (!canPlan || (roleLocked && stanceWouldFlipRole(stance))) return;
    plan({
      stance,
      supportPlayerId: stance === 'support' ? (me.plan.supportPlayerId || supportPlayers[0]?.id) : undefined,
    });
  };

  const dismissCoach = () => {
    setCoachStep(null);
    try { window.localStorage.setItem(COACH_KEY, 'done'); } catch { /* ignore */ }
  };

  const restartCoach = () => {
    try { window.localStorage.removeItem(COACH_KEY); } catch { /* ignore */ }
    setCoachStep(0);
  };

  const coachContent = coachStep === null ? null : coachStep === 0
    ? {
        target: 'stage',
        step: '1 / 3',
        title: state.mode === 'treasure' ? '选一座宝库路线' : me.role === 'boss' ? '钦定首领招式' : '安排目标与攻守站位',
        text: state.mode === 'treasure'
          ? '点击上方三座宝库卡之一；注意高悬赏目标、奇巧条件，以及本轮事件规则。'
          : me.role === 'boss'
            ? '先点击上方候选招式卡牌再选骰，讨伐队会根据你的预告布防或打断。'
            : `上方点击核心/装置切换进攻目标，中栏可切「进攻 / 坚守 / 援护」；${supportPlayers.length ? '选「援护」后直接点同队玩家卡即可指派！' : ''}`,
      }
    : coachStep === 1
      ? {
          target: legal.canPoolSwap ? 'pool' : 'dice',
          step: '2 / 3',
          title: legal.canPoolSwap ? '团队共享换骰池 & 选骰' : '点击或划选你的骰子',
          text: legal.canPoolSwap
            ? '无需等待队友确认：先点「团队共享换骰池」的骰子，再点手里非「命定」骰即可立即换手！下排点击或空白处划过选骰，带「命定」角标必选。'
            : '点击骰子或从空白桌面按住滑过骰排可批量选中；注意带「命定」角标的骰子本轮必须保留参加结算。',
        }
      : {
          target: 'actions',
          step: '3 / 3',
          title: '重投 · 确认使用 & 轮间补给',
          text: `选好要刷新的骰子点右侧「重投」(剩余 ${me.rerolls})，确认选够 ${legal.requiredDice || '任意'} 颗骰后点绿色「确认」；每轮结算后会发 1 点补给买永久成长！`,
        };

  const renderClashShowcase = () => {
    const key = `clash-${state.round}-${state.phase}`;
    if (state.mode === 'raid' || state.mode === 'overlord') {
      const heroResults = state.results.filter(r => state.players.find(p => p.id === r.playerId)?.role !== 'boss');
      const totalHeroDamage = heroResults.reduce((sum, r) => sum + Math.max(0, r.damage), 0);
      const interrupted = state.log.some(e => e.round === state.round && e.text.includes('爆发被全队打断'));
      const moveLabel = moveInfo[state.bossMove]?.name || '首领行动';
      const movePreset: VfxPreset = interrupted
        ? 'shield-cyan'
        : state.bossMove === 'eruption'
          ? 'heavy-crimson'
          : state.bossMove === 'drain'
            ? 'counter-violet'
            : 'slash-gold';
      return (
        <div className={`party-clash-stage ${interrupted ? 'is-interrupted' : `move-${state.bossMove}`}`} key={key}>
          {!reducedMotion && (
            <svg className="party-clash-svg" viewBox="0 0 600 110" preserveAspectRatio="none" aria-hidden="true">
              {interrupted
                ? <path className="clash-arc shield" d="M 120 82 Q 300 20 480 82"/>
                : <>
                    <path className="clash-arc main" d="M 35 88 Q 290 12 565 68"/>
                    <path className="clash-arc twin" d="M 65 22 Q 310 98 545 32"/>
                  </>}
            </svg>
          )}
          <VfxParticles preset={movePreset} count={interrupted ? 12 : 16} spread={85} x={84} y={48} reducedMotion={reducedMotion}/>
          <div className="party-clash-main">
            <span className="party-clash-tag">{interrupted ? '⚡ 蓄力击破 · 爆发打断' : `首领招式揭晓 · ${moveLabel}`}</span>
            <strong>{interrupted ? `${moveLabel}被打断，队伍危机 -1` : `讨伐队本轮累计造成 ${totalHeroDamage} 点伤害`}</strong>
            <small>{state.bossHp <= 0 ? '首领已被击破！' : `首领剩余生命 ${state.bossHp} / ${state.bossMaxHp} · 危机 ${state.crisis} / ${state.maxCrisis}`}</small>
          </div>
          <div className="party-clash-badges">
            {state.targets.map(t => (
              <span key={t.id} className={`party-clash-pill ${t.broken ? 'is-broken' : ''}`}>
                {t.name} {t.broken ? '已击破' : `${t.hp}/${t.maxHp}`}
              </span>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className={`party-clash-stage mode-${state.mode}`} key={key}>
        <VfxParticles preset={state.mode === 'treasure' ? 'slash-gold' : 'counter-violet'} count={12} spread={74} x={86} y={46} reducedMotion={reducedMotion}/>
        <div className="party-clash-main">
          <span className="party-clash-tag">{state.mode === 'treasure' ? '✦ 宝库星核揭晓' : '⚔ 竞技场交锋结算'}</span>
          <div className="party-vault-winners">
            {state.targets.map(t => {
              const contenders = state.results.filter(r => r.targetId === t.id);
              const best = contenders.length ? Math.max(...contenders.map(r => r.score)) : 0;
              const winnerNames = state.mode === 'treasure'
                ? contenders.filter(r => r.score === best && r.score > 2).map(r => state.players.find(p => p.id === r.playerId)?.name || '').filter(Boolean)
                : [...new Set(contenders.filter(r => r.score === best).map(r => teamName(state, state.players.find(p => p.id === r.playerId)?.teamId || '')))];
              return (
                <div key={t.id} className="party-vault-card">
                  <span>{targetIcon(t.kind)}{t.name}</span>
                  <b>{winnerNames.join('、') || (contenders.length ? '已完成' : '无人前往')}</b>
                  <small>{best > 0 ? `最高 +${best} 分` : `悬赏 ${t.reward} 分`}</small>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const bossCardHpPct = percent(state.bossHp, state.bossMaxHp);
  const myHpPct = percent(me.hp, me.maxHp);
  const myGhostPct = Math.max(myHpPct, playerGhostPct[me.id] ?? myHpPct);

  const bottomInstruction = busy
    ? '正在提交操作…'
    : armedPoolDie
      ? `已选池骰 ${armedPoolDie.value} 点 · 请点击下方手里非「命定」骰完成交换，或再点池骰取消`
      : me.confirmed
        ? `已提交本轮计划 · 等待其余玩家确认 (${allReady}/${state.players.length})`
        : resultsPhase
          ? (me.supplies > 0 ? `你有 ${me.supplies} 点补给可购买下方强化，买完点「准备下一轮」` : `已准备 ${allReady}/${state.players.length} · 点击准备进入下一轮`)
          : finished
            ? '对局已结束'
            : legal.reason
              ? legal.reason
              : me.plan.stance === 'support'
                ? `援护模式 · 将支援 ${state.players.find(p => p.id === me.plan.supportPlayerId)?.name || '队友'}，点击右侧骰盘选骰并确认`
                : `点击或按住空白桌面滑选骰子 · 选够 ${legal.requiredDice || '任意'} 颗后点击绿钮确认`;

  return (
    <section
      ref={table}
      data-coach-active={planning && coachStep !== null ? coachContent?.target : undefined}
      className={`battle-page party-table-page mode-${state.mode} role-${myRole} ${planning ? 'phase-planning' : `phase-${state.phase}`}`}
    >
      <div className="battle-topbar party-table-topbar" data-sweep-ignore="true">
        <button className="back-button" onClick={() => (finished ? onExit() : setDialog('exit'))}>
          <ArrowLeft size={18}/>返回
        </button>
        <div className="party-topbar-meta">
          <strong>{mode.name}</strong>
          <button
            type="button"
            className={`party-rule-badge ${ruleOpen ? 'active' : ''}`}
            onClick={() => setRuleOpen(v => !v)}
            title={state.roundRule.description}
          >
            <Sparkles size={11}/>
            <span>{state.roundRule.name}</span>
          </button>
          {(state.mode === 'raid' || state.mode === 'overlord')
            ? <span className="party-meta-stat">首领 <b>{state.bossHp}</b>/{state.bossMaxHp} · 危机 <b>{state.crisis}</b>/{state.maxCrisis}</span>
            : <span className="party-meta-stat">第 <b>{myRank}</b> 名 · <b>{me.score}</b> 分</span>}
          <span className="party-meta-stat">{planning ? '确认' : '准备'} <b>{allReady}</b>/{state.players.length}</span>
        </div>
        <div className="party-topbar-actions">
          <button className="icon-button" title="牌桌新手引导" onClick={restartCoach}><Sparkles size={18}/></button>
          <button className="icon-button" title="模式与操作说明" onClick={() => setDialog('rules')}><CircleHelp size={18}/></button>
          <button className="icon-button" title="战局记录" onClick={() => setDialog('log')}><List size={18}/></button>
        </div>
      </div>

      {ruleOpen && (
        <div className="weather-popover party-rule-popover" data-sweep-ignore="true">
          <strong>本轮规则：{state.roundRule.name}</strong>
          <p>{state.roundRule.description}</p>
          {myPrismDef && <button type="button" className="text-button" onClick={() => { setRuleOpen(false); setDialog('prismatic'); }}>查看我的曜彩骰面</button>}
        </div>
      )}

      {planning && coachContent && (
        <div className="party-coach-bar" data-sweep-ignore="true">
          <span className="party-coach-badge"><Sparkles size={13}/>{coachContent.step}</span>
          <div className="party-coach-copy">
            <strong>{coachContent.title}</strong>
            <span>{coachContent.text}</span>
          </div>
          <div className="party-coach-btns">
            <button className="text-button" onClick={dismissCoach}>跳过</button>
            {coachStep !== null && coachStep < 2
              ? <button className="primary compact" onClick={() => setCoachStep((coachStep + 1) as 1 | 2)}>下一步</button>
              : <button className="primary compact" onClick={dismissCoach}>开始实战</button>}
          </div>
        </div>
      )}

      <div className="arena-layout party-arena-layout">
        <aside className="round-rail party-roster-rail" data-sweep-ignore="true">
          <div className="party-rail-header">
            <div className="party-round-chip">
              <span>✦</span>
              <small>轮次</small>
              <b>{state.round}/{state.maxRounds}</b>
            </div>
            {(state.mode === 'raid' || state.mode === 'overlord') && (
              <div className="party-crisis-gauge" title={`当前危机 ${state.crisis} / 上限 ${state.maxCrisis}`}>
                <small>阶段 {state.bossPhase} · 危机 {state.crisis}/{state.maxCrisis}</small>
                <div className="party-crisis-track"><i style={{ width: `${percent(state.crisis, state.maxCrisis)}%` }}/></div>
              </div>
            )}
          </div>
          <div className="party-seat-strip" data-seat-count={state.players.length}>
            {state.players.map(p => {
              const pCard = state.catalog.cards.find(c => c.id === p.cardId);
              const isMe = p.id === me.id;
              const sameTeamAlly = !isMe && p.teamId === me.teamId && p.role !== 'boss';
              const canAssignSupport = canPlan && me.plan.stance === 'support' && sameTeamAlly;
              const isSupported = me.plan.stance === 'support' && me.plan.supportPlayerId === p.id;
              const hpPct = percent(p.hp, p.maxHp);
              return (
                <div
                  key={p.id}
                  className={`party-seat-tile ${isMe ? 'is-me' : ''} ${p.role === 'boss' ? 'is-boss' : ''} ${p.confirmed ? 'is-confirmed' : ''} ${isSupported ? 'is-supported' : ''} ${canAssignSupport ? 'is-support-pickable' : ''}`}
                >
                  <button
                    type="button"
                    className="party-seat-main"
                    title={canAssignSupport ? `点击指定援护 ${p.name}` : `点击查看 ${p.name} 详情`}
                    onClick={() => {
                      if (canAssignSupport) {
                        plan({ stance: 'support', supportPlayerId: p.id });
                      } else {
                        setInspectId(p.id);
                      }
                    }}
                  >
                    <img src={asset(pCard?.image)} alt={pCard?.name || p.name}/>
                    <div className="party-seat-info">
                      <div className="party-seat-name">
                        <strong>{p.name}{isMe ? ' · 你' : ''}</strong>
                        {p.confirmed && <Check size={12} className="seat-check"/>}
                      </div>
                      <div className="party-seat-bar">
                        <i style={{ width: `${hpPct}%` }}/>
                        <span>{p.hp}/{p.maxHp}</span>
                      </div>
                      <small className="party-seat-sub">
                        {isSupported
                          ? '★ 援护中'
                          : p.role === 'boss'
                            ? `首领 · 备战${p.confirmed ? '✓' : ''}`
                            : `${teamName(state, p.teamId)} · ${p.score}分${state.mode !== 'treasure' && sameTeamAlly ? ` · ${stanceOptions[p.plan.stance].name}` : ''}`}
                      </small>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="party-seat-inspect"
                    aria-label={`查看 ${p.name} 卡牌信息`}
                    title="查看角色技能与状态"
                    onClick={() => setInspectId(p.id)}
                  >
                    <Info size={12}/>
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <div className="arena-frame">
          <div className="arena-inner party-arena-inner">
            {/* Top Objective / Boss Telegraph Zone */}
            <div className="party-stage-zone" data-sweep-ignore="true" data-party-coach="stage">
              {(state.mode === 'raid' || state.mode === 'overlord') && (
                <div className="party-boss-strip">
                  <div className="party-boss-identity">
                    <Crown size={15}/>
                    <div>
                      <strong>{state.bossPlayerId ? (state.players.find(p => p.id === state.bossPlayerId)?.name || '玩家首领') : '裂界首领'}</strong>
                      <small>{me.role === 'boss' ? '你扮演首领 · 选择本轮秘密招式' : `预告：${state.bossTelegraph}`}</small>
                    </div>
                  </div>
                  <div className="party-boss-bar">
                    <div className="hp-track">
                      <div className="hp-ghost" style={{ width: `${Math.max(bossCardHpPct, bossGhostPct)}%` }}/>
                      <div className="hp-fill" style={{ width: `${bossCardHpPct}%` }}/>
                      <span><Heart size={11} fill="currentColor"/>{state.bossHp} / {state.bossMaxHp}</span>
                    </div>
                  </div>
                </div>
              )}

              {me.role === 'boss' ? (
                <div className={`party-target-row boss-moves count-${Math.min(state.bossMoves.length, 4)}`}>
                  {state.bossMoves.map(m => {
                    const chosen = state.bossMove === m;
                    return (
                      <button
                        key={m}
                        disabled={disabled}
                        className={`party-stage-card ${chosen ? 'active' : ''}`}
                        onClick={() => command({ type: 'bossMove', playerId, move: m })}
                      >
                        <div className="party-stage-head">
                          {moveInfo[m].icon}
                          <strong>{moveInfo[m].name}</strong>
                          <span className="party-stage-tag">{chosen ? '已选招式' : '点击选用'}</span>
                        </div>
                        <small>{moveInfo[m].hint}</small>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className={`party-target-row count-${Math.min(state.targets.length, 4)}`}>
                  {state.targets.map(t => {
                    const active = me.plan.targetId === t.id && (state.mode === 'treasure' || state.mode === 'duos' || me.plan.stance === 'assault');
                    const lockedSwitch = !canPlan || t.broken || (roleLocked && targetWouldFlipRole(t));
                    const targeters = state.players.filter(p => p.role !== 'boss' && p.plan.targetId === t.id && p.plan.stance !== 'support');
                    const hpPct = percent(t.hp, t.maxHp);
                    return (
                      <button
                        key={t.id}
                        disabled={lockedSwitch}
                        title={roleLocked && targetWouldFlipRole(t) ? '已重投/换骰/曜彩后不可切换攻守姿态' : t.description}
                        className={`party-stage-card ${active ? 'active' : ''} ${t.broken ? 'broken' : ''}`}
                        onClick={() => {
                          if (state.mode === 'treasure') plan({ targetId: t.id, stance: t.id === 'bastion' ? 'guard' : 'assault' });
                          else if (state.mode === 'duos') plan({ targetId: t.id });
                          else plan({ targetId: t.id, stance: 'assault' });
                        }}
                      >
                        <div className="party-stage-head">
                          {targetIcon(t.kind)}
                          <strong>{t.name}</strong>
                          <span className="party-stage-tag">
                            {t.broken ? '已击破' : state.mode === 'treasure' ? `悬赏 ${t.reward}${state.roundRule.kind === 'bounty' ? '+2' : ''}★` : t.kind === 'arena' ? `难度 ${t.difficulty}` : `${t.hp}/${t.maxHp}`}
                          </span>
                        </div>
                        {t.maxHp > 0 && t.maxHp < 900 && (
                          <div className="party-target-meter">
                            <i className="ghost" style={{ width: `${Math.max(hpPct, targetGhostPct[t.id] ?? hpPct)}%` }}/>
                            <i className="fill" style={{ width: `${hpPct}%` }}/>
                          </div>
                        )}
                        <small>{t.description}</small>
                        {state.mode !== 'treasure' && targeters.length > 0 && (
                          <div className="party-targeters">
                            {targeters.slice(0, 3).map(p => <em key={p.id}>{p.name}</em>)}
                            {targeters.length > 3 && <em>+{targeters.length - 3}人</em>}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Central Phase Line + Stance Selector */}
            <div className="phase-line party-phase-line" data-sweep-ignore="true">
              <div className="party-phase-side left">
                {me.role !== 'boss' && state.mode !== 'treasure' ? (
                  <div className="party-stance-pills" role="group" aria-label="本轮姿态">
                    {(['assault', 'guard', 'support'] as PartyStance[]).map(st => {
                      const info = stanceOptions[st];
                      const supportBlocked = st === 'support' && supportPlayers.length === 0;
                      const flipLocked = roleLocked && stanceWouldFlipRole(st);
                      return (
                        <button
                          key={st}
                          className={me.plan.stance === st ? 'active' : ''}
                          disabled={!canPlan || supportBlocked || flipLocked}
                          title={flipLocked ? '已重投/换骰/曜彩，不可切攻守（仍可切换同姿态具体动作）' : info.hint}
                          onClick={() => setStance(st)}
                        >
                          {info.icon}
                          <span>{info.name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : <span className="line"/>}
              </div>

              <div className="phase-announcement" key={`${state.round}-${me.plan.stance}-${me.plan.targetId}-${me.confirmed}`}>
                <span>ROUND {String(state.round).padStart(2, '0')}</span>
                <b>
                  {me.confirmed
                    ? '等待全员确认'
                    : me.role === 'boss'
                      ? `首领 · ${moveInfo[state.bossMove].name}`
                      : `${stanceOptions[me.plan.stance].name} · ${selectedTarget?.name || '行动中'}`}
                </b>
              </div>

              <div className="party-phase-side right">
                <span className="line"/>
                {me.role !== 'boss' && me.plan.stance === 'support' && supportPlayers.length > 0 && (
                  <span className="party-support-badge">
                    援护：{state.players.find(p => p.id === me.plan.supportPlayerId)?.name || '请点选同队头像'}
                  </span>
                )}
              </div>
            </div>

            {/* Shared Swap Pool */}
            {teamPool.length > 0 && (
              <div className="party-mid-zone" data-sweep-ignore="true">
                <div className={`swap-zone party-swap-zone ${armedPoolDie ? 'is-armed' : ''}`} data-party-coach="pool">
                  <div className="swap-label">
                    <span><Shuffle size={12}/> 团队共享换骰池</span>
                    {me.exchangedThisRound
                      ? <small>本轮已换骰一次</small>
                      : armedPoolDie
                        ? <small className="armed-tip">已选中池骰 {armedPoolDie.value} 点 · 点下方手牌中非「命定」骰完成交换 <button type="button" className="mini-cancel" onClick={() => { setArmedPoolDieId(null); setSwapWarning(''); }}>取消</button></small>
                        : <small>点击池骰后，再点手里任意非命定骰立即换手（不锁定队友）</small>}
                  </div>
                  <DiceTray
                    dice={teamPool}
                    compact
                    pool
                    animateNewDice={false}
                    selected={armedPoolDieId ? [armedPoolDieId] : []}
                    disabled={disabled || !legal.canPoolSwap}
                    onSelect={handlePoolDieClick}
                    reducedMotion={reducedMotion}
                    lowQuality={lowQuality}
                  />
                </div>
              </div>
            )}

            {/* Bottom Friendly Hand & 3D Dice Tray */}
            <div className="friendly-zone party-friendly-zone" data-party-coach="dice">
              <div className="power-display">
                {myRole === 'attack' ? <Swords/> : <Shield/>}
                <strong key={`${preview.value}-${preview.objectiveValue}`}>
                  {me.plan.targetId === 'puzzle' ? preview.objectiveValue : preview.value}
                </strong>
                <span>
                  {swapWarning
                    ? <em className="swap-warning">{swapWarning}</em>
                    : armedPoolDie
                      ? `交换待命中：点击手里非「命定」骰换回 ${dieBrief(armedPoolDie)}`
                      : preview.effects.slice(0, 3).join(' · ') || preview.objectiveHint}
                </span>
              </div>

              <div className={`player-dice-position ${me.confirmed ? 'committed' : ''} ${armedPoolDie ? 'swap-picking' : ''}`}>
                <DiceTray
                  dice={me.dice}
                  selected={me.selectedIds}
                  onSelect={handleOwnDieClick}
                  selectionSurface={armedPoolDieId || dialog || inspectId || ruleOpen ? undefined : table}
                  onSelectionChange={armedPoolDieId || !canSelect || dialog || inspectId || ruleOpen ? undefined : selectIds}
                  disabled={!canSelect && !(armedPoolDieId && legal.canPoolSwap)}
                  animateNewDice
                  rollEventKey={rollKey}
                  rollingIds={rollingDiceIds}
                  reducedMotion={reducedMotion}
                  lowQuality={lowQuality}
                />
                {prismBurstKey > 0 && (
                  <VfxParticles key={`prism-${prismBurstKey}`} preset="prism-rainbow" count={16} spread={88} x={50} y={48} reducedMotion={reducedMotion}/>
                )}
              </div>

              <div className="player-hud party-my-hud">
                <button className="hud-portrait" onClick={() => setInspectId(me.id)} title="查看我的角色技能与曜彩骰">
                  <img src={asset(card?.image)} alt={card?.name}/>
                  <span>{me.gild ? '✦'.repeat(me.gild) : '★'}</span>
                </button>
                <div className="hud-info">
                  <div className="hud-name">
                    <strong>{card?.name || me.name}</strong>
                    <small>{me.role === 'boss' ? '首领' : teamName(state, me.teamId)} · 得分 {me.score} · 补给 {me.supplies}</small>
                    {me.confirmed && <Check size={15}/>}
                  </div>
                  <div className="hp-track">
                    <div className="hp-ghost" style={{ width: `${myGhostPct}%` }}/>
                    <div className="hp-fill" style={{ width: `${myHpPct}%` }}/>
                    <span><Heart size={12} fill="currentColor"/>{me.hp}<small> / {me.maxHp}</small></span>
                  </div>
                  <div className="hud-levels">
                    <span><Swords size={12}/>{me.attackLevel || '∞'}</span>
                    <span><Shield size={12}/>{me.defenseLevel}</span>
                    <span>{stanceOptions[me.plan.stance].name}</span>
                    <StatusBadges statuses={me.statuses} upgrades={me.upgrades}/>
                  </div>
                </div>
                <div className="hud-power">
                  {myRole === 'attack' ? <Swords size={16}/> : <Shield size={16}/>}
                  <b>{preview.value}</b>
                </div>
              </div>
            </div>

            {/* Phase 2: Round Results + Upgrades Modal Overlay inside Frame */}
            {resultsPhase && (
              <div className="party-results-overlay" data-sweep-ignore="true">
                {renderClashShowcase()}
                <div className="party-results-columns">
                  <div className="party-results-list">
                    <h4>第 {state.round} 轮战报 · 准备 {allReady}/{state.players.length}</h4>
                    <div className="party-results-scroll">
                      {state.results.map(r => {
                        const rp = state.players.find(p => p.id === r.playerId);
                        return (
                          <div key={`${r.playerId}-${r.targetId}`} className={`party-result-row ${r.playerId === playerId ? 'is-me' : ''}`}>
                            <strong>{rp?.name}</strong>
                            <span>{r.text}</span>
                            <b>+{r.score}分</b>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="party-results-upgrades">
                    <div className="party-upgrade-head">
                      <h4><Sparkles size={15}/>轮间补给成长</h4>
                      <span className={me.supplies > 0 && !me.upgradedThisRound ? 'supply-hot' : ''}>
                        可用补给 <b>{me.supplies}</b>
                      </span>
                    </div>
                    {me.supplies > 0 && !me.upgradedThisRound && !me.ready && (
                      <p className="party-upgrade-tip">你本轮获得了 1 点补给！点击以下卡片永久强化角色：</p>
                    )}
                    <div className="party-upgrade-grid">
                      {(['power', 'ward', 'fortune'] as PartyUpgrade[]).map(key => {
                        const u = upgradeInfo[key];
                        const level = me.upgrades[key];
                        const canBuy = !busy && legal.canUpgrade && level < 3;
                        return (
                          <button
                            key={key}
                            className={`party-upgrade-card ${upgradeBurst === key ? 'is-upgraded' : ''}`}
                            disabled={!canBuy}
                            onClick={() => command({ type: 'upgrade', playerId, upgrade: key })}
                          >
                            <div className="party-upgrade-top">
                              {u.icon}
                              <strong>{u.name}</strong>
                              <span>Lv.{level}/3</span>
                            </div>
                            <small>{u.hint}</small>
                            {upgradeBurst === key && <VfxParticles preset="heal-aurora" count={12} spread={70} x={50} y={40} reducedMotion={reducedMotion}/>}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      className="primary full party-ready-btn"
                      disabled={busy || !legal.canReady}
                      onClick={() => command({ type: 'ready', playerId })}
                    >
                      {me.ready ? <><CheckCheck size={17}/>已就绪，等待其他玩家 ({allReady}/{state.players.length})</> : <>准备第 {state.round + 1} 轮<Check size={17}/></>}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="action-rail party-action-rail" data-sweep-ignore="true" data-party-coach="actions">
          <button className={`weather-button ${ruleOpen ? 'active' : ''}`} onClick={() => setRuleOpen(v => !v)}>
            <Sparkles size={22}/>
            <span>{state.roundRule.name}</span>
            <ChevronDown size={12}/>
          </button>
          <div className="rail-spacer"/>
          <button
            className="prismatic-action"
            title={prism ? `${prism.name}（点击投掷曜彩骰）` : '当前角色无曜彩骰'}
            disabled={disabled || !legal.canPrismatic}
            onClick={() => command({ type: 'prismatic', playerId })}
          >
            <span className="round-action-icon prism">
              {diceById[me.prismaticId || '']?.image ? <img src={asset(diceById[me.prismaticId!].image)} alt=""/> : <Gem size={26}/>}
            </span>
            <strong>{prism?.name || '曜彩骰'}</strong>
            <small>剩余 {me.prismaticUses} 次</small>
          </button>
          <button
            className="reroll-action"
            title="重投当前蓝框选中的骰子"
            disabled={disabled || !legal.canReroll || !selectedIds.length}
            onClick={() => command({ type: 'reroll', playerId, diceIds: [...selectedIds] })}
          >
            <span className="round-action-icon">
              <RotateCcw size={25}/>
              <span className="action-count">{me.rerolls}</span>
            </span>
            <strong>重投</strong>
            <small>{selectedIds.length ? `重投选中 ${selectedIds.length} 颗` : '先选要重投的骰'}</small>
          </button>
          <button
            className="confirm-action"
            title="提交当前选中的骰子与计划"
            disabled={disabled || !legal.canConfirm}
            onClick={() => command({ type: 'confirm', playerId, diceIds: [...selectedIds] })}
          >
            <span className="round-action-icon"><Check size={32}/></span>
            <strong>{me.confirmed ? '已确认' : '确认计划'}</strong>
            <small>{selectedIds.length} / {legal.requiredDice || '∞'}</small>
          </button>
        </aside>
      </div>

      <div className="battle-bottom" data-sweep-ignore="true">
        <span className="battle-instruction">{bottomInstruction}</span>
        <span className="last-event">{state.log.at(-1)?.text}</span>
      </div>

      {finished && (
        <div className="result-overlay party-finished-overlay">
          <span className="result-eyebrow">COSMICON PARTY</span>
          <div className="result-emblem">{won ? '✦' : '◇'}</div>
          <h1>{won ? '派对胜利' : '对局结束'}</h1>
          <p>{state.reason || `${mode.name} · 共进行了 ${state.round} 轮`}</p>
          <div className="party-finish-boards">
            <div className="result-stats">
              {teams.slice(0, 4).map((t, i) => (
                <span key={t.id}>
                  {i === 0 ? '★ ' : ''}{teamName(state, t.id)}
                  <b>{t.score}</b>
                </span>
              ))}
            </div>
            <div className="party-finish-ranks">
              {rankedPlayers.map((p, i) => (
                <span key={p.id} className={p.id === playerId ? 'is-me' : ''}>
                  #{i + 1} {p.name} · {p.score}分 (伤害 {p.contribution})
                </span>
              ))}
            </div>
          </div>
          <button className="primary" onClick={onExit}>返回房间</button>
          <button className="text-button" onClick={() => setDialog('log')}>查看战局记录</button>
        </div>
      )}

      {dialog === 'rules' && (
        <Modal title={`${mode.name} · 牌桌规则`} onClose={() => setDialog(null)}>
          <div className="prose">
            <p className="muted">{mode.subtitle}</p>
            {mode.rules.map(r => <p key={r}>{r}</p>)}
            {(state.mode === 'raid' || state.mode === 'overlord') && (
              <>
                <h3>首领招式说明</h3>
                {Object.entries(moveInfo).map(([k, v]) => <p key={k}><strong>{v.name}：</strong>{v.hint}</p>)}
              </>
            )}
            <div className="modal-actions">
              <button className="secondary" onClick={() => { setDialog(null); restartCoach(); }}>重看牌桌指引</button>
              <button className="primary" onClick={() => setDialog(null)}>返回牌桌</button>
            </div>
          </div>
        </Modal>
      )}

      {dialog === 'log' && (
        <Modal title="战局记录" onClose={() => setDialog(null)}>
          <div className="battle-log">
            {state.log.slice().reverse().map(e => (
              <p key={e.id}><small>R{e.round}</small><span>{e.text}</span></p>
            ))}
          </div>
        </Modal>
      )}

      {dialog === 'prismatic' && myPrismDef && (
        <Modal title={myPrismDef.name} onClose={() => setDialog(null)}>
          <DiceDetails die={myPrismDef} card={myCardDef}/>
        </Modal>
      )}

      {dialog === 'exit' && (
        <Modal title="返回房间" onClose={() => setDialog(null)}>
          <div className="prose">
            <p>确认暂时离开当前牌桌吗？你的对局进度会保留在房间/本地存档中。</p>
          </div>
          <div className="modal-actions">
            <button className="secondary" onClick={() => setDialog(null)}>留在牌桌</button>
            <button className="primary" onClick={() => { setDialog(null); onExit(); }}>离开牌桌</button>
          </div>
        </Modal>
      )}

      {inspectedPlayer && inspectedCard && (
        <Modal title={`${inspectedCard.name} · ${inspectedPlayer.name}`} onClose={() => setInspectId(null)}>
          <div className="prose">
            <p>{cleanText(inspectedSource?.description || inspectedCard.description || '')}</p>
            {inspectedSource && <CharacterDetails card={inspectedSource}/>}
            <StatusBadges statuses={inspectedPlayer.statuses} upgrades={inspectedPlayer.upgrades}/>
            {inspectedPlayer.id === me.id && myPrismDef && (
              <>
                <h3>携带曜彩骰</h3>
                <DiceDetails die={myPrismDef} card={myCardDef}/>
              </>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
