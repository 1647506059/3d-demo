import { Node } from 'cc';
import { ObjectConfig, quatFromJson, vec3FromJson } from './LevelData';
import { ObjectTypeRegistry } from './ObjectTypeRegistry';
import { MeshLoader } from './MeshLoader';
import { paint, shape, SurfaceOptions } from './GameVisuals';
import { Vec3 } from 'cc';

/** 根据关卡配置生成单个物体的可视化模型节点（仅建模，不含玩法/物理逻辑） */
export class LevelObjectBuilder {
    /** 加载 mesh 并按配置摆放到 parent（一般为所属平台节点）下 */
    static async build(obj: ObjectConfig, registry: ObjectTypeRegistry, parent: Node): Promise<Node> {
        const meshName = registry.resolveMeshName(obj);
        let node: Node;
        try {
            node = await MeshLoader.instantiate(meshName, parent);
        } catch (e) {
            node = await MeshLoader.instantiate('Cube', parent);
            console.warn(`[LevelObjectBuilder] mesh ${meshName} 加载失败，使用 Cube 兜底`, e);
        }

        const root = new Node(`Obj_${obj.type}`);
        root.parent = parent;
        node.parent = root;
        // Tall meshes already contain their height; avoid scaling that dimension twice.
        const height = /^(can|box|stone|jar|ice)_1x(\d+)/.exec(meshName);
        const width = /^log_1x(\d+)/.exec(meshName);
        node.setScale(width ? 1 / Number(width[1]) : 1, height ? 1 / Number(height[2]) : 1, 1);
        const color = obj.type >= 51 && obj.type <= 59 ? '#FFB84D' : obj.type <= 9 ? '#E9694F'
            : obj.type <= 19 || obj.type === 41 || obj.type === 42 ? '#E0C9AA' : '#72B8BD';
        const surface: SurfaceOptions | undefined = obj.type <= 9 || obj.type >= 51 && obj.type <= 59 ? { kind: 'paint' }
            : obj.type <= 19 || obj.type === 41 || obj.type === 42 ? { kind: 'wood' }
            : obj.type <= 29 ? { kind: 'concrete' } : undefined;
        paint(node, color, surface);
        if (obj.type <= 9) {
            for (const y of [-0.29, 0.29]) shape(root, 'BarrelBand', 'cylinder', '#663F3D', new Vec3(0, y, 0), new Vec3(1.018, 0.055, 1.018), false, false, { kind: 'steel' });
        }
        root.setPosition(vec3FromJson(obj.pos));
        root.setRotation(quatFromJson(obj.rot));
        root.setScale(vec3FromJson(obj.size));
        return root;
    }
}
