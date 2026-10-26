import { Color, Material, Mesh, MeshRenderer, Node, primitives, resources, Texture2D, utils, Vec3, Vec4 } from 'cc';

export interface SurfaceOptions {
    kind: 'concrete' | 'paint' | 'steel' | 'brass' | 'wood';
    tiling?: readonly [number, number];
    offset?: readonly [number, number];
}
const surfaceAssets = { concrete: 'range-concrete', paint: 'painted-metal-wear', steel: 'painted-metal-wear', brass: 'aged-brass', wood: 'weathered-planks' };
const textures = new Map<string, Texture2D>();
let textureLoading: Promise<void> | null = null;

export function loadSurfaceTextures(): Promise<void> {
    if (!textureLoading) textureLoading = Promise.all([...new Set(Object.values(surfaceAssets))].map(name => new Promise<void>((resolve, reject) => {
        resources.load(`textures/${name}/texture`, Texture2D, (error, texture) => {
            if (error || !texture) { reject(error || new Error(`Missing surface texture: ${name}`)); return; }
            textures.set(name, texture); resolve();
        });
    }))).then(() => undefined).catch(error => { textureLoading = null; throw error; });
    return textureLoading;
}

const materials = new Map<string, Material>();
const meshes = new Map<string, Mesh>();

export function material(hex: string, luminous = false, surface?: SurfaceOptions): Material {
    const key = `${hex}/${luminous}/${surface?.kind || ''}/${surface?.tiling || ''}/${surface?.offset || ''}`;
    if (!materials.has(key)) {
        const result = new Material();
        // Shared meshes/materials can be submitted together, including moving barrels and fragments.
        const texture = !luminous && surface ? textures.get(surfaceAssets[surface.kind]) : null;
        result.initialize({ effectName: luminous ? 'builtin-unlit' : 'builtin-standard', defines: { USE_INSTANCING: true, USE_ALBEDO_MAP: !!texture } });
        result.setProperty(luminous ? 'mainColor' : 'albedo', new Color().fromHEX(hex));
        if (!luminous) {
            const roughness = surface?.kind === 'brass' ? 0.45 : surface?.kind === 'concrete' || surface?.kind === 'wood' ? 0.9 : 0.75;
            const metallic = surface?.kind === 'brass' ? 0.42 : surface?.kind === 'concrete' || surface?.kind === 'wood' ? 0 : surface ? 0.22 : 0.15;
            result.setProperty('roughness', roughness); result.setProperty('metallic', metallic);
            if (texture) {
                result.setProperty('mainTexture', texture);
                if (surface?.kind === 'paint') result.setProperty('albedoScale', new Vec3(1.8, 1.8, 1.8));
                result.setProperty('tilingOffset', new Vec4(surface?.tiling?.[0] ?? 1, surface?.tiling?.[1] ?? 1, surface?.offset?.[0] ?? 0, surface?.offset?.[1] ?? 0));
            }
        }
        materials.set(key, result);
    }
    return materials.get(key)!;
}

export function paint(node: Node, hex: string, surface?: SurfaceOptions) {
    for (const renderer of node.getComponentsInChildren(MeshRenderer)) {
        renderer.setMaterial(material(hex, false, surface), 0);
        renderer.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;
    }
}

export function shape(parent: Node, name: string, kind: 'box' | 'sphere' | 'cylinder' | 'ring', color: string, position: Vec3, scale: Vec3, luminous = false, castsShadow = false, surface?: SurfaceOptions): Node {
    const node = new Node(name);
    node.parent = parent;
    node.setPosition(position);
    node.setScale(scale);
    if (!meshes.has(kind)) {
        const geometry = kind === 'box' ? primitives.box() : kind === 'sphere' ? primitives.sphere(0.5, { segments: 12 }) : kind === 'ring' ? primitives.torus(0.5, 0.025, { radialSegments: 6, tubularSegments: 32 }) : primitives.cylinder(0.5, 0.5, 1, { radialSegments: 24 });
        meshes.set(kind, utils.createMesh(geometry));
    }
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = meshes.get(kind)!;
    renderer.setMaterial(material(color, luminous, surface), 0);
    // Decorative bands, aim dots and small fragments do not need separate shadow passes.
    renderer.shadowCastingMode = castsShadow && !luminous ? MeshRenderer.ShadowCastingMode.ON : MeshRenderer.ShadowCastingMode.OFF;
    return node;
}
