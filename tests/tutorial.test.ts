import { describe, expect, it } from 'vitest';
import { applyCommand, chooseAiCommand, createMatch, getLegalActions, type GameCommand, type GameState } from '../src/game';
import { getChallenges } from '../src/components/Campaign';
import { advanceTutorial, createTutorialProgress, getPrismaticLesson, getTutorialStep, restartTutorial, skipTutorial, updateTutorialProgress, type TutorialProgress } from '../src/lib/tutorial';

function firstChallenge(seed: number | string = 'first-lesson-20260929'): GameState {
  const challenge = getChallenges().find(c => c.id === 'classic-1')!;
  return createMatch({ mode: 'classic', players: [
    { id: 'you', name: '开拓者', cardId: '264000', prismaticId: '' },
    { id: 'enemy', name: challenge.name, cardId: challenge.opponentId, isAI: true },
  ], weather: challenge.weather }, seed);
}
function command(state: GameState, command: GameCommand): GameState {
  const result = applyCommand(state, command);
  expect(result.error).toBeUndefined();
  return result.state;
}
function select(state: GameState, count: number): GameState {
  const player = state.players[0];
  return { ...state, players: [{ ...player, selectedIds: [...player.dice].sort((a, b) => b.value - a.value).slice(0, count).map(d => d.id) }, ...state.players.slice(1)] };
}
function aiUntilPlayer(state: GameState): GameState {
  for (let i = 0; i < 20 && state.phase !== 'finished' && state.activePlayerId !== 'you'; i++) {
    const cmd = chooseAiCommand(state, 'enemy');
    if (!cmd) throw new Error('AI cannot continue its turn');
    state = command(state, cmd);
  }
  return state;
}

describe('first challenge interactive tutorial', () => {
  it('marks the original first campaign as teaching while preserving stage and rewards', () => {
    const challenges = getChallenges();
    expect(challenges.find(c => c.id === 'classic-1')).toMatchObject({ tutorial: true, stageId: '9001', opponentId: '264025', rewardId: '8014001' });
    expect(challenges.filter(c => c.tutorial)).toHaveLength(1);
  });

  it('uses real starter dice, accepts an actual reroll, resolves attack, then teaches defense', () => {
    let state = firstChallenge();
    expect(state.players[0].hp).toBe(25);
    let progress = createTutorialProgress(state, 'you');
    expect(getTutorialStep(state, 'you', progress).id).toBe('intro');
    expect(getTutorialStep(state, 'you', progress).pauseOpponent).toBe(true);
    progress = advanceTutorial(state, 'you', progress);
    expect(getTutorialStep(state, 'you', progress).id).toBe('reroll-select');
    state = select(state, 1);
    expect(getTutorialStep(state, 'you', progress).id).toBe('reroll');
    expect(updateTutorialProgress(state, 'you', progress).rerolled).toBe(false);
    state = command(state, { type: 'reroll', playerId: 'you', diceIds: state.players[0].selectedIds });
    progress = updateTutorialProgress(state, 'you', progress);
    expect(progress.rerolled).toBe(true);
    expect(getTutorialStep(state, 'you', progress).id).toBe('attack-select');
    state = select(state, getLegalActions(state, 'you').requiredDice);
    expect(getTutorialStep(state, 'you', progress).id).toBe('attack-confirm');
    state = command(state, { type: 'confirm', playerId: 'you', diceIds: state.players[0].selectedIds });
    progress = updateTutorialProgress(state, 'you', progress);
    expect(progress.attackConfirmed).toBe(true);
    expect(getTutorialStep(state, 'you', progress).pauseOpponent).toBe(false);
    state = aiUntilPlayer(state);
    progress = updateTutorialProgress(state, 'you', progress);
    expect(state.turn).toBe(2);
    expect(progress.attackResult).toBeDefined();
    const summary = getTutorialStep(state, 'you', progress);
    expect(summary.id).toBe('attack-result');
    expect(summary.text).toContain(`普通攻击实际扣血 ${state.lastResolution!.strikes[0].amount}`);
    expect(summary.pauseOpponent).toBe(true);
    progress = advanceTutorial(state, 'you', progress);
    expect(getTutorialStep(state, 'you', progress).id).toBe('defense-select');
    state = select(state, getLegalActions(state, 'you').requiredDice);
    expect(getTutorialStep(state, 'you', progress).id).toBe('defense-confirm');
    state = command(state, { type: 'confirm', playerId: 'you', diceIds: state.players[0].selectedIds });
    progress = updateTutorialProgress(state, 'you', progress);
    expect(progress.defenseConfirmed).toBe(true);
    expect(getTutorialStep(state, 'you', progress).id).toBe('defense-result');
    progress = advanceTutorial(state, 'you', progress);
    expect(getTutorialStep(state, 'you', progress).id).toBe('complete');
    expect(getTutorialStep(state, 'you', progress).hint).toContain('没有曜彩骰');
    progress = advanceTutorial(state, 'you', progress);
    expect(progress.status).toBe('completed');
    expect(getTutorialStep(state, 'you', progress).id).toBe('inactive');
  });

  it('does not trap a player who confirms immediately, runs out of rerolls, or ends early', () => {
    let state = firstChallenge(123);
    let progress = advanceTutorial(state, 'you', createTutorialProgress(state, 'you'));
    state = select(state, 3);
    state = command(state, { type: 'confirm', playerId: 'you', diceIds: state.players[0].selectedIds });
    progress = updateTutorialProgress(state, 'you', progress);
    expect(progress.rerolled).toBe(false);
    expect(progress.attackConfirmed).toBe(true);
    expect(getTutorialStep(state, 'you', progress).id).toBe('defense-wait');
    state = aiUntilPlayer(state);
    progress = advanceTutorial(state, 'you', updateTutorialProgress(state, 'you', progress));
    expect(getTutorialStep(state, 'you', progress).id).toBe('defense-select');
    const fresh = firstChallenge(124); fresh.players[0].rerolls = 0;
    const noRerolls = advanceTutorial(fresh, 'you', createTutorialProgress(fresh, 'you'));
    expect(getTutorialStep(fresh, 'you', noRerolls).id).toBe('attack-select');
    const ended = command(fresh, { type: 'surrender', playerId: 'you' });
    expect(getTutorialStep(ended, 'you', noRerolls).id).toBe('complete');
    expect(getTutorialStep(ended, 'you', noRerolls).title).toBe('本局教学告一段落');
  });

  it('restores progress from JSON and authoritative history, never from the chosen point values', () => {
    let state = firstChallenge(555);
    let progress = advanceTutorial(state, 'you', createTutorialProgress(state, 'you'));
    state = command(state, { type: 'reroll', playerId: 'you', diceIds: [state.players[0].dice[0].id] });
    progress = updateTutorialProgress(state, 'you', progress);
    const restored = JSON.parse(JSON.stringify(progress)) as TutorialProgress;
    expect(getTutorialStep(JSON.parse(JSON.stringify(state)), 'you', restored).id).toBe('attack-select');
    expect(updateTutorialProgress(state, 'you', restored)).toBe(restored);
    const historical = advanceTutorial(state, 'you', createTutorialProgress(state, 'you'));
    expect(historical.rerolled).toBe(true);
    state = select(state, 3);
    state.players[0].dice.forEach(d => d.value = 1);
    expect(getTutorialStep(state, 'you', historical).id).toBe('attack-confirm');
  });

  it('keeps skipping durable and lets the same match review at its current point', () => {
    const state = firstChallenge();
    let progress = skipTutorial(createTutorialProgress(state, 'you'));
    expect(updateTutorialProgress(state, 'you', progress)).toBe(progress);
    expect(getTutorialStep(state, 'you', progress).pauseOpponent).toBe(false);
    progress = restartTutorial(state, 'you');
    expect(getTutorialStep(state, 'you', progress).id).toBe('intro');
    expect(progress.status).toBe('active');
  });

  it('explains unavailable and conditional prismatic dice without requiring a purchase', () => {
    const state = firstChallenge();
    expect(getPrismaticLesson(state, 'you')).toContain('没有曜彩骰');
    const die = state.catalog.prismatics.find(d => d.condition === 'Defense')!;
    state.players[0].prismaticId = die.id; state.players[0].prismaticUses = 2;
    expect(getPrismaticLesson(state, 'you')).toContain(die.description || '仅防守时可用');
    const restricted = state.catalog.prismatics.find(d => d.description?.includes('累计受到25点伤害'))!;
    state.players[0].prismaticId = restricted.id;
    expect(getPrismaticLesson(state, 'you')).toContain('累计受到25点伤害');
    state.players[0].prismaticUses = 0;
    expect(getPrismaticLesson(state, 'you')).toContain('无需购买');
  });
});
