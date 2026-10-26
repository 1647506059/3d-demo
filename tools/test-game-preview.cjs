/* Usage: node tools/test-game-preview.cjs <Pink preview URL> [playwright module path] */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[3] ? path.resolve(process.argv[3]) : 'playwright');

(async () => {
    const output = path.resolve('temp/codex-cannon'); await fs.mkdir(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CANNON_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors = [], failures = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) failures.push(`${r.status()} ${r.url()}`); });
        const state = () => page.evaluate(() => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            return { level: g.level, phase: g.phase, ammo: g.ammo, budget: g.budget, total: g.total, cleared: g.cleared, score: g.score, paused: g._paused };
        });
        const waitReady = () => page.waitForFunction(() => ['aiming', 'won', 'lost'].includes(window.cc?.director.getScene()?.getChildByName('Main')?.getComponent('GameManager')?.phase), null, { timeout: 20000 });
        const clickButton = async name => {
            const p = await page.evaluate(name => {
                const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
                function find(node) { if (node.name === name && node.activeInHierarchy) return node; for (const c of node.children) { const found = find(c); if (found) return found; } }
                const p = g._ui._uiCamera.worldToScreen(find(g._ui._root).worldPosition);
                return { x: p.x, y: innerHeight - p.y };
            }, name);
            await page.mouse.click(p.x, p.y);
        };
        const shoot = async miss => {
            const before = await state();
            const p = await page.evaluate(miss => {
                const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
                const alive = g._targets.filter(t => !t.removed && !t.pending).sort((a, b) => a.node.worldPosition.y - b.node.worldPosition.y);
                const aim = alive[Math.min(1, alive.length - 1)].node.worldPosition.clone();
                if (miss) { aim.x = g._loaded.bounds.min.x - 6; aim.y = 3; aim.z = g._loaded.bounds.min.z; }
                const p = g._camera.worldToScreen(aim); return { x: p.x, y: innerHeight - p.y };
            }, miss);
            await page.mouse.move(p.x, p.y);
            const fire = await page.evaluate(() => {
                const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
                const p = g._ui._uiCamera.worldToScreen(g._ui._root.getChildByName('Fire').worldPosition);
                return { x: p.x, y: innerHeight - p.y };
            });
            await page.mouse.move(fire.x, fire.y); await page.mouse.down();
            await page.waitForFunction(() => cc.director.getScene().getChildByName('Cannon').getComponent('CannonController')._charging, null, { timeout: 5000 });
            await page.waitForFunction(() => cc.director.getScene().getChildByName('Cannon').getComponent('CannonController')._charge >= 0.7, null, { timeout: 5000 });
            await page.mouse.up();
            await page.waitForFunction(ammo => cc.director.getScene().getChildByName('Main').getComponent('GameManager').ammo === ammo - 1, before.ammo, { timeout: 5000 });
            await waitReady(); return state();
        };
        await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' }); await waitReady();
        assert.equal((await state()).cleared, 0, 'targets must remain supported before the first shot');
        await clickButton('Pause'); assert.equal((await state()).paused, true);
        const paused = await state(); await page.mouse.click(480, 350); assert.deepEqual(await state(), paused);
        await clickButton('Continue'); assert.equal((await state()).paused, false);
        console.log('PASS: pause/resume and modal input isolation');

        let current = await state();
        for (let shot = 0; current.phase === 'aiming' && shot < current.budget; shot++) current = await shoot(false);
        assert.equal(current.phase, 'won', JSON.stringify(current)); assert.equal(current.cleared, current.total);
        assert.ok(current.score > 0); await page.screenshot({ path: path.join(output, 'victory.png') });
        console.log('PASS: actual aiming, one-ammo firing, collision, chain reaction and victory', current);
        await clickButton('Continue'); await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager').level === 2, null, { timeout: 10000 }); await waitReady();
        assert.equal((await state()).score, 0); console.log('PASS: next level');
        await shoot(false); await clickButton('Retry'); await waitReady();
        current = await state(); assert.equal(current.ammo, current.budget); assert.equal(current.cleared, 0); assert.equal(current.score, 0);
        console.log('PASS: retry resets ammo, targets and score');

        for (let shot = 0; current.phase === 'aiming' && shot < current.budget; shot++) current = await shoot(true);
        assert.equal(current.phase, 'lost', JSON.stringify(current)); assert.equal(current.ammo, 0); assert.ok(current.cleared < current.total);
        await page.screenshot({ path: path.join(output, 'failure.png') }); console.log('PASS: last-shot failure after projectile resolution');
        await clickButton('Continue'); await waitReady();
        await page.setViewportSize({ width: 720, height: 1100 });
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._ui._w === 720);
        await page.screenshot({ path: path.join(output, 'portrait.png') });
        await clickButton('Pause'); await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._ui._w === 1280);
        assert.equal((await state()).paused, true);
        assert.equal(await page.evaluate(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._ui._modal.active), true);
        await clickButton('Continue'); await page.screenshot({ path: path.join(output, 'landscape.png') });
        assert.deepEqual(errors, []); assert.deepEqual(failures, []);
        console.log('PASS: portrait/landscape layout, resize while paused, no runtime errors');
        await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: true, state: await state(), errors, failures }, null, 2));
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
