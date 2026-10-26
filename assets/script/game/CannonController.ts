import { _decorator, Camera, Component, EventMouse, geometry, Input, input, Node, PhysicsSystem, Quat, Vec3 } from 'cc';
import { MeshLoader } from './MeshLoader';
import { GameUI } from '../ui/GameUI';
import { LevelBounds } from './LevelLoader';
import { GRAVITY, launchVelocity } from './GameRules';
import { paint, shape } from './GameVisuals';
const { ccclass } = _decorator;

@ccclass('CannonController')
export class CannonController extends Component {
    camera!: Camera;
    ui!: GameUI;
    canFire: (() => boolean) = () => false;
    canAim: (() => boolean) = () => true;
    onShot: ((power: number) => void) | null = null;
    onImpact: ((point: Vec3, hit: Node | null, power: number) => void) | null = null;
    private _barrel!: Node;
    private _muzzle = new Vec3();
    private _aim = new Vec3();
    private _bounds!: LevelBounds;
    private _dots: Node[] = [];
    private _shot: { node: Node; from: Vec3; velocity: Vec3; time: number; power: number } | null = null;
    private _charging = false;
    private _charge = 0.55;
    private _time = 0;
    private _recoil = 0;
    private _visual!: Node;
    private _flash: Node | null = null;
    private _trajectoryDirty = true;
    private _wasVisible = false;
    private _lastCameraPosition = new Vec3(Infinity, Infinity, Infinity);
    private _lastCameraRotation = new Quat();
    private _lastUILayout = -1;
    private _reticleFrames = 0;
    paused = false;
    get muzzlePosition(): Readonly<Vec3> { return this._muzzle; }
    get mountPosition(): Readonly<Vec3> { return this._barrel.worldPosition; }

    async setup(camera: Camera, ui: GameUI) {
        this.camera = camera; this.ui = ui;
        this._barrel = new Node('CannonAim'); this._barrel.parent = this.node; this._barrel.setPosition(0, 1.361, 0);
        // The imported stand is centered vertically but its depth starts at the rear edge.
        const base = await MeshLoader.instantiate('CannonBottom', this.node); base.setScale(8, 8, 8); base.setPosition(0, 0.961, -0.519); paint(base, '#344D62');
        this._visual = await MeshLoader.instantiate('CannonBody', this._barrel); this._visual.setScale(8, 8, 8); this._visual.setPosition(0, 0, -0.2); paint(this._visual, '#FFB74E');
        shape(this.node, 'CannonPlinth', 'cylinder', '#294958', new Vec3(0, 0.125, 0), new Vec3(2.8, 0.25, 2.8));
        for (let i = 0; i < 22; i++) { const dot = shape(this.node.scene!, 'TrajectoryDot', 'sphere', i === 21 ? '#FFBD59' : '#BCE8DD', new Vec3(), new Vec3(0.07, 0.07, 0.07)); this._dots.push(dot); }
        ui.onAimStart = e => { if (!this.canAim() || !this.canFire() || this.paused || !ui.isGameplayScreenPoint(e.getLocationX(), e.getLocationY())) return; this.aimAtScreen(e.getLocationX(), e.getLocationY()); this.beginCharge(); };
        ui.onAimMove = e => { if (this.canAim() && this._charging && ui.isGameplayScreenPoint(e.getLocationX(), e.getLocationY())) this.aimAtScreen(e.getLocationX(), e.getLocationY()); };
        ui.onAimEnd = () => this.release(); ui.onCharge = () => this.beginCharge(); ui.onFire = () => this.release(); ui.onCancel = () => this.cancel();
        input.on(Input.EventType.MOUSE_MOVE, this._mouseAim, this);
    }

    configure(bounds: LevelBounds) {
        this.reset(); this._bounds = bounds;
        const centerX = (bounds.min.x + bounds.max.x) / 2;
        this.node.setPosition(centerX, 0, bounds.min.z - 7.5);
        this._aim.set(centerX, Math.max(1.2, bounds.min.y + (bounds.max.y - bounds.min.y) * 0.45), bounds.min.z + 0.2);
        this._updateAim();
    }

    aimAtScreen(x: number, y: number) {
        if (!this._bounds || this._shot || !this.canFire() || this.paused) return;
        const ray = this.camera.screenPointToRay(x, y);
        if (PhysicsSystem.instance.raycastClosest(ray, 0xffffffff, this.camera.far, false)) {
            const hit = PhysicsSystem.instance.raycastClosestResult;
            this._aim.set(hit.hitPoint).add(ray.d.clone().multiplyScalar(0.08));
            this._updateAim(); return;
        }
        const z = this._bounds.min.z + 0.2;
        const t = (z - ray.o.z) / ray.d.z;
        if (t <= 0 || !Number.isFinite(t)) return;
        this._aim.set(Math.max(this._bounds.min.x - 3, Math.min(this._bounds.max.x + 3, ray.o.x + ray.d.x * t)), Math.max(0.15, Math.min(this._bounds.max.y + 3, ray.o.y + ray.d.y * t)), z);
        this._updateAim();
    }

    beginCharge() { if (!this.canFire() || this._shot || this.paused) return; this._charging = true; this._charge = 0.55; this._time = 0; this.ui.setCharging(true); }
    cancel() { this._charging = false; if (this._charge !== 0.55) this._trajectoryDirty = true; this._charge = 0.55; this.ui?.setPower(this._charge); this.ui?.setCharging(false); }
    release() {
        if (!this._charging || !this.canFire() || this._shot || this.paused) { this.cancel(); return; }
        this._charging = false;
        this.ui.setCharging(false);
        const velocity = this._velocity();
        const ball = shape(this.node.scene!, 'LiveCannonBall', 'sphere', '#FFCD6C', this._muzzle.clone(), new Vec3(0.3, 0.3, 0.3), true);
        this._flash?.destroy();
        this._flash = shape(this._barrel, 'MuzzleFlash', 'sphere', '#FFF0A5', new Vec3(0, 0, -1.35), new Vec3(0.7, 0.7, 0.95), true);
        this._shot = { node: ball, from: this._muzzle.clone(), velocity, time: 0, power: this._charge };
        this._recoil = 0.22; this.onShot?.(this._charge);
    }

    reset() {
        this._shot?.node.destroy(); this._shot = null; this._flash?.destroy(); this._flash = null;
        if (this._visual?.isValid) this._visual.setPosition(0, 0, -0.2);
        this._recoil = 0; this._trajectoryDirty = true; this.cancel();
    }
    private _mouseAim(e: EventMouse) {
        if (!this.canAim()) return;
        const y = e.getLocationY(); if (!this.ui?.isGameplayScreenPoint(e.getLocationX(), y)) return;
        if (!this._charging) this.aimAtScreen(e.getLocationX(), y);
    }
    private _velocity(): Vec3 {
        const t = Math.max(0.38, Math.min(1.4, Vec3.distance(this._aim, this._muzzle) / (15 + this._charge * 9)));
        const v = launchVelocity(this._muzzle, this._aim, t); return new Vec3(v.x, v.y, v.z);
    }
    private _updateAim() {
        if (!this._barrel) return;
        this._trajectoryDirty = true;
        const origin = this._barrel.worldPosition;
        const aimDirection = Vec3.subtract(new Vec3(), this._aim, origin).normalize();
        this._muzzle.set(origin).add(aimDirection.multiplyScalar(1.25));
        // The ballistic elevation changes the muzzle direction; keep the shot origin on the visible barrel.
        for (let i = 0; i < 2; i++) {
            const v = this._velocity();
            this._barrel.lookAt(Vec3.add(new Vec3(), origin, v));
            this._muzzle.set(origin).add(v.normalize().multiplyScalar(1.25));
        }
    }
    update(dt: number) {
        if (!this._bounds || this.paused) return;
        dt = Math.min(dt, 0.05);
        if (this._charging) {
            this._time += dt; const power = Math.min(1, 0.55 + this._time * 0.42);
            if (power !== this._charge) { this._charge = power; this.ui.setPower(this._charge); this._updateAim(); }
        }
        if (this._recoil > 0) { this._recoil = Math.max(0, this._recoil - dt); this._visual?.setPosition(0, 0, -0.2 + this._recoil * 1.5); }
        if (this._flash) { const size = Math.max(0, (this._recoil - 0.08) / 0.14); this._flash.setScale(size * 0.7, size * 0.7, size); if (size <= 0) { this._flash.destroy(); this._flash = null; } }
        const visible = this.canFire() && !this._shot;
        const visibilityChanged = visible !== this._wasVisible;
        const cameraChanged = !this.camera.node.worldPosition.equals(this._lastCameraPosition) || !this.camera.node.worldRotation.equals(this._lastCameraRotation);
        if (this._trajectoryDirty || cameraChanged || visibilityChanged || this._lastUILayout !== this.ui.layoutVersion) {
            // Camera matrices are refreshed during rendering, after component updates.
            this._reticleFrames = 2;
            this._lastUILayout = this.ui.layoutVersion;
        }
        if (this._reticleFrames > 0) {
            this.ui.setAimScreen(this.camera.worldToScreen(this._aim), visible);
            this._lastCameraPosition.set(this.camera.node.worldPosition); this._lastCameraRotation.set(this.camera.node.worldRotation);
            this._reticleFrames--;
        }
        if (visibilityChanged) for (const dot of this._dots) dot.active = visible;
        if (visible && (this._trajectoryDirty || visibilityChanged)) {
            const velocity = this._velocity(), flightTime = Math.abs((this._aim.z - this._muzzle.z) / velocity.z);
            for (let i = 0; i < this._dots.length; i++) {
                const t = (i + 1) / this._dots.length * flightTime;
                this._dots[i].setWorldPosition(this._muzzle.x + velocity.x * t, this._muzzle.y + velocity.y * t - GRAVITY * t * t / 2, this._muzzle.z + velocity.z * t);
            }
        }
        this._trajectoryDirty = false;
        this._wasVisible = visible;
        if (!this._shot) return;
        const shot = this._shot; const previous = shot.node.worldPosition.clone(); shot.time += dt;
        const t = shot.time;
        const next = new Vec3(shot.from.x + shot.velocity.x * t, shot.from.y + shot.velocity.y * t - GRAVITY * t * t / 2, shot.from.z + shot.velocity.z * t);
        const delta = Vec3.subtract(new Vec3(), next, previous); const length = delta.length();
        if (length > 0 && PhysicsSystem.instance.raycastClosest(new geometry.Ray(previous.x, previous.y, previous.z, delta.x / length, delta.y / length, delta.z / length), 0xffffffff, length + 0.12, false)) {
            const hit = PhysicsSystem.instance.raycastClosestResult;
            this._impact(hit.hitPoint.clone(), hit.collider.node, shot.power); return;
        }
        shot.node.setWorldPosition(next);
        if (next.y < 0.12 || t > 3.2) this._impact(next, null, shot.power);
    }
    private _impact(point: Vec3, node: Node | null, power: number) { this._shot?.node.destroy(); this._shot = null; this.onImpact?.(point, node, power); this._charge = 0.55; this.ui.setPower(this._charge); }
    onDestroy() { input.off(Input.EventType.MOUSE_MOVE, this._mouseAim, this); this.reset(); for (const dot of this._dots) dot.destroy(); }
}
