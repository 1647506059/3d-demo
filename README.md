# 油桶爆破行动

基于现有 Cocos 3D 模型和 1000 份关卡数据的炮击游戏，通过 Pink 开发和预览。

## 运行

1. 在 Pink 中打开项目，等待资源和脚本导入完成。
2. 打开 `assets/main.scene`，点击 Pink 的预览按钮。
3. 拖动场景中的准星，按住蓄力、松开发射；也可以先移动鼠标瞄准，再按住右下角的「开炮」。
4. 摧毁或击落所有目标即可通关。炮弹用尽后，需要等待当前炮弹和连锁反应结算，才会判定失败。

支持暂停、音效开关、重试、下一关、星级评分和本地进度保存。横屏、竖屏均有独立布局。`Main.levelIndex` 大于 1 时可指定起始关卡；默认从本地进度继续。

玩家相机固定在炮口后方，以低机位越肩视角瞄准，鼠标拖动只调整炮口。命中后保留油桶翻滚、碎片、烟尘和冲击波；最后一击至少展示 4 秒，并在最后一次连锁反应结束后保留至少 2.8 秒，再弹出结算。暂停期间不会消耗展示时间。

## 玩法与资源

- 炮弹采用重力弹道和逐帧射线检测，避免高速飞行穿透目标；虚线预览与发射使用同一套弹道公式。
- 油桶使用 Bullet 刚体碰撞，命中产生冲击波和有限层数的连锁爆破；掉下平台的目标同样计入完成数。
- 金色炸药桶具有更大的爆炸范围，石头需要更高伤害。连爆和剩余炮弹提供额外得分。
- 弹药预算随目标数量变化；关卡中的旋转平台、移动平台和移动挡板由原有 JSON 配置驱动。
- 模型来自 `assets/mesh` 分包，关卡来自 `assets/resources/prod-13-json`，不依赖运行时远程服务。

## Pink 开发流程

当前环境：Pink 1.127.0 / Cocos 4.0.0-beta.0。项目的历史 Creator 版本标记为 3.8.8，当前验证以 Pink 选用的引擎为准。

项目自带 `tools/pink-automation` 本地开发桥。在 Pink 中启用已有的 `SUD.pink-automation-bridge` 扩展后：

```powershell
node tools/pink-automation/client.cjs status
node tools/pink-automation/client.cjs capabilities
node tools/pink-automation/client.cjs describe assets.refresh
```

开发时先按项目路径连接开发桥，并通过 `pink_scene_bind` 绑定 `db://assets/main.scene`。修改脚本后，用 `pink_prepare` → `pink_commit` 调用精确路径的 `assets.refresh` 或 `assets.reimportAsset`，再检查 `pink_diagnostics` 并运行预览。写操作的准备票据不需要额外的人工确认，它用于防止项目、场景或文件版本在操作期间发生变化。

预览地址从当前 Pink 的 `pink_status` / `pink_preview_state` 返回值获取，不写死端口。场景操作、资源导入和预览均使用同一项目的 Pink 实例。

## 验证

规则回归需要 Node.js 22.6 或更新版本：

```powershell
node --test tools/test-game-rules.mjs
```

浏览器回归需要 Playwright 和 Chrome/Chromium，依赖可安装到已忽略的临时目录：

```powershell
npm install --prefix temp/codex-cannon playwright --no-audit --no-fund
$env:CANNON_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node tools/test-game-preview.cjs '<当前 Pink 返回的预览 URL>' './temp/codex-cannon/node_modules/playwright'
node tools/test-game-presentation.cjs '<当前 Pink 返回的预览 URL>' './temp/codex-cannon/node_modules/playwright'
```

回归覆盖暂停/继续、真实鼠标瞄准和开炮、单发扣弹、碰撞与连爆、通关、下一关、重试、最后一发失败，以及横竖屏切换。表现回归额外检查炮口后方镜头、瞄准时镜头稳定、直接命中最后一个目标时的无弹窗展示，以及展示暂停和延迟结算。验证截图和结果保存在 `temp/codex-cannon/`，不进入版本库。
