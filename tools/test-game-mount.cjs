/* Usage: node tools/test-game-mount.cjs <Pink preview URL> [playwright module path] */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[3] ? path.resolve(process.argv[3]) : 'playwright');

// Derive reference points from the imported geometry, independently of the rig constants.
function geometry(name) {
    const file = fs.readFileSync(path.join(__dirname, '../assets/mesh', `${name}.glb`));
    let doc, data;
    for (let offset = 12; offset < file.length;) {
        const length = file.readUInt32LE(offset), type = file.readUInt32LE(offset + 4);
        const chunk = file.subarray(offset + 8, offset + 8 + length); offset += 8 + length;
        if (type === 0x4e4f534a) doc = JSON.parse(chunk.toString());
        if (type === 0x004e4942) data = chunk;
    }
    const accessor = doc.accessors[doc.meshes[0].primitives[0].attributes.POSITION], view = doc.bufferViews[accessor.bufferView];
    const start = (view.byteOffset || 0) + (accessor.byteOffset || 0), stride = view.byteStride || 12;
    assert.equal(accessor.componentType, 5126);
    return { min: accessor.min, max: accessor.max, points: Array.from({ length: accessor.count }, (_, i) => [0, 1, 2].map(axis => data.readFloatLE(start + i * stride + axis * 4))) };
}
const stand = geometry('CannonBottom'), barrel = geometry('CannonBody');
const ends = stand.points.filter(p => Math.abs(p[0]) > Math.max(Math.abs(stand.min[0]), Math.abs(stand.max[0])) * 0.84 && p[1] > 0);
const axle = [0, 1, 2].map(axis => (Math.min(...ends.map(p => p[axis])) + Math.max(...ends.map(p => p[axis]))) / 2);
const mouth = [(barrel.min[0] + barrel.max[0]) / 2, (barrel.min[1] + barrel.max[1]) / 2, barrel.min[2]];

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CANNON_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('Main')?.getComponent('GameManager')?.phase === 'aiming');
        const measurements = await page.evaluate(({ axle, mouth }) => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager'), c = g._cannon;
            const stand = c.node.getChildByName('CannonYaw').getChildByName('CannonBottom');
            const transform = (node, point) => cc.Vec3.transformMat4(new cc.Vec3(), new cc.Vec3(...point), node.worldMatrix);
            const measure = () => {
                const standRight = cc.Vec3.transformQuat(new cc.Vec3(), new cc.Vec3(1, 0, 0), stand.worldRotation);
                const barrelRight = cc.Vec3.transformQuat(new cc.Vec3(), new cc.Vec3(1, 0, 0), c._barrel.worldRotation);
                return { axleGap: cc.Vec3.distance(transform(stand, axle), c.mountPosition), mouthGap: cc.Vec3.distance(transform(c._visual, mouth), c.muzzlePosition), axisDot: cc.Vec3.dot(standRight, barrelRight) };
            };
            const results = [];
            for (const aim of [[0, 1.5, 8], [-6, 4, 8], [6, 0.4, 8], [0, 10, 8], [-8, 2, 1]]) {
                c.reset(); c._aim.set(c.node.worldPosition).add(new cc.Vec3(...aim)); c._updateAim();
                results.push({ aim, recoil: 0, ...measure() });
                c._recoil = 0.15; c.update(0); results.push({ aim, recoil: 0.15, ...measure() });
                c.reset(); results.push({ aim, reset: true, ...measure() });
            }
            c.reset(); c._aim.set(c.node.worldPosition).add(new cc.Vec3(8, 12, 25)); c._updateAim();
            const release = c.release.bind(c);
            c.release = () => {
                if (!c._charging) return release();
                const before = transform(c._visual, mouth); release();
                const shot = c._balls[c._balls.length - 1];
                window.mountShotProbe = { launchGap: cc.Vec3.distance(before, shot.from), ...measure(), flashGap: cc.Vec3.distance(c._flash.worldPosition, c.muzzlePosition) };
            };
            return results;
        }, { axle, mouth });
        for (const pose of measurements) {
            assert.ok(pose.axleGap < 1e-4, JSON.stringify(pose));
            assert.ok(pose.mouthGap < 1e-4, JSON.stringify(pose));
            assert.ok(pose.axisDot > 0.99999, JSON.stringify(pose));
        }
        const fire = await page.evaluate(() => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            const p = g._ui._uiCamera.worldToScreen(g._ui._root.getChildByName('Fire').worldPosition); return { x: p.x, y: innerHeight - p.y };
        });
        await page.mouse.click(fire.x, fire.y);
        const shot = await page.evaluate(() => window.mountShotProbe);
        assert.ok(shot.launchGap < 1e-4, JSON.stringify(shot)); assert.ok(shot.mouthGap < 1e-4, JSON.stringify(shot)); assert.ok(shot.flashGap < 1e-4, JSON.stringify(shot));
        assert.deepEqual(errors, []);
        console.log('PASS: barrel pivot stays on the mesh cross-shaft through yaw, pitch and recoil; projectile and flash start at the visible muzzle', { maximumAxleGap: Math.max(...measurements.map(p => p.axleGap)), maximumMouthGap: Math.max(...measurements.map(p => p.mouthGap)), shot });
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
