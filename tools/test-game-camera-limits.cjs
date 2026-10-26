/* Usage: node tools/test-game-camera-limits.cjs <Pink preview URL> [playwright module path] */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[3] ? path.resolve(process.argv[3]) : 'playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CANNON_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const output = path.resolve('temp/codex-cannon'); await fs.mkdir(output, { recursive: true });
    try {
        const errors = [];
        const ready = page => page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('Main')?.getComponent('GameManager')?.phase === 'aiming');
        const state = page => page.evaluate(() => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager'), c = g._playerCamera;
            const home = c._homePosition.clone().subtract(c._homeFocus), homeYaw = Math.atan2(home.x, home.z);
            const dx = c._pivot.x - c._homeFocus.x, dz = c._pivot.z - c._homeFocus.z;
            return { unlocked: c.gmUnlocked, zoom: c._radius / home.length(), yaw: (c._yaw - homeYaw) * 180 / Math.PI,
                side: dx * Math.cos(homeYaw) - dz * Math.sin(homeYaw), depth: dx * Math.sin(homeYaw) + dz * Math.cos(homeYaw),
                vertical: c._pivot.y - c._homeFocus.y, radius: c._radius, homeRadius: home.length(), ammo: g.ammo,
                paused: g._paused, modal: g._ui._modalKind, far: g._camera.far, phase: g.phase };
        });
        const limited = s => {
            assert.equal(s.unlocked, false); assert.ok(s.zoom >= 0.8 - 1e-6 && s.zoom <= 1.25 + 1e-6, JSON.stringify(s));
            assert.ok(Math.abs(s.yaw) <= 25 + 1e-6, JSON.stringify(s));
            assert.ok(Math.abs(s.side) <= Math.min(2, s.homeRadius * 0.12) + 1e-6, JSON.stringify(s));
            assert.ok(Math.abs(s.depth) <= Math.min(1, s.homeRadius * 0.06) + 1e-6, JSON.stringify(s));
            assert.ok(Math.abs(s.vertical) <= Math.min(1.2, s.homeRadius * 0.08) + 1e-6, JSON.stringify(s));
        };
        const button = (page, name) => page.evaluate(name => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            function find(node) { if (node.name === name && node.activeInHierarchy) return node; for (const child of node.children) { const hit = find(child); if (hit) return hit; } }
            const p = g._ui._uiCamera.worldToScreen(find(g._ui._root).worldPosition); return { x: p.x, y: innerHeight - p.y };
        }, name);
        const click = async (page, name, mouseButton = 'left') => { const p = await button(page, name); await page.mouse.click(p.x, p.y, { button: mouseButton }); };
        const drag = async (page, mouseButton, fromX, toX) => {
            await page.mouse.move(fromX, 350); await page.mouse.down({ button: mouseButton });
            await page.mouse.move(toX, 450, { steps: 16 }); await page.mouse.up({ button: mouseButton });
        };
        const gm = async page => { await click(page, 'Pause'); await click(page, 'GMOpen'); await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._ui.isGMPanelOpen); };
        const resume = async page => { await click(page, 'GMBack'); await click(page, 'Continue'); };
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.on('pageerror', e => errors.push(e.message));
        await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' }); await ready(page);
        const initial = await state(page); limited(initial);
        await page.mouse.move(600, 350); await page.mouse.wheel(0, 100000);
        await page.waitForFunction(() => { const c = cc.director.getScene().getChildByName('Main').getComponent('GameManager')._playerCamera; return c._radius / c._homeRadius > 1.249; }); limited(await state(page));
        await page.mouse.wheel(0, -100000);
        await page.waitForFunction(() => { const c = cc.director.getScene().getChildByName('Main').getComponent('GameManager')._playerCamera; return c._radius / c._homeRadius < 0.801; }); limited(await state(page));
        for (const [from, to] of [[100, 1150], [1150, 100]]) { await drag(page, 'right', from, to); limited(await state(page)); await drag(page, 'middle', from, to); limited(await state(page)); }
        await click(page, 'View'); await drag(page, 'left', 100, 1150); limited(await state(page));
        await page.keyboard.press('v'); limited(await state(page));
        await page.evaluate(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._ui.onGMToggleLimits()); limited(await state(page));
        assert.equal((await state(page)).ammo, initial.ammo);
        console.log('PASS: repeated wheel, left/right orbit and pan, view mode and V stay inside normal limits without firing');

        await gm(page); await page.screenshot({ path: path.join(output, 'gm-camera-limited.png') });
        await click(page, 'GMToggleLimits', 'right'); assert.equal((await state(page)).unlocked, false);
        await click(page, 'GMToggleLimits');
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._playerCamera.gmUnlocked);
        const paused = await state(page); assert.equal(paused.paused, true); assert.ok(paused.far >= 2000);
        await page.mouse.move(600, 350); await page.mouse.wheel(0, 1000);
        assert.equal((await state(page)).radius, paused.radius, 'the GM overlay keeps game input paused');
        await page.screenshot({ path: path.join(output, 'gm-camera-unlocked.png') }); await resume(page);
        await page.mouse.move(600, 350); await page.mouse.wheel(0, 1000);
        await page.waitForFunction(() => { const c = cc.director.getScene().getChildByName('Main').getComponent('GameManager')._playerCamera; return c._radius / c._homeRadius > 1.5; });
        await drag(page, 'right', 100, 1150); await drag(page, 'middle', 100, 1150);
        const free = await state(page); assert.ok(Math.abs(free.yaw) > 25); assert.ok(Math.abs(free.side) > 2); assert.equal(free.ammo, initial.ammo);
        await gm(page); await page.setViewportSize({ width: 720, height: 1100 });
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._ui._h === 1100);
        assert.equal((await state(page)).modal, 'gm'); assert.equal((await state(page)).unlocked, true);
        await page.screenshot({ path: path.join(output, 'gm-camera-portrait.png') });
        await click(page, 'GMToggleLimits');
        await page.waitForFunction(() => !cc.director.getScene().getChildByName('Main').getComponent('GameManager')._playerCamera.gmUnlocked);
        limited(await state(page)); assert.ok((await state(page)).far < 2000);
        await resume(page); limited(await state(page));
        await click(page, 'Retry'); await ready(page); limited(await state(page));
        await page.reload(); await ready(page); limited(await state(page));
        console.log('PASS: only the GM panel unlocks; free orbit/zoom/pan exceed player bounds; resize preserves the panel; relocking clamps immediately');

        const context = await browser.newContext({ viewport: { width: 720, height: 1100 }, hasTouch: true, isMobile: true });
        const mobile = await context.newPage(); mobile.on('pageerror', e => errors.push(e.message));
        await mobile.goto(process.argv[2], { waitUntil: 'domcontentloaded' }); await ready(mobile);
        const mobileInitial = await state(mobile), cdp = await context.newCDPSession(mobile);
        const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y })) });
        await touch('touchStart', [[1, 300, 450], [2, 400, 450]]); await touch('touchMove', [[1, 100, 450], [2, 650, 450]]); await touch('touchEnd', []);
        await mobile.waitForFunction(() => { const c = cc.director.getScene().getChildByName('Main').getComponent('GameManager')._playerCamera; return c._radius / c._homeRadius < 0.801; }); limited(await state(mobile));
        await touch('touchStart', [[3, 100, 500], [4, 600, 500]]); await touch('touchMove', [[3, 300, 500], [4, 400, 500]]); await touch('touchEnd', []);
        await mobile.waitForFunction(() => { const c = cc.director.getScene().getChildByName('Main').getComponent('GameManager')._playerCamera; return c._radius / c._homeRadius > 1.249; }); limited(await state(mobile));
        const view = await button(mobile, 'View'); await mobile.touchscreen.tap(view.x, view.y);
        await touch('touchStart', [[5, 100, 450]]); await touch('touchMove', [[5, 650, 450]]); await touch('touchEnd', []); limited(await state(mobile));
        assert.equal((await state(mobile)).ammo, mobileInitial.ammo); assert.deepEqual(errors, []);
        console.log('PASS: real touch pinch and one-finger view gestures enforce the same limits without consuming ammo');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
