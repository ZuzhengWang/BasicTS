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
# 输出 out/mole-offline-0.1.0-offline.apk
```
构建步骤：克隆 RecTaoMee_Hero → npm 安装 Ruffle → Maven 获取 smali/apksig → smali 汇编 dex → 生成二进制清单 → 打包（resources.arsc 不压缩、4 字节对齐）→ v2 签名 → apksig 校验。

签名使用 `android/keystore/debug-offline.p12`（公开的调试密钥，密码 `moleoffline`），只用于让后续版本能覆盖安装，不代表任何官方身份。

## 4. 使用
- 包名 `com.molehero.offline`，可与原版共存。
- 首次登录：输入**任意数字账号**和密码即自动在本地创建账号（原复兴版的注册是网页，离线不可用）；之后需用同一密码。
- 选择服务器 → 剧情动画 → 创建角色（名字、职业、外观）→ 进入新手地图。

## 5. 已验证 / 近似 / 未实现

（见文末“测试记录”。）
