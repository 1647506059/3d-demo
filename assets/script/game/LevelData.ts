import { Quat, Vec3 } from 'cc';

/** 关卡 JSON 向量字段 */
export interface JsonVec3 {
    x: number;
    y: number;
    z: number;
}

/** 关卡 JSON 四元数字段 */
export interface JsonQuat {
    x: number;
    y: number;
    z: number;
    w: number;
}

/** 单个可击倒物体配置 */
export interface ObjectConfig {
    tableId: number;
    type: number;
    size: JsonVec3;
    pos: JsonVec3;
    rot: JsonQuat;
}

/** 平台配置 */
export interface TableConfig {
    id: number;
    pos: JsonVec3;
    rot: JsonQuat;
    scl: JsonVec3;
    dim: JsonVec3;
    doRot: boolean;
    rotSpd: number;
    movH: boolean;
    movHMin: number;
    movHMax: number;
    dirH: number;
    movSpdH: number;
    movV: boolean;
    movVMin: number;
    movVMax: number;
    dirV: number;
    movSpdV: number;
}

/** 单阶段关卡配置 */
export interface StageConfig {
    objects: ObjectConfig[];
    tables: TableConfig[];
    blockers: BlockerConfig[];
}

export interface BlockerConfig {
    width: number; initZ: number; startNormalized: number;
    minPos: { x: number; y: number }; maxPos: { x: number; y: number };
    posHalfCycleDuration: number; initRotEuler: number; rotInSecEuler: number;
}

/** 完整关卡配置 */
export interface LevelConfig {
    levelIndex: number;
    moveCount: number;
    difficulty: number;
    stages: StageConfig[];
}

/** type 映射条目 */
export interface ObjectTypeEntry {
    mesh: string;
    collider: 'box' | 'mesh';
    mass: number;
}

export type ObjectTypeMap = Record<string, ObjectTypeEntry>;

/** JSON 向量转 Vec3 */
export function vec3FromJson(v: JsonVec3): Vec3 {
    return new Vec3(v.x, v.y, v.z);
}

/** JSON 四元数转 Quat */
export function quatFromJson(q: JsonQuat): Quat {
    return new Quat(q.x, q.y, q.z, q.w);
}

/** 根据 type 与 size 推断 mesh 名 */
export function resolveMeshName(type: number, size: JsonVec3, entry?: ObjectTypeEntry): string {
    if (entry?.mesh) {
        const base = entry.mesh;
        const sy = Math.max(1, Math.min(8, Math.round(size.y)));
        const sx = Math.max(1, Math.min(8, Math.round(size.x)));
        if (type >= 1 && type <= 9) return `can_1x${sy}`;
        if (type >= 11 && type <= 19) return `box_1x${sy}`;
        if (type >= 21 && type <= 29) return `stone_1x${sy}`;
        if (type >= 31 && type <= 39) return `jar_1x${sy}`;
        if (type === 41) return `log_1x${sx}`;
        if (type === 42) return 'log_1x1';
        if (type >= 61 && type <= 69) return `ice_1x${sy}`;
        return base;
    }
    return 'box_1x1';
}
