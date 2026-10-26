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
    private _debrisAge = 0;
    private _deathVelocity = new Vec3(0, 4, 3);
    private _originalScale = new Vec3(1, 1, 1);

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
            if (this._debrisAge > 0.3) this.node.getComponent(BoxCollider)!.enabled = false;
            if (this._debrisAge > 1.5) this.node.setScale(this._originalScale.clone().multiplyScalar(Math.max(0.01, (2.3 - this._debrisAge) / 0.8)));
            if (this._debrisAge >= 2.3) this.node.destroy();
            return;
        }
        if (this.pending && !this.removed) { this._pendingTime -= dt; if (this._pendingTime <= 0) this.remove(this._chain); return; }
        this._age += dt;
        if (this.removed || this.pending || this._age < 1) return;
        const pos = this.node.worldPosition;
        // A barrel counts when it falls off the platform, not after it leaves the camera.
        const floor = this._platform?.isValid ? this._platform.worldPosition.y : this._floor;
        if (pos.y < floor - 0.65 || pos.y < -1 || Vec3.distance(pos, this._initial) > 30) this.remove(-1);
    }
}
