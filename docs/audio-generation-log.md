# 星穹骰局：Suno 生成记录

日期：2026-09-28。已在 Suno 取得 **10 个候选结果**，其中 **5 个 A 版已下载、处理并接入游戏**；另外 5 个 B 版保留结果链接。本记录保留生成阶段的 `ready_for_review` 状态，表示页面显示播放入口及时长，不代表主观听审。当前成品处理与技术核验见 [音频资产记录](audio-assets.md)。

## 本轮范围与实际进度

- 保留用户先前生成的 2 个「Buant Groove」牌局 BGM，未重复生成。
- 本轮新增投骰、确认、攻击、毒液四类音效，每类 2 个候选，共 8 个。其余大厅／共斗 BGM、胜败提示和更多 SFX 未在本轮批量生成。
- 用户已把 Suno 标签分离为独立窗口，主代理在该窗口完成操作；首个人机验证在用户授权后通过。
- 全部 10 个候选均**未作人的主观听审**，不对音色、循环、杂音或原作还原程度作判断。用户要求直接接入最新版后，已按波形包络对四个 A 版音效裁剪，并完成成品解码、响度与峰值核验；原始长候选没有直接绑定每次游戏动作。
- 本轮下载页面当时显示 18 次额度。先下载 5 个 A 版候选，B 版保留 Suno 链接；不据此推算未经页面确认的剩余额度。

## 任务总览

| 项目 | 拟接入成品文件 | 目标成品时长 | 实际页面结果 | 生成状态 | 本地下载状态 |
| --- | --- | --- | --- | --- | --- |
| BGM-02 牌局 | `audio/bgm_duel.mp3` | 120 BPM，约 48 小节／96 秒；可从长片段剪辑 | A 2:58；B 2:52 | ready_for_review；用户先前生成 | A 已落地 4,300,411 字节；B 暂不下载 |
| SFX-01 投骰 | `audio/sfx_dice_roll_01.mp3` | 约 1 秒 | A / B 均 0:10 | ready_for_review | A 已落地 218,631 字节；B 暂不下载 |
| SFX-03 确认 | `audio/sfx_confirm.mp3` | 约 0.25 秒 | A / B 均 0:02 | ready_for_review | A 已落地 81,084 字节；B 暂不下载 |
| SFX-04 攻击 | `audio/sfx_attack.mp3` | 约 0.5 秒 | A 0:08；B 0:04 | ready_for_review | A 已落地 229,297 字节；B 暂不下载 |
| SFX-07 毒液 | `audio/sfx_poison_trigger.mp3` | 约 0.5 秒 | A / B 均 0:10 | ready_for_review | A 已落地 246,402 字节；B 暂不下载 |

上表保留原始生成结果与目标；五个成品已另存到 `public/audio/`，原始候选仍在 `release/audio-candidates/`，不属于运行时目录。页面时长是浏览器显示值；成品独立解码长度、精确字节数、裁剪范围及哈希见 [音频资产记录](audio-assets.md)。

## 本轮四项 SFX 英文短版

### SFX-01 骰子弹桌

```text
One isolated sound of five polished resin dice tumbling onto a firm tabletop with thin felt, about one second. A quick clustered rattle, distinct irregular light clacks, diminishing bounces, then one clean settling tap. Tactile, close, crisp and satisfying, with rounded body. Dry studio sound. No music, voices or electronic melody.
```

### SFX-03 落牌确认

```text
One satisfying board-game confirmation sound, about a quarter of a second. A neat card snap and compact mechanical latch click, followed by a tiny warm upward chime. Confident, clean and precise, with a short dry tail. No music bed, voices or long sparkle sequence.
```

### SFX-04 卡牌出击

```text
One stylized card-attack whoosh for a colorful sci-fi tabletop game, about half a second. A fast paper-card flick sweeps forward into a clean air swish, ending with a compact rounded punch. Snappy and playful, controlled low-mid body. No sword ringing, gunshot, huge explosion, music or voice.
```

### SFX-07 毒液引爆

```text
One isolated magical poison pulse for a colorful tabletop battle, about half a second. A small liquid bubble swells and pops, followed by a soft fizzy electronic hiss and rounded downward pitch droplet. Precise, compact and mischievous. No blade whoosh, punch or explosion. Dry mix, restrained treble, no music or voice.
```

## 实际候选结果

SFX 标题按页面显示的截断文本保留省略号，没有猜补完整标题；每类 A/B 页面标题相同。

| 项目／候选 | 页面标题 | 结果链接 | 来源 | 页面显示时长 | 试听状态 | 下载状态 |
| --- | --- | --- | --- | --- | --- | --- |
| BGM / A | Buant Groove | [Suno 页面](https://suno.com/song/a6cd88eb-9f6e-4122-9e2f-d0f94fa07395) | 用户先前生成 | 2:58 | 未试听 | 已核对：`release/audio-candidates/bgm_duel_A.mp3`，4,300,411 字节 |
| BGM / B | Buant Groove | [Suno 页面](https://suno.com/song/7510cc3d-f7a4-4efa-b34f-f6deaba3248e) | 用户先前生成 | 2:52 | 未试听 | 暂不下载；保留链接 |
| 投骰 / A | One Isolated Sound Of Five Polished Resin Dice Tumbling Onto A Firm Tabletop ... | [Suno 页面](https://suno.com/song/636b91fc-a7d8-4275-9ded-ff734db2ac21) | 本轮新增 | 0:10 | 未试听 | 已核对：`release/audio-candidates/sfx_dice_roll_A.mp3`，218,631 字节 |
| 投骰 / B | One Isolated Sound Of Five Polished Resin Dice Tumbling Onto A Firm Tabletop ... | [Suno 页面](https://suno.com/song/c4914442-9f33-4d43-9cfb-e13f182238d0) | 本轮新增 | 0:10 | 未试听 | 暂不下载；保留链接 |
| 确认 / A | One Satisfying Board-game Confirmation Sound, About A Quarter Of A Second. A ... | [Suno 页面](https://suno.com/song/02c895f8-7155-455b-8498-a31069ece54f) | 本轮新增 | 0:02 | 未试听 | 已核对：`release/audio-candidates/sfx_confirm_A.mp3`，81,084 字节 |
| 确认 / B | One Satisfying Board-game Confirmation Sound, About A Quarter Of A Second. A ... | [Suno 页面](https://suno.com/song/aef67943-2fab-4eab-a554-987a1f72de4c) | 本轮新增 | 0:02 | 未试听 | 暂不下载；保留链接 |
| 攻击 / A | One Stylized Card-attack Whoosh For A Colorful Sci-fi Tabletop Game, About Ha... | [Suno 页面](https://suno.com/song/f09e76da-d28f-4dc3-a84a-a13577367279) | 本轮新增 | 0:08 | 未试听 | 已核对：`release/audio-candidates/sfx_attack_A.mp3`，229,297 字节 |
| 攻击 / B | One Stylized Card-attack Whoosh For A Colorful Sci-fi Tabletop Game, About Ha... | [Suno 页面](https://suno.com/song/b692ee0a-e34d-4b7c-9588-e4eaacd847dc) | 本轮新增 | 0:04 | 未试听 | 暂不下载；保留链接 |
| 毒液 / A | One Isolated Magical Poison Pulse For A Colorful Tabletop Battle, About Half ... | [Suno 页面](https://suno.com/song/034a1db6-1c06-44c2-b8c9-062d4922f16e) | 本轮新增 | 0:10 | 未试听 | 已核对：`release/audio-candidates/sfx_poison_trigger_A.mp3`，246,402 字节 |
| 毒液 / B | One Isolated Magical Poison Pulse For A Colorful Tabletop Battle, About Half ... | [Suno 页面](https://suno.com/song/38f28182-ff44-4b16-acc6-6d369a1b20be) | 本轮新增 | 0:10 | 未试听 | 暂不下载；保留链接 |

## 下载与审核记录规则

- 有结果卡、播放按钮或时长不代表已经听过声音；试听记录只写实际听到的内容。
- A／B 是本地候选标签，不是质量排名。本次接入采用已实际下载的 A 版，不表示试听比较后判定优于 B 版。
- 下载需记录实际文件路径与大小。当前五个 A 版均已下载并完成本地核对，五个 B 版只保留在线链接；播放页 URL 不算音频文件。
- 原始候选保持不覆盖，处理成品另存；四个短音效只保留单次动作片段，不把 10 秒原段绑定每次投骰或毒伤。后续主观听感调整仍应从原始候选重新处理。

## 本地交付与接入状态

- 已确认落地：**5 个 A 版音频候选，共 5,075,825 字节（约 5.076 MB）**；逐项字节数与非零文件已核对，五项文件头均为 `ID3`。
- 已作主观听审：**0**；已处理成品：**5**（四个 SFX 裁剪，BGM 保留全曲并重新编码）；已接入游戏：**5**。运行时五个 MP3 共 **2,166,705 字节**。
- 游戏接入已完成，新的 Toy ZIP 包含处理成品；原始下载与独立试听包继续单独保留。游戏只读取本地随包文件，不在运行时请求 Suno。
- 独立试听索引：`release/audio-candidates/试听.html`（原生播放器，无自动播放）。
- 独立试听素材包约定名称：`release/星穹骰局-Suno试听素材.zip`；它与 Toy 游戏部署包分开，打包由主代理完成。
- 如需听感调整，可通过独立试听素材页检查原始 A 版；当前成品的截取范围和增益由 `scripts/prepare_audio.py` 记录，修改后可重新生成。
- 页面结果截图：`artifacts/suno-generated-effects.png`、`artifacts/suno-generated-bgm.png`。截图证明页面结果与时长，不代替音频听审。
- 接入后的技术与 UI 验收：全量 198 项本地测试及生产构建通过；最终 ZIP 解压子路径中五项 MP3 在首次手势后 HTTP 200 加载，实际检查音量归零／恢复、选骰、重投及确认。截图为 `artifacts/audio-settings-production.png`、`artifacts/audio-battle-production.png`；这些不替代主观听审或实体手机验证。部署 ZIP 为 38,646,773 字节，解压后 40,133,780 字节，完整核验见 [验证记录](verification.md)。

完整提示词与功能依据见 [Suno 音乐与音效提示词](suno-audio-prompts.md)。候选文件说明见 [audio-candidates/README](../release/audio-candidates/README.md)。
