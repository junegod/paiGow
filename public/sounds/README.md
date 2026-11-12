# 音效素材说明

当前音效来自 Kenney Casino Audio，授权为 CC0，可用于开发期占位。

来源：https://opengameart.org/content/54-casino-sound-effects-cards-dice-chips

后期替换方式：

- 保持同名文件即可直接替换，不需要改代码。
- `card-select.ogg`：选中手牌。
- `card-play.ogg`：明打、吃牌等正面出牌。
- `card-discard.ogg`：背面弃牌。
- `card-shuffle.ogg`：开始新一局。
- `dice-roll.ogg`：掷骰。
- `trick-win.ogg`：赢下一墩。
- `settlement.ogg`：整局结算。

收牌垒墩沿用 `card-play.ogg` 的碰牌素材，由统一播放器区分两种动作：

- `cardStack`：每次叠稳一摞牌时轻脆碰响，播放速度为 1.16 倍、基础音量为 0.55。
- `pileDrop`：整摞收进赢墩区时稍沉的落桌声，播放速度为 0.94 倍、基础音量为 0.7。
- 同一次动作只由一张代表牌回报落位，不随牌张数重复叠加声音。
- 两种声音都受“游戏音效”开关和音量控制，恢复历史牌堆、原地翻面或普通重绘不会补播。
