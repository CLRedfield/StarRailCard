# 星穹骰局：Suno 音乐与关键音效提示词

核验日期：2026-09-28。**本次交付是参考链接和原创生成提示词，没有生成、下载或替换任何音频，也没有修改游戏声音代码。** 本轮尚未实际试听原作音轨；下文的明亮街机、桌游、future funk / jazztronica 音色是本项目设计建议，不是对原曲的听辨结论。没有独立音效文件入库，不能把试听页面算作已取得的素材。

## 先生成什么

先做「再掷一局」牌局 BGM、「骰子弹桌」、「落牌确认」、「卡牌出击」和「毒液引爆」，再补大厅／共斗 BGM、护盾、骇入与胜败短提示。这样先解决最常听到的背景和交互，也让毒伤在听感上与普通攻击分开。每项先生成一组候选，试听选一条；不要把失败候选和全部母带打进 Toy ZIP。

当前 `src/lib/audio.ts` 只有 Web Audio 振荡器与噪声合成：一组 16 步音高每 210 ms 循环，效果入口为 click、roll、damage、win、heal、arise、hack、attack；项目 `public/` 中没有现成音频文件。读取代码可见目前结算统一走 win，伤害大类走 damage；后续接入应拆分胜／败、攻击／护盾／毒伤，但本次不改调用逻辑。

## 在 Suno 中怎么填

- **BGM：** Create → Custom（部分界面称 Advanced），开启 Instrumental，英文正文放 Styles，歌词留空。若能看到 Exclude，粘贴下方排除项。官方说明支持这种纯器乐工作流：[Custom](https://help.suno.com/en/articles/3197377)、[Instrumental](https://suno.com/tools/instrumental-generator)、[Exclude](https://help.suno.com/en/articles/3161921)。
- **短音效／胜败提示：** 优先 Create → Sounds → **One Shot**，把相应英文正文放声音描述。当前官方已支持此入口，不能再笼统说 Suno 只能生成整首歌曲；它仍是实验功能。[官方 Sounds 说明](https://help.suno.com/en/articles/10625537)
- Sounds 的 Loop、BPM、Key 是可选生成方向。提示中的秒数、节拍和干净留白是目标，**不保证精确时长、绝对无歌声或循环接缝**；需要逐条试听和裁剪。若你的账号没有 Sounds，用文末 cue sheet 备用方案尝试，不把整个 cue sheet 直接作为一次游戏反馈播放。

通用 BGM Exclude（若该输入框可用）：

```text
vocals, singing, humming, spoken words, choir, rap, crowd chants, piercing beeps, harsh distortion, alarm sirens, cinematic explosions, long intro, dramatic breakdowns
```

以下所有曲风、BPM、时长与文件名均是本项目制作建议。没有要求模仿具体艺术家、复刻原曲旋律或上传原作 OST。

## 可直接粘贴的提示词

### BGM-01 星光牌厅

用途：大厅、收藏、配置；104 BPM；成品裁剪约 32 小节，约 74 秒。

操作：Custom / Advanced，Instrumental 开启；粘贴到 Styles。拟接入文件：`audio/bgm_lobby.mp3`。

```text
Original instrumental background music for a bright, polished sci-fi tabletop game lobby. Playful jazztronica and light future funk, 104 BPM, warm electric piano with major seventh and ninth chords, rounded fingerstyle electric bass, muted guitar comping, brushed electronic drums, soft shaker, and occasional glassy mallet accents. A relaxed, confident groove with a memorable but understated original melody. Small arrangement changes every eight bars, plenty of space for tactile dice and interface sounds. Clean modern production, clear midrange on phone speakers, soft high frequencies, controlled bass. Establish the groove immediately, keep a consistent energy, and write repeatable phrases suitable for editing into a background loop. Instrumental only.
```

### BGM-02 再掷一局

用途：常规经典牌局；120 BPM；成品裁剪约 48 小节，约 96 秒。

操作：Custom / Advanced，Instrumental 开启；粘贴到 Styles。拟接入文件：`audio/bgm_duel.mp3`。

```text
Original instrumental music for a cheerful competitive dice-and-card battle. 120 BPM, crisp jazztronica, nimble future-funk groove, warm electric piano stabs, syncopated electric bass, tight dry drums, light hand percussion, a few short muted-brass answers, and a playful original synth motif. Clever and energetic, with the feeling of making a satisfying tactical move. Keep the lead sparse and the rhythm steady so dice rolls, confirmations, and attacks remain easy to hear. Add subtle eight-bar variations without a dramatic build-up or drop. Full, warm, polished sound rather than thin arcade beeps. Immediate groove, consistent loudness, repeatable musical phrases, instrumental only.
```

### BGM-03 双人王牌

用途：共斗、首领后半局；128 BPM；成品裁剪约 32 小节，约 60 秒。

操作：Custom / Advanced，Instrumental 开启；粘贴到 Styles。拟接入文件：`audio/bgm_coop.mp3`。

```text
Original instrumental battle music for two friends teaming up at a luminous sci-fi game table. 128 BPM, energetic jazztronica with a tight electro-funk rhythm section, agile bass, percussive electric piano, bright synth arpeggios used sparingly, and short brass-like accents. Friendly competitive tension, teamwork, clever reversals, and a sense of momentum. Slightly more urgent than a casual card match while staying colorful and optimistic. Clear rhythmic pulse, compact phrases, controlled percussion, and room in the midrange for game sound effects. Avoid a large cinematic climax; sustain the groove with small variations and clean phrase boundaries for later loop editing. Instrumental only.
```

### ST-01 胜利亮牌

用途：结果页胜利；目标约 3 秒。

操作：Sounds → One Shot；没有 Sounds 时用 Custom + Instrumental。拟接入文件：`audio/stinger_win.mp3`。

```text
A single original victory jingle for a bright sci-fi tabletop game, about three seconds. A crisp card snap leads into a joyful rising electric-piano and glass-mallet figure, supported by one warm bass note and a tiny brass sparkle. Satisfying, elegant, playful, compact. One clear final chord and a short clean decay. No voice, no applause, no background beat, no additional phrases.
```

### ST-02 下局再来

用途：结果页失败；目标约 2.5 秒。

操作：Sounds → One Shot；没有 Sounds 时用 Custom + Instrumental。拟接入文件：`audio/stinger_lose.mp3`。

```text
A single original gentle defeat jingle for a cheerful sci-fi board game, about two and a half seconds. Three soft descending electric-piano notes, a small wooden card tap, and a warm unresolved chord that settles quietly. Wry and encouraging rather than tragic. Brief, clean, and restrained. No voice, no laughing, no alarm, no dramatic boom, no background beat.
```

### SFX-01 骰子弹桌

用途：投骰／重投主音；目标约 1.1 秒，优先生成。

操作：Sounds → One Shot。拟接入文件：`audio/sfx_dice_roll_01.mp3`。

```text
One isolated sound of five small polished resin dice tumbling onto a firm tabletop with a thin felt surface, about one second. A fast clustered rattle at the start, distinct irregular light clacks and small bounces that gradually slow down, then one clean final settling tap. Tactile, close, crisp, satisfying, and slightly rounded, with subtle body. Dry studio sound, no room ambience, no music, no voices, no electronic melody.
```

### SFX-02 轻触选中

用途：单骰选中；目标约 0.10 秒。

操作：Sounds → One Shot。拟接入文件：`audio/sfx_select.mp3`。

```text
One tiny tactile interface selection click. A soft polished plastic tick with a very short rounded glass accent, about one tenth of a second. Crisp but gentle, dry and close, no ringing tail. No music, no voice, no harsh beep.
```

### SFX-03 落牌确认

用途：确认最终骰组；目标约 0.25 秒。

操作：Sounds → One Shot。拟接入文件：`audio/sfx_confirm.mp3`。

```text
One satisfying board-game confirmation sound, about a quarter of a second. A neat card snap and a compact mechanical latch click, followed by a tiny warm upward chime. Confident, clean, and precise, with a short dry tail. No music bed, no voices, no long sparkle sequence.
```

### SFX-04 卡牌出击

用途：普通攻击出手；目标约 0.45 秒。

操作：Sounds → One Shot。拟接入文件：`audio/sfx_attack.mp3`。

```text
One stylized card-attack whoosh for a colorful sci-fi tabletop game, about half a second. A fast paper-card flick sweeps forward into a short clean air swish, ending with a compact rounded punch. Snappy and playful, with a controlled low-mid body. No sword ringing, no gunshot, no huge explosion, no music, no voice.
```

### SFX-05 命中落点

用途：有实际扣血时；目标约 0.25 秒。

操作：Sounds → One Shot。拟接入文件：`audio/sfx_hit.mp3`。

```text
One compact stylized impact for a friendly sci-fi card battle, about a quarter of a second. A crisp dry tap layered over a short warm low-mid thump and a tiny bright particle crackle. Clear single impact, immediate onset, very short decay. No voice, no gore, no explosion tail, no music.
```

### SFX-06 晶格护盾

用途：格挡或护盾接触；目标约 0.45 秒。

操作：Sounds → One Shot。拟接入文件：`audio/sfx_shield.mp3`。

```text
One small luminous energy shield absorbing a card strike, about half a second. A rounded glassy ping with a soft elastic pulse underneath, a brief crystalline shimmer, then a controlled clean decay. Protective and resilient rather than shattering. No alarm, no cymbal crash, no heavy impact, no music, no voice.
```

### SFX-07 毒液引爆

用途：海瑟音额外引爆；目标约 0.55 秒，必须与挥砍区分。

操作：Sounds → One Shot。拟接入文件：`audio/sfx_poison_trigger.mp3`。

```text
One isolated magical poison pulse for a colorful tabletop battle, about half a second. A small liquid bubble swells and pops, followed by a soft fizzy electronic hiss and a rounded downward pitch droplet. Precise, compact, and slightly mischievous, with no physical strike. Dry mix, restrained high frequencies, no blade whoosh, no punch, no explosion, no music, no voice.
```

### SFX-08 回合毒蚀

用途：回合末中毒；目标约 0.30 秒。

操作：Sounds → One Shot。拟接入文件：`audio/sfx_poison_tick.mp3`。

```text
One tiny poison damage tick, about one third of a second. A single soft liquid plip, a short low bubbling pulse, and a quick delicate fizz that fades immediately. Small and clearly distinct from an attack or confirmation. No whoosh, no thump, no melody, no background music, no voice.
```

### SFX-09 数值跃升

用途：跃升／跃迁数值变换；目标约 0.70 秒。

操作：Sounds → One Shot。拟接入文件：`audio/sfx_arise.mp3`。

```text
One short luminous upgrade sound, about seven tenths of a second. A quick airy upward sweep with three soft glass-like steps rising in pitch, ending in one bright rounded shimmer. Playful sci-fi interface magic, smooth and polished, not piercing. No large space-engine rumble, no long musical phrase, no voice, no background music.
```

### SFX-10 数据骇入

用途：骇入改写骰面；目标约 0.55 秒。

操作：Sounds → One Shot。拟接入文件：`audio/sfx_hack.mp3`。

```text
One short sci-fi data rewrite sound, about half a second. Three tight digital glitch clicks, a small filtered electrical zip, and a clean downward pitch lock at the end. Clever, precise, and mischievous. Compact dry texture with softened treble. No siren, no harsh modem screech, no long static, no musical beat, no voice.
```

### SFX-11 卡面击破

用途：阵亡碎片动画；目标约 1 秒；与胜败 jingle 分开。

操作：Sounds → One Shot。拟接入文件：`audio/sfx_ko.mp3`。

```text
One stylized luminous card shattering into tiny digital cubes, about one second. A compact papery crack, a soft low impact, then a short scatter of delicate glass-like particle ticks that fall away. Bright arcade finish, satisfying but not violent or enormous. No voice, no explosion rumble, no musical jingle, no long reverb.
```

### SFX-12 交换入槽

用途：共享池交换成功；目标约 0.30 秒。

操作：Sounds → One Shot。拟接入文件：`audio/sfx_swap.mp3`。

```text
One tactile sci-fi board-game piece exchange sound, about one third of a second. A short smooth slide followed by two close soft resin clicks locking into a slot. Compact, clean, and reassuring. Dry sound, no voice, no music, no long chime.
```

## 看不到 Sounds 时的 cue sheet 备用方案

下面只是一种可尝试的生成方式，模型可能仍加入节奏、压缩静默或漏掉某项。使用 Custom／Instrumental，把正文放 Styles；生成后只裁出听感合格的单个 cue。一次不理想就改为每次只描述一个音效；有歌声或连续音乐垫底的片段不要直接用作按钮音。

```text
An isolated sound-design cue sheet for a polished sci-fi tabletop game, not a song. Separate individual sounds with generous complete silence: first a short tactile dice tumble with diminishing bounces; second one gentle selection tick; third one card-snap confirmation; fourth a quick card-attack swish; fifth one rounded glass shield ping; sixth a small liquid poison bubble and fizz. Each cue happens only once and has its own clean ending. Dry studio sound. No continuous rhythm, no melody, no background ambience, no voices, no spoken cue names.
```

## 输出规格与后续接入计划

- 母带优先保留可用的最高质量文件；若账号只能导出 MP3，保留原下载文件，不为了文件后缀再转成 WAV。官方当前格式说明见 [可下载格式](https://help.suno.com/en/articles/13926081)。本地母带放开发素材区，**不随部署包发布**。
- 游戏成品建议 BGM 44.1 kHz、立体声 MP3、128 kbps 起；听到高频压缩伪影再提高码率。短 SFX 建议 44.1 kHz、单声道 MP3、128 kbps 起。可把母带保留为 WAV，实际接入前再统一导出与试听。
- BGM 分别选约 32／48／32 小节的稳定段落（上述目标 BPM 下约 74／96／60 秒），避开冗长前奏和大停顿。手动检查首尾节拍、音色与响度，必要时做交叉淡化；模型声称 loop 也必须听接缝。
- SFX 裁到单次动作与完整短尾音，去掉多余前后静默，保留起音冲击；必要时加极短淡入淡出防止接缝爆音。主投掷音做 2–3 个候选变体，用轮换而非一次叠放；落点／确认不要混成一串长旋律。
- 不强行把所有音效归一化到同一主观响度。滑选 click 最轻、确认稍亮、真实攻击更有分量、毒伤保持小而独立；音乐在操作声后面，手机外放试听时不遮住骰子和确认。
- 后续接入按表中英文文件名，运行时从本地相对资源路径加载。`damageKind=poison-trigger` 与 `poison-tick` 分别播放对应液体提示，`strike` 只播放卡牌出手；同一事件不能叠加通用 damage 与专属 poison。恢复快照保持静音，网络重复包不再次触发。这里是命名与映射计划，文件尚不存在。

当前包解压后 37,960,419 字节，按 50,000,000 字节上限，较紧的剩余预算为 **12,039,581 字节（约 12.04 MB）**。建议整套运行时音频控制在 **5 MB 内**：三条 BGM 按约 230 秒、128 kbps 估算约 3.68 MB，再给音效与短提示预留约 0.5–1 MB。此为码率估算，不是实际导出体积；最终仍以重打包检查为准。音频工作只增加提示词文档；本次游戏包已更新教学与补给，但未增加任何部署音频。

## 参考来源与取得状态

以下均为参考入口；**实际取得音频文件：0**。B 站／YouTube 链接由用户在播放器中试听，项目不抓取媒体、不把参考视频打包。原作实录时间点来自已有视觉核验文档，不能证明本轮听过原音。

- [官方共斗玩法介绍（场景依据，不是音源）](https://www.taptap.cn/moment/797910836491322059)：官方账号图文；可核对共斗、交换等使用场景，不把无声动态图当作声音证据。
- [4.0 待机音乐试听入口（氧化膜yhm）](https://www.bilibili.com/video/BV14fPDzSEPR/)：检索命中待机音乐标题，页面合集还列出「战斗场地音乐」；不是官方原声发行页。网页抓取返回 412，未实际试听，也未取得单独战斗曲链接。
- [4.0 原作重投实录：22:04 起](https://www.youtube.com/watch?v=p1lrsO8vcxk&t=1324s)：游戏玩家小张实录；原项目视觉核验记录这里是重投前后，可由用户打开对照骰子音效；本次音轨未试听，抓取限流。
- [4.0 攻击／护盾实录：14:53 起](https://www.youtube.com/watch?v=p1lrsO8vcxk&t=893s)：同一实录的攻击、防御结算画面入口；不声称已分离或听辨原作声音。
- [4.0 击破／结算实录：17:08 起](https://www.youtube.com/watch?v=p1lrsO8vcxk&t=1028s)：同一实录；时间来自已保存的阵亡视觉核验记录，供用户对照短音效与结果提示。
- [4.2 全流程实录（Kuroyukihime）](https://www.youtube.com/watch?v=2GyV6k8jQTg&t=2122s)：搜索摘要明确 35:22 起为包含战斗的完整流程；本次没有逐秒试听，不给尚未确认的独立音效时间点。
- [Suno 官方：Custom 与 Instrumental](https://help.suno.com/en/articles/3197377)：说明 Custom、Instrumental、Styles 的入口；不同版本界面也可能显示 Advanced。
- [Suno 官方：排除元素](https://help.suno.com/en/articles/3161921)：Advanced Options 内 Exclude 可列出不想要的元素。
- [Suno 官方：Instrumental Generator](https://suno.com/tools/instrumental-generator)：建议用场景、风格、乐器、速度和能量描述伴奏。
- [Suno 官方：Suno Sounds](https://help.suno.com/en/articles/10625537)：2026-09-09 更新：实验性短音效／采样入口，One Shot 或 Loop，可设 BPM/Key；准确性仍在完善。
- [Suno 官方：可下载格式](https://help.suno.com/en/articles/13926081)：2026-09-09 更新：MP3、WAV 等取决于套餐、功能、设备；WAV 歌曲下载列为 Pro/Premier 网页能力。
