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

test('a direct final hit cannot show results until the impact and debris have played', () => {
    assert.equal(rules.canResolveShot(0.1, 0.1, false, false, true), false);
    assert.equal(rules.canResolveShot(3, 3, false, false, true), false);
    assert.equal(rules.canResolveShot(4, 0.2, false, false, true), false, 'a late chain reaction starts another quiet window');
    assert.equal(rules.canResolveShot(4, 2.8, false, false, true), true);
    assert.equal(rules.canResolveShot(4, 3, false, true, true), false, 'the last shot must also allow airborne targets to land');
    assert.equal(rules.canResolveShot(7, 3, false, true, true), true, 'moving platforms cannot block results forever');
    assert.equal(rules.canResolveShot(10, 5, true, false, true), false, 'pending explosions must finish');
});

test('another shot waits for falling targets, with a bound for perpetually moving platforms', () => {
    assert.equal(rules.canResolveShot(1.5, 1.5, false, false, false), false);
    assert.equal(rules.canResolveShot(2.2, 1, false, false, false), true);
    assert.equal(rules.canResolveShot(3, 2, false, true, false), false);
    assert.equal(rules.canResolveShot(7, 3, false, true, false), true);
});
