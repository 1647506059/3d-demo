/* Usage: node tools/test-game-rapid-fire.cjs <Pink preview URL> [playwright module path] */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.argv[3] ? path.resolve(process.argv[3]) : 'playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CANNON_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        const button = name => page.evaluate(name => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            function find(node) { if (node.name === name && node.activeInHierarchy) return node; for (const child of node.children) { const match = find(child); if (match) return match; } }
            const p = g._ui._uiCamera.worldToScreen(find(g._ui._root).worldPosition); return { x: p.x, y: innerHeight - p.y };
        }, name);
        const click = async name => { const p = await button(name); await page.mouse.click(p.x, p.y); };
        const state = () => page.evaluate(() => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager'), c = g._cannon;
            return { ammo: g.ammo, active: c.activeShots, phase: g.phase, canFire: c.canFire(), charging: c._charging, power: c._charge,
                balls: c._balls.map(b => ({ time: b.time, position: { ...b.node.worldPosition }, velocity: { ...b.velocity }, power: b.power })),
                fireLabel: g._ui._labels.get('Fire').string, modal: g._ui._modal.active };
        });
        const aimLongMiss = x => page.evaluate(x => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            // High, off-axis trajectories give multiple real projectiles time to overlap.
            g._cannon._aim.set(x, 12, g._loaded.bounds.max.z + 25); g._cannon._updateAim();
        }, x);
        await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('Main')?.getComponent('GameManager')?.phase === 'aiming');
        await page.evaluate(() => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            window.rapidProbe = { impacts: [] };
            const impact = g._impact.bind(g); g._impact = (...args) => { window.rapidProbe.impacts.push({ at: performance.now(), power: args[2] }); return impact(...args); };
        });
        const initial = await state();
        await aimLongMiss(-9); await click('Fire'); const first = await state();
        await aimLongMiss(9); await click('Fire'); const pair = await state();
        assert.equal(pair.active, 2); assert.equal(pair.ammo, initial.ammo - 2); assert.equal(pair.canFire, true);
        assert.equal(pair.fireLabel, '开 炮'); assert.deepEqual(pair.balls[0].velocity, first.balls[0].velocity);
        assert.notDeepEqual(pair.balls[1].velocity, pair.balls[0].velocity, 're-aiming affects only the new projectile');
        await click('Pause'); const paused = await state(); await page.waitForTimeout(350);
        assert.deepEqual((await state()).balls, paused.balls, 'pause freezes every projectile');
        await click('Continue');
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._cannon._balls[0]?.time > 2.85);
        const fire = await button('Fire'); await page.mouse.move(fire.x, fire.y); await page.mouse.down();
        await page.waitForFunction(() => window.rapidProbe.impacts.length > 0);
        const duringImpact = await state(); assert.equal(duringImpact.charging, true); assert.ok(duringImpact.power > 0.55, 'an earlier impact cannot reset the next charge');
        await page.mouse.up(); assert.equal((await state()).ammo, initial.ammo - 3);
        assert.ok((await state()).active > 0);
        await click('Retry');
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager').phase === 'aiming');
        assert.equal((await state()).active, 0);
        await page.waitForTimeout(250);
        assert.equal(await page.evaluate(() => cc.director.getScene().children.filter(n => n.name === 'LiveCannonBall' && n.isValid).length), 0, 'retry destroys all old projectiles');
        console.log('PASS: two real shots overlap, re-aim independently, pause together, preserve charging on impact, and clear on retry');

        // A short direct hit wins while an earlier high shot is still airborne.
        const targetAim = await page.evaluate(() => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            const target = [...g._targets].sort((a, b) => a.node.worldPosition.y - b.node.worldPosition.y)[0];
            for (const other of g._targets) if (other !== target) other.node.destroy();
            g._targets = [target]; g.total = 1; g.ammo = 2; g.budget = 2; g._render();
            const p = g._camera.worldToScreen(target.node.worldPosition); return { x: p.x, y: innerHeight - p.y };
        });
        await aimLongMiss(-9); await click('Fire');
        await page.mouse.move(targetAim.x, targetAim.y); await click('Fire');
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager').phase === 'showcase');
        const winning = await state(); assert.ok(winning.active > 0); assert.equal(winning.modal, false); assert.equal(winning.canFire, false);
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._cannon.activeShots === 0);
        assert.equal((await state()).modal, false, 'last airborne projectile must finish before the result timer');
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager').phase === 'won', null, { timeout: 20000 });
        assert.ok(await page.evaluate(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._impactElapsed >= 4));
        console.log('PASS: victory waits for every airborne projectile and the final impact presentation');

        await page.evaluate(async () => { const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager'); await g.load(1); g.ammo = 2; g.budget = 2; g._render(); });
        await aimLongMiss(-9); await click('Fire'); await aimLongMiss(9); await click('Fire');
        const empty = await state(); assert.equal(empty.ammo, 0); assert.equal(empty.active, 2); assert.equal(empty.canFire, false);
        await click('Fire'); assert.equal((await state()).ammo, 0, 'empty ammo cannot spawn another ball');
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager').phase === 'lost', null, { timeout: 20000 });
        assert.equal((await state()).active, 0); assert.deepEqual(errors, []);
        console.log('PASS: last-ammo rapid misses resolve once, after all projectiles, with no runtime errors');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
