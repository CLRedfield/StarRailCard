import { describe, expect, it } from 'vitest';
import { dice, diceById, prismaticDice } from '../src/data';
import { diceEffectGroups, diceRestriction, faceEffectLabel, faceEffectText } from '../src/components/diceDetails';

describe('loadout face descriptions from published data', () => {
  it('distinguishes equal numbered faces instead of looking for absent effect fields', () => {
    const die = diceById['264418'];
    expect(die.faces.slice(0, 4).map(face => face.value)).toEqual([4, 4, 4, 4]);
    expect(die.faces[3].effect).toBeUndefined();
    expect(die.faces.slice(0, 4).map(faceEffectLabel)).toEqual(['普通点数', '普通点数', '普通点数', '骇入']);
    expect(diceEffectGroups(die)).toEqual([{ text: '本回合获得骇入', positions: [4, 5, 6] }]);
  });

  it('keeps original and upgraded thresholds and attack/defense restrictions', () => {
    expect(diceRestriction(diceById['264407'])).toBe('生命值≤8点时可用');
    expect(diceRestriction(diceById['264507'])).toBe('生命值≤4点时可用');
    expect(diceRestriction(diceById['264405'])).toBe('累计受到25点伤害后，可以在攻击时使用');
    expect(diceRestriction(diceById['264424'])).toBe('回合数≥3时，可以在防御时使用');
  });

  it('shows the different effects of each face on mixed dice', () => {
    expect(diceById['264427'].faces.map(faceEffectLabel)).toEqual(['普通点数', '力场', '韧性 4层', '反伤 30%', '不屈', '反击']);
    expect(diceById['264426'].faces.map(faceEffectLabel)).toEqual(['普通点数', '普通点数', '普通点数', '力量 2层', '连击', '虹吸 50%']);
    expect(diceById['264425'].faces.map(faceEffectLabel)).toEqual(['普通点数', '次数 +1', '次数 +1', '次数 +1', '次数 +1', '强运']);
  });

  it('every published face has a readable label, with no punctuation-only false special faces', () => {
    expect(prismaticDice).toHaveLength(25);
    for (const die of dice) for (const face of die.faces) {
      const text = faceEffectText(face);
      expect(faceEffectLabel(face)).toBeTruthy();
      expect(text).not.toMatch(/^[\s，,。；;]+$/);
      expect(text).not.toMatch(/^选[定择]后提供\d+点数/);
      if (!face.description) expect(text).toBe('');
    }
  });
});
