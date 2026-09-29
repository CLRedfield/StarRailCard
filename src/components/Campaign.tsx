import { useState } from 'react';
import { ArrowRight, Check, LockKeyhole, Swords, Users, Trophy, Gift, Search, Dices } from 'lucide-react';
import { classicCampaigns, classicStages, coopStages, cardById, giftChallenges, streetChallenges, rewards } from '../data';
import type { Profile } from '../lib/storage';
import { currencyNames } from '../lib/progression';
import { asset, cleanText } from './CardView';
import './BattleTutorial.css';

export type ChallengeGroup = 'classic' | 'coop' | 'gift' | 'street';
export interface Challenge {
  id: string; title: string; name: string; intro: string; opponentId: string;
  bossIds?: string[]; rewardId?: string; weather?: string[]; mode: 'classic' | 'coop';
  group: ChallengeGroup; unlockChallengeId?: string; image?: string; stageId?: string;
  difficulty?: number; opponentGild?: number; opponentPrismaticId?: string;
  tutorial?: boolean;
}
export function getChallenges(): Challenge[] {
  const classic: Challenge[] = classicCampaigns.map((c, index) => {
    const stage = classicStages.find(s => s.id === c.stageIds[0]);
    return { id: `classic-${c.id}`, tutorial: c.id === '1', title: c.title, name: c.name, intro: cleanText(c.intro), opponentId: stage?.cardId || c.cardIds[0], rewardId: stage?.rewardId, weather: c.ruleGroups.flatMap(g => g.weatherIds.slice(0, 1)), mode: 'classic', group: 'classic', image: c.image, stageId: stage?.id, opponentGild: Math.max(0, (stage?.foilLevel || 1) - 1), opponentPrismaticId: stage?.diceIds[3] ? String(stage.diceIds[3]) : undefined, unlockChallengeId: index ? `classic-${classicCampaigns[index - 1].id}` : undefined };
  });
  const coop: Challenge[] = coopStages.map((c, index) => ({ id: `coop-${c.id}`, title: c.difficulty === 'story' ? `商业街争霸赛 · ${c.chapter}` : `强敌挑战 · ${c.chapter}`, name: c.name, intro: `携手${c.companionName || '伙伴'}，与${c.opponentName}展开银河战力党对决。交换骰子，配合战术，击破强敌的全部阶段。`, opponentId: c.bossCardIds[0], bossIds: c.bossCardIds, rewardId: c.rewardId, mode: 'coop', group: 'coop', image: c.image, unlockChallengeId: index ? `coop-${coopStages[index - 1].id}` : undefined }));
  const gifts: Challenge[] = giftChallenges.map(c => ({ ...c, group: 'gift', mode: 'classic' }));
  const streets: Challenge[] = [...streetChallenges].sort((a, b) => a.difficulty - b.difficulty || Number(a.stageId) - Number(b.stageId)).map(c => ({ ...c, group: 'street', mode: 'classic', opponentGild: Math.max(0, c.foilLevel - 1), opponentPrismaticId: c.diceIds[3] ? String(c.diceIds[3]) : undefined }));
  return [...classic, ...coop, ...gifts, ...streets];
}

function rewardLabel(challenge: Challenge): string {
  const reward = rewards[challenge.rewardId || ''];
  if (!reward) return '挑战记录 · 检验你的牌组与配合';
  const parts = reward.cardIds.map(id => `${cardById[id]?.name || id}角色卡`);
  for (const currency of ['coins', 'victoryCoins', 'paintCoins', 'dust'] as const) if (reward[currency]) parts.push(`${reward[currency]} ${currencyNames[currency]}`);
  if (reward.xp) parts.push(`${reward.xp} 资历`);
  return `首胜：${parts.join(' · ')}`;
}

export default function Campaign({ profile, onStart }: { profile: Profile; onStart: (c: Challenge) => void }) {
  const [group, setGroup] = useState<ChallengeGroup>('classic');
  const [chosenId, setChosenId] = useState('');
  const [query, setQuery] = useState('');
  const [difficulty, setDifficulty] = useState('all');
  const [unfinishedOnly, setUnfinishedOnly] = useState(false);
  const all = getChallenges();
  const list = all.filter(c => c.group === group && (group !== 'street' || (c.name.includes(query.trim()) && (difficulty === 'all' || c.difficulty === Number(difficulty)) && (!unfinishedOnly || !profile.completed.includes(c.id)))));
  const challenge = list.find(c => c.id === chosenId) || list[0];
  const card = challenge ? cardById[challenge.opponentId] : undefined;
  const unlocked = (c: Challenge) => !c.unlockChallengeId || profile.completed.includes(c.unlockChallengeId);
  const prerequisite = challenge?.unlockChallengeId ? all.find(c => c.id === challenge.unlockChallengeId) : undefined;
  const tabs = [{ id: 'classic' as const, name: '上骰了', Icon: Swords }, { id: 'coop' as const, name: '又上骰了', Icon: Users }, { id: 'gift' as const, name: '赠卡挑战', Icon: Gift }, { id: 'street' as const, name: '街头切磋', Icon: Dices }];
  return <section className="campaign-page page-enter">
    <div className="page-heading"><div><p className="eyebrow">THE NEXT CHALLENGER IS YOU</p><h1>上桌，迎战。</h1><p>从一颗骰子开始，写下你的战力传奇。</p></div></div>
    <div className="collection-toolbar campaign-toolbar"><div className="segment campaign-tabs">{tabs.map(({ id, name, Icon }) => <button key={id} className={group === id ? 'active' : ''} onClick={() => { setGroup(id); setChosenId(''); }}><Icon size={15}/>{name}</button>)}</div>{group === 'street' && <label className="search-field"><Search size={16}/><input aria-label="搜索街头牌局角色" placeholder="搜索角色卡名" value={query} onChange={e => { setQuery(e.target.value); setChosenId(''); }}/></label>}</div>
    {group === 'street' && <div className="filter-row street-filters"><label>对手难度<select aria-label="街头牌局难度" value={difficulty} onChange={e => { setDifficulty(e.target.value); setChosenId(''); }}><option value="all">全部难度</option>{Array.from({ length: 9 }, (_, i) => <option key={i + 1} value={i + 1}>难度 {i + 1}</option>)}</select></label><button className={unfinishedOnly ? 'active' : ''} aria-pressed={unfinishedOnly} onClick={() => { setUnfinishedOnly(!unfinishedOnly); setChosenId(''); }}>只看未完成</button><span>{list.length} 场牌局 · 每场首胜可得战力币与粉尘</span></div>}
    {challenge && card ? <div className="campaign-layout"><div className="chapter-list">{list.map((c, i) => <button key={c.id} className={`chapter-button ${c.id === challenge.id ? 'active' : ''} ${!unlocked(c) ? 'locked' : ''}`} onClick={() => setChosenId(c.id)}>
      {c.image ? <img className="chapter-thumb" src={asset(c.image)} alt="" loading="lazy" width={42} height={42} style={{ objectFit: 'contain', flexShrink: 0 }}/> : <span className="chapter-number">{group === 'street' ? c.stageId : String(i + 1).padStart(2, '0')}</span>}<div><small>{group === 'street' ? `街头切磋 · 难度 ${c.difficulty}` : c.title}</small><strong>{c.name}{c.tutorial && <small className="campaign-tutorial-label">新手教学</small>}</strong></div>{profile.completed.includes(c.id) ? <Check size={18}/> : !unlocked(c) ? <LockKeyhole size={15}/> : <ArrowRight size={16}/>}</button>)}</div>
      <article className={`challenge-feature ${challenge.mode}`}><div className="challenge-watermark">{challenge.mode === 'coop' ? 'CO–OP' : 'VERSUS'}</div><img className="challenge-art" src={asset(card.image)} alt={card.name}/><div className="challenge-copy"><p className="eyebrow">{group === 'street' ? `STREET ${challenge.stageId}` : `CHALLENGE ${String(list.indexOf(challenge) + 1).padStart(2, '0')}`} / {tabs.find(t => t.id === group)?.name}</p><h2>{challenge.name}</h2><p className="challenge-quote">“{challenge.intro}”</p>{challenge.tutorial && <p className="challenge-tutorial-note"><strong>边玩边学第一局</strong>从选骰、重投到攻防结算逐步引导；随时可跳过，也可重新学习。无需购买卡牌即可开始。</p>}<div className="opponent-preview"><span>对手卡牌</span><strong>{card.name}</strong><small>{challenge.bossIds ? `${challenge.bossIds.length} 个强敌阶段 · 3 次共享生命` : `生命 ${card.hp} · 攻击 ${card.attack || '不限'} · 防御 ${card.defense}`}</small></div><div className="challenge-reward"><Trophy size={17}/><span>{profile.completed.includes(challenge.id) ? '已领取首胜奖励 · 可再次挑战' : rewardLabel(challenge)}</span></div>{!unlocked(challenge) && prerequisite && <p className="section-hint">完成「{prerequisite.name}」后解锁</p>}<button className="primary" disabled={!unlocked(challenge)} onClick={() => onStart(challenge)}>{unlocked(challenge) ? challenge.tutorial ? profile.completed.includes(challenge.id) ? '重看教学并挑战' : '开始新手教学' : '准备挑战' : '尚未解锁'}<ArrowRight size={19}/></button></div></article>
    </div> : <p className="empty-state">没有符合条件的街头牌局，试试其他名称或难度。</p>}
  </section>;
}
