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
- 包名 `com.molehero.offline`，可与原版共存。
- 首次登录：输入**大于 50000 的任意数字账号**（例如 100001）和密码，即自动在本地创建账号（原复兴版的注册是网页，离线不可用）；之后需用同一密码。客户端把 50000 以下的 ID 当作怪物/NPC，所以小号码无法使用。
- 选择服务器 → 剧情动画 → 创建角色（名字、职业、外观）→ 进入新手地图。

## 5. 已验证 / 近似 / 未实现

### 已验证（开发机：Chromium 无 GPU + Ruffle 0.8.0-nightly.2026.10.20，客户端与 APK 内文件相同）
截图见 `docs/screens/`。
1. 断网启动：页面不访问任何外部地址（外部请求全部由本地拦截返回），依次加载 BaseUI → 配置 → 登录面板；
2. 登录：新账号自动建号 → 103 登录 → 107 建角色占位 → 105 服务器列表 → 选服；
3. 游戏服：约 40 条初始化命令应答后进入主界面；
4. **新角色**：剧情动画（可“不看动画”）→ 新手地图 11101 → 点击 NPC → 起名（1018）→ 选职业 → 外观确认（1015）→ 回到地图；存档中记录了名字、职业、新手装备；
5. **闭环**：在暗雷地图 21102 走路 → 遇敌 → 战斗（加载进度、开战、每回合 1308→1310/1311）→ 胜利结算面板（经验、掉落物品）→ 升级（Lv1→Lv2）→ 自动存档；
6. **读档**：刷新页面（相当于重启 App）后重新登录，读到 Lv2、经验 51、物品、所在地图与坐标；
7. 打包：APK 由 apksig 校验 v2 签名有效；resources.arsc 未压缩且对齐；所有 ZIP 条目本地/中央目录文件名一致；dex 可被 baksmali 解析。

### 未在真机验证（需要你实测）
- 本环境无法运行 Android（无 SDK/模拟器镜像下载权限），**APK 没有在任何 Android 设备或模拟器上安装运行过**；
- smali 外壳（WebView、资源拦截、存档文件）只做了汇编和结构检查，运行时行为未验证；
- 手机上 Ruffle 的性能、触摸操作、输入法弹出（输入账号/名字）未验证。

### 近似规则（原服务端规则不在客户端里，以下为推测实现）
- 伤害：`max(5%攻击, 攻击 − 0.6×防御) × 随机0.9~1.1`，暴击 ×1.5，防御 ×0.5；命中 = 命中 − 闪避；
- 怪物属性：Pet.xml 成长系数 ×(等级+1)/10，再套客户端属性系数矩阵，HP ×0.6；怪物只用普通攻击（5010）；
- 角色基础属性：使用客户端 `UserInfoPanal1._attrFactorMatrix` 推出，魔攻/魔防/命中/闪避/暴击为估计值；
- 每只怪经验 `6 + 4×等级^1.5`；升级表为客户端内置真实数据；每级 4 个属性点；自动加点按职业初始属性比例；
- 掉落：使用 Pet.xml 中对应等级的 ItemID/Rate（千分比，真实配置）；
- 遇敌距离：Map.xml 的 BasicValue/RandomValue（×4.5 像素，配置注释给出的换算）。

### 未实现 / 不完整
- 技能（角色只能普攻/防御/逃跑；技能按普攻处理）、宠物（捕捉、出战、宠物列表编码）、组队、PVP、交易、商店买卖、邮件内容、好友；
- 任务：只保存任务状态与节点，按 task_summary.xml 发放节点奖励；任务战斗/特殊任务逻辑未逐一验证；
- 角色创建后地图上的外观要下次登录才刷新；
- 约 390 个命令中目前实现约 60 个，其余命令客户端发出后没有应答（相关界面可能无反应）；
- **v0.1 为了满足 500 MiB 的发送上限，没有打包编号 ≥10000 的任务动画**（`res/task/swf2/` 中 325 个文件、约 92 MB：支线/周期任务与后期地图剧情）。主线、新手流程和战斗所需资源都在。构建时设 `MOLE_SKIP_SIDE_TASKS=0` 可生成完整版（约 565 MB）；
- 仓库缓存缺失的资源（例如 `login/CareerSelectModule.swf`、部分地图）无法补全；
- 原 AIR 版的资源热更新、充值、网页跳转等在线功能不提供。
