import manifest from '../data/assetManifest.json';

// Keep source paths stable in game data and saves while sharing byte-identical art.
// package_toy.py uses this same path ordering and verifies the actual file hashes.
const canonicalByHash = new Map<string, string>();
export const assetAliases: Readonly<Record<string, string>> = Object.fromEntries(
  [...manifest].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0).map(item => {
    const canonical = canonicalByHash.get(item.sha256) ?? item.path;
    canonicalByHash.set(item.sha256, canonical);
    return [item.path, canonical];
  }),
);

export function asset(path: string | undefined) {
  if (!path) return '';
  const relative = path.replace(/^\//, '');
  return `${import.meta.env.BASE_URL}${assetAliases[relative] ?? relative}`;
}
