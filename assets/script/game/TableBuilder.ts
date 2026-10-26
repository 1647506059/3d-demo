import { BoxCollider, Node, RigidBody, Vec3 } from 'cc';
import { quatFromJson, TableConfig, vec3FromJson } from './LevelData';
import { MeshLoader } from './MeshLoader';
import { paint, shape } from './GameVisuals';

/** 平台顶面世界 Y 与半径信息（用于关卡包围盒估算） */
export interface TableInfo {
    node: Node;
    topY: number;
    radius: number;
}

/** 拼装关卡展示用平台模型（局部 y=0 为台面，仅生成可视节点） */
export class TableBuilder {
    /** 根据配置创建平台节点 */
    static async build(cfg: TableConfig, parent: Node, footprint?: { minX: number; maxX: number; minZ: number; maxZ: number }): Promise<TableInfo> {
        const root = new Node(`Table_${cfg.id}`);
        root.setParent(parent);
        root.setPosition(vec3FromJson(cfg.pos));
        root.setRotation(quatFromJson(cfg.rot));
        root.setScale(vec3FromJson(cfg.scl));

        const dim = cfg.dim;
        const poleH = Math.max(dim.y, 0.5);
        const topW = Math.max(dim.x, footprint ? footprint.maxX - footprint.minX : 1);
        const topD = Math.max(Math.abs(dim.z), footprint ? footprint.maxZ - footprint.minZ : 1);
        const cx = footprint ? (footprint.minX + footprint.maxX) / 2 : 0;
        const cz = footprint ? (footprint.minZ + footprint.maxZ) / 2 : 0;

        try {
            const pole = await MeshLoader.instantiate('TablePole', root);
            pole.setPosition(0, -poleH * 0.5, 0);
            pole.setScale(0.6, poleH / 1.678, 0.6);
            paint(pole, '#577681', { kind: 'steel' });
        } catch (e) {
            console.warn('[TableBuilder] TablePole 加载失败', e);
        }

        try {
            const top = await MeshLoader.instantiate('TableTop', root);
            top.setPosition(cx, 0, cz);
            top.setScale(topW, 1, topD);
            // This mesh occupies a small patch of its original atlas; expand it to one wood tile.
            const uvSpan = 0.1225065;
            paint(top, '#E6D6BB', { kind: 'wood', tiling: [1 / uvSpan, 1 / uvSpan], offset: [-0.3940154 / uvSpan, -0.5243199 / uvSpan] });
        } catch (e) {
            console.warn('[TableBuilder] TableTop 加载失败', e);
        }

        shape(root, 'PlatformSlab', 'box', '#69898C', new Vec3(cx, -0.14, cz), new Vec3(topW + 0.3, 0.28, topD + 0.3), false, false, { kind: 'steel' });
        const body = root.addComponent(RigidBody);
        body.type = RigidBody.Type.STATIC;
        const collider = root.addComponent(BoxCollider);
        collider.center = new Vec3(cx, -0.14, cz);
        collider.size = new Vec3(topW + 0.3, 0.28, topD + 0.3);

        const wp = root.worldPosition;
        const topY = wp.y;
        const radius = Math.sqrt(topW * topW + topD * topD) * 0.5;

        return { node: root, topY, radius };
    }
}
