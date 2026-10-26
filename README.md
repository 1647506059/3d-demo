# 油桶爆破行动

基于现有 Cocos 3D 模型和 1000 份关卡数据的炮击游戏，通过 Pink 开发和预览。

## 运行

1. 在 Pink 中打开项目，等待资源和脚本导入完成。
2. 需要边运行边编辑场景时，在项目目录运行 `npm run preview`，使用独立浏览器预览；也可以在 Pink 顶部选择「浏览器」预览。入口会读取当前 Pink 服务地址并固定加载 `assets/main.scene`。
3. 拖动场景中的准星，按住蓄力、松开发射；也可以先移动鼠标瞄准，再按住右下角的「开炮」。
4. 可以反复点击或蓄力连续发射，多枚炮弹可同时飞行；前一发的命中、倒塌与连爆不会锁住下一发。摧毁或击落所有目标即可通关。炮弹用尽后，所有在途炮弹和连锁反应结束才会判定失败。

支持暂停、音效开关、重试、下一关、星级评分和本地进度保存。横屏、竖屏均有独立布局。`Main.levelIndex` 大于 1 时可指定起始关卡；默认从本地进度继续。

当前 Pink 版本的「编辑器内预览」依附于场景编辑页，切走该页会停止内嵌游戏，返回时显示场景编辑视图。独立浏览器预览拥有自己的游戏运行实例，可以在 Pink 中切换场景或代码页；关闭浏览器页即可结束这次游戏。修改脚本引起的热重载仍可能重新加载游戏。

战斗界面只保留边角的关卡进度、得分、弹药和浮动开炮按钮，顶部与底部没有横跨画面的面板。蓄力条仅在按住时出现，操作提示会自动淡出，并在首次蓄力后收起；最高分可在暂停菜单中查看。

玩家相机默认位于炮口后方，以越肩视角瞄准；炮台缩小并位于画面下沿，给目标留出视野。左键拖动瞄准，右键拖动环视，中键拖动平移，滚轮缩放；按 V 或使用暂停菜单的「回正视角」可恢复炮后视角。右上角「视角」按钮可切换单指/左键环视模式；触屏也可用双指拖动环视、捏合缩放，相机手势不会消耗炮弹。命中后保留油桶翻滚、碎片、烟尘和冲击波；结算会等待全部在途炮弹结束，最后一次命中至少展示 4 秒，并在最后一次连锁反应结束后保留至少 2.8 秒，再弹出结算。暂停期间不会消耗展示时间。

## 玩法与资源

- 炮弹采用重力弹道和逐帧射线检测，避免高速飞行穿透目标；虚线预览与发射使用同一套弹道公式。
- 油桶使用 Bullet 刚体碰撞，命中产生冲击波和有限层数的连锁爆破；掉下平台的目标同样计入完成数。
- 金色炸药桶具有更大的爆炸范围，石头需要更高伤害。连爆和剩余炮弹提供额外得分。
- 弹药预算随目标数量变化；关卡中的旋转平台、移动平台和移动挡板由原有 JSON 配置驱动。
- 模型来自 `assets/mesh` 分包，关卡来自 `assets/resources/prod-13-json`，不依赖运行时远程服务。
- 重复模型共享实例化材质，主要物体保留单级阴影；装饰、弹道点和碎片不额外投影。相机与弹道按变化更新，连爆合并同帧 HUD 重绘，碎片使用对象池并限制为最多 80 个，保留油桶翻滚、烟尘与冲击波。

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
node tools/test-game-camera.cjs '<当前 Pink 返回的预览 URL>' './temp/codex-cannon/node_modules/playwright'
node tools/test-game-performance.cjs '<当前 Pink 返回的预览 URL>' './temp/codex-cannon/node_modules/playwright'
node tools/test-game-rapid-fire.cjs '<当前 Pink 返回的预览 URL>' './temp/codex-cannon/node_modules/playwright'
node tools/test-game-mount.cjs '<当前 Pink 返回的预览 URL>' './temp/codex-cannon/node_modules/playwright'
```

回归覆盖暂停/继续、真实鼠标瞄准和开炮、单发扣弹、碰撞与连爆、通关、下一关、重试、最后一发失败，以及横竖屏切换。表现回归额外检查炮口后方镜头、瞄准时镜头稳定、直接命中最后一个目标时的无弹窗展示，以及展示暂停和延迟结算。视角回归覆盖右键环视、中键平移、滚轮缩放、V/菜单回正、暂停与屏幕旋转，以及真实双指操作和开炮的互斥。连续射击回归覆盖多弹并行与独立瞄准、暂停全部炮弹、命中时继续蓄力、重试清空在途炮弹，以及最后一枚炮弹结束后的胜负结算。炮架回归从 GLB 几何提取横轴与炮口位置，检查转向、俯仰、后坐和复位时的连接，并确认炮弹与火光从可见炮口发出。验证截图和结果保存在 `temp/codex-cannon/`，不进入版本库。
