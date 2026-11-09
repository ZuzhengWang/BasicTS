# 摩尔勇士 单机离线版（实验性）

本目录是把“摩尔勇士复兴版”做成**手机本地运行、不连任何服务器**的离线 APK 的全部源码、工具和构建步骤。

> 状态：第一版（v0.1）。不是 100% 还原；下面分别列出 **已验证**、**推测/近似** 和 **未实现** 的内容。

## 1. 分析结论

| 项目 | 结论 |
|---|---|
| 原始 APK | HARMAN AIR 51.1 打包（`air.com.mole2.rec`，targetSdk 34，仅 arm64）。APK 内只有启动器 `Client.swf`（含资源下载器 + CrossBridge 编译的 `parseSocketResult` 模块）和两个小 DLL；**游戏主体代码与资源全部在线下载** |
| 参考仓库 RecTaoMee_Hero | 玩家浏览器缓存收集的 **Web 客户端**：`Client.swf`、`login/`、`dll/`(4 个核心 DLL)、`module/`、`res/`（约 550 MB）。**不含任何服务端代码**；缓存不完整（例如没有 `login/CareerSelectModule.swf`，部分地图/资源缺失） |
| 版本一致性 | 仓库 `dll/HeroLibraryDLL.swf` 与 APK 内的文件 SHA-256 完全相同 |
| 网络协议 | 明文 TCP，18 字节包头 `len u32 | cmd u16 | uid u32 | seq i32 | result u32`，无加密。登录服（DirSer/SubServer）+ 游戏服两套连接 |
| 配置表 | `res/config/*.xml` 用“末尾 16 字节密钥循环异或 + 去掉末尾 20 字节”加密（`DllLoader.doDec`），已能解密 |
| 旧实验版卡在橙色背景 | 已确认：橙色花纹银框是 `res/UI/BaseUI.swf`，之后客户端要联网取系统配置/更新地址/`Login.swf`，断网就停在这里 |
| 旧版 -124 安装错误 | 推测为 `INSTALL_PARSE_FAILED_RESOURCES_ARSC_COMPRESSED`（Android 11+ 要求 resources.arsc 不压缩且 4 字节对齐）。本版打包器专门处理了这点（未在真机验证） |

### 为什么不继续改 AIR 版
- 本环境无法下载 AIR SDK / Android SDK / 模拟器镜像（dl.google.com 等被网络策略拒绝），修改后的 AIR 版**无法在这里运行任何测试**；
- 修改 AIR 客户端需要重新编译 ActionScript，或手工改字节码。

### 本版方案
**APK = 系统 WebView + Ruffle（开源 Flash 运行时，WebAssembly）+ 页面内置的 JS 本地服务端 + 全部游戏资源（APK assets）**

- Flash 的 `Socket` 由 Ruffle 转成 WebSocket；`server/core.js` 替换 `window.WebSocket`，把连接交给页面里的本地服务端，**没有任何真实网络连接**；
- 游戏资源由 `AssetClient` 从 APK assets 提供（`https://mole.local/...` 只是页面内部地址，非 `mole.local` 的请求一律 404）；
- 存档：`window.MoleNative.save()` 写入应用私有目录 `files/mole_save.json`（写临时文件后改名，并保留 `.bak` 上一版），同时写一份 localStorage 作为后备；
- 这样我在开发机上用 Chromium + 同一个 Ruffle 测通的代码，就是手机上运行的代码。

## 2. 目录

```
web/index.html            游戏页面（Ruffle 配置、socketProxy 映射）
web/server/core.js        字节读写、伪 WebSocket、fetch 拦截、存档
web/server/login.js       登录服：建号/登录/建角色/服务器列表
web/server/online*.js     游戏服：初始化同步、角色、地图走路、战斗
web/server/gamedata.js    运行时读取并解密客户端 res/config/*.xml
web/server/data/level_exp.xml  升级经验表（从 ClientCoreDLL 内嵌资源提取）
android/smali/            APK 外壳（MainActivity / AssetClient / NativeBridge）
android/tools/            AXML 清单生成、APK 打包、apksig 签名与校验
tools/                    SWF/ABC 解析、伪代码反编译、命令号查询、配置解密
devtest/                  Chromium + Ruffle 自动化测试脚本
build.sh                  一键构建
```

## 3. 构建

需要：JDK 17+、Python 3、Node/npm、Maven、git。

```bash
ORIG_APK=/path/to/base.apk ./build.sh
# 输出 out/mole-offline-0.1.0-offline.apk（默认不含支线任务动画；MOLE_SKIP_SIDE_TASKS=0 打包全部资源）
```
构建步骤：克隆 RecTaoMee_Hero → npm 安装 Ruffle → Maven 获取 smali/apksig → smali 汇编 dex → 生成二进制清单 → 打包（resources.arsc 不压缩、4 字节对齐）→ v2 签名 → apksig 校验。

签名使用 `android/keystore/debug-offline.p12`（公开的调试密钥，密码 `moleoffline`），只用于让后续版本能覆盖安装，不代表任何官方身份。

## 4. 使用
- 安装包以 7z 分卷交付：`mole-offline-0.4.1.7z.001` + `.002`（放在同一文件夹，用 ZArchiver 等打开 `.001` 解压），得到 `mole-offline-0.4.1-offline.apk`（含全部资源，versionCode 6，SHA-256 `f6b3803522a7d4118b1384d7abbe6cc9191d571c678b030a62ddf01c6661ffd0`）。可直接覆盖安装旧版，存档保留。
- 包名 `com.molehero.offline`，可与原版共存。
- 首次登录：输入**大于 50000 的任意数字账号**（例如 100001）和密码，即自动在本地创建账号（原复兴版的注册是网页，离线不可用）；之后需用同一密码。客户端把 50000 以下的 ID 当作怪物/NPC，所以小号码无法使用。
- 选择服务器 → 剧情动画 → 创建角色（名字、职业、外观）→ 进入新手地图。

### 聊天框控制台（v0.3）
在右下角聊天框输入以 `/` 开头的命令，回复以【控制台】显示在聊天框里，修改立即写入本地存档。输入 `/help` 查看全部命令。
| 命令 | 作用 |
|---|---|
| `/info` | 角色信息 |
| `/money 数量`、`/level 等级`、`/exp 经验`、`/heal` | 星豆 / 等级 / 加经验 / 回满（含宠物） |
| `/role 属性 数值` | 改角色字段：physique strength endurance quick intelligen attr_add xiaomee level experience hp mp honor energy |
| `/find 关键字` | 按名字查物品、装备、宠物的 ID |
| `/additem ID [数量]` | 加物品或装备（装备 ID 也可） |
| `/items`、`/equips` | 背包物品；装备列表（带编号） |
| `/setequip 编号 属性 数值` | 改装备属性：hp mp atk matk def mdef speed spirit resume hit dodge crit fightback dur level；编号可写 `last` |
| `/wear 编号`、`/delequip 编号` | 穿上 / 删除装备 |
| `/addpet 类型ID [等级]`、`/pets`、`/delpet 编号` | 加宠物 / 宠物列表 / 删除 |
| `/setpet 编号 属性 数值` | 改宠物：level exp growth（成长）nick status points physique strength endurance quick intelligence hp mp atk def speed spirit resume hit dodge crit fightback；编号可写 `last` |
| `/goto 地图ID` | 下次登录出现在该地图 |
| `/fight 怪物ID [等级] [数量]` | 立即开始一场战斗（测试捕捉、技能） |
| `/petskills 编号`、`/addskill 编号 技能ID [等级]`、`/delskill 编号 技能ID` | 查看 / 添加 / 删除宠物技能 |
| `/battlepets 3` 或 `/battlepets 9` | 上场宠物：3 = 原版（主战 + 2 辅助），9 = 主战 + 最多 8 只背包宠物，占满己方 10 个位置 |

已知：在 Ruffle 下，聊天框输入字母时游戏快捷键也会触发（例如会弹出个人信息面板），不影响命令执行。部分数值（星豆、穿着装备的属性）要重新登录后界面才完全刷新。

## 5. 已验证 / 近似 / 未实现

### 已验证（开发机：Chromium 无 GPU + Ruffle 0.8.0-nightly.2026.10.20，客户端与 APK 内文件相同）
截图见 `docs/screens/`。
1. 断网启动：页面不访问任何外部地址（外部请求全部由本地拦截返回），依次加载 BaseUI → 配置 → 登录面板；
2. 登录：新账号自动建号 → 103 登录 → 107 建角色占位 → 105 服务器列表 → 选服；
3. 游戏服：约 40 条初始化命令应答后进入主界面；
4. **新角色**：剧情动画（可“不看动画”）→ 新手地图 11101 → 点击 NPC → 起名（1018）→ 选职业 → 外观确认（1015）→ 回到地图；存档中记录了名字、职业、新手装备；
5. **闭环**：在暗雷地图 21102 走路 → 遇敌 → 战斗（加载进度、开战、每回合 1308→1310/1311）→ 胜利结算面板（经验、掉落物品）→ 升级（Lv1→Lv2）→ 自动存档；
6. **读档**：刷新页面（相当于重启 App）后重新登录，读到 Lv2、经验 51、物品、所在地图与坐标；
7. **治疗（v0.2）**：勇士广场 → 红十字 → 护士蒂蒂拉 → 全部恢复 → 确定：HP 100→550、MP 10→55、星豆按原版公式（10 级以下免费），已存档；
8. **服装显示（v0.2）**：修正 ClothInfo 字段（之前地图上的角色都不显示装备）；新建魔法师创建后立刻穿着法师帽和法袍，老存档剑士显示旅行者布帽/布衣；
9. **丢弃物品（v0.2）**：背包 → 消耗品 → 丢弃确认 → 物品从存档中移除；
10. **控制台（v0.3）**：聊天框输入 `/help`、`/additem 130005`、`/setequip last atk 999`、`/wear last`、`/info`、`/addpet 3 10`、`/setpet last growth 300`、`/pets`、`/money 99999`、`/additem 300001 5`、`/items`，回复显示在聊天框，存档中数值正确（剑攻击 999、穿上后角色攻击 1171）；
11. **宠物（v0.3）**：控制台加宠物后，在暗雷地图遇敌，宠物（主战）每回合出指令并参战、受伤、战后获得经验；精灵背包面板显示宠物在“主战”格、头像与属性；
12. 打包：APK 由 apksig 校验 v2 签名有效；resources.arsc 未压缩且对齐；所有 ZIP 条目本地/中央目录文件名一致；dex 可被 baksmali 解析。

### v0.4（浏览器中已验证）
- 装备列表编码修正：之前每件装备多写 4 字节，第二件起全部错位（个人秀里装备“虚”、提示职业不符的原因）；新角色背包里有职业武器；
- 战斗：主战宠物 + 2 只辅助宠物同时上场；待命宠物可“召唤”换上（1339 + 1315 全量同步）；`/battlepets 9` 时最多 9 只宠物；
- 捕捉：战斗中“抓捕” → 选闪灵胶片（kind 27，需种族匹配），成功率取 Pet.xml `Catch` + `SpecCatch`，客户端显示“签订契约啦”，宠物进入精灵背包；
- 宠物技能：Pet.xml BaseSkill + 天赋池 TalentSkill；技能效果按 BattleActionListConfig 类型和 Skill.xml 描述中的倍率/基础伤害；野怪会用 SpecSkill；
- 击杀：被打死的怪物被击飞并移除（state2 位），自己方倒下；
- 任务：完成判定改用 task_summary.xml 的 `IsEnd` 节点（之前用“最后一个节点”，完成的任务重启后又回到任务书），老存档自动修复；
- 宠物技能商店 1601 学习、1605 删除、1607 解锁天赋。

### 已实现但还没在界面里实测（v0.2）
- 使用药品（1114，按 itemInfo.xml 的 HpUp/MpUp）、战斗中用药（1309）；
- 商店买卖物品/装备（1108/1101/1112/1111，价格取自 itemInfo.xml / item_equip.xml）；
- 换装（1105，界面里拖装备；控制台 `/wear` 已验证）；
- 宠物：改名、加点、设为跟随、改出战状态、治疗宠物（1552/1606/1603/1558/1551/1555）。

### 闪退诊断（v0.1.1 起）
App 记录 Java 崩溃和 WebView 渲染进程退出，下次启动会显示诊断页（含最近日志），请截图反馈。

### 未在真机验证（需要你实测）
- 本环境无法运行 Android（无 SDK/模拟器镜像下载权限），**APK 没有在任何 Android 设备或模拟器上安装运行过**；
- smali 外壳（WebView、资源拦截、存档文件）只做了汇编和结构检查，运行时行为未验证；
- 手机上 Ruffle 的性能、触摸操作、输入法弹出（输入账号/名字）未验证。

### 近似规则（原服务端规则不在客户端里，以下为推测实现）
- 治疗价格：已改用客户端 TreatManager 的原版公式（不再是估算）；
- 伤害：`max(5%攻击, 攻击 − 0.6×防御) × 随机0.9~1.1`，暴击 ×1.5，防御 ×0.5；命中 = 命中 − 闪避；
- 怪物属性：Pet.xml 成长系数 ×(等级+1)/10，再套客户端属性系数矩阵，HP ×0.6；怪物只用普通攻击（5010）；
- 角色基础属性：使用客户端 `UserInfoPanal1._attrFactorMatrix` 推出，魔攻/魔防/命中/闪避/暴击为估计值；
- 天赋：每只新宠物从天赋池按权重抽 1~3 个（至少 1 个），原服抽取规则未知；技能等级随宠物等级提升；技能伤害公式为估算；召唤换宠的同步时机为估算（回合动画后约 2.5 秒+每个动作 1.5 秒，或下一回合第一个指令时）；
- 宠物属性：Pet.xml 成长系数 ×(等级+1)×成长值/2500 + 2，再套角色属性系数矩阵；宠物经验与角色相同、用角色升级表；
- 每只怪经验 `6 + 4×等级^1.5`；升级表为客户端内置真实数据；每级 4 个属性点；自动加点按职业初始属性比例；
- 掉落：使用 Pet.xml 中对应等级的 ItemID/Rate（千分比，真实配置）；
- 遇敌距离：Map.xml 的 BasicValue/RandomValue（×4.5 像素，配置注释给出的换算）。

### 未实现 / 不完整
- 技能（角色只能普攻/防御/逃跑；技能按普攻处理）、宠物技能与捕捉、组队、PVP、交易、邮件内容、好友；
- 任务：只保存任务状态与节点，按 task_summary.xml 发放节点奖励；任务战斗/特殊任务逻辑未逐一验证；
- 约 390 个命令中目前实现约 60 个，其余命令客户端发出后没有应答（相关界面可能无反应）；
- **v0.1 为了满足 500 MiB 的发送上限，没有打包编号 ≥10000 的任务动画**（`res/task/swf2/` 中 325 个文件、约 92 MB：支线/周期任务与后期地图剧情）。主线、新手流程和战斗所需资源都在。构建时设 `MOLE_SKIP_SIDE_TASKS=0` 可生成完整版（约 565 MB）；
- 仓库缓存缺失的资源（例如 `login/CareerSelectModule.swf`、部分地图）无法补全；
- 原 AIR 版的资源热更新、充值、网页跳转等在线功能不提供。
