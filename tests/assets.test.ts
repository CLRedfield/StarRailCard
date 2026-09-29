import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../src/data/assetManifest.json';
import { asset, assetAliases } from '../src/lib/assets';
import { allCards, classicCampaigns, coopStages, dice, tactics, weather } from '../src/data';

describe('shared original assets', () => {
  it('resolves every original image to byte-identical, non-chained content', () => {
    for (const item of manifest) {
      const target = assetAliases[item.path];
      const bytes = readFileSync(resolve('public', target));
      expect(createHash('sha256').update(bytes).digest('hex'), item.path).toBe(item.sha256);
      expect(assetAliases[target], item.path).toBe(target);
    }
    expect(new Set(Object.values(assetAliases)).size).toBeLessThan(manifest.length);
  });

  it('covers cards and the dynamic weather, tactic, dice and challenge paths', () => {
    const paths = [
      ...allCards.map(c => c.image), ...dice.map(d => d.image),
      ...classicCampaigns.map(c => c.image), ...coopStages.map(c => c.image),
      ...weather.map(w => `assets/weather/${w.id}.png`),
      ...tactics.map(t => `assets/tactics/${t.id}.png`),
    ].filter((path): path is string => !!path);
    for (const path of paths) expect(assetAliases[path], path).toBeTruthy();
  });

  it('retains relative deployment URLs and handles optional or non-catalog assets', () => {
    expect(asset(undefined)).toBe('');
    expect(asset('')).toBe('');
    expect(asset('/favicon.svg')).toBe(`${import.meta.env.BASE_URL}favicon.svg`);
    const alias = manifest.find(item => assetAliases[item.path] !== item.path)!;
    expect(asset(`/${alias.path}`)).toBe(`${import.meta.env.BASE_URL}${assetAliases[alias.path]}`);
  });
});
