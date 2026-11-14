import { useMemo, useState } from 'react';
import { Search, Check, ArrowRight, Gem, Sparkles, BookOpen, ChevronRight, LockKeyhole } from 'lucide-react';
import { cards, cardById, prismaticDice, glossary, weather, tactics, diceById, progression } from '../data';
import type { CardDefinition, DiceDefinition } from '../data';
import type { Profile } from '../lib/storage';
import { levelForXp } from '../lib/progression';
import CardView, { asset, cleanText } from './CardView';
import Modal from './Modal';
import { CharacterDetails, DiceDetails, DiceFaceGrid } from './LoadoutDetails';
import { diceRestriction, faceEffectText } from './diceDetails';

export default function Collection({ profile, onChange, onToast, free = false, onDone }: { profile: Profile; onChange: (p: Profile) => void; onToast: (s: string) => void; free?: boolean; onDone?: () => void }) {
  const [category, setCategory] = useState<'cards' | 'dice' | 'guide'>('cards');
  const [query, setQuery] = useState('');
  const [edition, setEdition] = useState('all');
  const [detail, setDetail] = useState<CardDefinition | null>(null);
  const [diceDetail, setDiceDetail] = useState<DiceDefinition | null>(null);
  const equippedCard = cardById[profile.selectedCard];
  const canEditDice = free || levelForXp(profile.xp) >= progression.prismaticUnlockLevel;
  const filtered = useMemo(() => cards.filter(c => (edition === 'all' || c.version === edition) && (c.name.includes(query) || c.description.includes(query))), [edition, query]);
  const equip = (card: CardDefinition) => {
    if (!free && !profile.ownedCards.includes(card.id)) { onToast('这张卡尚未收集，可前往商店兑换；自由模式可直接使用。'); return; }
    onChange({ ...profile, selectedCard: card.id, selectedDice: card.prismaticId || '' }); onToast(`已装备 ${card.name}`); setDetail(null);
  };
  return <section className="collection-page page-enter">
    <div className="page-heading"><div><p className="eyebrow">YOUR COSMICON COLLECTION</p><h1>战力收藏</h1><p>{free ? '自由模式 · 全部卡牌与曜彩骰已开放' : `已收集 ${profile.ownedCards.length} / ${cards.length} 张角色卡`}</p></div>{onDone && <button className="primary" onClick={onDone}>确认配置 <ArrowRight size={18}/></button>}</div>
    <div className="collection-toolbar"><div className="segment"><button className={category === 'cards' ? 'active' : ''} onClick={() => setCategory('cards')}>角色卡牌 <span>{cards.length}</span></button><button className={category === 'dice' ? 'active' : ''} onClick={() => setCategory('dice')}>曜彩骰 <span>25</span></button><button className={category === 'guide' ? 'active' : ''} onClick={() => setCategory('guide')}>规则手册</button></div><label className="search-field"><Search size={16}/><input placeholder="搜索名称 / 技能" value={query} onChange={e => setQuery(e.target.value)}/></label></div>
    {category === 'cards' && <><div className="filter-row">{[['all', '全部卡牌'], ['4.0', '上骰了！'], ['4.2', '又上骰了！'], ['custom', '同人扩展']].map(([id, text]) => <button key={id} className={edition === id ? 'active' : ''} onClick={() => setEdition(id)}>{text}</button>)}<span>点击卡牌查看详情和装备</span></div><div className="card-grid">{filtered.map(card => <CardView key={card.id} card={card} selected={card.id === profile.selectedCard} locked={!free && !profile.ownedCards.includes(card.id)} gild={profile.gild[card.id] || 0} onClick={() => setDetail(card)}/>)}</div>{!filtered.length && <p className="empty-state">没有符合条件的卡牌。</p>}</>}
    {category === 'dice' && <><p className="section-hint">点击曜彩骰查看完整效果与装备。金色格子为特殊骰面，格号区分相同点数的不同效果。</p><div className="prismatic-grid">{prismaticDice.filter(d => (d.name + d.description + d.faces.map(f => f.description).join('')).includes(query)).map(die => {
      const owned = free || profile.ownedDice.includes(die.id); const selected = profile.selectedDice === die.id;
      const special = die.faces.filter(f => !!faceEffectText(f)).length;
      return <button key={die.id} className={`prism-tile dice-catalog-tile ${selected ? 'active' : ''}`} aria-label={`查看${die.name}骰面详情`} onClick={() => setDiceDetail(die)}><div className="dice-catalog-heading"><div className="prism-gem">{die.image ? <img src={asset(die.image)} alt="" width={52} height={52} loading="lazy"/> : <Gem size={38}/>}</div><div><h3>{die.name}{selected && <Check size={15}/>}</h3><p>{diceRestriction(die)}</p></div><ChevronRight size={17}/></div><DiceFaceGrid die={die} compact/><div className="dice-catalog-footer"><span>{special ? `${special} 个特殊面 · 点开查看效果释义` : '全部为点数面'}</span><b>{!owned ? <span className="catalog-locked"><LockKeyhole size={10}/>未收集 · 可查看</span> : selected ? '已配置' : '查看 / 配置'}</b></div></button>;
    })}</div></>}
    {category === 'guide' && <div className="guide"><article><BookOpen/><h2>一张角色卡，一场骰子决斗。</h2><p>攻击等级和防御等级决定本回合需要选择的骰子数量。选定骰子的点数之和构成攻防值，通常伤害为攻击值减去防御值，最低为零。每回合交换攻防，将对方生命降至零即可取胜。</p><p>进攻默认可重投两次，防御默认不能重投。先选中要重投的骰子，再点击重投；其他骰子留在原位并保持原点数。重投后重新选择。确认使用时，选中数量须满足本回合的攻防要求，该要求不限制一次重投的颗数。曜彩骰也可以重投，其特殊面须选中参与结算才生效；角色技能和天气可能改变这些规则。</p><h3>双人共斗</h3><p>两名队友共同挑战多阶段强敌，共享三次生命。双方确认选骰后，未使用的骰子进入共享交换区；点击自己已选骰子，再点击交换区骰子即可交换。交换阶段可以使用战术卡，双方确认后结算。</p></article><div className="glossary-grid">{glossary.filter(g => (g.name + g.description).includes(query)).map(g => <article key={g.id}><h3>{g.name}</h3><p>{cleanText(g.description)}</p></article>)}</div><h2>天气图鉴</h2><div className="glossary-grid">{weather.filter(g => (g.name + g.description).includes(query)).map(g => <article key={g.id}><h3>{g.name}</h3><p>{cleanText(g.description)}</p></article>)}</div><h2>战术卡图鉴</h2><div className="glossary-grid">{tactics.filter(g => (g.name + g.description).includes(query)).map(g => <article key={g.id}><h3>{g.name} <small>◈ {g.cost}</small></h3><p>{cleanText(g.description)}</p></article>)}</div></div>}
    {detail && <Modal title="角色卡牌详情" onClose={() => setDetail(null)} wide><div className="card-detail"><CardView card={detail} large gild={profile.gild[detail.id] || 0}/><div><p className="eyebrow">{detail.version === 'custom' ? '同人扩展' : detail.version === '4.2' ? '扩展包 · 2' : '银河战力党'}</p><h2>{detail.name}</h2><CharacterDetails card={detail} heading={false}/><div className="detail-actions"><button className="primary" onClick={() => equip(detail)}>装备此卡 <Check size={18}/></button>{free && <button className="secondary" onClick={() => { onChange({ ...profile, gild: { ...profile.gild, [detail.id]: ((profile.gild[detail.id] || 0) + 1) % 3 } }); }}><Sparkles size={16}/>切换镀闪外观</button>}</div></div></div>{detail.prismaticId && diceById[detail.prismaticId] && <div className="collection-card-dice"><DiceDetails die={diceById[detail.prismaticId]} card={detail} caption="角色默认曜彩骰"/></div>}</Modal>}
    {diceDetail && (() => {
      const isCardDefault = equippedCard?.prismaticId === diceDetail.id;
      const canEquipDie = free || isCardDefault || profile.ownedDice.includes(diceDetail.id);
      return <Modal title="曜彩骰详情" onClose={() => setDiceDetail(null)} wide><div className="collection-dice-detail"><DiceDetails die={diceDetail} card={equippedCard}/><div className="collection-dice-actions"><p>当前角色：{equippedCard.name}<br/>{!equippedCard.prismaticId ? '此角色不能使用曜彩骰，请先更换角色。' : !canEditDice ? `资历达到 ${progression.prismaticUnlockLevel} 级后开放曜彩骰配置。` : !canEquipDie ? '尚未收集，可前往商店兑换。' : isCardDefault && !free && !profile.ownedDice.includes(diceDetail.id) ? '当前出战角色的默认曜彩骰，可直接配置；前往商店兑换后可给其他角色通用。' : '装备后在牌桌满足使用条件时即可投掷。'}</p><button className="primary" disabled={!equippedCard.prismaticId || !canEditDice || !canEquipDie} onClick={() => { onChange({ ...profile, selectedDice: diceDetail.id }); onToast(`已配置 ${diceDetail.name}`); setDiceDetail(null); }}>{profile.selectedDice === diceDetail.id ? '已配置此骰' : '配置此骰'}<Check size={17}/></button></div></div></Modal>;
    })()}
  </section>;
}
