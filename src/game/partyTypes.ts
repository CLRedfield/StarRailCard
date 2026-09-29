import type { GameCatalog, GameEvent, PlayerConfig, PlayerState, PlayerPreview } from './types';

export type PartyMode = 'treasure' | 'raid' | 'duos' | 'overlord';
export type PartyPhase = 'planning' | 'results' | 'finished';
export type PartyStance = 'assault' | 'guard' | 'support';
export type PartyUpgrade = 'power' | 'ward' | 'fortune';
export type OverlordMove = 'sweep' | 'drain' | 'eruption';
export interface PartyConfig { mode: PartyMode; players: PlayerConfig[]; catalog?: GameCatalog; maxRounds?: number; }
export interface PartyPlan { targetId: string; stance: PartyStance; supportPlayerId?: string; }
export interface PartyPlayer extends PlayerState {
  teamId: string; role: 'hero' | 'boss'; score: number; ready: boolean; plan: PartyPlan;
  contribution: number; supplies: number; upgrades: Record<PartyUpgrade, number>; upgradedThisRound: boolean; exchangedThisRound: boolean;
}
export interface PartyTarget {
  id: string; name: string; description: string; kind: 'fire' | 'bastion' | 'puzzle' | 'core' | 'shield' | 'charge' | 'arena';
  hp: number; maxHp: number; reward: number; difficulty: number; broken: boolean;
}
export interface PartyRoundResult { playerId: string; targetId: string; value: number; damage: number; score: number; text: string; }
export interface PartyEvent { id: number; round: number; text: string; playerId?: string; }
export interface PartyState {
  kind: 'party'; version: 1; mode: PartyMode; phase: PartyPhase; round: number; maxRounds: number;
  seed: number; nextId: number; players: PartyPlayer[]; catalog: GameCatalog; targets: PartyTarget[];
  weatherId: string | null; roundRule: { name: string; description: string; kind: 'bounty' | 'precision' | 'respite' | 'surge' };
  crisis: number; maxCrisis: number; bossPhase: number; bossMoves: OverlordMove[]; bossMove: OverlordMove;
  bossTelegraph: string; bossPlayerId: string | null; bossHp: number; bossMaxHp: number;
  log: PartyEvent[]; results: PartyRoundResult[]; battleEvents: GameEvent[];
  /** Persistent objective combatants retain poison and other character effects. */
  enemies: Record<string, PlayerState>;
  /** Before role-dependent round preparation; used to change plans losslessly. */
  roundStarts: Record<string, PlayerState>;
  winnerTeamIds: string[]; reason?: string;
}
export type PartyCommand = { playerId: string } & (
  | { type: 'select'; diceIds: string[] }
  | { type: 'reroll'; diceIds: string[] }
  | { type: 'prismatic' }
  | { type: 'exchange'; targetPlayerId: string; ownDieId: string; targetDieId: string }
  | { type: 'plan'; targetId: string; stance: PartyStance; supportPlayerId?: string }
  | { type: 'bossMove'; move: OverlordMove }
  | { type: 'confirm'; diceIds?: string[] }
  | { type: 'ready' }
  | { type: 'upgrade'; upgrade: PartyUpgrade }
);
export interface PartyLegalActions {
  canAct: boolean; canSelect: boolean; canReroll: boolean; canPrismatic: boolean; canConfirm: boolean;
  canPlan: boolean; canReady: boolean; canUpgrade: boolean; canExchange: boolean; minDice: number; maxDice: number; requiredDice: number;
  targetIds: string[]; supportPlayerIds: string[]; reason?: string;
}
export interface PartyPreview extends PlayerPreview { role: 'attack' | 'defense'; objectiveValue: number; objectiveHint: string; }
export interface PartyCommandResult { state: PartyState; error?: string; }
