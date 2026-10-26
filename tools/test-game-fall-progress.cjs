/* Usage: node tools/test-game-fall-progress.cjs <Pink preview URL> [playwright module path] */
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.argv[3] ? path.resolve(process.argv[3]) : 'playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CANNON_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('Main')?.getComponent('GameManager')?.phase === 'aiming');
        const fixture = async ({ level = 2, rolled = false, scaled = false } = {}) => {
            await page.evaluate(async ({ level, rolled, scaled }) => {
                const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager'); await g.load(level); g._mechanics = null;
                const target = [...g._targets].sort((a, b) => b.node.worldScale.y - a.node.worldScale.y)[0];
                for (const other of g._targets) if (other !== target) other.node.destroy();
                g._targets = [target]; g.total = 1; g.cleared = 0; g._render();
                target.body.type = 2; target.health = 100;
                const board = target._platform; board.setWorldPosition(board.worldPosition.x, 0.55, board.worldPosition.z);
                if (scaled) board.setScale(1.4, 0.8, 0.6);
                const rotation = board.worldRotation.clone();
                if (rolled) cc.Quat.multiply(rotation, rotation, cc.Quat.fromEuler(new cc.Quat(), 0, 0, 90));
                target.node.setWorldRotation(rotation);
                const collider = target.node.getComponent('cc.BoxCollider'), size = collider.size, m = target.node.worldMatrix;
                const halfY = (Math.abs(m.m01) * size.x + Math.abs(m.m05) * size.y + Math.abs(m.m09) * size.z) / 2;
                const deck = board.getComponent('cc.BoxCollider');
                const position = cc.Vec3.transformMat4(new cc.Vec3(), new cc.Vec3(deck.center.x, 0, deck.center.z), board.worldMatrix);
                position.y += halfY + 0.015; target.node.setWorldPosition(position);
                window.fallProbe = { target, board, halfY, removals: 0 };
                const removed = target.onRemoved; target.onRemoved = (...args) => { window.fallProbe.removals++; window.fallProbe.chain = args[2]; window.fallProbe.centerY = args[1].y; removed(...args); };
            }, { level, rolled, scaled });
            await page.waitForFunction(() => window.fallProbe.target._age >= 1.2);
            assert.equal(await page.evaluate(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager').cleared), 0, 'supported barrels must not be counted');
        };
        const cleared = () => page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager').cleared === 1, null, { timeout: 8000 });

        // Reproduce the old low-board miss using a real dynamic body and impulse.
        await fixture();
        await page.evaluate(() => {
            const { target, board, halfY } = window.fallProbe, deck = board.getComponent('cc.BoxCollider');
            const p = cc.Vec3.transformMat4(new cc.Vec3(), new cc.Vec3(deck.center.x - deck.size.x / 2 + 0.65, 0, deck.center.z), board.worldMatrix);
            p.y += halfY + 0.015; target.node.setWorldPosition(p); target.body.type = 1;
            target.body.applyImpulse(new cc.Vec3(-target.body.mass * 5, 0, 0));
        });
        await cleared();
        const physical = await page.evaluate(() => {
            const { target, board } = window.fallProbe, g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            const before = { cleared: g.cleared, score: g.score }; target.remove(-1); target.remove(-1);
            return { floor: board.worldPosition.y, centerY: window.fallProbe.centerY, chain: window.fallProbe.chain, removals: window.fallProbe.removals, before, after: { cleared: g.cleared, score: g.score } };
        });
        assert.equal(physical.chain, -1); assert.equal(physical.removals, 1); assert.deepEqual(physical.before, physical.after);
        assert.ok(physical.centerY >= physical.floor - 0.65, 'count before reaching the old center-height threshold');
        await page.waitForFunction(() => cc.director.getScene().getChildByName('Main').getComponent('GameManager').phase === 'won', null, { timeout: 15000 });
        console.log('PASS: a barrel physically knocked off a low board counts once and completes the level', physical);

        // Tall barrels on the ground can still have their center above the board.
        await fixture({ level: 29 });
        await page.evaluate(() => {
            const { target, halfY, board } = window.fallProbe, deck = board.getComponent('cc.BoxCollider');
            const p = cc.Vec3.transformMat4(new cc.Vec3(), new cc.Vec3(deck.center.x + deck.size.x / 2 + 0.1, 0, deck.center.z), board.worldMatrix);
            p.y = halfY + 0.01; target.node.setWorldPosition(p);
        });
        await cleared();
        assert.equal(await page.evaluate(() => window.fallProbe.removals), 1);
        console.log('PASS: tall grounded barrels count even when their center stays above the platform');

        // A long barrel lying on a rotated/scaled board must stay alive and follow its frame.
        for (const options of [{ level: 29, rolled: true }, { level: 4, scaled: true }]) {
            await fixture(options);
            await page.evaluate(() => {
                const { target, board } = window.fallProbe, delta = new cc.Vec3(1, 0.8, -0.4);
                board.setWorldPosition(board.worldPosition.clone().add(delta)); target.node.setWorldPosition(target.node.worldPosition.clone().add(delta));
            });
            await page.waitForTimeout(200);
            assert.equal(await page.evaluate(() => window.fallProbe.target.removed), false, 'moving together on the board is still supported');
            await page.evaluate(() => {
                const { target, board } = window.fallProbe, deck = board.getComponent('cc.BoxCollider');
                const p = cc.Vec3.transformMat4(new cc.Vec3(), new cc.Vec3(deck.center.x + deck.size.x / 2 + 3, 0, deck.center.z), board.worldMatrix);
                p.y = target.node.worldPosition.y; target.node.setWorldPosition(p);
            });
            await cleared(); assert.equal(await page.evaluate(() => window.fallProbe.removals), 1);
        }
        assert.deepEqual(errors, []);
        console.log('PASS: lying, rotated, scaled and translated supports do not false-count; leaving their edges does count');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
