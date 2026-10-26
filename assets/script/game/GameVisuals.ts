import { Color, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';

const materials = new Map<string, Material>();
const meshes = new Map<string, Mesh>();

export function material(hex: string, luminous = false): Material {
    const key = `${hex}/${luminous}`;
    if (!materials.has(key)) {
        const result = new Material();
        result.initialize({ effectName: luminous ? 'builtin-unlit' : 'builtin-standard' });
        result.setProperty(luminous ? 'mainColor' : 'albedo', new Color().fromHEX(hex));
        if (!luminous) { result.setProperty('roughness', 0.75); result.setProperty('metallic', 0.15); }
        materials.set(key, result);
    }
    return materials.get(key)!;
}

export function paint(node: Node, hex: string) {
    for (const renderer of node.getComponentsInChildren(MeshRenderer)) {
        renderer.setMaterial(material(hex), 0);
        renderer.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;
    }
}

export function shape(parent: Node, name: string, kind: 'box' | 'sphere' | 'cylinder' | 'ring', color: string, position: Vec3, scale: Vec3, luminous = false): Node {
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
    renderer.setMaterial(material(color, luminous), 0);
    renderer.shadowCastingMode = luminous ? MeshRenderer.ShadowCastingMode.OFF : MeshRenderer.ShadowCastingMode.ON;
    return node;
}
