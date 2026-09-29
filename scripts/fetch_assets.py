"""Fetch unmodified released game textures; records source URL and SHA-256.
Only texture paths referenced by the pinned 4.2 game data are downloaded.
"""
import concurrent.futures, hashlib, json, time, urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ASSET_REF='2a4b9a7eb7ac9db7f48d627fa5cdfd3822c902ce'
BASE=f'https://raw.githubusercontent.com/umaichanuwu/StarRailTextures/{ASSET_REF}/assets/asbres/'
PUBLIC=ROOT/'public'

def load(path): return json.loads((ROOT/path).read_text('utf-8'))
def texture_url(path):
    parts=path.split('/')
    return BASE+'/'.join([x.lower() for x in parts[:-1]]+[parts[-1]])

def fetch(item):
    source, local, *override=item
    dest=PUBLIC/local
    url=override[0] if override else texture_url(source)
    commit=override[1] if override else ASSET_REF
    for attempt in range(3):
        try:
            if dest.exists(): raw=dest.read_bytes()
            else:
                with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'StarRailCard-Fan-Project/1.0'}),timeout=40) as r: raw=r.read()
            if not raw.startswith(b'\x89PNG\r\n\x1a\n'): raise ValueError('Source is not a PNG')
            dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw)
            return {'sourcePath':source,'path':local,'url':url,'commit':commit,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
        except Exception as e:
            if attempt==2: return {'sourcePath':source,'path':local,'error':str(e)}
            time.sleep(attempt+1)

def main():
    jobs=[]
    cards=load('src/data/cards.json')+load('src/data/bossCards.json')
    priority={'264026':0,'264014':1,'264013':2}
    for row in sorted(cards,key=lambda c:priority.get(c['id'],10)):
        jobs.append((row['imagePath'],f"assets/cards/{row['id']}.png"))
    rawcards=load('.cache/release-data/4.2/ExcelOutput/ActivityDiceAvatarConfig.json')
    for row in rawcards:
        bg=row.get('HighLevelBGImgPath')
        if bg: jobs.append((bg,f"assets/card-backgrounds/{row['DiceAvatarID']}.png"))
    for source in load('.cache/release-data/4.2/ExcelOutput/ActivityDiceAvatarLevel.json'):
        for key,value in source.items():
            if key.endswith('FramePath'): jobs.append((value,'assets/ui/'+value.split('/')[-1]))
    for file in ['weather','tactics','glossary','classicCampaigns','coopStages','dice']:
        for row in load('src/data/'+file+'.json'):
            if row.get('imagePath'): jobs.append((row['imagePath'],f"assets/{file}/{row['id']}.png"))
    extras=[
      'SpriteOutput/Quest/DiceCombat/DiceCombatBattle_IconAttack.png',
      'SpriteOutput/Quest/DiceCombat/DiceCombatBattle_IconDefence.png',
      'SpriteOutput/Quest/DiceCombat/DiceCombatCardDiceItemLevel1.png',
      'SpriteOutput/Quest/DiceCombat/DiceCombatCardDiceItemLevel2.png',
      'SpriteOutput/Quest/DiceCombat/DiceCombatCardDiceItemLevel3.png',
      'SpriteOutput/Quest/DiceCombat/DiceCombatCardDiceItemLevel4.png',
      'UI/UI3D/DiceCombat/_dependencies/Texture/DiceCombatCardItemBig_Normal_BackBg.png',
      'UI/UI3D/DiceCombat/_dependencies/Texture/DiceCombatCardItemBig_Gold_BackBg.png',
      'UI/UI3D/DiceCombat/_dependencies/Texture/DiceCombatCardItemBigCardBack.png',
      'UI/UI3D/DiceCombat/_dependencies/Texture/DiceCombatCardItemBigBack_Color.png',
    ]
    for path in extras: jobs.append((path,'assets/ui/'+path.split('/')[-1]))
    for item in load('.cache/release-data/4.2/ExcelOutput/ItemConfig.json'):
        if item['ID'] in [264996,264997,264998,264999,269001,150093]:
            jobs.append((item['ItemIconPath'],f"assets/currency/{item['ID']}.png"))
    for item in load('src/data/customAssets.json'):
        jobs.append((item['sourcePath'],item['path'],item['url'],item['commit']))
    jobs=list(dict.fromkeys(jobs))
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results=[]
        for item in pool.map(fetch,jobs):
            results.append(item)
            print(('FAIL ' if 'error' in item else 'OK ')+item['path'],flush=True)
    failed=[x for x in results if 'error' in x]
    for file in ['cards','bossCards']:
        rows=load('src/data/'+file+'.json')
        for row in rows: row['image']=f"assets/cards/{row['id']}.png"
        (ROOT/'src/data'/f'{file}.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n','utf-8')
    (ROOT/'src/data/assetManifest.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n','utf-8')
    print(f'{len(results)-len(failed)}/{len(results)} textures downloaded; {len(failed)} failures.',flush=True)
    if failed: print(json.dumps(failed,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
