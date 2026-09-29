import type { GameCommand } from '../game/types';
import type { SoundKind } from './audio';
import type { BattlePresentation } from './useBattlePresentation';

/** Command feedback belongs to the person who completed it, never the AI. */
export function commandSuccessSound(command: GameCommand, isAI: boolean): SoundKind | undefined {
  if (isAI) return undefined;
  if (command.type === 'confirm') return 'confirm';
  if (['swap', 'buyTactic', 'refreshTactics', 'useTactic', 'discardTactic', 'leaveTactics'].includes(command.type)) return 'click';
  return undefined;
}

/** Follows the visual event order, including damage IDs presented after a later reroll ID. */
export class BattleSoundTracker {
  private matchKey: string | undefined;
  private seenEvents = new Set<number>();
  private seenStages = new Set<string>();
  private finished = false;

  consume(frame: BattlePresentation, matchKey: string, active = true): SoundKind[] {
    const state = frame.state;
    if (!active || !state) { this.matchKey = undefined; return []; }
    if (this.matchKey !== matchKey) {
      this.matchKey = matchKey;
      this.seenEvents = new Set(state.log.map(event => event.id));
      this.seenStages = new Set(state.log.flatMap(event => [`strike:${event.id}`, `transform:${event.id}`]));
      this.finished = state.phase === 'finished';
      return []; // Restored snapshots never replay historical effects or victory.
    }
    const sounds: SoundKind[] = [];
    const stage = (id: string, sound: SoundKind) => {
      if (this.seenStages.has(id)) return;
      this.seenStages.add(id); sounds.push(sound);
    };
    if (frame.phase === 'transform' && frame.activeEffect?.effectKind) stage(`transform:${frame.activeEffect.id}`, frame.activeEffect.effectKind);
    // Reduced motion omits the flight; play the same attack once at contact instead.
    if ((frame.phase === 'strike' || frame.phase === 'impact') && frame.activeStrike && frame.activeEvent) stage(`strike:${frame.activeEvent.id}`, 'attack');
    for (const event of state.log) {
      if (this.seenEvents.has(event.id)) continue;
      this.seenEvents.add(event.id);
      if ((event.type === 'roll' || event.type === 'reroll' || event.type === 'turn') && state.phase !== 'finished') {
        if (!sounds.includes('roll')) sounds.push('roll');
      } else if (event.type === 'damage' && (event.amount || 0) > 0) {
        sounds.push(event.damageKind === 'poison-trigger' || event.damageKind === 'poison-tick' ? 'poison' : 'damage');
      } else if (event.type === 'heal' && (event.amount || 0) > 0) sounds.push('heal');
    }
    if (state.phase === 'finished' && !this.finished) sounds.push('win');
    this.finished = state.phase === 'finished';
    return sounds;
  }
}
