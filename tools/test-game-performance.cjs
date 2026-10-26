/* Usage: node tools/test-game-performance.cjs <Pink preview URL> [playwright module path] */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[3] ? path.resolve(process.argv[3]) : 'playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CANNON_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => {
            const g = window.cc?.director.getScene()?.getChildByName('Main')?.getComponent('GameManager');
            return g?.phase === 'aiming' && g._cannon._reticleFrames === 0;
        });
        const idle = await page.evaluate(async () => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            const counts = { cameraApplies: 0, trajectoryWrites: 0 };
            const apply = g._playerCamera._apply.bind(g._playerCamera);
            g._playerCamera._apply = (...args) => { counts.cameraApplies++; return apply(...args); };
            for (const node of g._cannon._dots) { const set = node.setWorldPosition.bind(node); node.setWorldPosition = (...args) => { counts.trajectoryWrites++; return set(...args); }; }
            const frames = [], draws = []; let previous = performance.now();
            await new Promise(resolve => { function sample(time) { frames.push(time - previous); previous = time; draws.push(cc.director.root.device.numDrawCalls); if (frames.length === 30) resolve(); else requestAnimationFrame(sample); } requestAnimationFrame(sample); });
            return { counts, drawCalls: Math.max(...draws), averageFrameMs: frames.reduce((a, b) => a + b) / frames.length, renderer: cc.director.root.device.renderer };
        });
        assert.equal(idle.counts.cameraApplies, 0); assert.equal(idle.counts.trajectoryWrites, 0); assert.ok(idle.drawCalls < 80, JSON.stringify(idle));
        const hudRenders = await page.evaluate(async () => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager'); let count = 0;
            const render = g._ui.render.bind(g._ui); g._ui.render = (...args) => { count++; return render(...args); };
            for (let i = 0; i < 20; i++) g._render();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return count;
        });
        assert.equal(hudRenders, 1);
        const reticleError = () => page.evaluate(() => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            const expected = g._camera.worldToScreen(g._cannon._aim), actual = g._ui._uiCamera.worldToScreen(g._ui._reticle.worldPosition);
            return Math.hypot(expected.x - actual.x, expected.y - actual.y);
        });
        assert.ok(await reticleError() < 1);
        await page.setViewportSize({ width: 720, height: 1100 });
        await page.waitForFunction(() => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            return g._ui._h === 1100 && g._cannon._reticleFrames === 0;
        });
        assert.ok(await reticleError() < 1, 'cached reticle must stay aligned after viewport changes');
        console.log('PASS: batched rendering, no idle camera/trajectory writes, coalesced HUD, correct reticle', idle);
        await page.evaluate(() => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            g._burst(g._loaded.bounds.max, 12, '#FFB650');
        });
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._particles.length === 0, null, { timeout: 15000 });
        const reused = await page.evaluate(() => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            const pool = new Set([...g._effectPool.values()].flat()); g._burst(g._loaded.bounds.max, 12, '#FFB650');
            return { count: g._particles.length, allReused: g._particles.every(p => pool.has(p.node)) };
        });
        assert.equal(reused.count, 12); assert.equal(reused.allReused, true);
        const capped = await page.evaluate(() => { const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager'); g._burst(g._loaded.bounds.max, 500, '#FFB650'); return g._particles.length; });
        assert.equal(capped, 80);
        const resetPosition = await page.evaluate(() => {
            const c = cc.director.getScene().getChildByName('Cannon').getComponent('CannonController');
            c._recoil = 0.15; c._visual.setPosition(0, 0, 0.1); c.reset(); return c._visual.position.z;
        });
        assert.equal(resetPosition, -0.2, 'retry during recoil must restore the cannon without idle position writes');
        assert.deepEqual(errors, []);
        await fs.mkdir('temp/codex-cannon', { recursive: true });
        await fs.writeFile('temp/codex-cannon/performance-verification.json', JSON.stringify({ passed: true, idle, hudRenders, reused, capped, errors }, null, 2));
        console.log('PASS: repeated effects reuse their nodes and large bursts remain bounded');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
