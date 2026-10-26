/* Usage: node tools/test-game-textures.cjs <Pink preview URL> [playwright module path] */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.argv[3] ? path.resolve(process.argv[3]) : 'playwright');

(async () => {
    const expected = {};
    for (const name of ['range-concrete', 'painted-metal-wear', 'aged-brass', 'weathered-planks']) {
        const meta = JSON.parse(await fs.readFile(path.join(__dirname, `../assets/resources/textures/${name}.png.meta`), 'utf8'));
        const texture = Object.values(meta.subMetas).find(asset => asset.importer === 'texture');
        assert.equal(meta.userData.type, 'texture'); assert.equal(texture.userData.wrapModeS, 'repeat'); assert.equal(texture.userData.mipfilter, 'linear');
        expected[name] = texture.uuid;
    }
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CANNON_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors = [], failures = [], materialWarnings = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) failures.push(`${r.status()} ${r.url()}`); });
        page.on('console', m => { if (['error', 'warning'].includes(m.type()) && /shader|uniform|sampler|material|texture.*(?:fail|error)/i.test(m.text())) materialWarnings.push(m.text()); });
        await page.goto(process.argv[2], { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.cc?.director.getScene()?.getChildByName('Main')?.getComponent('GameManager')?.phase === 'aiming');
        const result = await page.evaluate(() => {
            const g = cc.director.getScene().getChildByName('Main').getComponent('GameManager');
            function renderer(node) {
                const found = node.components.find(c => c.constructor.name === 'MeshRenderer'); if (found) return found;
                for (const child of node.children) { const hit = renderer(child); if (hit) return hit; }
            }
            function inspect(node) {
                const mat = renderer(node).getSharedMaterial(0), texture = mat.getProperty('mainTexture');
                return { texture: texture?._uuid, width: texture?.width, mipLevels: texture?.getGFXTexture()?.info.levelCount,
                    sampler: texture?.getSamplerInfo(), mapped: mat.passes[0].defines.USE_ALBEDO_MAP, instanced: mat.passes[0].defines.USE_INSTANCING };
            }
            const table = [...g._loaded.tables.values()][0].node;
            const barrelMats = g._targets.map(t => renderer(t.node.children[0]).getSharedMaterial(0));
            const top = inspect(table.getChildByName('TableTop'));
            const topUV = renderer(table.getChildByName('TableTop')).getSharedMaterial(0).getProperty('tilingOffset');
            return { surfaces: {
                ground: inspect(g._decor.getChildByName('Ground')),
                barrel: inspect(g._targets[0].node.children[0]),
                brass: inspect(g._cannon._visual),
                steel: inspect(g._cannon.node.getChildByName('CannonYaw').getChildByName('CannonBottom')),
                crate: inspect(g._decor.getChildByName('BackdropCrate')), top,
            }, barrelMaterialsShared: barrelMats.every(mat => mat === barrelMats[0]), draws: cc.director.root.device.numDrawCalls,
                topUV: { minU: 0.39401537 * topUV.x + topUV.z, maxU: 0.51652187 * topUV.x + topUV.z, minV: 0.52431995 * topUV.y + topUV.w, maxV: 0.64682639 * topUV.y + topUV.w } };
        });
        const textureNames = { ground: 'range-concrete', barrel: 'painted-metal-wear', brass: 'aged-brass', steel: 'painted-metal-wear', crate: 'weathered-planks', top: 'weathered-planks' };
        for (const [surface, name] of Object.entries(textureNames)) {
            const info = result.surfaces[surface]; assert.equal(info.texture, expected[name], surface); assert.equal(info.mapped, true); assert.equal(info.instanced, true);
            assert.ok(info.width >= 1024); assert.ok(info.mipLevels > 1); assert.equal(info.sampler.addressU, 0); assert.equal(info.sampler.addressV, 0);
        }
        assert.equal(result.barrelMaterialsShared, true); assert.ok(result.draws <= 50);
        for (const key of ['minU', 'minV']) assert.ok(Math.abs(result.topUV[key]) < 1e-4);
        for (const key of ['maxU', 'maxV']) assert.ok(Math.abs(result.topUV[key] - 1) < 1e-4);
        assert.deepEqual(errors, []); assert.deepEqual(failures, []); assert.deepEqual(materialWarnings, []);
        console.log('PASS: all four generated textures are used on the matching surfaces, mipmapped and instanced; table UV atlas normalized; barrels share one material', { draws: result.draws, topUV: result.topUV });
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
