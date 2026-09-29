"""Verify linked game catalog, exact release counts and local asset provenance."""
import hashlib,json,re,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def load(name):return json.loads((ROOT/'src/data'/f'{name}.json').read_text('utf-8'))
original_cards=load('cards');cards=original_cards+load('customCards');boss=load('bossCards');dice=load('dice');weather=load('weather');tactics=load('tactics')
assert len(original_cards)==36 and len(cards)==37 and len(boss)==28
for c in cards: c.update(load('cardBalance').get(c['id'],{}))
assert len(dice)==50 and len([d for d in dice if d['color']=='Colorful' and d['collectible']])==25
assert len(tactics)==24 and len(weather)==31
assert len(load('classicCampaigns'))==11 and len(load('coopStages'))==11
all_cards={c['id']:c for c in cards+boss};dice_ids={d['id'] for d in dice};stage_ids={s['id'] for s in load('classicStages')}
assert len(all_cards)==len(cards)+len(boss)
for c in cards+boss:
 assert c['description'] and c['name'] and c['hp']>0
 assert all(d in dice_ids for d in c['baseDiceIds'])
 assert c['prismaticId'] is None or c['prismaticId'] in dice_ids
 assert all(s in [4,6,8] for s in c['dice'])
 assert not re.search(r'#\d',c['description']), (c['id'],c['description'])
 assert (ROOT/'public'/c['image']).exists(),c['image']
for d in dice:
 assert len(d['faces'])==d['sides'],d['id']
 for f in d['faces']:assert not re.search(r'#\d',f['description']),(d['id'],f)
for c in load('classicCampaigns'):
 assert c['stageIds'] and all(s in stage_ids for s in c['stageIds'])
for c in load('coopStages'):assert all(id in all_cards for id in c['bossCardIds'])
rewards=load('rewards');streets=load('streetChallenges');gifts=load('giftChallenges')
assert len(streets)==116 and len(gifts)==3
for challenge in streets+gifts:
 assert challenge['opponentId'] in all_cards and challenge['rewardId'] in rewards
for street in streets:
 assert street['stageId'] in stage_ids and rewards[street['rewardId']]['coins']==1
for good in load('shopGoods')+load('customShopGoods'):
 assert good['itemId'] in (all_cards if good['type']=='card' else dice_ids)
for item in load('assetManifest'):
 assert 'error' not in item,item
 content=(ROOT/'public'/item['path']).read_bytes()
 assert content.startswith(b'\x89PNG\r\n\x1a\n'),item['path']
 assert hashlib.sha256(content).hexdigest()==item['sha256'],item['path']
 width,height=struct.unpack('>II',content[16:24])
 assert width>0 and height>0,item['path']
print(f'Verified {len(cards)} player cards, {len(boss)} NPC cards, {len(dice)} dice, 24 tactics, 31 weather records, all campaign links, 3 gifts, 116 street challenges, and {len(load("assetManifest"))} original PNG textures.')
