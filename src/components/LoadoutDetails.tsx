import { Gem, Heart, Shield, Swords, Sparkles, Info, ChevronDown } from 'lucide-react';
import { diceById, glossary } from '../data';
import type { CardDefinition, DiceDefinition } from '../data';
import { asset, cleanText } from './CardView';
import { diceEffectGroups, diceRestriction, faceEffectLabel, faceEffectText } from './diceDetails';
import './LoadoutDetails.css';

export function EffectGlossary({ text }: { text: string }) {
  const terms = glossary.filter(term => text.includes(term.name));
  if (!terms.length) return null;
  return <details className="effect-glossary"><summary><Info size={13}/>效果释义 <span>{terms.map(term => term.name).join(' · ')}</span><ChevronDown size={13}/></summary><dl>{terms.map(term => <div key={term.id}><dt>{term.name}</dt><dd>{cleanText(term.description)}</dd></div>)}</dl></details>;
}

export function CharacterDetails({ card, heading = true }: { card: CardDefinition; heading?: boolean }) {
  return <section className="character-inspector" aria-label={`${card.name}技能详情`}>
    {heading && <header><span>角色技能</span><h3>{card.name}</h3></header>}
    <div className="inspector-stats"><span><Heart size={13}/>生命 <strong>{card.hp}</strong></span><span><Swords size={13}/>攻击 <strong>{card.attack || '不限'}</strong></span><span><Shield size={13}/>防御 <strong>{card.defense}</strong></span></div>
    <p className="inspector-skill">{cleanText(card.description)}</p>
    <div className="inspector-pool"><span>初始骰池</span><div>{card.dice.map((sides, index) => <b className={`d${sides}`} key={index}>D{sides}</b>)}</div></div>
    <p className="inspector-uses"><Gem size={13}/>{card.prismaticId ? `曜彩骰初始 ${card.prismaticUses} 次` : '此角色不能使用曜彩骰'}{card.prismaticId && <span>默认：{diceById[card.prismaticId]?.name || '—'}</span>}</p>
    <EffectGlossary text={card.description}/>
  </section>;
}

export function DiceFaceGrid({ die, compact = false }: { die: DiceDefinition; compact?: boolean }) {
  return <ol className={`inspector-faces ${compact ? 'compact' : ''}`} aria-label={`${die.name}各骰面效果`}>{die.faces.map((face, index) => {
    const special = !!faceEffectText(face);
    return <li className={special ? 'special' : ''} key={index} aria-label={`第${index + 1}面，${face.value}点，${face.description ? cleanText(face.description) : '无特殊效果'}`}><span className="face-index">{String(index + 1).padStart(2, '0')}{special && <Sparkles size={10}/>}</span><strong>{face.value}</strong><span className="face-effect-label">{faceEffectLabel(face)}</span></li>;
  })}</ol>;
}

export function DiceDetails({ die, card, caption = '曜彩骰详情' }: { die: DiceDefinition; card?: CardDefinition; caption?: string }) {
  const groups = diceEffectGroups(die);
  return <section className="dice-inspector" aria-label={`${die.name}详细效果`}>
    <header className="dice-inspector-heading"><div className="inspector-gem">{die.image ? <img src={asset(die.image)} alt=""/> : <Gem size={36}/>}</div><div><span>{caption}</span><h3>{die.name}</h3></div><b>{die.sides} 面</b></header>
    <div className={`dice-restriction ${die.condition === 'Attack' ? 'attack' : die.condition === 'Defense' ? 'defense' : ''}`}>{die.condition === 'Attack' ? <Swords size={15}/> : die.condition === 'Defense' ? <Shield size={15}/> : <Info size={15}/>}<div><span>使用条件</span><strong>{diceRestriction(die)}</strong></div></div>
    {card && <p className="dice-character-limit">{card.prismaticId ? `${card.name} · 初始 ${card.prismaticUses} 次；使用次数的额外变化见角色技能与天气。` : `${card.name}不能使用曜彩骰，可查看骰面后更换角色。`}</p>}
    <DiceFaceGrid die={die}/>
    <div className="face-effects-list">{groups.length ? groups.map(group => <div key={group.text}><span>第 {group.positions.join('、')} 面</span><p>{group.text}</p></div>) : <p className="no-face-effects">各面只提供对应点数，无额外骰面效果。</p>}</div>
    <p className="dice-inspector-note">金色标记为特殊面；投出后须选中参与结算才生效。格号对应上方骰面的位置。</p>
    <EffectGlossary text={die.faces.map(face => face.description).join(' ')}/>
  </section>;
}
