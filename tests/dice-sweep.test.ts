import { describe, expect, it } from 'vitest';
import { beginDiceSweep, moveDiceSweep } from '../src/components/diceSweep';

const hit = (x: number, y: number) => y >= 100 && y <= 140 && x >= 20 && x < 200 ? ['a', 'b', 'c'][Math.floor((x - 20) / 60)] : undefined;

describe('table dice sweep', () => {
  it('waits on a blank start, then selects every crossed die in a single fast movement', () => {
    const sweep = beginDiceSweep([], 0, 120);
    expect(sweep.visited.size).toBe(0);
    expect(moveDiceSweep(sweep, 210, 120, hit)).toBe(true);
    expect([...sweep.ids]).toEqual(['a', 'b', 'c']);
  });

  it('adds from blank space even when the first crossed die was already selected', () => {
    const sweep = beginDiceSweep(['a'], 0, 120);
    moveDiceSweep(sweep, 210, 120, hit);
    moveDiceSweep(sweep, 0, 120, hit);
    expect([...sweep.ids]).toEqual(['a', 'b', 'c']);
  });

  it('keeps deselect mode when starting on a selected die and retracing the row', () => {
    const sweep = beginDiceSweep(['a', 'b', 'c', 'uncrossed'], 50, 120, 'a');
    moveDiceSweep(sweep, 210, 120, hit);
    moveDiceSweep(sweep, 50, 120, hit);
    expect([...sweep.ids]).toEqual(['uncrossed']);
  });

  it('ignores blank paths and never selects dice merely by crossing their x coordinates', () => {
    const sweep = beginDiceSweep(['c'], 0, 0);
    expect(moveDiceSweep(sweep, 210, 0, hit)).toBe(false);
    expect([...sweep.ids]).toEqual(['c']);
    expect(sweep.visited.size).toBe(0);
    moveDiceSweep(sweep, 110, 120, hit);
    expect([...sweep.ids]).toEqual(['c', 'b']);
  });
});
