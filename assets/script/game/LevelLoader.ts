import { JsonAsset, Node, resources, Vec3 } from 'cc';
import { LevelConfig, StageConfig } from './LevelData';
import { ObjectTypeRegistry } from './ObjectTypeRegistry';
import { TableBuilder, TableInfo } from './TableBuilder';
import { LevelObjectBuilder } from './LevelObjectBuilder';

/** 关卡整体包围盒（世界坐标） */
export interface LevelBounds {
    min: Vec3;
    max: Vec3;
}

/** 关卡加载结果 */
export interface LevelLoadResult {
    config: LevelConfig;
    bounds: LevelBounds;
    objects: { node: Node; config: import('./LevelData').ObjectConfig; floor: number }[];
    tables: Map<number, TableInfo>;
}

/** 从 JSON 加载关卡并生成静态展示模型 */
export class LevelLoader {
    constructor(private _registry: ObjectTypeRegistry) {}

    /** 加载指定关卡到 levelRoot，仅生成可视模型，并整体贴地摆放 */
    async loadLevel(levelIndex: number, levelRoot: Node, stageIndex = 0): Promise<LevelLoadResult> {
        for (const child of [...levelRoot.children]) child.destroy();

        const config = await this._loadConfig(levelIndex);
        const stage = config.stages[stageIndex];
        if (!stage) {
            throw new Error(`关卡 ${levelIndex} 无 stages 数据`);
        }

        // 配置里的坐标未必贴地，整体抬升/下压 levelRoot，让包围盒最低点落在 y=0 地面上
        const rawBounds = this._computeBounds(stage);
        const groundOffsetY = -rawBounds.min.y;
        levelRoot.setPosition(0, groundOffsetY, 0);

        const tableMap = new Map<number, TableInfo>();
        for (const tableCfg of stage.tables) {
            const supported = stage.objects.filter(o => o.tableId === tableCfg.id);
            const footprint = supported.length ? {
                minX: Math.min(...supported.map(o => o.pos.x - o.size.x / 2)), maxX: Math.max(...supported.map(o => o.pos.x + o.size.x / 2)),
                minZ: Math.min(...supported.map(o => o.pos.z - o.size.z / 2)), maxZ: Math.max(...supported.map(o => o.pos.z + o.size.z / 2)),
            } : undefined;
            const info = await TableBuilder.build(tableCfg, levelRoot, footprint);
            tableMap.set(tableCfg.id, info);
        }

        const objects: LevelLoadResult['objects'] = [];
        for (const objCfg of stage.objects) {
            const table = tableMap.get(objCfg.tableId);
            if (!table) {
                console.warn(`[LevelLoader] 找不到 tableId=${objCfg.tableId}`);
                continue;
            }
            const node = await LevelObjectBuilder.build(objCfg, this._registry, table.node);
            objects.push({ node, config: objCfg, floor: table.topY });
        }

        const bounds: LevelBounds = {
            min: new Vec3(rawBounds.min.x, rawBounds.min.y + groundOffsetY, rawBounds.min.z),
            max: new Vec3(rawBounds.max.x, rawBounds.max.y + groundOffsetY, rawBounds.max.z),
        };
        return { config, bounds, objects, tables: tableMap };
    }

    /** 根据关卡原始配置估算世界包围盒，供相机取景使用 */
    private _computeBounds(stage: StageConfig): LevelBounds {
        const min = new Vec3(Infinity, Infinity, Infinity);
        const max = new Vec3(-Infinity, -Infinity, -Infinity);
        const expand = (x: number, y: number, z: number) => {
            min.x = Math.min(min.x, x);
            min.y = Math.min(min.y, y);
            min.z = Math.min(min.z, z);
            max.x = Math.max(max.x, x);
            max.y = Math.max(max.y, y);
            max.z = Math.max(max.z, z);
        };

        const tableById = new Map(stage.tables.map((t) => [t.id, t]));

        for (const t of stage.tables) {
            const halfX = Math.max(t.dim.x, 1) * 0.5;
            const halfZ = Math.max(Math.abs(t.dim.z), 1) * 0.5;
            const poleH = Math.max(t.dim.y, 0.5);
            expand(t.pos.x - halfX, t.pos.y - poleH, t.pos.z - halfZ);
            expand(t.pos.x + halfX, t.pos.y, t.pos.z + halfZ);
        }

        for (const o of stage.objects) {
            const table = tableById.get(o.tableId);
            const baseX = table?.pos.x ?? 0;
            const baseY = table?.pos.y ?? 0;
            const baseZ = table?.pos.z ?? 0;
            const hx = o.size.x * 0.5;
            const hy = o.size.y * 0.5;
            const hz = o.size.z * 0.5;
            expand(baseX + o.pos.x - hx, baseY + o.pos.y - hy, baseZ + o.pos.z - hz);
            expand(baseX + o.pos.x + hx, baseY + o.pos.y + hy, baseZ + o.pos.z + hz);
        }

        if (!isFinite(min.x)) {
            return { min: new Vec3(-1, 0, -1), max: new Vec3(1, 2, 1) };
        }
        return { min, max };
    }

    private _loadConfig(levelIndex: number): Promise<LevelConfig> {
        const path = `prod-13-json/Level${levelIndex}`;
        return new Promise((resolve, reject) => {
            resources.load(path, JsonAsset, (err, asset) => {
                if (err || !asset) {
                    reject(err ?? new Error(`无法加载关卡 ${levelIndex}`));
                    return;
                }
                resolve(asset.json as LevelConfig);
            });
        });
    }
}
