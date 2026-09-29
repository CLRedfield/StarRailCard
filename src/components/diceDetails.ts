import type { DiceDefinition, DiceFaceDefinition } from '../data';
import { cleanText } from './CardView';

/** Preserve each physical face: two equal numbers can carry different effects. */
export function faceEffectText(face: DiceFaceDefinition): string {
  return cleanText(face.description).replace(/^选[定择](?:后)?提供\s*\d+\s*点数[，,]?\s*/, '').trim();
}

export function faceEffectLabel(face: DiceFaceDefinition): string {
  const text = faceEffectText(face);
  if (!text) return '普通点数';
  if (text.includes('翻倍')) return '攻防翻倍';
  if (text.includes('使用次数')) return `次数 +${text.match(/获得\s*(\d+)/)?.[1] || '1'}`;
  if (text.includes('仅下个回合')) return `下回合力量 +${text.match(/(\d+)层/)?.[1] || ''}`;
  const word = ['猛毒', '中毒', '反伤', '反击', '虹吸', '命定', '治愈', '连击', '力场', '不屈', '超载', '背水', '骇入', '荆棘', '瞬伤', '强运', '韧性', '力量'].find(term => text.includes(term));
  if (!word) return text;
  const percent = text.match(/(\d+)%/);
  const layers = text.match(/(\d+)层/);
  const points = text.match(/(?:治愈|造成)\s*(\d+)点/);
  return `${word}${percent ? ` ${percent[1]}%` : layers ? ` ${layers[1]}层` : points ? ` ${points[1]}` : ''}`;
}

export function diceEffectGroups(die: DiceDefinition) {
  const groups: { text: string; positions: number[] }[] = [];
  die.faces.forEach((face, index) => {
    const text = faceEffectText(face);
    if (!text) return;
    const group = groups.find(item => item.text === text);
    if (group) group.positions.push(index + 1);
    else groups.push({ text, positions: [index + 1] });
  });
  return groups;
}

export function diceRestriction(die: DiceDefinition): string {
  return cleanText(die.description) || (die.condition === 'Attack' ? '只能在攻击时使用' : die.condition === 'Defense' ? '只能在防御时使用' : '随时可用');
}
