# 打索子 iOS 打包与上架准备

本轮生成了 Capacitor 8.4.1 的 iOS 工程，包名 `com.junegod.dasuozi`，显示名称“打索子”，版本 1.2.0，最低 iOS 15.4（支持原生隐私对话框），面向 iPhone 竖屏。游戏是本地资源运行的骨牌游戏，保留自愿联机功能；没有支付、积分交易或兑换接口。

## 已完成

- iOS 工程、Swift Package Manager 依赖、原生图标和启动图，不使用远程网页作为应用首页。
- iPhone 竖屏和 WebView 安全区域配置，未添加 HTTP 放行或敏感权限。
- 将可见“赏钱”改为“奖励分”、“卖屁股”改为“无门弃牌”、“庄家”角色标识改为“先手”；“打索子”、牌名和真实规则保持。旧数据库键、积分枚举、协议字段不改名，避免破坏已有数据。
- 将没有资质证明的“非物质文化遗产”宣传改为“地方传统玩法”。这不是对该玩法文化价值的判断，而是避免未经核实的官方身份表述。
- 免费补分明确写明积分用途，不可购买、转让或兑换；结算展示使用加分、扣分。
- 随安装包提供离线隐私说明；设置内可查看及撤回联机同意。首次联机须明确确认，取消不影响单机。首页不预连接；已同意且尚未离开的房间可自动恢复。
- 添加应用隐私清单：无追踪；联机昵称、座位标识、操作信息按关联用户的应用功能数据保守列明。未使用需单独说明理由的原生 API；以后添加插件时必须重新核查。

## 构建命令

需要 Node.js 22+、pnpm、Xcode 26+，以及 Xcode 对应的 iOS 平台组件。

```sh
pnpm install --frozen-lockfile
pnpm ios:sync
pnpm ios:open
pnpm ios:build
pnpm ios:archive
```

- `ios:sync`：编译前端并同步原生工程。
- `ios:build`：构建未签名模拟器应用，成功才生成 `release/da-suo-zi-1.2.0-ios-simulator.zip`。
- `ios:archive`：构建未签名设备归档，成功才生成 `release/DaSuoZi-unsigned.xcarchive` 及其 ZIP。未签名归档不能直接安装或上传 App Store。
- 构建脚本仅为当前子进程指定 `/Applications/Xcode.app/Contents/Developer`，不修改系统默认的 `xcode-select`。
- `ios/App/App/public` 和同步生成的 Capacitor 配置不提交，由 `ios:sync` 重建。工程交付 ZIP 则包含这些文件，解压后可直接用 Xcode 打开工程。

### 当前机器验证边界

2026-09-26：Xcode 26.6，SDK 26.5，但没有 iOS 26.5 运行平台。归档返回 `iOS 26.5 is not installed`，进一步直接设备编译在启动故事板编译阶段仍报告平台缺失。`xcodebuild -runFirstLaunch -checkForNewerComponents` 未找到更新；运行平台下载约 8.52 GB，当前网络速度不足，本轮停止下载，没有生成成功的 `.app`、`.xcarchive` 或 `.ipa`。

可在 Xcode → Settings → Components 安装对应 iOS 平台，或在有足够空间和稳定网络时执行：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -downloadPlatform iOS -architectureVariant arm64
pnpm ios:archive
```

本机没有 Apple Distribution 签名证书；现有 Apple Development 和 macOS Developer ID 证书不能冒充商店发行证书。未选用任何用户团队，未注册 App ID、创建描述文件或上传 App Store Connect。

## 能否上架

技术上可以准备提交，但当前不能认定已满足审核要求，也不能仅靠替换名字保证过审。Apple 根据实际玩法、素材、网络服务及商店信息审核。

1. **发行地区**：中国大陆商店的游戏需要 NPPA 游戏审批号及支持文件，还需核实适用的 ICP 备案等信息。非商业、免费、地方文化定位不能作为自动豁免理由。其他地区也有各自的游戏分级与许可要求，需逐一确认。
2. **开发者账户**：确认 Apple Developer Program 账户及发布主体，确保 Bundle ID 可用，在 Signing & Capabilities 选择自己的 Team。递增 build 号、以正式签名重新 Archive，然后通过 Organizer 验证、上传 TestFlight。
3. **联机内容**：当前公开大厅展示用户自填昵称，房间内可编辑机器人名；尚无完整的内容过滤、举报、屏蔽与处理机制。保留联机公开发行时，需要按审核指南 1.2 完成适用治理措施。若首版决定只做离线玩法，应做真实、全程一致的离线产品版本，不能对审核人员隐藏功能。
4. **隐私与支持**：`public/privacy.html` 已含实际客户端、服务端数据流与退出方式，但正式上线前仍需确认运营主体、可用支持渠道、基础设施日志的保留/删除规则。将最终政策部署到可公开访问的 HTTPS 地址，并填写到 App Store Connect；本轮没有部署网站，也没有把未部署的政策 URL 当成可用地址。
5. **年龄分级**：如实填写 Chance-Based Activities、Simulated Gambling、用户生成内容等问卷。不能因改成“积分”就自动勾选“没有模拟赌博”；也不应仅因使用骨牌就武断认定是真钱赌博。由实际是否存在投注/押注行为、频率及各地区规则决定；不申报儿童类别。
6. **真实体验**：在真实 iPhone / WKWebView 验证安全区域、静音与音频、开局 WebGL、后台恢复、网络切换、结算落账，以及删除并重新安装后的本地数据状态。网页检查不替代真机验证。
7. **服务发布一致性**：联机动作提示由服务端规则引擎生成，因此服务器也要部署本轮文字变更；只发布 iOS 客户端时，旧服务器仍可能返回旧文案。本轮未部署服务。

## 商店资料草稿

- 名称：打索子
- 副标题：吉安传统骨牌玩法与练习
- 类别建议：游戏 → 桌面 / 卡牌；最终按商店可选分类确认。
- 简介：体验江西吉安新居村流传的四人骨牌玩法。认识 32 张传统骨牌，通过单机练习、定制起手牌、局内规则和回合复盘学习出牌与计分。积分只记录游戏表现，不可购买、转让或兑换。多人对战需自愿同意必要的联机数据处理。
- 审核备注：启动后无需注册即可进入单机或定制练习。设置内可查看隐私说明。多人对战通过加密 WebSocket 同步房间和公开牌局，首次进入需确认；当前不提供支付、现金投注、奖品或积分兑换。正式提审前须完成上面的联机治理和服务部署检查。
- 截图应在实际签名构建中拍摄，不能用桌面 Chrome 截图充当已验证的 iPhone 原生运行截图。

## 核对的 Apple 官方资料

核对日期：2026-09-26。

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)：1.2 用户生成内容、2.3 元数据与分级、4.2 最低功能、5.1 隐私、5.3 游戏与赌博。
- [App information / Availability in China mainland](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/)：中国大陆游戏审批号、支持文件及适用 ICP 信息。
- [Age ratings values and definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/)：真实和模拟赌博定义及分级。
- [Capacitor iOS](https://capacitorjs.com/docs/ios)：原生平台、最低系统和 Xcode 要求。
