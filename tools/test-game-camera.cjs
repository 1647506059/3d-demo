/* Usage: node tools/test-game-camera.cjs <Pink preview URL> [playwright module path] */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[3] ? path.resolve(process.argv[3]) : 'playwright');
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CANNON_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const output = path.resolve('temp/codex-cannon'); await fs.mkdir(output, { recursive: true });
    try {
        const errors = [];
        const ready = page => page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('Main')?.getComponent('GameManager')?.phase === 'aiming');
        const pose = page => page.evaluate(() => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager'), c = g._playerCamera;
            return { position: { ...g._camera.node.worldPosition }, pivot: { ...c._pivot }, radius: c._radius, viewMode: c.viewMode, interacting: c.interacting, ammo: g.ammo, phase: g.phase };
        });
        const button = (page, name) => page.evaluate(name => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            function find(node) { if (node.name === name && node.activeInHierarchy) return node; for (const child of node.children) { const found = find(child); if (found) return found; } }
            const p = g._ui._uiCamera.worldToScreen(find(g._ui._root).worldPosition); return { x: p.x, y: innerHeight - p.y };
        }, name);
        const click = async (page, name) => { const p = await button(page, name); await page.mouse.click(p.x, p.y); };
        const drag = async (page, mouseButton) => { await page.mouse.move(560, 350); await page.mouse.down({ button: mouseButton }); await page.mouse.move(700, 390, { steps: 12 }); await page.mouse.up({ button: mouseButton }); };
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); page.on('pageerror', e => errors.push(e.message));
        await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' }); await ready(page);
        const home = await pose(page);
        await drag(page, 'right'); const orbit = await pose(page);
        assert.ok(distance(home.position, orbit.position) > 0.5); assert.equal(orbit.ammo, home.ammo); assert.equal(orbit.phase, 'aiming');
        await page.waitForTimeout(250); assert.ok(distance((await pose(page)).position, orbit.position) < 1e-5, 'camera must not snap back on the next update');
        const retry = await button(page, 'Retry'); await page.mouse.click(retry.x, retry.y, { button: 'right' });
        assert.ok(distance((await pose(page)).position, orbit.position) < 1e-5, 'right-clicking HUD must not trigger retry');
        await page.mouse.move(600, 350); await page.mouse.wheel(0, 250);
        await page.waitForFunction(radius => Math.abs(cc.director.getScene().getChildByName('Main').getComponent('GameManager')._playerCamera._radius - radius) > 0.1, orbit.radius);
        const zoomed = await pose(page);
        await drag(page, 'middle'); const panned = await pose(page); assert.ok(distance(panned.pivot, zoomed.pivot) > 0.1); assert.equal(panned.ammo, home.ammo);
        await page.keyboard.press('v'); assert.ok(distance((await pose(page)).position, home.position) < 1e-5);
        console.log('PASS: right orbit, wheel zoom, middle pan, no snap-back or accidental shots, V reset');

        await click(page, 'View'); assert.equal((await pose(page)).viewMode, true);
        await drag(page, 'left'); const view = await pose(page); assert.ok(distance(view.position, home.position) > 0.5); assert.equal(view.ammo, home.ammo);
        await click(page, 'View'); assert.equal((await pose(page)).viewMode, false);
        await click(page, 'Pause'); const paused = await pose(page); await drag(page, 'right'); await page.mouse.wheel(0, 250);
        assert.ok(distance((await pose(page)).position, paused.position) < 1e-5);
        await click(page, 'ResetView'); assert.ok(distance((await pose(page)).position, home.position) < 1e-5); await click(page, 'Continue');
        await drag(page, 'right'); const beforeResize = await pose(page); await page.setViewportSize({ width: 720, height: 1100 });
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._ui._h === 1100);
        assert.ok(distance((await pose(page)).position, beforeResize.position) < 1e-5);
        await page.screenshot({ path: path.join(output, 'camera-orbit.png') }); await page.close();
        console.log('PASS: view-mode left drag, pause input isolation, pause-menu reset, resize preserves the chosen view');

        const context = await browser.newContext({ viewport: { width: 720, height: 1100 }, hasTouch: true, isMobile: true });
        const mobile = await context.newPage(); mobile.on('pageerror', e => errors.push(e.message));
        await mobile.goto(process.argv[2], { waitUntil: 'domcontentloaded' }); await ready(mobile);
        const mobileHome = await pose(mobile), cdp = await context.newCDPSession(mobile);
        const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y })) });
        await touch('touchStart', [[1, 220, 450], [2, 430, 450]]);
        await touch('touchMove', [[1, 230, 410], [2, 490, 410]]); await touch('touchMove', [[1, 240, 390], [2, 530, 390]]);
        await touch('touchEnd', []);
        const pinched = await pose(mobile);
        assert.ok(distance(pinched.position, mobileHome.position) > 0.5); assert.ok(Math.abs(pinched.radius - mobileHome.radius) > 0.1);
        assert.equal(pinched.ammo, mobileHome.ammo); assert.equal(pinched.phase, 'aiming'); assert.equal(pinched.interacting, false);
        const viewButton = await button(mobile, 'View'); await mobile.touchscreen.tap(viewButton.x, viewButton.y);
        assert.equal((await pose(mobile)).viewMode, true);
        await touch('touchStart', [[3, 300, 450]]); await touch('touchMove', [[3, 420, 510]]); await touch('touchEnd', []);
        assert.ok(distance((await pose(mobile)).position, pinched.position) > 0.5); assert.equal((await pose(mobile)).ammo, mobileHome.ammo);
        const pause = await button(mobile, 'Pause'); await mobile.touchscreen.tap(pause.x, pause.y);
        const reset = await button(mobile, 'ResetView'); await mobile.touchscreen.tap(reset.x, reset.y);
        const resume = await button(mobile, 'Continue'); await mobile.touchscreen.tap(resume.x, resume.y);
        assert.ok(distance((await pose(mobile)).position, mobileHome.position) < 1e-5);
        const fire = await button(mobile, 'Fire'); await touch('touchStart', [[4, fire.x, fire.y]]);
        await mobile.waitForFunction(() => cc.director.getScene().getChildByName('Cannon').getComponent('CannonController')._charge >= 0.7);
        await touch('touchEnd', []);
        await mobile.waitForFunction(ammo => cc.director.getScene().getChildByName('Main').getComponent('GameManager').ammo === ammo - 1, mobileHome.ammo);
        assert.deepEqual(errors, []);
        await fs.writeFile(path.join(output, 'camera-verification.json'), JSON.stringify({ passed: true, home, orbit, zoomed, panned, mobileHome, pinched, errors }, null, 2));
        console.log('PASS: real two-finger touch orbit/pinch and one-finger view mode never fire; touch aiming/fire still works after reset');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
