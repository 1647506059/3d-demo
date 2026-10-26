import { Color, Material, Mesh, MeshRenderer, Node, primitives, utils, Vec3 } from 'cc';

const materials = new Map<string, Material>();
const meshes = new Map<string, Mesh>();

export function material(hex: string): Material {
    if (!materials.has(hex)) {
        const result = new Material();
        result.initialize({ effectName: 'builtin-standard' });
        result.setProperty('albedo', new Color().fromHEX(hex));
        result.setProperty('roughness', 0.75);
        result.setProperty('metallic', 0.15);
        materials.set(hex, result);
    }
    return materials.get(hex)!;
}

export function paint(node: Node, hex: string) {
    for (const renderer of node.getComponentsInChildren(MeshRenderer)) {
        renderer.setMaterial(material(hex), 0);
        renderer.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;
    }
}

export function shape(parent: Node, name: string, kind: 'box' | 'sphere' | 'cylinder', color: string, position: Vec3, scale: Vec3): Node {
    const node = new Node(name);
    node.parent = parent;
    node.setPosition(position);
    node.setScale(scale);
    if (!meshes.has(kind)) {
        const geometry = kind === 'box' ? primitives.box() : kind === 'sphere' ? primitives.sphere(0.5, { segments: 12 }) : primitives.cylinder(0.5, 0.5, 1, { radialSegments: 24 });
        meshes.set(kind, utils.createMesh(geometry));
    }
    const renderer = node.addComponent(MeshRenderer);
    renderer.mesh = meshes.get(kind)!;
    renderer.setMaterial(material(color), 0);
    renderer.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;
    return node;
}
