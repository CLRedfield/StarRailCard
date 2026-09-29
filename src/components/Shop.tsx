import { useState } from 'react';
import { Check, Gem, ShoppingBag, Sparkles, LockKeyhole } from 'lucide-react';
import { cards, cardById, diceById, shopGoods } from '../data';
import type { Profile } from '../lib/storage';
import { buyGood, currencyNames, gildCard, gildCost, goodUnavailableReason, levelForXp, maxGildLevel } from '../lib/progression';
import CardView, { asset } from './CardView';

export default function Shop({ profile, onChange, onToast }: { profile: Profile; onChange: (profile: Profile) => void; onToast: (message: string) => void }) {
  const [tab, setTab] = useState('1');
  const buy = (id: string) => { const result = buyGood(profile, id); if (result.error) return onToast(result.error); onChange(result.profile); onToast('兑换成功，已加入你的收藏'); };
  const gild = (id: string) => { const result = gildCard(profile, id); if (result.error) return onToast(result.error); onChange(result.profile); onToast('镀闪完成，卡牌焕然一新'); };
  return <section className="shop-page page-enter">
    <div className="page-heading"><div><p className="eyebrow">THE COSMICON EMPORIUM</p><h1>好牌，值得收藏。</h1><p>在每一次对局里积累，把心仪的角色带回牌桌。</p></div><div className="shop-level"><ShoppingBag size={20}/>资历 Lv.{levelForXp(profile.xp)}</div></div>
    <div className="shop-wallet">{(['coins', 'victoryCoins', 'paintCoins', 'dust'] as const).map(key => <span key={key}><Gem size={14}/>{currencyNames[key]} <strong>{profile[key]}</strong></span>)}</div>
    <div className="segment shop-tabs">{[['1', '基础商店'], ['2', '高手珍藏'], ['3', '商街新品'], ['gild', '卡牌镀闪']].map(([id, name]) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{id === 'gild' && <Sparkles size={15}/>} {name}</button>)}</div>
    {tab === 'gild' ? <><p className="section-hint">镀闪只改变卡牌外观，不影响生命、技能或骰组。普通卡可镀金，三星卡可进一步解锁全息质感。</p><div className="shop-grid">{cards.filter(c => profile.ownedCards.includes(c.id)).map(card => {
      const level = profile.gild[card.id] || 0, full = level >= maxGildLevel(card.id), cost = gildCost(profile, card.id);
      return <article className="shop-item gild-item" key={card.id}><CardView card={card} gild={level} compact/><div className="shop-item-copy"><h3>{card.name}</h3><p>{['普通卡面', '鎏金卡面', '全息卡面'][level]}</p><button className="secondary" disabled={full || profile.dust < cost} onClick={() => gild(card.id)}>{full ? <><Check size={14}/>已达到最高镀闪</> : <><Sparkles size={14}/>{cost} 战力粉尘 · 镀闪</>}</button></div></article>;
    })}</div></> : <div className="shop-grid">{shopGoods.filter(g => g.shopId === tab).map(good => {
      const owned = (good.type === 'card' ? profile.ownedCards : profile.ownedDice).includes(good.itemId);
      const reason = goodUnavailableReason(profile, good), card = cardById[good.itemId], die = diceById[good.itemId];
      return <article className={`shop-item ${owned ? 'owned' : ''}`} key={good.id}>
        {card ? <img className="shop-art" src={asset(card.image)} alt={card.name} loading="lazy"/> : <div className="shop-dice-art">{die?.image ? <img src={asset(die.image)} alt={die.name} width={112} height={112} loading="lazy"/> : <Gem size={55}/>}<div className="faces">{die?.faces.map((f, i) => <span key={i} title={f.description}>{f.value}</span>)}</div></div>}
        <div className="shop-item-copy"><small>{good.type === 'card' ? `${'★'.repeat(card?.rarity || 3)} 角色卡` : '曜彩骰'}</small><h3>{good.name}</h3><p>{card?.description || die?.description}</p><button className="secondary" disabled={!!reason} title={reason} onClick={() => buy(good.id)}>{owned ? <><Check size={15}/>已经拥有</> : reason && !reason.endsWith('不足') ? <><LockKeyhole size={14}/>{reason}</> : <><Gem size={14}/>{good.cost} {currencyNames[good.currency]} · 兑换</>}</button></div>
      </article>;
    })}</div>}
  </section>;
}
