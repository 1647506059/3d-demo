import { _decorator, BoxCollider, Component, Node, RigidBody, Vec3 } from 'cc';
const { ccclass } = _decorator;

@ccclass('Destructible')
export class Destructible extends Component {
    body!: RigidBody;
    removed = false;
    pending = false;
    explosive = false;
    health = 1;
    paused = false;
    onRemoved: ((target: Destructible, center: Vec3, chain: number) => void) | null = null;
    private _age = 0;
    private _initial = new Vec3();
    private _floor = 0;
    private _platform: Node | null = null;
    private _pendingTime = 0;
    private _chain = 0;

    setup(size: Vec3, mass: number, type: number, floor: number, platform?: Node) {
        this.explosive = type >= 51 && type <= 59;
        this.health = type >= 21 && type <= 29 ? 2 : 1;
        this._floor = floor;
        this._platform = platform || null;
        this._initial.set(this.node.worldPosition);
        // Separate world-space physics from the scaled/rotating platform hierarchy.
        this.node.setParent(this.node.scene!, true);
        const scale = this.node.worldScale.clone();
        this.node.setWorldScale(scale);
        this.body = this.node.addComponent(RigidBody);
        this.body.mass = Math.max(0.4, mass);
        this.body.linearDamping = 0.12;
        this.body.angularDamping = 0.22;
        const collider = this.node.addComponent(BoxCollider);
        collider.size = new Vec3(0.96, 0.98, 0.96);
        // The root already carries the configured object dimensions.
        void size;
    }

    hit(center: Vec3, power: number, chain = 0) {
        if (this.removed || this.pending) return;
        this.health -= power;
        if (this.health <= 0) {
            this.pending = true;
            this._pendingTime = chain > 0 ? 0.055 : 0;
            this._chain = chain;
        } else {
            const push = Vec3.subtract(new Vec3(), this.node.worldPosition, center).normalize().multiplyScalar(3);
            push.y += 2;
            this.body.applyImpulse(push);
        }
    }

    remove(chain = 0) {
        if (this.removed) return;
        this.removed = true;
        this.onRemoved?.(this, this.node.worldPosition.clone(), chain);
        this.node.destroy();
    }

    update(dt: number) {
        if (this.paused) return;
        if (this.pending && !this.removed) { this._pendingTime -= dt; if (this._pendingTime <= 0) this.remove(this._chain); return; }
        this._age += dt;
        if (this.removed || this.pending || this._age < 1) return;
        const pos = this.node.worldPosition;
        // A barrel counts when it falls off the platform, not after it leaves the camera.
        const floor = this._platform?.isValid ? this._platform.worldPosition.y : this._floor;
        if (pos.y < floor - 0.65 || pos.y < -1 || Vec3.distance(pos, this._initial) > 30) this.remove(-1);
    }
}
