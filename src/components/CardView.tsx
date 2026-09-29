import { Shield, Swords, Heart, LockKeyhole, Sparkles } from 'lucide-react';
import type { CardDefinition } from '../data/types';
import { asset } from '../lib/assets';
export { asset } from '../lib/assets';

export function cleanText(text: string) { return text.replace(/\{F#([^}]+)\}\{M#[^}]+\}/g, '$1').replace(/<[^>]*>/g, '').replace(/\\n/g, '\n'); }
export default function CardView({ card, selected = false, gild = 0, locked = false, large = false, onClick, compact = false }: { card: CardDefinition; selected?: boolean; gild?: number; locked?: boolean; large?: boolean; onClick?: () => void; compact?: boolean }) {
  const content = <>
    <div className="card-art"><img src={asset(card.image)} alt={card.name} loading={large ? 'eager' : 'lazy'} draggable={false}/></div>
    <span className="card-stars">{'★'.repeat(card.rarity || 3)}</span>
    <span className="card-hp"><Heart size={12} fill="currentColor"/>{card.hp}</span>
    <div className="card-caption"><span className="card-code">{card.version === 'custom' ? '同人扩展' : card.version === '4.2' ? 'EXPANSION / 02' : 'COSMICON / 01'}</span><strong>{card.name}</strong><div className="card-stats"><span><Swords size={13}/>{card.attack || '∞'}</span><span><Shield size={13}/>{card.defense}</span><span className="card-pool">{card.dice.length} DICE</span></div></div>
    {gild > 0 && <div className="foil-shine"/>}{locked && <div className="locked-card"><LockKeyhole size={20}/><span>尚未收集</span></div>}
    {selected && <span className="selected-card"><Sparkles size={11}/> 已装备</span>}
  </>;
  const cls = `character-card foil-${gild} ${large ? 'large' : ''} ${compact ? 'compact' : ''} ${selected ? 'selected' : ''}`;
  return onClick ? <button className={cls} onClick={onClick} aria-label={`查看${card.name}卡牌`}>{content}</button> : <div className={cls}>{content}</div>;
}
