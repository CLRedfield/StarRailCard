import { getLegalActions, getPlayerPreview } from '../game';
import type { BattleResolution, GameState } from '../game';

export interface TutorialResult {
  turn: number;
  attack: number;
  defense: number;
  damage: number;
  extraDamage: number;
}
export interface TutorialProgress {
  version: 1;
  status: 'active' | 'skipped' | 'completed';
  introSeen: boolean;
  rerolled: boolean;
  attackConfirmed: boolean;
  defenseConfirmed: boolean;
  attackResult?: TutorialResult;
  defenseResult?: TutorialResult;
  attackExplained: boolean;
  defenseExplained: boolean;
}
export type TutorialStepId = 'intro' | 'reroll-select' | 'reroll' | 'attack-select' | 'attack-confirm' | 'attack-wait' | 'attack-result' | 'defense-select' | 'defense-confirm' | 'defense-wait' | 'defense-result' | 'complete' | 'inactive';
export interface TutorialStep {
  id: TutorialStepId;
  title: string;
  text: string;
  hint: string;
  number: number;
  target: 'none' | 'dice' | 'reroll' | 'confirm' | 'values';
  button?: string;
  pauseOpponent: boolean;
}

function resultFor(resolution: BattleResolution, playerId: string): TutorialResult | undefined {
  const strike = resolution.strikes.find(s => s.kind === 'attack' && (s.attackerId === playerId || s.defenderId === playerId));
  if (!strike) return undefined;
  const targetId = strike.defenderId;
  const extraDamage = (resolution.events || []).filter(e => e.type === 'damage' && e.targetId === targetId && e.id !== strike.eventId).reduce((sum, e) => sum + (e.amount || 0), 0);
  return { turn: resolution.turn, attack: strike.attack, defense: strike.defense, damage: strike.amount, extraDamage };
}

/** Match-local learning state; never changes dice, money, AI or battle rules. */
export function createTutorialProgress(state: GameState, playerId: string): TutorialProgress {
  return updateTutorialProgress(state, playerId, { version: 1, status: 'active', introSeen: false, rerolled: false, attackConfirmed: false, defenseConfirmed: false, attackExplained: false, defenseExplained: false });
}

/** Only accepted engine results count as completed actions; a pending click cannot advance a lesson. */
export function updateTutorialProgress(state: GameState, playerId: string, progress: TutorialProgress): TutorialProgress {
  if (progress.status !== 'active') return progress;
  const player = state.players.find(p => p.id === playerId);
  if (!player) return progress;
  const next = { ...progress };
  next.rerolled ||= state.log.some(e => e.playerId === playerId && e.type === 'reroll');
  if (player.rollLocked || player.confirmed) {
    if (state.attackingSide === player.side) next.attackConfirmed = true;
    else next.defenseConfirmed = true;
  }
  const resolution = state.lastResolution;
  if (resolution) {
    const result = resultFor(resolution, playerId);
    if (result) {
      if (resolution.attackingSide === player.side) { next.attackConfirmed = true; next.attackResult ||= result; }
      else { next.defenseConfirmed = true; next.defenseResult ||= result; }
    }
  }
  // Old saves may predate the lesson. Continue at the current role instead of asking
  // the player to repeat a turn that has already been resolved.
  if (state.turn > 1 && player.side === 0) next.attackConfirmed = true;
  if (state.turn > 2 && player.side === 0) next.defenseConfirmed = true;
  return JSON.stringify(next) === JSON.stringify(progress) ? progress : next;
}

export function skipTutorial(progress: TutorialProgress): TutorialProgress { return { ...progress, status: 'skipped' }; }
export function restartTutorial(state: GameState, playerId: string): TutorialProgress { return createTutorialProgress(state, playerId); }

export function getPrismaticLesson(state: GameState, playerId: string): string {
  const player = state.players.find(p => p.id === playerId);
  if (!player?.prismaticId) return '这张入门卡没有曜彩骰；后续解锁对应角色与曜彩骰，再体验特殊骰面。';
  const die = state.catalog.prismatics.find(d => d.id === player.prismaticId);
  if (!player.prismaticUses) return '当前曜彩骰没有可用次数；普通骰就能完成对局，无需购买或消耗养成资金。';
  const condition = die?.description?.replace(/<[^>]*>/g, '').trim() || (die?.condition === 'Attack' ? '仅进攻时可用' : die?.condition === 'Defense' ? '仅防守时可用' : '按骰子条件使用');
  return `${die?.name || '曜彩骰'}：${condition}，本局剩 ${player.prismaticUses} 次。可用时按钮会亮起；特殊骰面需选中参与结算才生效。`;
}

export function getTutorialStep(state: GameState, playerId: string, saved: TutorialProgress): TutorialStep {
  const progress = updateTutorialProgress(state, playerId, saved);
  const player = state.players.find(p => p.id === playerId);
  const base = { hint: '', target: 'none' as TutorialStep['target'], pauseOpponent: false };
  if (progress.status !== 'active' || !player || state.mode !== 'classic') return { ...base, id: 'inactive', title: '新手教学', text: '', number: 0 };
  const legal = getLegalActions(state, playerId);
  const preview = getPlayerPreview(state, playerId);
  const count = player.selectedIds.length;
  const required = legal.requiredDice ? `${legal.requiredDice} 颗` : '至少 1 颗';
  const selectionHint = `已选 ${count} / ${legal.requiredDice || '不限'} · 当前${state.attackingSide === player.side ? '攻击' : '防御'}值 ${preview.value}`;
  if (!progress.introSeen) return { ...base, id: 'intro', number: 1, title: '先认清攻防', text: '下方是你，上方是对手。通常以攻击值减防御值扣血；生命归零即落败。', hint: `本卡进攻选 ${player.attackLevel || '任意数量'} 颗，防守选 ${player.defenseLevel} 颗。教学和对局不消耗资金。`, target: 'values', button: '开始选骰', pauseOpponent: true };
  const attackResult = progress.attackResult;
  if (attackResult && !progress.attackExplained) return { ...base, id: 'attack-result', number: 5, title: '看懂这次结算', text: `本次 ${attackResult.attack} 攻 / ${attackResult.defense} 防，普通攻击实际扣血 ${attackResult.damage}。${attackResult.extraDamage ? `另有 ${attackResult.extraDamage} 点伤害，来源见对局记录。` : attackResult.damage === 0 ? '防住了，普通攻击没有扣血。' : '技能、穿透等效果会影响最终伤害。'}`, hint: '每次攻防结算后交换进攻与防守。', target: 'values', button: state.phase === 'finished' ? '明白了' : '学习防守', pauseOpponent: true };
  const defenseResult = progress.defenseResult;
  if (defenseResult && !progress.defenseExplained) return { ...base, id: 'defense-result', number: 7, title: '你已完成一次防守', text: `对手 ${defenseResult.attack} 攻 / 你 ${defenseResult.defense} 防，普通攻击实际扣血 ${defenseResult.damage}。${defenseResult.extraDamage ? `另有 ${defenseResult.extraDamage} 点伤害，可展开记录查看。` : '防御越高，通常受到的伤害越少。'}`, hint: '之后继续交替攻防；点击头像可随时查看角色技能。', target: 'values', button: '查看要点', pauseOpponent: true };
  if (state.phase === 'finished' || progress.attackConfirmed && progress.defenseConfirmed) return { ...base, id: 'complete', number: 8, title: progress.attackConfirmed && progress.defenseConfirmed ? '基础操作已掌握' : '本局教学告一段落', text: '选骰 → 按需重投 → 按数量确认 → 交替攻防。可随时回到第一关重新学习。', hint: getPrismaticLesson(state, playerId), button: state.phase === 'finished' ? '收起教学' : '继续对局' };
  if (!progress.attackConfirmed && state.attackingSide === player.side && legal.canSelect) {
    if (!progress.rerolled && legal.canReroll) {
      if (!count) return { ...base, id: 'reroll-select', number: 2, title: '先选一颗，试试重投', text: '点击一颗想更换点数的骰子。也可从牌桌空白处按住，再滑过骰子批量选择。', hint: '选中带蓝色边框；再次点击可取消。', target: 'dice' };
      return { ...base, id: 'reroll', number: 3, title: `重投选中的 ${count} 颗`, text: '点击「重投」，只有选中的骰子会重新掷出；未选中的保留点数。', hint: `本轮还可重投 ${player.rerolls} 次，点数满意也可直接确认。`, target: 'reroll' };
    }
    return { ...base, id: legal.canConfirm ? 'attack-confirm' : 'attack-select', number: 4, title: legal.canConfirm ? '确认这次进攻' : `为进攻选好 ${required}`, text: legal.canConfirm ? '看看中央攻击值与角色技能，满意后点击「确认使用」。' : `重新选好本回合使用的 ${required}骰子；多选了就再点一下取消。`, hint: selectionHint, target: legal.canConfirm ? 'confirm' : 'dice' };
  }
  if (!progress.defenseConfirmed && state.attackingSide !== player.side && legal.canSelect) return { ...base, id: legal.canConfirm ? 'defense-confirm' : 'defense-select', number: 6, title: legal.canConfirm ? '确认你的防守' : `现在防守：选 ${required}`, text: legal.canConfirm ? '比较对手攻击值与自己的防御值，再点击「确认使用」。' : `点击骰子组成防御。${player.rerolls > 0 ? `本轮可重投 ${player.rerolls} 次。` : '普通防守默认不能重投，角色与天气可能例外。'}`, hint: selectionHint, target: legal.canConfirm ? 'confirm' : 'dice' };
  return { ...base, id: progress.attackConfirmed ? 'defense-wait' : 'attack-wait', number: progress.attackConfirmed ? 6 : 5, title: '等待对手与结算', text: '对手确认后会展示双方最终攻防与每次扣血；无需重复点击。', hint: '上方「对局记录」可以查看天气、骰面与伤害来源。', target: 'values' };
}

export function advanceTutorial(state: GameState, playerId: string, saved: TutorialProgress): TutorialProgress {
  const progress = updateTutorialProgress(state, playerId, saved);
  const step = getTutorialStep(state, playerId, progress);
  if (step.id === 'intro') return { ...progress, introSeen: true };
  if (step.id === 'attack-result') return { ...progress, attackExplained: true };
  if (step.id === 'defense-result') return { ...progress, defenseExplained: true };
  if (step.id === 'complete') return { ...progress, status: 'completed' };
  return progress;
}

export interface TutorialDiagnostic {
  selectedCount: number;
  requiredDice: number;
  overSelected: number;
  remaining: number;
  statusLabel: string;
  tip: string;
  skillLabel: string;
}

export function getTutorialDiagnostic(state: GameState, playerId: string): TutorialDiagnostic {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return { selectedCount: 0, requiredDice: 0, overSelected: 0, remaining: 0, statusLabel: '等待中', tip: '', skillLabel: '' };
  const legal = getLegalActions(state, playerId);
  const selectedCount = player.selectedIds.length;
  const requiredDice = legal.requiredDice;
  const overSelected = requiredDice > 0 ? Math.max(0, selectedCount - requiredDice) : 0;
  const remaining = requiredDice > 0 ? Math.max(0, requiredDice - selectedCount) : 0;
  const missingForced = player.dice.some(d => d.forced && !player.selectedIds.includes(d.id));
  const card = state.catalog.cards.find(c => c.id === player.cardId);
  const rawSkill = card?.description?.replace(/<[^>]*>/g, '').trim() || '';
  const shortSkill = rawSkill.length > 44 ? `${rawSkill.slice(0, 44)}…` : rawSkill;
  const skillLabel = shortSkill ? `${card?.name || player.name}：${shortSkill}` : '';

  const statusLabel = !requiredDice
    ? (selectedCount > 0 ? `已选 ${selectedCount} 颗（不限颗数）` : '请至少选择 1 颗骰子')
    : overSelected > 0
      ? `多选了 ${overSelected} 颗 · 需取消至 ${requiredDice} 颗`
      : remaining > 0
        ? `还差 ${remaining} 颗 · 已选 ${selectedCount} / ${requiredDice}`
        : `已选齐 ${requiredDice} 颗 · 可确认使用`;

  const tip = missingForced
    ? '包含「命定」角标的骰子，必须选中保留才能确认！'
    : overSelected > 0
      ? `已超出本回合可用骰数 (${selectedCount}/${requiredDice})，请点击蓝框骰子取消多余选择。`
      : legal.canReroll && remaining > 0
        ? '可先点选想重摇的骰子点右侧「重投」，再凑齐要求数量。'
        : legal.canConfirm
          ? '已达到要求颗数！点击绿色「确认使用」完成操作。'
          : (legal.reason || '点击骰子或从空白桌面滑过批量选中。');

  return { selectedCount, requiredDice, overSelected, remaining, statusLabel, tip, skillLabel };
}

export interface CoopCoachStep {
  id: 'coop-roll' | 'coop-swap' | 'coop-tactics';
  number: number;
  title: string;
  text: string;
  hint: string;
  target: 'dice' | 'swap' | 'tactics' | 'confirm';
}

export function getCoopCoachStep(state: GameState, playerId: string): CoopCoachStep | null {
  if (state.mode !== 'coop' || state.phase === 'finished') return null;
  const player = state.players.find(p => p.id === playerId);
  if (!player) return null;
  const legal = getLegalActions(state, playerId);
  if (state.phase === 'tactics') {
    return {
      id: 'coop-tactics',
      number: 3,
      title: '战术商店 · 筹备战术卡',
      text: '消耗战术点 ◈ 购买战术卡（手牌上限 3 张）。买好的卡牌会在接下来的「交换阶段」点击手牌立即生效！',
      hint: `当前拥有 ◈ ${player.tacticPoints} · 挑好或暂无需要可直接点「准备完毕」。`,
      target: 'tactics',
    };
  }
  if (state.phase === 'swap') {
    return {
      id: 'coop-swap',
      number: 2,
      title: '共斗共享交换区 & 出牌',
      text: '自己与队友未选中的骰子已汇入中央共享池！点自己的骰子再点池骰即可互换（也可拖动），此时点击下方展开的战术手牌可直接打出。',
      hint: player.tactics.length ? `你当前持有 ${player.tactics.length} 张战术卡，点底栏卡面查看并使用。` : '换好需要的点数后，点击右侧绿钮「确认交换」触发联手结算。',
      target: 'swap',
    };
  }
  return {
    id: 'coop-roll',
    number: 1,
    title: '双人共斗 · 选骰与留池配合',
    text: '选定本轮出战骰子后，你未选中的骰子会自动进入「共享交换区」给队友备用！先选好出战骰，再点确认进入交换。',
    hint: `需选 ${legal.requiredDice || '至少 1'} 颗 · 已选 ${player.selectedIds.length} 颗 · 共斗队伍共享 3 条生命。`,
    target: legal.canConfirm ? 'confirm' : 'dice',
  };
}
