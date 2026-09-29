import * as source from '../data';
import type { GameCatalog, DieFace } from './types';

/** Adapts the pinned, published game tables into the small executable rule schema. */
export function defaultCatalog(): GameCatalog {
  const data = source as unknown as Record<string, any[]>;
  const strings = (value: unknown) => typeof value === 'string' ? value : '';
  const face = (f: any, name: string): DieFace => {
    const desc = `${f.description || ''} ${f.effect || ''}`;
    const candidates: [RegExp, string][] = [
      [/猛毒|Venom/i, 'venom'], [/中毒|Poison/i, 'poison'], [/翻倍|觉醒|double|awakening/i, 'double'],
      [/命定|Fated/i, 'fated'], [/治愈|heal/i, 'heal'], [/连击|combo/i, 'combo'],
      [/反伤|counter damage/i, 'reflect'], [/反击|counter/i, 'counter'], [/力场|forcefield/i, 'forcefield'],
      [/不屈|unyielding/i, 'unyielding'], [/超载|overload/i, 'overload'], [/背水|last stand/i, 'lastStand'],
      [/骇入|hack/i, 'hack'], [/荆棘|thorns/i, 'thorns'], [/瞬伤|instant/i, 'instant'],
      [/强运|大吉|大运|鸿运|Great Luck/i, 'lucky'], [/韧性|toughness/i, 'toughness'], [/力量|strength/i, 'strength'],
      [/虹吸|siphon/i, 'siphon'], [/使用次数|曜彩|prismatic.*use/i, 'refund'],
    ];
    let effect = candidates.find(([pattern]) => pattern.test(desc))?.[1];
    if (/命运|Destiny/i.test(name)) effect = 'fated';
    let amount = Number(f.amount ?? f.params?.[0] ?? f.value ?? 0);
    if (effect === 'instant') amount = 3;
    if (effect === 'refund') amount = 1;
    if (effect === 'poison') amount = Number(desc.match(/陷入\s*(\d+)\s*层中毒/)?.[1] ?? f.value);
    if (effect === 'thorns') amount = Math.floor(Number(f.value) / 4);
    if (effect === 'reflect') amount = 0.3;
    if (effect === 'siphon') amount = 0.5;
    if (/强攻|猛攻|进攻|Onslaught/i.test(name) && effect === 'strength') amount = 2;
    return { value: Number(f.value), effect, amount };
  };
  return {
    cards: (data.allCards || data.cards || []).map(c => ({ id: String(c.id), name: c.name, description: c.description, image: c.image, attack: Number(c.attack), defense: Number(c.defense), hp: Number(c.hp), skill: strings(c.skill) || String(c.id), dice: c.dice.map(Number), prismaticId: c.prismaticId == null ? undefined : String(c.prismaticId), prismaticUses: c.prismaticUses })),
    prismatics: (data.dice || data.prismatics || []).filter(d => d.color === 'Colorful' || !d.color).map(d => ({ id: String(d.id), name: d.name, description: d.description, faces: d.faces.map((f: any) => face(f, d.name)), condition: strings(d.condition) })),
    weather: (data.weather || []).map(w => ({ id: String(w.id), name: w.name, description: w.description, effect: w.name, rounds: w.rounds || w.turns || Object.entries({ 2: [1, 4, 25, 5, 29, 2, 13, 6, 31], 4: [3, 21, 23, 24, 7, 9, 10, 11], 6: [16, 18, 20, 27, 28, 12, 26], 8: [17, 19, 14] }).filter(([, ids]) => ids.includes(Number(w.id))).map(([round]) => Number(round)) })),
    tactics: (data.tactics || []).map(t => ({ id: String(t.id), name: t.name, description: t.description, effect: t.name, amount: t.amount, cost: Number(t.cost), kind: t.kind === 'defend' || t.kind === 'defense' ? 'defense' : t.kind === 'attack' ? 'attack' : 'any' })),
  };
}

export function coopRules(stageId?: string): { enabled: boolean; weights?: Record<string, number> } {
  const stage = (source.coopStages as { id: string; tacticsWeights: { id: string; weight: number }[] }[]).find(s => s.id === stageId);
  return { enabled: stageId !== '1001', weights: stage ? Object.fromEntries(stage.tacticsWeights.map(w => [w.id, w.weight])) : undefined };
}
