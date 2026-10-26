import { _decorator, BoxCollider, Camera, Color, Component, DirectionalLight, isValid, Node, PhysicsSystem, RigidBody, screen, sys, Vec3, Vec4, view } from 'cc';
import { DebugOrbitCamera } from '../DebugOrbitCamera';
import { GameUI } from '../ui/GameUI';
import { CannonController } from './CannonController';
import { Destructible } from './Destructible';
import { ammoForStage, canResolveShot, MAX_LEVEL, starsForWin } from './GameRules';
import { shape } from './GameVisuals';
import { LevelLoader, LevelLoadResult } from './LevelLoader';
import { ObjectTypeRegistry } from './ObjectTypeRegistry';
import { StageMechanics } from './StageMechanics';
import { PlayerCameraController } from './PlayerCameraController';
const { ccclass } = _decorator;
type Phase = 'loading' | 'aiming' | 'flying' | 'settling' | 'showcase' | 'won' | 'lost' | 'error';
interface Progress { level: number; scores: Record<string, number>; stars: Record<string, number>; muted: boolean }
interface Particle { node: Node; velocity: Vec3; age: number; life: number; size: number; kind: 'debris' | 'smoke' | 'flash' | 'ring'; poolKey: string }

@ccclass('GameManager')
export class GameManager extends Component {
    level = 1;
    stage = 0;
    phase: Phase = 'loading';
    ammo = 0;
    budget = 0;
    score = 0;
    cleared = 0;
    total = 0;
    private _ui!: GameUI;
    private _cannon!: CannonController;
    private _camera!: Camera;
    private _playerCamera!: PlayerCameraController;
    private _registry = new ObjectTypeRegistry();
    private _root!: Node;
    private _decor!: Node;
    private _loaded: LevelLoadResult | null = null;
    private _targets: Destructible[] = [];
    private _particles: Particle[] = [];
    private _effectPool = new Map<string, Node[]>();
    private _particlePosition = new Vec3();
    private _hudDirty = false;
    private _settling = 0;
    private _impactElapsed = 0;
    private _shots = 0;
    private _levelBudget = 0;
    private _combo = 0;
    private _paused = false;
    private _revision = 0;
    private _cameraPosition = new Vec3();
    private _shake = 0;
    private _mechanics: StageMechanics | null = null;
    private _audio: AudioContext | null = null;
    private _progress: Progress = { level: 1, scores: {}, stars: {}, muted: false };

    private get _inCombat(): boolean {
        return this.phase === 'aiming' || this.phase === 'flying' || this.phase === 'settling';
    }

    private get _canControlView(): boolean {
        return this._inCombat || this.phase === 'showcase';
    }

    async initialize(startLevel: number) {
        try { const saved = JSON.parse(sys.localStorage.getItem('cannon-progress-v1') || 'null'); if (saved && Number.isFinite(saved.level)) this._progress = { ...this._progress, ...saved }; } catch { /* Storage can be unavailable. */ }
        this.level = Math.max(1, Math.min(MAX_LEVEL, startLevel > 1 ? startLevel : this._progress.level));
        this._camera = this.node.scene!.getChildByName('Main Camera')!.getComponent(Camera)!;
        // Destroy the editor orbit controller so its global mouse listeners cannot rotate the player camera.
        const orbit = this._camera.node.getComponent(DebugOrbitCamera); if (orbit) orbit.destroy();
        this._camera.visibility &= ~(1 << 25);
        this._camera.clearColor = new Color(29, 53, 68, 255);
        this._camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        const globals = this.node.scene!.globals;
        globals.skybox.enabled = false;
        globals.skybox.useIBL = false;
        globals.ambient.skyColor = new Vec4(0.8, 0.84, 0.9, 1);
        globals.ambient.groundAlbedo = new Vec4(0.45, 0.5, 0.55, 1);
        const light = this.node.scene!.getComponentInChildren(DirectionalLight);
        if (light) light.csmLevel = 1;
        view.on('canvas-resize', this._onResize, this);
        const plane = this.node.scene!.getChildByName('Plane'); if (plane) plane.active = false;
        this._ui = this.node.addComponent(GameUI);
        this._playerCamera = this._camera.node.addComponent(PlayerCameraController);
        this._playerCamera.ui = this._ui;
        this._ui.canUseButtons = () => !this._playerCamera.nonPrimaryPointer;
        this._ui.onGestureStart = event => this._playerCamera.touchStart(event);
        this._ui.onGestureMove = event => this._playerCamera.touchMove(event);
        this._ui.onGestureEnd = event => this._playerCamera.touchEnd(event);
        this._playerCamera.canControl = () => !this._paused && this._canControlView;
        this._ui.onView = () => this._playerCamera.toggleViewMode();
        this._ui.onResetView = () => this._playerCamera.reset();
        this._ui.onRetry = () => { this._resume(); void this.load(this.level); };
        this._ui.onNext = () => { this._resume(); void this.load(this.level < MAX_LEVEL ? this.level + 1 : 1); };
        this._ui.onPause = () => this.togglePause();
        this._ui.onSound = () => { this._progress.muted = !this._progress.muted; this._ui.setSound(this._progress.muted); this._save(); };
        const root = this.node.scene!.getChildByName('LevelRoot') || new Node('LevelRoot'); root.parent = this.node.scene!; this._root = root;
        this._decor = new Node('Arena'); this._decor.parent = this.node.scene!;
        const cannonNode = new Node('Cannon'); cannonNode.parent = this.node.scene!; this._cannon = cannonNode.addComponent(CannonController);
        this._playerCamera.onInteraction = () => this._cannon?.cancel();
        this._cannon.canAim = () => !this._playerCamera.viewMode && !this._playerCamera.interacting;
        this._cannon.canFire = () => this._inCombat && !this._paused && this.ammo > 0 && this.cleared < this.total && !this._playerCamera.interacting;
        this._cannon.onShot = () => { this.ammo--; this._shots++; this._combo = 0; this.phase = 'flying'; this._settling = 0; this._impactElapsed = 0; this._sound(110, 0.16); this._shake = 0.1; this._render(); };
        this._cannon.onImpact = (point, hit, power) => this._impact(point, hit, power);
        this._render();
        try { await this._registry.init(); await this._cannon.setup(this._camera, this._ui); await this.load(this.level); }
        catch (error) { this._fail(error); }
    }

    async load(level: number, stage = 0) {
        if (this.phase === 'loading' && this._revision > 0) return;
        const revision = ++this._revision;
        this.phase = 'loading'; this._cannon.reset(); this._ui.hideModal();
        for (const target of this._targets) if (isValid(target.node)) target.node.destroy(); this._targets = [];
        for (const particle of this._particles) particle.node.destroy(); this._particles = [];
        for (const pool of this._effectPool.values()) for (const node of pool) node.destroy(); this._effectPool.clear();
        for (const node of [...this._decor.children]) node.destroy();
        this.level = level; this.stage = stage;
        if (stage === 0) { this.score = 0; this._shots = 0; this._levelBudget = 0; }
        this.cleared = 0; this.total = 0; this._render();
        this._settling = 0; this._impactElapsed = 0;
        try {
            this._loaded = await new LevelLoader(this._registry).loadLevel(level, this._root, stage);
            if (revision !== this._revision || !isValid(this.node)) return;
            this._cannon.configure(this._loaded.bounds);
            this._makeArena();
            this._mechanics = new StageMechanics(this._loaded, stage, this._root);
            for (const item of this._loaded.objects) {
                const target = item.node.addComponent(Destructible);
                target.setup(new Vec3(item.config.size.x, item.config.size.y, item.config.size.z), this._registry.getMass(item.config.type), item.config.type, item.floor, this._loaded.tables.get(item.config.tableId)?.node);
                target.onRemoved = (object, center, chain) => this._removed(object, center, chain);
                this._targets.push(target);
            }
            this.total = this._targets.length;
            this.budget = ammoForStage(this.total, this._loaded.config.moveCount); this.ammo = this.budget; this._levelBudget += this.budget;
            this._frame();
            this.phase = 'aiming'; this._ui.toast(stage === 0 ? '瞄准下层 · 引爆连锁' : '新的目标已就位'); this._render();
        } catch (error) { this._fail(error); }
    }

    private _makeArena() {
        const b = this._loaded!.bounds;
        const cannon = this._cannon.node.worldPosition;
        const x = (b.min.x + b.max.x) / 2;
        const front = cannon.z - 2.2, back = Math.max(b.max.z + 3, cannon.z + 12);
        const z = (front + back) / 2;
        const width = Math.max(12, b.max.x - b.min.x + 7), depth = back - front;
        const ground = shape(this._decor, 'Ground', 'box', '#3D6972', new Vec3(x, -0.3, z), new Vec3(width, 0.6, depth));
        const body = ground.addComponent(RigidBody); body.type = RigidBody.Type.STATIC; ground.addComponent(BoxCollider);
        shape(this._decor, 'IslandBase', 'box', '#243F50', new Vec3(x, -0.85, z), new Vec3(width + 0.4, 0.5, depth + 0.4));
        for (const side of [-1, 1]) for (let i = 0; i < 8; i++) shape(this._decor, 'RangeMarker', 'box', '#B6C7A7', new Vec3(x + side * (width / 2 - 0.8), 0.0125, front + 0.8 + i * (depth - 1.6) / 7), new Vec3(0.14, 0.025, 0.65));
        shape(this._decor, 'FiringLine', 'box', '#B6C7A7', new Vec3(cannon.x, 0.0125, cannon.z + 1.9), new Vec3(4.4, 0.025, 0.12));
        for (let i = 0; i < 6; i++) {
            const h = 0.5 + (i % 3) * 0.35;
            shape(this._decor, 'BackdropCrate', 'box', i % 2 ? '#527C7C' : '#466772', new Vec3(x - width / 2 + 1 + i * (width - 2) / 5, h / 2, back - 0.9), new Vec3(1.1, h, 0.9));
        }
    }

    private _frame(preserveView = false) {
        const b = this._loaded!.bounds;
        const center = new Vec3((b.min.x + b.max.x) / 2, Math.max(1.8, (b.min.y + b.max.y) / 2 + 0.45), (b.min.z + b.max.z) / 2);
        const aspect = screen.windowSize.width / Math.max(1, screen.windowSize.height);
        this._camera.fov = 50;
        const halfVertical = this._camera.fov * Math.PI / 360;
        const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
        const range = Math.max(10, (b.max.x - b.min.x + 2) / (2 * Math.tan(halfHorizontal) * 0.76), (b.max.y - b.min.y + 1) / (2 * Math.tan(halfVertical) * 0.62));
        const cannon = this._cannon.node.worldPosition;
        const forward = new Vec3(center.x - cannon.x, 0, center.z - cannon.z).normalize();
        const right = new Vec3(-forward.z, 0, forward.x);
        const targetDistance = Math.hypot(center.x - cannon.x, center.z - cannon.z);
        const behind = Math.max(aspect < 1 ? 6.5 : 5.8, range - targetDistance);
        // A low shoulder camera sits behind the cannon, looking over its muzzle at the target.
        this._cameraPosition.set(cannon.x - forward.x * behind + right.x * 0.55, this._cannon.mountPosition.y + 2.25, cannon.z - forward.z * behind + right.z * 0.55);
        this._playerCamera.setHome(this._cameraPosition, center, preserveView);
        this._camera.near = 0.1;
        this._camera.far = Math.max(100, range * 3);
    }
    private _onResize() { if (this._loaded) this._frame(true); }

    private _impact(point: Vec3, hit: Node | null, power: number) {
        if (this.phase !== 'showcase') this.phase = this._cannon.activeShots > 0 ? 'flying' : 'settling';
        this._settling = 0; this._impactElapsed = 0;
        const direct = hit?.getComponent(Destructible);
        if (direct) direct.hit(point, 2, 0);
        this._blast(point, 1.15 + power * 0.95, 0, direct || undefined);
        this._burst(point, 15, '#FFB650'); this._impactEffects(point); this._shake = 0.25; this._sound(65, 0.22);
        if (!direct) this._ui.toast(hit ? '冲击波已释放' : '差一点！试着调整落点');
        this._render();
    }

    private _blast(center: Vec3, radius: number, chain: number, source?: Destructible) {
        for (const target of this._targets) {
            if (target === source || target.removed || target.pending || !isValid(target.node)) continue;
            const offset = Vec3.subtract(new Vec3(), target.node.worldPosition, center); const distance = offset.length();
            if (distance > radius + 0.2) continue;
            const impulse = offset.normalize().multiplyScalar((1 - distance / (radius + 0.4)) * 9); impulse.y += 2;
            target.body.applyImpulse(impulse);
            if (distance < radius) target.hit(center, 1, chain + 1);
        }
    }

    private _removed(target: Destructible, point: Vec3, chain: number) {
        if (this.phase === 'loading' || this.phase === 'error') return;
        this.cleared++; this._combo++; this.score += 100 + Math.min(this._combo - 1, 9) * 25;
        this._settling = 0;
        if (chain >= 0) {
            this._burst(point, target.explosive ? 16 : 6, target.explosive ? '#FFCC68' : '#E97950');
            if (chain < 2 || target.explosive && chain < 5) this._blast(point, target.explosive ? 2.8 : 1.25, chain, target);
        }
        if (this._combo >= 3) this._ui.toast(`${this._combo} 连爆  +${100 + Math.min(this._combo - 1, 9) * 25}`);
        this._render();
    }

    private _burst(center: Vec3, count: number, color: string) {
        for (let i = 0; i < count && this._particles.length < 80; i++) {
            const size = 0.09 + Math.random() * 0.16;
            const tint = i % 3 ? color : '#F7D9A1', poolKey = `debris/${tint}`;
            const node = this._effectNode(poolKey, 'box', tint, false); node.setWorldPosition(center); node.setScale(size, size, size);
            this._particles.push({ node, velocity: new Vec3((Math.random() - 0.5) * 7, 2 + Math.random() * 5, (Math.random() - 0.5) * 7), age: 0, life: 1.2 + Math.random() * 1.2, size, kind: 'debris', poolKey });
        }
    }

    private _impactEffects(center: Vec3) {
        const add = (kind: Particle['kind'], color: string, size: number, life: number, velocity: Vec3) => {
            if (this._particles.length >= 80) return;
            const poolKey = `${kind}/${color}`;
            const node = this._effectNode(poolKey, kind === 'ring' ? 'ring' : 'sphere', color, true); node.setScale(size, size, size);
            node.setWorldPosition(center);
            this._particles.push({ node, velocity, age: 0, life, size, kind, poolKey });
        };
        add('flash', '#FFF0AD', 1.7, 0.28, new Vec3());
        add('ring', '#FFC069', 1, 0.7, new Vec3());
        // A brief, local puff leaves the target and tumbling barrels visible.
        for (let i = 0; i < 2; i++) add('smoke', i % 2 ? '#7B7770' : '#AAA18C', 0.24 + i * 0.06, 0.8 + i * 0.15, new Vec3((Math.random() - 0.5) * 0.5, 0.35 + i * 0.15, (Math.random() - 0.5) * 0.5));
    }
    private _effectNode(key: string, kind: 'box' | 'sphere' | 'ring', color: string, luminous: boolean): Node {
        const node = this._effectPool.get(key)?.pop() || shape(this._decor, key, kind, color, Vec3.ZERO, Vec3.ONE, luminous);
        node.active = true; node.setRotationFromEuler(0, 0, 0); return node;
    }

    update(dt: number) {
        if (this._paused || !this._loaded) return;
        dt = Math.min(dt, 0.05);
        if (this.phase === 'loading' || this.phase === 'error') return;
        this._mechanics?.step(dt);
        for (let i = this._particles.length - 1; i >= 0; i--) {
            const p = this._particles[i]; p.age += dt;
            if (p.age > p.life) {
                p.node.active = false;
                const pool = this._effectPool.get(p.poolKey) || []; pool.push(p.node); this._effectPool.set(p.poolKey, pool);
                this._particles.splice(i, 1); continue;
            }
            if (p.kind === 'debris') {
                p.velocity.y -= 10 * dt;
                const next = Vec3.scaleAndAdd(this._particlePosition, p.node.worldPosition, p.velocity, dt);
                if (next.y < 0.04 && p.velocity.y < 0) { next.y = 0.04; p.velocity.y *= -0.32; p.velocity.x *= 0.7; p.velocity.z *= 0.7; }
                p.node.setWorldPosition(next); p.node.setRotationFromEuler(p.age * 180, p.age * 250, 0);
                const size = p.size * Math.min(1, (p.life - p.age) / 0.55); p.node.setScale(size, size, size);
            } else {
                p.node.setWorldPosition(Vec3.scaleAndAdd(this._particlePosition, p.node.worldPosition, p.velocity, dt));
                const t = p.age / p.life;
                const scale = p.kind === 'flash' ? p.size * (1 + t) * (1 - t) : p.kind === 'ring' ? 0.5 + t * 5 : p.size * (1 + t * 1.4) * Math.min(1, (1 - t) * 3);
                p.node.setScale(scale, p.kind === 'ring' ? Math.max(0.03, (1 - t) * 0.4) : scale, scale);
            }
        }
        this._shake = Math.max(0, this._shake - dt);
        this._playerCamera.setShake(this._shake);
        if (this._inCombat && this.total > 0 && this.cleared >= this.total) {
            this.phase = 'showcase'; this._cannon.cancel(); this._impactElapsed = 0; this._settling = 0;
            this._ui.toast('漂亮！目标全部摧毁'); this._render();
        }
        if (this.phase === 'settling' || this.phase === 'showcase') {
            // A late projectile can still hit, trigger a chain or change the result.
            if (this._cannon.activeShots > 0) return;
            this._impactElapsed += dt;
            this._settling += dt;
            const cleared = this.cleared >= this.total;
            const alive = this._targets.filter(target => !target.removed && isValid(target.node));
            const pending = alive.some(target => target.pending);
            const velocity = new Vec3();
            const moving = alive.some(target => { target.body.getLinearVelocity(velocity); return velocity.lengthSqr() > 0.36; });
            if (canResolveShot(this._impactElapsed, this._settling, pending, moving, cleared || this.ammo <= 0)) {
                if (this.cleared >= this.total) {
                    if (this.stage + 1 < this._loaded.config.stages.length) void this.load(this.level, this.stage + 1);
                    else this._win();
                } else if (this.ammo <= 0) { this.phase = 'lost'; this._ui.showModal('lost', 0, `已摧毁 ${this.cleared} / ${this.total} 个目标 · 得分 ${this.score}`); }
                else { this.phase = 'aiming'; this._render(); }
            }
        }
    }

    private _win() {
        this.phase = 'won'; this.score += this.ammo * 150;
        const stars = starsForWin(this._shots, this._levelBudget);
        this._progress.scores[String(this.level)] = Math.max(this.score, this._progress.scores[String(this.level)] || 0);
        this._progress.stars[String(this.level)] = Math.max(stars, this._progress.stars[String(this.level)] || 0);
        this._progress.level = Math.max(this._progress.level, Math.min(MAX_LEVEL, this.level + 1)); this._save();
        this._ui.showModal('won', stars, `得分 ${this.score}  ·  使用 ${this._shots} 发炮弹  ·  余弹奖励 +${this.ammo * 150}`); this._render(); this._sound(520, 0.25);
    }

    togglePause() {
        if (!this._canControlView) return;
        this._paused = !this._paused; this._cannon.paused = this._paused; this._cannon.cancel(); PhysicsSystem.instance.enable = !this._paused;
        this._playerCamera.cancelInteraction();
        if (this._paused) this._playerCamera.setShake(0);
        for (const target of this._targets) target.paused = this._paused;
        if (this._paused) this._ui.showModal('paused', 0, '放松一下，回来再炸个痛快。'); else this._ui.hideModal();
    }
    private _resume() { this._paused = false; if (this._cannon) this._cannon.paused = false; PhysicsSystem.instance.enable = true; }
    private _render() { this._hudDirty = true; }
    lateUpdate() {
        if (!this._hudDirty || !this._ui) return;
        this._hudDirty = false;
        this._ui.render({ level: this.level, stage: this.stage, stages: this._loaded?.config.stages.length || 1, ammo: this.ammo, budget: this.budget, cleared: this.cleared, total: this.total, score: this.score, best: this._progress.scores[String(this.level)] || 0, phase: this.phase });
    }
    private _save() { try { sys.localStorage.setItem('cannon-progress-v1', JSON.stringify(this._progress)); } catch {} }
    private _fail(error: unknown) { console.error('[CannonGame]', error); this.phase = 'error'; this._ui.showModal('error', 0, '请点击重新挑战，重新装载关卡资源。'); }
    private _sound(frequency: number, duration: number) {
        if (this._progress.muted || typeof AudioContext === 'undefined') return;
        try {
            if (!this._audio) this._audio = new AudioContext(); void this._audio.resume();
            const oscillator = this._audio.createOscillator(), gain = this._audio.createGain(), now = this._audio.currentTime;
            oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(frequency, now); oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.35, now + duration);
            gain.gain.setValueAtTime(0.16, now); gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
            oscillator.connect(gain); gain.connect(this._audio.destination); oscillator.start(now); oscillator.stop(now + duration);
        } catch { /* Audio is optional on unsupported platforms. */ }
    }
    onDestroy() { this._revision++; view.off('canvas-resize', this._onResize, this); this._resume(); this._audio?.close(); for (const target of this._targets) if (isValid(target.node)) target.node.destroy(); this._cannon?.node.destroy(); this._decor?.destroy(); }
}
