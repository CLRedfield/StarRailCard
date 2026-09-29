export interface CardDefinition {
  id: string; name: string; hp: number; attack: number; defense: number;
  dice: number[]; baseDiceIds: string[]; skill: string; skillId: string;
  description: string; descriptionTemplate: string; params: number[]; aiParams: number[];
  rarity: number; prismaticId: string | null; prismaticUses: number;prismaticStockCount:number;
  image: string; imagePath: string; headImagePath: string; collectible: boolean;
  recommendedDiceIds: string[]; version: string; skillPath: string;
}
export interface DiceFaceDefinition { value: number; contentId: string; description: string; params: number[]; skillPath: string; imagePath: string; effect?: string; amount?: number }
export interface DiceDefinition { id: string; name: string; description: string; sides: number; color: string; faces: DiceFaceDefinition[]; params: number[]; condition: string; conditionPath: string; collectible: boolean; version: string;image?:string;imagePath?:string }
export type PrismaticDefinition = DiceDefinition;
export interface WeatherDefinition { id: string; name: string; description: string; descriptionTemplate: string; params: number[]; effect: string; tag: string; showType: string; imagePath: string; skillPath: string }
export interface TacticDefinition { id: string; name: string; description: string; descriptionTemplate: string; params: number[]; cost: number; kind: string; rank: number; effect: string; amount: number; imagePath: string }
export interface ClassicStageDefinition { id: string; cardId: string; foilLevel: number; diceIds: number[]; presetId: string; aiLevel: number; difficulty: number; rewardId: string; recommendedCardIds: string[] }
export interface ClassicCampaignDefinition { id: string; name: string; title: string; progress: number; displayProgress: number[]; intro: string; lossText: string; outro: string; stageIds:string[];cardIds:string[];missionId:string;ruleGroups: {round: number;groupId: string;weatherIds:string[]}[]; imagePath: string;image:string }
export interface CoopStageDefinition { id: string;name:string;opponentName:string;difficulty:'story'|'challenge'; chapter: number; bossCardIds: string[]; lives: number; recommendedCardIds: string[]; tacticsWeights: {id:string;weight:number}[]; imagePath: string; backgroundPath: string;image:string;companionName?:string;companionCardId?:string;rewardId?:string; raw: Record<string,unknown> }
export interface PveStageDefinition { id:string;name:string;cardId:string;foilLevel:number;presetId:string;rewardId:string;avatarPath:string;dialoguePath:string }
export interface GlossaryDefinition { id: string; name:string;description:string;imagePath:string }
export type Currency = 'coins' | 'victoryCoins' | 'paintCoins' | 'dust';
export interface ShopGoodsDefinition {id:string;itemId:string;type:'card'|'dice';name:string;currency:Currency;cost:number;unlockLevel:number;missionIds:string[];unlockChallenges:string[];shopId:string;conditions:{Type:string;Param:string}[]}
export interface RewardDefinition {coins:number;victoryCoins:number;paintCoins:number;dust:number;xp:number;cardIds:string[];diceIds:string[];prismaticEdit?:boolean}
export interface GiftChallengeDefinition { id:string;name:string;title:string;intro:string;opponentId:string;unlockChallengeId:string;rewardId:string }
export interface StreetChallengeDefinition extends GiftChallengeDefinition { stageId:string;foilLevel:number;diceIds:number[];aiLevel:number;difficulty:number }
