import { BoxCollider, Node, Quat, RigidBody, Vec3 } from 'cc';
import { BlockerConfig, TableConfig } from './LevelData';
import { LevelLoadResult } from './LevelLoader';
import { shape } from './GameVisuals';

/** Kinematic platforms and guards follow the existing level JSON. */
export class StageMechanics {
    private _time = 0;
    private _tables: { node: Node; config: TableConfig; origin: Vec3; rotation: Quat }[] = [];
    private _blockers: { node: Node; config: BlockerConfig }[] = [];

    constructor(loaded: LevelLoadResult, stageIndex: number, root: Node) {
        const stage = loaded.config.stages[stageIndex];
        for (const config of stage.tables) {
            const node = loaded.tables.get(config.id)?.node;
            if (node && (config.doRot || config.movH || config.movV)) {
                node.getComponent(RigidBody)!.type = RigidBody.Type.KINEMATIC;
                this._tables.push({ node, config, origin: node.position.clone(), rotation: node.rotation.clone() });
            }
        }
        for (const config of stage.blockers) {
            const node = shape(root, 'MovingGuard', 'box', '#E8AF54', new Vec3(config.minPos.x, config.minPos.y, config.initZ), new Vec3(Math.max(0.4, config.width), 0.4, 0.4));
            const body = node.addComponent(RigidBody); body.type = RigidBody.Type.KINEMATIC; node.addComponent(BoxCollider);
            this._blockers.push({ node, config });
        }
    }
    step(dt: number) {
        this._time += dt;
        for (const { node, config: c, origin, rotation } of this._tables) {
            const pos = origin.clone();
            if (c.movH) pos.x += this._offset(c.movHMin, c.movHMax, c.movSpdH, c.dirH);
            if (c.movV) pos.y += this._offset(c.movVMin, c.movVMax, c.movSpdV, c.dirV);
            node.setPosition(pos);
            if (c.doRot) node.setRotation(Quat.multiply(new Quat(), rotation, Quat.fromEuler(new Quat(), 0, this._time * c.rotSpd, 0)));
        }
        for (const { node, config: c } of this._blockers) {
            const fraction = c.posHalfCycleDuration > 0 ? (1 - Math.cos((this._time / c.posHalfCycleDuration + c.startNormalized * 2) * Math.PI)) / 2 : 0;
            node.setPosition(c.minPos.x + (c.maxPos.x - c.minPos.x) * fraction, c.minPos.y + (c.maxPos.y - c.minPos.y) * fraction, c.initZ);
            node.setRotationFromEuler(0, 0, c.initRotEuler + this._time * c.rotInSecEuler);
        }
    }
    private _offset(min: number, max: number, speed: number, direction: number) {
        if (max <= min) return 0;
        const range = max - min, t = this._time * Math.abs(speed) / range;
        return min + range * (1 - Math.cos(t * Math.PI + (direction < 0 ? Math.PI : 0))) / 2;
    }
}
