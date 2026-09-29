export type MatchMode = 'classic' | 'coop';
export type Phase = 'roll' | 'swap' | 'tactics' | 'finished';
export type Side = 0 | 1;

export interface DieFace { value: number; effect?: string; amount?: number }
export interface CardDefinition { id: string; name: string; hp: number; attack: number; defense: number; dice: number[]; skill?: string; prismaticId?: string; prismaticUses?: number; description?: string; image?: string }
export interface PrismaticDefinition { id: string; name: string; faces: DieFace[]; condition?: string; description?: string }
export interface WeatherDefinition { id: string; name: string; effect?: string; description?: string; rounds?: number[] }
export interface TacticDefinition { id: string; name: string; cost: number; kind: 'attack' | 'defense' | 'any'; effect: string; amount?: number; description?: string }
export interface GameCatalog { cards: CardDefinition[]; prismatics: PrismaticDefinition[]; weather: WeatherDefinition[]; tactics: TacticDefinition[] }
export interface PlayerConfig { id: string; name: string; cardId: string; prismaticId?: string; isAI?: boolean; gild?: number }
export interface BossPhase { cardId: string; hp?: number; attack?: number; defense?: number; skill?: string; target?: 'all' | 'highestDefense' | 'lowestDefense' }
export interface MatchConfig { mode: MatchMode; players: PlayerConfig[]; startingSide?: Side | 'random'; weather?: 'random' | 'off' | string[]; bossPhases?: BossPhase[]; coopStageId?: string; maxTurns?: number; catalog?: GameCatalog }
export interface RolledDie { id: string; sides: number; value: number; prismatic: boolean; effect?: string; amount?: number; ownerId: string; typeId?: string; forced?: boolean; poolIndex?: number }
export interface Statuses { strength: number; toughness: number; poison: number; thorns: number; overload: number; interference: number; evolution: number; venom: number; [key: string]: number }
export interface RoundModifiers { attack: number; defense: number; double: number; combo: number; pierce: boolean; penetration: number; forcefield: boolean; unyielding: boolean; counter: boolean; hack: boolean; arise: boolean; siphon: number; reflect: number; nextStrength: number; prismaticRefund: number; attackSync: boolean; defenseSync: boolean; fullSupport: boolean; upgrade: boolean; [key: string]: number | boolean }
export interface PlayerState { id: string; name: string; cardId: string; side: Side; isAI: boolean; gild: number; hp: number; maxHp: number; attackLevel: number; defenseLevel: number; baseDefense: number; dice: RolledDie[]; selectedIds: string[]; rerolls: number; rollsUsed: number; prismaticId?: string; prismaticUses: number; prismaticRolled: boolean; statuses: Statuses; modifiers: RoundModifiers; tactics: string[]; tacticPoints: number; offers: string[]; confirmed: boolean; rollLocked: boolean; shopReady: boolean; totalDamageTaken: number; selectedOnes: number; selectedFours: number; selectedSixes: number; specialTriggers: number; accumulatedPower: number; unyieldingUsed: boolean; bananaUsed: boolean }
export interface DiceChange { dieId: string; before: number; after: number }
export interface ResolutionPlayer { id: string; cardId: string; side: Side; role: 'attack' | 'defense'; value: number; dice: RolledDie[]; effects: string[]; hp?: number; maxHp?: number }
export type DamageKind = 'attack' | 'counter' | 'reflect' | 'poison-trigger' | 'poison-tick' | 'thorns' | 'overload' | 'instant' | 'self-cost';
export interface DamageDetails { damageKind?: DamageKind; sourceLabel?: string; hpBefore?: number; hpAfter?: number; poisonBefore?: number; poisonAfter?: number; thornsBefore?: number; thornsAfter?: number; venomBefore?: number; venomAfter?: number; overloadBefore?: number; overloadAfter?: number; strikeIndex?: number; strikeCount?: number; comboSource?: string; attackerCardId?: string; targetCardId?: string; attack?: number; defense?: number }
export interface ResolutionStrike extends DamageDetails { attackerId: string; defenderId: string; attack: number; defense: number; amount: number; kind: 'attack' | 'counter' | 'reflect' | 'instant'; eventId?: number }
export interface BattleResolution { turn: number; attackingSide: Side; players: ResolutionPlayer[]; strikes: ResolutionStrike[]; events?: GameEvent[]; weatherId?: string | null; weatherName?: string; eventStartId?: number; eventEndId?: number }
export interface GameEvent extends DamageDetails { id: number; type: 'roll' | 'reroll' | 'select' | 'swap' | 'damage' | 'heal' | 'effect' | 'turn' | 'weather' | 'tactic' | 'boss-phase' | 'revive' | 'victory'; playerId?: string; targetId?: string; amount?: number; text: string; dice?: RolledDie[]; effectKind?: 'arise' | 'hack'; diceChanges?: DiceChange[]; previousCardId?: string; sharedLivesAfter?: number; bossPhaseAfter?: number; maxHpAfter?: number; statusesAfter?: Statuses }
export interface GameState { version: 1; mode: MatchMode; phase: Phase; turn: number; seed: number; nextId: number; players: PlayerState[]; activePlayerId: string | null; attackingSide: Side; weatherId: string | null; weatherSchedule: 'random' | 'off' | string[]; sharedLives: number; bossPhase: number; bossPhases: BossPhase[]; swapPool: RolledDie[]; winner: Side | null; reason?: string; maxTurns: number; log: GameEvent[]; catalog: GameCatalog; tacticsWeights?: Record<string, number>; tacticsEnabled?: boolean; lastResolution?: BattleResolution }
export type GameCommand = { playerId: string } & (
  | { type: 'select'; diceIds: string[] }
  | { type: 'reroll'; diceIds: string[] }
  | { type: 'prismatic' }
  | { type: 'confirm'; diceIds?: string[] }
  | { type: 'swap'; ownDieId: string; poolDieId: string }
  | { type: 'buyTactic'; offerIndex: number }
  | { type: 'refreshTactics' }
  | { type: 'useTactic'; handIndex: number }
  | { type: 'discardTactic'; handIndex: number }
  | { type: 'leaveTactics' }
  | { type: 'surrender' }
);
export interface LegalActions { canAct: boolean; canSelect: boolean; canReroll: boolean; canPrismatic: boolean; canConfirm: boolean; canSwap: boolean; canShop: boolean; canUseTactics: boolean; requiredDice: number; minDice: number; maxDice: number; reason?: string }
export interface PlayerPreview { value: number; diceRequired: number; canConfirm: boolean; damageEstimate: number; effects: string[] }
export interface CommandResult { state: GameState; events: GameEvent[]; error?: string }
