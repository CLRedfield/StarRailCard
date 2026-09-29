"""Reproducible released-data import. Python integers preserve 64-bit text hashes.

Raw upstream files stay in .cache; the browser receives only normalized used data.
Run: python scripts/import_game_data.py
"""
from __future__ import annotations
import concurrent.futures, hashlib, json, re, time, urllib.request, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache' / 'release-data'
OUT = ROOT / 'src' / 'data'
REFS = {'4.0': 'ef1a136031756a146f51891f135c337e4ea87487', '4.2': '8a83702254b0f44188b6e2ca2f889e5a2ba4a8a1'}
API = 'https://gitlab.com/api/v4/projects/Dimbreath%2Fturnbasedgamedata/repository/files/'
TABLES = ['ActivityDiceAvatarConfig','ActivityDiceAvatarLevel','ActivityDiceConfig','ActivityDiceContentConfig','ActivityDiceSkill','ActivityDiceEffect','ActivityDiceGlossary','ActivityDiceCampaignConfig','ActivityDiceStageConfig','ActivityDiceSpecialRule','ActivityDiceRuleGroup','ActivityDicePresetConfig','ActivityDiceRankConfig','ActivityDiceShopConfig','ActivityDiceShopGoodsConfig','ActivityDiceUnlockTips','ActivityDiceGoodsUnlockTips','ActivityDiceConstValueCommo','ActivityDiceLuckControl','ActivityDiceModifier','ActivityDiceV2Stage','ActivityDiceV2PVEStage','ActivityDiceV2TacticsCard','ActivityDiceV2TacticsPoint','ActivityDiceV2Opponent','ActivityDiceV2Robot','ActivityDiceV2Brand','ActivityDiceV2BossAdvice']
TABLES += ['OfferingLevelConfig','OfferingTypeConfig','RewardData','ItemConfig','MainMission']

def fetch(version, path):
    dest = CACHE / version / path
    if not dest.exists():
        url = API + urllib.parse.quote(path, safe='') + '/raw?ref=' + REFS[version]
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers={'User-Agent':'StarRailCard-Noncommercial-Fan-Project/1.0'})
                with urllib.request.urlopen(req, timeout=50) as response: raw = response.read()
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(raw)
                break
            except Exception:
                if attempt == 3: raise
                time.sleep(attempt + 1)
    def preserve_duplicate_keys(pairs):
        if len({k for k,v in pairs}) < len(pairs): return {'$entries':[{'key':k,'value':v} for k,v in pairs]}
        return dict(pairs)
    return json.loads(dest.read_text('utf-8'), object_pairs_hook=preserve_duplicate_keys)

def clean(text):
    return re.sub(r'<[^>]*>', '', str(text)).replace('\\n', '\n').replace('\u00a0',' ').replace('{NICKNAME}', '开拓者').strip()

def text(obj, params=()):
    raw = TEXT.get(str(obj.get('Hash')), '') if isinstance(obj, dict) else str(obj or '')
    for index in range(len(params), 0, -1): raw = re.sub(r'#'+str(index)+r'(?:\[[^]]*\])?', str(params[index-1]), raw)
    return clean(raw)

def jwrite(name, value):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / (name+'.json')).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', 'utf-8')

def raw_values(row): return list(row.values())

def main():
    global TEXT
    jobs = [('4.2', 'TextMap/TextMapCHS.json')] + [('4.2','ExcelOutput/'+name+'.json') for name in TABLES]
    jobs += [('4.0','ExcelOutput/'+name+'.json') for name in ['ActivityDiceAvatarConfig','ActivityDiceConfig','ActivityDiceSkill','ActivityDiceStageConfig','ActivityDiceCampaignConfig','ActivityDiceRuleGroup','ActivityDiceSpecialRule','ActivityDiceRankConfig','ActivityDiceShopGoodsConfig']]
    jobs += [('4.2',f'Config/Level/Mission/{id}/MissionInfo_{id}.partial.json') for id in [8040100,8040101,8042200]]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for (version,path), result in zip(jobs, pool.map(lambda job: fetch(*job), jobs)):
            print(version, path, len(result), flush=True)
    TEXT = fetch('4.2','TextMap/TextMapCHS.json')
    tables = {name:fetch('4.2','ExcelOutput/'+name+'.json') for name in TABLES}
    old_cards = {str(x['DiceAvatarID']) for x in fetch('4.0','ExcelOutput/ActivityDiceAvatarConfig.json')}
    old_dice = {str(next(iter(x.values()))) for x in fetch('4.0','ExcelOutput/ActivityDiceConfig.json')}
    skills = {str(x['GKEMENLDNNC']):x for x in tables['ActivityDiceSkill']}
    content = {x['ContentID']:x for x in tables['ActivityDiceContentConfig']}
    rawdice = {str(x['AKHFGCHPLGP']):x for x in tables['ActivityDiceConfig']}
    items={str(x['ID']):x for x in tables['ItemConfig']}
    dice = []
    for id, row in rawdice.items():
        params=row.get('NCMIBMACPJI',[])
        faces=[]
        for face in row['PKJCHBAHOKB']:
            info=content.get(face, {})
            value=info.get('Content',face if face<=20 else 0)
            faces.append({'value':value,'contentId':str(face),'description':text(info.get('SKillDesc',{}),[value]+info.get('SkillParam',[])),'params':info.get('SkillParam',[]),'skillPath':info.get('DiceSkillJsonPath',''),'imagePath':info.get('ImgPath','')})
        dice.append({'id':id,'name':text(row.get('AICNJNMPHGK',{})) or {'Blue':'蓝色四面骰','Purple':'紫色六面骰','Orange':'橙色八面骰','Colorful':'曜彩骰'}.get(row['INGKIPFOCLM'],row['KBEDCLBFOBI']), 'description':text(row.get('BMMHNFGANEM',{}),params),'sides':int(row['KBEDCLBFOBI'][1:]),'color':row['INGKIPFOCLM'],'faces':faces,'params':params,'condition':row.get('PAJNMMECDIK','Both'),'conditionPath':row.get('KKBAKIEAAFE',''),'collectible':bool(row.get('MPJFMIBOIOG',False)) or row['INGKIPFOCLM']!='Colorful','version':'4.0' if id in old_dice else '4.2'})
        if row.get('MPJFMIBOIOG') and items.get(id,{}).get('ItemFigureIconPath'):
            dice[-1]['imagePath']=items[id]['ItemFigureIconPath'];dice[-1]['image']=f'assets/dice/{id}.png'
    cards=[]
    for row in tables['ActivityDiceAvatarConfig']:
        id=str(row['DiceAvatarID']); skill=skills.get(str(row['SkillID']),{}); params=skill.get('EKHPCGCECOH',[])
        ids=[]
        for die,count in zip(row['DiceIDPerRare'][:3],row['DiceCountPerRare'][:3]): ids.extend([str(die)]*count if die else [])
        side_pool=[int(rawdice[d]['KBEDCLBFOBI'][1:]) for d in ids if d in rawdice]
        prism=str(row['DiceIDPerRare'][3]) if len(row['DiceIDPerRare'])>3 and row['DiceIDPerRare'][3] else None
        cards.append({'id':id,'name':text(row['Name']),'hp':row['HP'],'attack':row.get('AttackDiceNumber',0),'defense':row.get('DefendDiceNumber',0),'dice':side_pool,'baseDiceIds':ids,'skill':str(row['SkillID']),'skillId':str(row['SkillID']),'description':text(skill.get('KLELLNFDBKM',{}),params),'descriptionTemplate':text(skill.get('KLELLNFDBKM',{})),'params':params,'aiParams':skill.get('IDFPCABEAGE',[]),'rarity':row['Rare'],'prismaticId':prism,'prismaticUses':2 if prism else 0,'prismaticStockCount':row['DiceCountPerRare'][3] if prism else 0,'image':f'assets/cards/{id}.png','imagePath':row['ImgPath'],'headImagePath':row['ImgPathHeadIcon'],'collectible':bool(row.get('IsCollection')),'recommendedDiceIds':[str(x) for x in row.get('RecommendDiceIDList',[])],'version':'4.0' if id in old_cards else '4.2','skillPath':skill.get('AGKDIBJPOBG','')})
    weather=[]
    for row in tables['ActivityDiceSpecialRule']:
        params=row.get('ParamList',[])
        weather.append({'id':str(row['SpecialRuleID']),'name':text(row.get('Name')),'description':text(row.get('Desc'),params),'descriptionTemplate':text(row.get('Desc')),'params':params,'effect':str(row.get('ModifierID','')),'tag':row.get('RuleTag',''),'showType':row.get('ShowType',''),'imagePath':row.get('IconPath',''),'skillPath':row.get('SpecialRuleJson','')})
    tactics=[]
    for row in tables['ActivityDiceV2TacticsCard']:
        params=row.get('EKHPCGCECOH',[])
        tactics.append({'id':str(row['HNFGPHHKCJI']),'name':text(row['AICNJNMPHGK']),'description':text(row['KLELLNFDBKM'],params),'descriptionTemplate':text(row['KLELLNFDBKM']),'params':params,'cost':row.get('IEDCIFLPLNF',0),'kind':row.get('KBEDCLBFOBI','Both').lower(),'rank':row['MPNIDOCDOPG'],'effect':str(row['DNKJHILBPBA']),'amount':params[0] if params else 0,'imagePath':row['JHHHONJIKGL']})
    glossary=[{'id':str(x['HNFGPHHKCJI']),'name':text(x['AICNJNMPHGK']),'description':text(x['KLELLNFDBKM']),'imagePath':x['EOGLPPDKGED']} for x in tables['ActivityDiceGlossary']]
    jwrite('tacticsPoints',[{'id':str(x['HNFGPHHKCJI']),'trigger':x.get('MLCHGLLBPNG','TurnStart'),'params':x.get('FHAMMKLJJNN',[]),'amount':x['KDBCIPPKDOK'],'description':text(x['ONHAPIHDBGM'],[x['KDBCIPPKDOK']])} for x in tables['ActivityDiceV2TacticsPoint']])
    stages=[]
    for x in tables['ActivityDiceStageConfig']:
        stages.append({'id':str(x['DiceStageID']),'cardId':str(x['DiceAvatarID']),'foilLevel':x.get('DiceAvatarLevel',1),'diceIds':x.get('DiceIDPerRare',[]),'presetId':str(x.get('PresetID','')),'aiLevel':x.get('AILevel',1),'difficulty':x.get('HardLevel',1),'rewardId':str(x.get('RewardID','')),'recommendedCardIds':[str(y) for y in x.get('RecommendAvatarList',[])]})
    campaigns=[]
    mission_entries={x['ID']:x for id in [8040100,8040101,8042200] for x in fetch('4.2',f'Config/Level/Mission/{id}/MissionInfo_{id}.partial.json')['SubMissionList']}
    rule_groups={str(x['ID']):[str(rule) for rule in x.get('RuleList',[])] for x in tables['ActivityDiceRuleGroup']}
    for x in tables['ActivityDiceCampaignConfig']:
        stage_ids=[str(s) for s in mission_entries[x['SubMissonID']].get('ParamIntList',[])]
        rules=[{'round':v.get('MFOCBKDCFLL'),'groupId':str(v.get('LMMOHCCHKKO','')),'weatherIds':rule_groups.get(str(v.get('LMMOHCCHKKO','')),[])} for v in x.get('RuleGroupMapList',[])]
        campaigns.append({'id':str(x['DiceCampaignID']),'name':text(x['Name']),'title':text(x.get('ProgressTitle')),'progress':x.get('Progress',1),'displayProgress':x.get('DisplayProgress',[]),'intro':text(x.get('EnterProgress')),'lossText':text(x.get('LoseBattle')),'outro':text(x.get('ExitProgress')),'stageIds':stage_ids,'cardIds':[s['cardId'] for s in stages if s['id'] in stage_ids],'missionId':str(x['SubMissonID']),'ruleGroups':rules,'imagePath':x.get('MainPageIMGPath',''),'image':f"assets/classicCampaigns/{x['DiceCampaignID']}.png"})
    coop=[]
    opponents={x['HNFGPHHKCJI']:x for x in tables['ActivityDiceV2Opponent']}
    for x in tables['ActivityDiceV2Stage']:
        opponent=opponents[x['LJKLBANOKIG']]
        coop.append({'id':str(x['HNFGPHHKCJI']),'name':text(opponent['DPBKBGAFDCD']),'opponentName':text(opponent['HIHGHCNMPLG']),'chapter':x['LJKLBANOKIG'],'difficulty':'challenge' if x['HNFGPHHKCJI']>=2000 else 'story','bossCardIds':[str(y) for y in x['GKGIBGLDNJJ']],'lives':x.get('NIJBLDPAIHO',3),'recommendedCardIds':[str(y) for y in x.get('ACCODFNEMBJ',[])],'tacticsWeights':[{'id':str(y['HKALDMMDMHA']),'weight':y['KFACJPFHKFP']} for y in x.get('PAOGDFOBANM',[])],'imagePath':x.get('KHKLLGGEOFC',''),'backgroundPath':x.get('CLOALHFMGEO',''),'image':f"assets/coopStages/{x['HNFGPHHKCJI']}.png",'raw':x})
    pve=[]
    for x in tables['ActivityDiceV2PVEStage']:
        pve.append({'id':str(x['HNFGPHHKCJI']),'name':text(x['KJGLKAGMNIP']),'cardId':str(x['DDHAOIPMLHF']),'foilLevel':x.get('COGEPCLHLEM',3),'presetId':str(x.get('NHLHFOFCLFO','')),'rewardId':str(x.get('GGCKMOJNIIN','')),'avatarPath':x.get('NAHIHGLOMBL',''),'dialoguePath':x.get('BPAHGIHKIIH','')})
    for stage in coop:
        companion=next((p for p in pve if p['id']==stage['id']),None)
        if companion: stage.update({'companionName':companion['name'],'companionCardId':companion['cardId'],'rewardId':companion['rewardId']})
    used_names={}
    def replace_hashes(value):
        if isinstance(value,dict):
            if set(value)=={'Hash'}: return text(value)
            return {k:replace_hashes(v) for k,v in value.items()}
        if isinstance(value,list): return [replace_hashes(v) for v in value]
        return value
    progression={name.removeprefix('ActivityDice'):replace_hashes(tables[name]) for name in ['ActivityDiceRankConfig','ActivityDiceShopConfig','ActivityDiceShopGoodsConfig','ActivityDiceUnlockTips','ActivityDiceGoodsUnlockTips','ActivityDiceRuleGroup','ActivityDicePresetConfig','ActivityDiceV2TacticsPoint','ActivityDiceV2Brand','ActivityDiceV2Opponent','ActivityDiceV2BossAdvice']}
    currency_map={264996:'coins',264997:'victoryCoins',269001:'paintCoins',264998:'dust',264999:'xp'}
    names={x['id']:x['name'] for x in cards+dice}
    shop_ids={good:shop['DiceShopID'] for shop in tables['ActivityDiceShopConfig'] for good in shop['GoodsList']}
    campaign_missions={int(c['missionId']):'classic-'+c['id'] for c in campaigns}
    def mission_requirement(id,seen=None):
        seen=set(seen or [])
        if id in seen:return []
        seen.add(id)
        if id in campaign_missions:return [campaign_missions[id]]
        row=mission_entries.get(id,{})
        if row.get('FinishType')=='DiceCombatV2FinishPVEStage':return ['coop-'+str(s) for s in row.get('ParamIntList',[])]
        return list(dict.fromkeys(c for p in row.get('TakeParamIntList',[]) for c in mission_requirement(p,seen)))
    shop_goods=[]
    for x in tables['ActivityDiceShopGoodsConfig']:
        condition=x.get('UnlockCondition',[])
        level=next((int(c['Param'].split('-')[-1]) for c in condition if c['Type']=='OfferingLevel'),0)
        item=str(x['ItemID']); costs=x['ItemCost']; cost=costs[0]
        mission_ids=[c['Param'] for c in condition if c['Type']=='FinishSubMission']
        shop_goods.append({'id':str(x['DiceShopGoodsID']),'itemId':item,'type':'card' if item in {c['id'] for c in cards} else 'dice','name':names.get(item,item),'currency':currency_map[cost['ItemID']],'cost':cost['ItemNum'],'unlockLevel':level,'missionIds':mission_ids,'unlockChallenges':list(dict.fromkeys(c for m in mission_ids for c in mission_requirement(int(m)))),'shopId':str(shop_ids[x['DiceShopGoodsID']]),'conditions':condition})
    reward_source={str(x['RewardID']):x for x in tables['RewardData']}
    def normalize_reward(id):
        row=reward_source.get(str(id),{})
        reward={'coins':0,'victoryCoins':0,'paintCoins':0,'dust':0,'xp':0,'cardIds':[],'diceIds':[]}
        for i in range(1,10):
            item=row.get('ItemID_'+str(i)); count=row.get('Count_'+str(i),0)
            if item in currency_map: reward[currency_map[item]]+=count
            elif str(item) in {c['id'] for c in cards}: reward['cardIds'].append(str(item))
            elif str(item) in rawdice: reward['diceIds'].append(str(item))
            elif item==150093: reward['prismaticEdit']=True
        return reward
    levels=[]; cumulative=0
    for x in tables['OfferingLevelConfig']:
        if x['TypeID']!=12:continue
        cumulative+=x['ItemCost']
        levels.append({'level':x['Level'],'xpCost':x['ItemCost'],'xpTotal':cumulative,'rewardId':str(x['RewardID']),'reward':normalize_reward(x['RewardID'])})
    gifts=[
        {'id':'gift-scott','name':'斯科特','title':'赠卡挑战','intro':'来一场堂堂正正的决斗，把斯科特收入你的角色收藏。','opponentId':'264011','unlockChallengeId':'classic-2','rewardId':'2001695'},
        {'id':'gift-aventurine','name':'银河战力党传说','title':'赠卡挑战','intro':'与砂金一决高下。这一回，把好运握在自己手中。','opponentId':'264018','unlockChallengeId':'classic-11','rewardId':'15000503'},
        {'id':'gift-himeko','name':'孤狼之血','title':'赠卡挑战','intro':'与姬子完成一场特别的切磋，收下这份旅途的纪念。','opponentId':'264035','unlockChallengeId':'coop-1006','rewardId':'12054200'},
    ]
    main_missions={x['MainMissionID']:x for x in tables['MainMission']}
    for gift,mission_id in [(gifts[1],5000503),(gifts[2],2054200)]:
        gift['name']=text(main_missions[mission_id]['Name']);gift['rewardId']=str(main_missions[mission_id]['RewardID'])
    jwrite('giftChallenges',gifts)
    streets=[{'id':'street-'+s['id'],'stageId':s['id'],'name':names[s['cardId']],'title':'街头切磋','intro':f"与使用「{names[s['cardId']]}」的牌手切磋。首次获胜可领取本场原始奖励。",'opponentId':s['cardId'],'unlockChallengeId':'classic-1','rewardId':s['rewardId'],'foilLevel':s['foilLevel'],'diceIds':s['diceIds'],'aiLevel':s['aiLevel'],'difficulty':s['difficulty']} for s in stages if 2001<=int(s['id'])<=4013]
    jwrite('streetChallenges',streets)
    used_rewards={s['rewardId'] for s in stages+pve}|{x['rewardId'] for x in levels}|{'2001691'}|{x['rewardId'] for x in gifts}
    rewards={id:normalize_reward(id) for id in sorted(used_rewards)}
    normalized_progression={'starterCardIds':['264000'],'starterRewardId':'2001691','xpItemId':'264999','maxLevel':25,'prismaticUnlockLevel':5,'levels':levels,'foil':{'cosmeticOnly':True,'costs':[60,180],'maxLevelByRarity':{'1':2,'2':2,'3':3},'mappingStatus':'ordered-values-inference; upstream MapValue keys omitted'},'currencyItemIds':{v:str(k) for k,v in currency_map.items()}}
    jwrite('shopGoods',shop_goods);jwrite('rewards',rewards);jwrite('profileProgression',normalized_progression)
    for name,data in [('cards',[x for x in cards if x['collectible']]),('bossCards',[x for x in cards if not x['collectible']]),('dice',dice),('weather',weather),('tactics',tactics),('glossary',glossary),('classicStages',stages),('classicCampaigns',campaigns),('coopStages',coop),('pveStages',pve),('progression',progression),('constants',tables['ActivityDiceConstValueCommo'])]: jwrite(name,data)
    provenance=[]
    for version,path in jobs:
        raw=(CACHE/version/path).read_bytes()
        provenance.append({'version':version,'path':path,'commit':REFS[version],'sha256':hashlib.sha256(raw).hexdigest(),'url':API+urllib.parse.quote(path,safe='')+'/raw?ref='+REFS[version]})
    jwrite('provenance',provenance)
    print('Generated',len(cards),'cards incl boss;',len(dice),'dice;',len(tactics),'tactics.',flush=True)

if __name__=='__main__': main()
