import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';

const source = await readFile(new URL('../assets/script/game/GameRules.ts', import.meta.url), 'utf8');
const rules = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);

test('the displayed trajectory and the projectile meet the requested aim point', () => {
    for (const seconds of [0.38, 0.7, 1.4]) {
        const from = { x: 2.6, y: 1, z: -7 }, to = { x: -3, y: 5, z: 1 };
        const v = rules.launchVelocity(from, to, seconds);
        assert.ok(Math.abs(from.x + v.x * seconds - to.x) < 1e-9);
        assert.ok(Math.abs(from.y + v.y * seconds - rules.GRAVITY * seconds ** 2 / 2 - to.y) < 1e-9);
        assert.ok(Math.abs(from.z + v.z * seconds - to.z) < 1e-9);
    }
});

test('ammo scales with target count while respecting stage limits', () => {
    assert.equal(rules.ammoForStage(18, 20), 5);
    assert.equal(rules.ammoForStage(50, 20), 11);
    assert.equal(rules.ammoForStage(500, 20), 12);
    assert.equal(rules.ammoForStage(1, 20), 3);
    assert.equal(rules.ammoForStage(18, 4), 4);
});

test('stars reward efficient wins at the correct boundary', () => {
    assert.equal(rules.starsForWin(2, 5), 3);
    assert.equal(rules.starsForWin(3, 5), 2);
    assert.equal(rules.starsForWin(4, 5), 2);
    assert.equal(rules.starsForWin(5, 5), 1);
});
