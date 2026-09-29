# 数据与美术来源

本项目为非盈利《崩坏：星穹铁道》同人网页游戏，与 HoYoverse 无隶属关系。角色、原始美术、活动文本及游戏名称归其相应权利人所有。本项目不销售素材，不提供任何原游戏账户或奖励接口。

## 已发布游戏数据

感谢 [Dimbreath / TurnBasedGameData](https://gitlab.com/Dimbreath/turnbasedgamedata) 提供已发布客户端数据。导入锁定两个历史提交，避免将更新后的数值或未指定版本混入活动：

- 4.0：`ef1a136031756a146f51891f135c337e4ea87487`，2026-03-17，`OSPRODWin4.0.0_D14365601_A14205619_L14113962`。
- 4.2：`8a83702254b0f44188b6e2ca2f889e5a2ba4a8a1`，2026-05-12，`OSPRODWin4.2.0_D14975156_A14880027_L14887656`。

具体文件、不可变下载地址和 SHA-256 记录在 `src/data/provenance.json`。中文名称和说明来自该版本的 `TextMap/TextMapCHS.json`。原始表写入被 Git 忽略的 `.cache/release-data`，浏览器只载入使用到的规范化 JSON。

主要使用 ActivityDiceAvatarConfig、ActivityDiceConfig、ActivityDiceContentConfig、ActivityDiceSkill、ActivityDiceGlossary、ActivityDiceSpecialRule、ActivityDiceCampaignConfig、ActivityDiceStageConfig、ActivityDiceV2Stage、ActivityDiceV2PVEStage、ActivityDiceV2TacticsCard、ActivityDiceV2TacticsPoint。商城、经验和本地奖励关联 ActivityDiceShopGoodsConfig、OfferingLevelConfig、RewardData；战役关联使用原始 MissionInfo 的关卡完成条件。赠卡任务名称和奖励取自 MainMission 的 5000503、2054200 条目；无大世界版的入口改编见数据说明。

## 原始贴图

感谢 [umaichanuwu / StarRailTextures](https://github.com/umaichanuwu/StarRailTextures) 及其说明中署名的 Escartem 整理游戏贴图。下载锁定提交 `2a4b9a7eb7ac9db7f48d627fa5cdfd3822c902ce`（2026-06-01），仅选取上述 4.2 配置引用的资源。

原版 36 张可收集角色卡以及 28 张 NPC / Boss 卡都使用原小游戏卡面，不使用生成图或占位头像。另收录原始卡背、镀闪边框、人物背景、天气、战术、状态、战役、品牌、25 种曜彩骰及 6 种货币/证书图标。271 张原始 PNG 的路径、源 URL、大小和校验值见 `src/data/assetManifest.json`。PNG 内容未经绘制修改。

## 同人扩展素材

希儿使用 [Mar-7th / StarRailRes](https://github.com/Mar-7th/StarRailRes) 固定提交 `05aad816b2546f21ee18f0ddc52e9b1fc4d56173` 的 `image/character_preview/1102.png`，为原作预览立绘，非原小游戏卡面。未经绘制修改，加入同人角色后合计 272 张 PNG。来源与校验值存于 `customAssets.json` 及总资产清单。角色技能为用户指定的同人规则。

## 生成音乐与音效

2026-09-28 经用户授权，从用户 Suno 账号生成和取得音频。游戏实际接入一首背景音乐及投骰、确认、攻击、毒液四项 A 版短音效；它们是为同人网页游戏生成的素材，不是《崩坏：星穹铁道》官方原声录音。

| 用途 | 实际采用的来源 | 运行时成品 |
| --- | --- | --- |
| 背景音乐 Buant Groove | [Suno BGM A](https://suno.com/song/a6cd88eb-9f6e-4122-9e2f-d0f94fa07395) | `public/audio/bgm_duel.mp3` |
| 投骰／重投 | [Suno 投骰 A](https://suno.com/song/636b91fc-a7d8-4275-9ded-ff734db2ac21) | `public/audio/sfx_dice_roll_01.mp3` |
| 确认 | [Suno 确认 A](https://suno.com/song/02c895f8-7155-455b-8498-a31069ece54f) | `public/audio/sfx_confirm.mp3` |
| 攻击 | [Suno 攻击 A](https://suno.com/song/f09e76da-d28f-4dc3-a84a-a13577367279) | `public/audio/sfx_attack.mp3` |
| 中毒／引爆 | [Suno 毒液 A](https://suno.com/song/034a1db6-1c06-44c2-b8c9-062d4922f16e) | `public/audio/sfx_poison_trigger.mp3` |

原始下载保留在 `release/audio-candidates/`；实际运行只读取随包提供的五个处理文件，共 2,166,705 字节，不依赖 Suno 或其他音频网站。完整提示词、生成页面与下载证据见 [生成记录](audio-generation-log.md)；原始／成品哈希、裁剪范围及客观技术指标见 [音频处理记录](audio-assets.md) 和 `public/audio/manifest.json`。尚未进行人的主观听审；原始候选 B 版保留在线链接，未取得本地文件。未替换的轻量 UI、治愈、跃迁、骇入等提示仍为本项目程序合成声音。

## 复现

```sh
python scripts/sync_data.py
python scripts/verify_data.py
```

数据脚本使用 Python 标准库，保留 64 位文本 Hash 的完整整数精度，再生成浏览器可用的字符串 ID。联网只用于读取公开数据与纹理。规则解释与无法从数据获得的表现细节见 `docs/data-notes.md`。
