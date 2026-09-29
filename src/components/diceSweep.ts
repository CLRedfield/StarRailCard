export interface DiceSweep {
  visited: Set<string>;
  ids: Set<string>;
  add: boolean;
  x: number;
  y: number;
}

export function beginDiceSweep(selected: readonly string[], x: number, y: number, initialId?: string): DiceSweep {
  const sweep = { visited: new Set<string>(), ids: new Set(selected), add: !initialId || !selected.includes(initialId), x, y };
  if (initialId) visit(sweep, initialId);
  return sweep;
}

function visit(sweep: DiceSweep, id: string) {
  if (sweep.visited.has(id)) return false;
  sweep.visited.add(id);
  if (sweep.add) sweep.ids.add(id); else sweep.ids.delete(id);
  return true;
}

export function moveDiceSweep(sweep: DiceSweep, x: number, y: number, hitTest: (x: number, y: number) => string | undefined) {
  // Sample between pointer events so a fast sweep still reaches each crossed die.
  const steps = Math.max(1, Math.ceil(Math.hypot(x - sweep.x, y - sweep.y) / 10));
  let changed = false;
  for (let step = 1; step <= steps; step++) {
    const id = hitTest(sweep.x + (x - sweep.x) * step / steps, sweep.y + (y - sweep.y) * step / steps);
    if (id && visit(sweep, id)) changed = true;
  }
  sweep.x = x;
  sweep.y = y;
  return changed;
}
