# 毒伤、荆棘与连击核验

2026-09-28。本次修正限定在已批准的时序与联机交互；工程回归通过不代表取得了原游戏技能执行脚本。

## 证据及边界

固定使用 4.2 发布提交 `8a83702254b0f44188b6e2ca2f889e5a2ba4a8a1`。本地保存的上游表在 `.cache/release-data/4.2/ExcelOutput/`，中文映射在同版本 `TextMap/TextMapCHS.json`，64 位 Hash 由 Python 整数关联。可追溯文件：

- [ActivityDiceSkill](https://gitlab.com/Dimbreath/turnbasedgamedata/-/blob/8a83702254b0f44188b6e2ca2f889e5a2ba4a8a1/ExcelOutput/ActivityDiceSkill.json)：海瑟音、爻光、星期日技能。
- [ActivityDiceGlossary](https://gitlab.com/Dimbreath/turnbasedgamedata/-/blob/8a83702254b0f44188b6e2ca2f889e5a2ba4a8a1/ExcelOutput/ActivityDiceGlossary.json)：中毒、猛毒、荆棘、超载、反击、反伤、不屈术语。
- [ActivityDiceContentConfig](https://gitlab.com/Dimbreath/turnbasedgamedata/-/blob/8a83702254b0f44188b6e2ca2f889e5a2ba4a8a1/ExcelOutput/ActivityDiceContentConfig.json)：普通／真版毒液与命运骰面。
- [ActivityDiceSpecialRule](https://gitlab.com/Dimbreath/turnbasedgamedata/-/blob/8a83702254b0f44188b6e2ca2f889e5a2ba4a8a1/ExcelOutput/ActivityDiceSpecialRule.json)：飓风、云隙光。
- [官方共斗介绍](https://www.taptap.cn/moment/797910836491322059)：作为活动框架来源，不能据此推断未展示的技能内部时序。

本次重新读取了本地固定版本原始文本及规范化配置。在线访问 GitLab 页面返回 403，因此没有将在线重取标为成功。海瑟音“攻击流程后引爆一次、不要求破防、不消耗毒层”的具体时序以本次用户确认的实玩规则为验收依据，不冒充取得录像逐帧证明。猛毒的持续时间没有可靠新增证据，本次不调整。

## 本次验收语义

| 项目 | 实现与检查要点 |
| --- | --- |
| 海瑟音附毒 | 按最终参与攻击的骰面计偶数，每个偶数附 1 层；只预选或只掷出不施加状态。 |
| 海瑟音引爆 | 全偶数时，整次攻击／连击流程后额外触发一次毒伤；普攻完全被挡也触发；毒层不减少。目标已经倒下则不继续伤害。 |
| 回合末中毒 | 按本次结算前层数扣血，再减少 1 层。与角色额外引爆分别记录。 |
| 猛毒 | 两类毒伤均乘 2，重复获得不变为乘 4；持续时间维持已有规则。 |
| 荆棘 | 攻防结算前按当前层数扣血并清层；爻光达到 18 攻先清荆棘。星期日被命中后新产生的层数留到下一次结算。 |
| 防御超载 | 按超载层数的一半扣血；保留本引擎整数取整方式，并做固定案例检查。 |
| 反击／反伤／不屈 | 分开记录伤害来源和实际生命变化；不屈的最低生命、死亡、共享生命复起、首领换阶段分别检查。 |
| 爻光＋真命运 | 这两项本身没有连击。存在飓风或满足云隙光等条件时，额外一击必须标出来源和击次。无法反推用户旧局当时的天气。 |

海瑟音验收用骰为 `[2,2,2]`，普攻被完全防住：初始 0 毒时引爆 3、回合末 3、剩 2；初始 4 毒时两次各 7、剩 6；后者带猛毒时两次各 14、剩 6。

## 表现与记录

伤害事件保存 `damageKind/sourceLabel`、实际扣血、`hpBefore/hpAfter`、毒和荆棘层数前后值；攻击附带攻防值、`strikeIndex/strikeCount/comboSource`。每回合记录天气、最终骰面和攻防比较。动画按事件逐笔修改显示生命；毒与荆棘不会冒充普通攻击刀光。重复状态、重新进入与重连恢复不重播历史伤害。

具体测试与实际执行结果见 [验证记录](verification.md)。协议和本地选择机制见 [联机说明](networking.md)。
