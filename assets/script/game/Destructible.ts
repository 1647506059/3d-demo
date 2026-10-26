import { _decorator, BoxCollider, Component, Mat4, Node, RigidBody, Vec3 } from 'cc';
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
    private _collider!: BoxCollider;
    private _platformCollider: BoxCollider | null = null;
    private _relative = new Mat4();
    private _platformInverse = new Mat4();
    private _localCenter = new Vec3();
    private _pendingTime = 0;
    private _chain = 0;
    private _debrisAge = 0;
    private _deathVelocity = new Vec3(0, 4, 3);
    private _originalScale = new Vec3(1, 1, 1);

    setup(size: Vec3, mass: number, type: number, floor: number, platform?: Node) {
        this.explosive = type >= 51 && type <= 59;
        this.health = type >= 21 && type <= 29 ? 2 : 1;
        this._floor = floor;
        this._platform = platform || null;
        this._platformCollider = platform?.getComponent(BoxCollider) || null;
        this._initial.set(this.node.worldPosition);
        // Separate world-space physics from the scaled/rotating platform hierarchy.
        this.node.setParent(this.node.scene!, true);
        const scale = this.node.worldScale.clone();
        this.node.setWorldScale(scale);
        this.body = this.node.addComponent(RigidBody);
        this.body.mass = Math.max(0.4, mass);
        this.body.linearDamping = 0.12;
        this.body.angularDamping = 0.22;
        const collider = this._collider = this.node.addComponent(BoxCollider);
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
            this._deathVelocity.set(Vec3.subtract(new Vec3(), this.node.worldPosition, center));
            if (this._deathVelocity.lengthSqr() < 0.01) this._deathVelocity.set(0.2, 0.2, 1);
            this._deathVelocity.normalize().multiplyScalar(3.5);
            this._deathVelocity.y = 3.5 + Math.random() * 2;
        } else {
            const push = Vec3.subtract(new Vec3(), this.node.worldPosition, center).normalize().multiplyScalar(3);
            push.y += 2;
            this.body.applyImpulse(push);
        }
    }

    remove(chain = 0) {
        if (this.removed) return;
        this.removed = true;
        this._originalScale.set(this.node.scale);
        if (chain >= 0) {
            this.body.setLinearVelocity(this._deathVelocity);
            this.body.setAngularVelocity(new Vec3(3 + Math.random() * 4, 2, 4));
        }
        this.onRemoved?.(this, this.node.worldPosition.clone(), chain);
    }

    update(dt: number) {
        if (this.paused) return;
        if (this.removed) {
            this._debrisAge += dt;
            // Keep the actual barrel tumbling instead of replacing it with an instant disappearance.
            if (this._debrisAge > 0.3) this._collider.enabled = false;
            if (this._debrisAge > 1.5) this.node.setScale(this._originalScale.clone().multiplyScalar(Math.max(0.01, (2.3 - this._debrisAge) / 0.8)));
            if (this._debrisAge >= 2.3) this.node.destroy();
            return;
        }
        if (this.pending && !this.removed) { this._pendingTime -= dt; if (this._pendingTime <= 0) this.remove(this._chain); return; }
        this._age += dt;
        if (this.removed || this.pending || this._age < 1) return;
        const pos = this.node.worldPosition;
        if (this._hasLeftPlatform() || pos.y < -1 || (!this._platform?.isValid && Vec3.distance(pos, this._initial) > 30)) this.remove(-1);
    }

    private _hasLeftPlatform(): boolean {
        if (!this._platform?.isValid || !this._platformCollider?.isValid) {
            const box = this._collider.worldBounds;
            return box.center.y - box.halfExtents.y < this._floor - 0.1;
        }
        // Project the actual rotated/scaled collider into the current platform frame.
        // Using the bottom catches tall barrels resting on the ground beside a low board.
        Mat4.invert(this._platformInverse, this._platform.worldMatrix);
        const m = Mat4.multiply(this._relative, this._platformInverse, this.node.worldMatrix);
        const center = Vec3.transformMat4(this._localCenter, this._collider.center, m), size = this._collider.size;
        const hx = (Math.abs(m.m00) * size.x + Math.abs(m.m04) * size.y + Math.abs(m.m08) * size.z) / 2;
        const hy = (Math.abs(m.m01) * size.x + Math.abs(m.m05) * size.y + Math.abs(m.m09) * size.z) / 2;
        const hz = (Math.abs(m.m02) * size.x + Math.abs(m.m06) * size.y + Math.abs(m.m10) * size.z) / 2;
        const board = this._platformCollider, scale = this._platform.worldScale;
        const marginY = 0.1 / Math.max(0.001, Math.abs(scale.y));
        const marginX = 0.03 / Math.max(0.001, Math.abs(scale.x)), marginZ = 0.03 / Math.max(0.001, Math.abs(scale.z));
        const top = board.center.y + board.size.y / 2;
        return center.y - hy < top - marginY
            || center.x + hx < board.center.x - board.size.x / 2 - marginX
            || center.x - hx > board.center.x + board.size.x / 2 + marginX
            || center.z + hz < board.center.z - board.size.z / 2 - marginZ
            || center.z - hz > board.center.z + board.size.z / 2 + marginZ;
    }
}
