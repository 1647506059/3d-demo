/* Usage: node tools/test-game-presentation.cjs <Pink preview URL> [playwright module path] */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[3] ? path.resolve(process.argv[3]) : 'playwright');

(async () => {
    const output = path.resolve('temp/codex-cannon'); await fs.mkdir(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CANNON_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        const button = name => page.evaluate(name => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            function find(node) { if (node.name === name && node.activeInHierarchy) return node; for (const c of node.children) { const match = find(c); if (match) return match; } }
            const p = g._ui._uiCamera.worldToScreen(find(g._ui._root).worldPosition); return { x: p.x, y: innerHeight - p.y };
        }, name);
        const click = async name => { const p = await button(name); await page.mouse.click(p.x, p.y); };
        const camera = () => page.evaluate(() => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            const c = g._camera.node.worldPosition, m = g._cannon.muzzlePosition, b = g._loaded.bounds;
            const dx = (b.min.x + b.max.x) / 2 - g._cannon.node.worldPosition.x, dz = (b.min.z + b.max.z) / 2 - g._cannon.node.worldPosition.z;
            return { behind: ((c.x - m.x) * dx + (c.z - m.z) * dz) / Math.hypot(dx, dz), height: c.y, rotation: { ...g._camera.node.worldRotation }, orbit: !!g._camera.node.getComponent('DebugOrbitCamera') };
        });
        await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('Main')?.getComponent('GameManager')?.phase === 'aiming');
        const landscape = await camera(); assert.ok(landscape.behind < -3); assert.ok(landscape.height < 4); assert.equal(landscape.orbit, false);
        await page.screenshot({ path: path.join(output, 'shoulder-landscape.png') });
        await page.mouse.move(620, 380); await page.mouse.down(); await page.mouse.move(720, 340, { steps: 8 });
        assert.deepEqual((await camera()).rotation, landscape.rotation, 'aim dragging must not orbit the camera');
        await page.evaluate(() => cc.director.getScene().getChildByName('Cannon').getComponent('CannonController').cancel()); await page.mouse.up();
        await page.setViewportSize({ width: 720, height: 1100 });
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._ui._h === 1100);
        const portrait = await camera(); assert.ok(portrait.behind < -3); assert.ok(portrait.height < 4);
        await page.screenshot({ path: path.join(output, 'shoulder-portrait.png') });
        console.log('PASS: low shoulder camera stays behind the muzzle in landscape and portrait; dragging cannot rotate it');
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._ui._h === 720);

        // One supported barrel and one remaining shot reproduce an immediate direct-hit victory.
        const aim = await page.evaluate(() => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            const target = [...g._targets].sort((a, b) => a.node.worldPosition.y - b.node.worldPosition.y)[0];
            for (const other of g._targets) if (other !== target) other.node.destroy();
            g._targets = [target]; g.total = 1; g.cleared = 0; g.ammo = 1; g.budget = 1; g._levelBudget = 1; g._render();
            window.presentationProbe = {};
            const impact = g._impact.bind(g); g._impact = (...args) => { window.presentationProbe.impactAt = performance.now(); impact(...args); };
            const modal = g._ui.showModal.bind(g._ui); g._ui.showModal = (kind, ...args) => {
                if (kind === 'won') Object.assign(window.presentationProbe, { resultAt: performance.now(), elapsed: g._impactElapsed, quiet: g._settling, effects: g._particles.length });
                modal(kind, ...args);
            };
            const p = g._camera.worldToScreen(target.node.worldPosition); return { x: p.x, y: innerHeight - p.y };
        });
        await page.mouse.move(aim.x, aim.y);
        const fire = await button('Fire'); await page.mouse.move(fire.x, fire.y); await page.mouse.down();
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Cannon').getComponent('CannonController')._charge >= 0.7);
        const chargeUI = await page.evaluate(() => {
            const ui = cc.director.getScene().getChildByName('Main').getComponent('GameManager')._ui;
            return { visible: ui._power.node.active, hint: ui._labels.get('Hint').string };
        });
        assert.equal(chargeUI.visible, true); assert.equal(chargeUI.hint, '');
        await page.screenshot({ path: path.join(output, 'compact-hud-charge.png') });
        await page.mouse.up();
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager').phase === 'showcase', null, { timeout: 15000 });
        const early = await page.evaluate(() => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            return { modal: g._ui._modal.active, effects: g._particles.length, barrelVisible: g._targets[0].node.isValid, ammo: g.ammo, cleared: g.cleared };
        });
        assert.equal(early.modal, false); assert.ok(early.effects > 0); assert.equal(early.barrelVisible, true); assert.equal(early.ammo, 0); assert.equal(early.cleared, 1);
        assert.equal(await page.evaluate(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._ui._power.node.active), false);
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._impactElapsed >= 0.45);
        await page.screenshot({ path: path.join(output, 'impact-showcase.png') });
        await click('Pause');
        const pausedTime = await page.evaluate(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._impactElapsed);
        await page.waitForTimeout(400);
        assert.equal(await page.evaluate(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager')._impactElapsed), pausedTime);
        await click('Continue');
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager').phase === 'won', null, { timeout: 30000 });
        const timing = await page.evaluate(() => window.presentationProbe);
        assert.ok(timing.elapsed >= 4); assert.ok(timing.quiet >= 2.8); assert.equal(timing.effects, 0);
        await page.screenshot({ path: path.join(output, 'delayed-result.png') });
        // Cover both straight stacks and the two rotated walls from level 4.
        for (const level of [1, 2, 4]) {
            const layout = await page.evaluate(async level => {
                const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
                await g.load(level);
                const bounds = g._loaded.bounds, cannon = g._cannon.node.worldPosition;
                const ground = g._decor.getChildByName('Ground'), pad = g._cannon.node.getChildByName('CannonPlinth');
                const surface = ground.worldPosition.y + ground.scale.y / 2;
                const front = ground.worldPosition.z - ground.scale.z / 2;
                const outliers = g._targets.filter(target => {
                    const box = target.node.getComponent('cc.BoxCollider').worldBounds;
                    return ['x', 'y', 'z'].some(axis => box.center[axis] - box.halfExtents[axis] < bounds.min[axis] - 0.08 || box.center[axis] + box.halfExtents[axis] > bounds.max[axis] + 0.08);
                }).length;
                return { centerOffset: cannon.x - (bounds.min.x + bounds.max.x) / 2, clearance: bounds.min.z - cannon.z,
                    padFrontMargin: cannon.z - pad.scale.z / 2 - front,
                    groundGap: pad.worldPosition.y - pad.scale.y / 2 - surface, outliers };
            }, level);
            assert.ok(Math.abs(layout.centerOffset) < 1e-5, `level ${level}: launcher centered on the targets`);
            assert.ok(layout.clearance > 5, `level ${level}: clear firing lane`);
            assert.ok(layout.padFrontMargin > 0.5, `level ${level}: launcher stays inside the front edge`);
            assert.ok(Math.abs(layout.groundGap) < 1e-5, `level ${level}: plinth rests on the ground`);
            assert.equal(layout.outliers, 0, `level ${level}: bounds contain the actual rotated target colliders`);
        }
        console.log('PASS: launch area is centered, grounded and inside the arena; bounds contain straight and rotated targets');
        assert.deepEqual(errors, []);
        await fs.writeFile(path.join(output, 'presentation-verification.json'), JSON.stringify({ passed: true, landscape, portrait, early, timing, errors }, null, 2));
        console.log('PASS: direct final hit shows tumbling barrel and explosion without a modal; paused time is excluded; results wait for all effects', timing);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
