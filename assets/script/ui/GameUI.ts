import { _decorator, Camera, Canvas, Color, Component, EventTouch, Graphics, Label, Layers, Node, ResolutionPolicy, UIOpacity, UITransform, Vec3, view, screen } from 'cc';
const { ccclass } = _decorator;
const C = { ink: '#F4F0E8', muted: '#95ADB8', panel: '#192F3D', line: '#365160', gold: '#FFBD59', teal: '#72DBCA' };

export interface HUDState {
    level: number; stage: number; stages: number; ammo: number; budget: number;
    cleared: number; total: number; score: number; best: number; phase: string;
}

@ccclass('GameUI')
export class GameUI extends Component {
    onAimStart: ((event: EventTouch) => void) | null = null;
    onAimMove: ((event: EventTouch) => void) | null = null;
    onAimEnd: (() => void) | null = null;
    onGestureStart: ((event: EventTouch) => void) | null = null;
    onGestureMove: ((event: EventTouch) => void) | null = null;
    onGestureEnd: ((event: EventTouch) => void) | null = null;
    onCharge: (() => void) | null = null;
    onFire: (() => void) | null = null;
    onCancel: (() => void) | null = null;
    onRetry: (() => void) | null = null;
    onNext: (() => void) | null = null;
    onPause: (() => void) | null = null;
    onSound: (() => void) | null = null;
    onView: (() => void) | null = null;
    onResetView: (() => void) | null = null;
    canUseButtons: () => boolean = () => true;
    private _root!: Node;
    private _labels = new Map<string, Label>();
    private _progress!: Graphics;
    private _power!: Graphics;
    private _barPixels = new WeakMap<Graphics, number>();
    private _powerValue = 0.55;
    private _modal!: Node;
    private _w = 1280;
    private _h = 800;
    private _state: HUDState | null = null;
    private _messageTime = 0;
    private _hintTime = 6;
    private _hintOpacity!: UIOpacity;
    private _charging = false;
    private _viewMode = false;
    private _fire!: Node;
    private _hudBlockers: Node[] = [];
    private _modalKind = '';
    private _modalStars = 0;
    private _modalDetail = '';
    private _uiCamera!: Camera;
    private _reticle!: Node;
    private _layoutVersion = 0;
    get layoutVersion(): number { return this._layoutVersion; }

    onLoad() { this._build(); view.on('canvas-resize', this._resize, this); }
    onDestroy() { view.off('canvas-resize', this._resize, this); this._root?.destroy(); }
    private _resize() {
        const kind = this._modalKind, stars = this._modalStars, detail = this._modalDetail;
        this._build(); if (this._state) this.render(this._state);
        if (kind) this.showModal(kind as 'won' | 'lost' | 'paused' | 'error', stars, detail);
    }

    private _build() {
        this._layoutVersion++;
        this._root?.destroy(); this._labels.clear(); this._hudBlockers = [];
        const aspect = screen.windowSize.width / Math.max(1, screen.windowSize.height);
        const portrait = aspect < 0.85;
        this._h = portrait ? 1100 : 720; this._w = Math.round(this._h * aspect);
        view.setDesignResolutionSize(this._w, this._h, ResolutionPolicy.SHOW_ALL);
        const w = this._w, h = this._h;
        const root = this._root = new Node('GameHUD'); root.parent = this.node.scene!; root.layer = Layers.Enum.UI_2D;
        root.addComponent(UITransform).setContentSize(w, h);
        const canvas = root.addComponent(Canvas);
        const camNode = new Node('HUDCamera'); camNode.parent = root; camNode.setPosition(0, 0, 1000);
        const cam = camNode.addComponent(Camera); cam.projection = Camera.ProjectionType.ORTHO;
        cam.orthoHeight = h / 2; cam.near = 0.1; cam.far = 2000;
        cam.visibility = Layers.Enum.UI_2D; cam.clearFlags = Camera.ClearFlag.DEPTH_ONLY; cam.priority = 10;
        canvas.cameraComponent = cam; canvas.alignCanvasWithScreen = true;
        this._uiCamera = cam;
        const surface = this._node('AimSurface', root, 0, 0, w, h);
        surface.on(Node.EventType.TOUCH_START, (e: EventTouch) => { this.onGestureStart?.(e); this.onAimStart?.(e); });
        surface.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => { this.onGestureMove?.(e); this.onAimMove?.(e); });
        surface.on(Node.EventType.TOUCH_END, (e: EventTouch) => { this.onAimEnd?.(); this.onGestureEnd?.(e); });
        surface.on(Node.EventType.TOUCH_CANCEL, (e: EventTouch) => { this.onCancel?.(); this.onGestureEnd?.(e); });
        this._reticle = this._node('AimReticle', root, 0, 0, 30, 30);
        const reticle = this._reticle.addComponent(Graphics);
        reticle.strokeColor = new Color().fromHEX(C.gold); reticle.lineWidth = 2; reticle.circle(0, 0, 12);
        for (const sign of [-1, 1]) { reticle.moveTo(sign * 8, 0); reticle.lineTo(sign * 18, 0); reticle.moveTo(0, sign * 8); reticle.lineTo(0, sign * 18); } reticle.stroke();
        const left = -w / 2 + 18;
        const status = this._panel(root, 'CompactStatus', left + 124, h / 2 - 42, 248, 56, C.panel, 165);
        this._hudBlockers.push(status);
        this._label(root, 'Level', '', left + 12, h / 2 - 35, 100, 19, C.ink, true, Label.HorizontalAlign.LEFT);
        this._label(root, 'Objective', '', left + 110, h / 2 - 35, 130, 15, C.muted, false, Label.HorizontalAlign.LEFT);
        this._progress = this._node('Progress', root, left + 12, h / 2 - 57, 224, 4).addComponent(Graphics);
        this._label(root, 'Score', '', w / 2 - 235, h / 2 - 36, 120, 18, C.teal, true);
        this._button(root, 'View', this._viewMode ? '瞄准' : '视角', w / 2 - 143, h / 2 - 36, 42, 42, C.panel, () => this.onView?.());
        this._button(root, 'Retry', '↻', w / 2 - 91, h / 2 - 36, 42, 42, C.panel, () => this.onRetry?.());
        this._button(root, 'Pause', 'II', w / 2 - 39, h / 2 - 36, 42, 42, C.panel, () => this.onPause?.());
        this._label(root, 'Combo', '', 0, h / 2 - 102, Math.min(480, w - 40), 22, C.gold, true);
        const ammo = this._panel(root, 'AmmoChip', left + 84, -h / 2 + 42, 168, 44, C.panel, 165);
        this._hudBlockers.push(ammo);
        this._label(root, 'Ammo', '', left + 84, -h / 2 + 42, 156, 20, C.gold, true);
        const hint = this._label(root, 'Hint', this._hintTime > 0 ? '拖动瞄准 · 按住蓄力，松开发射' : '', 0, -h / 2 + 26, Math.min(400, w - 400), 14, C.muted);
        this._hintOpacity = hint.node.addComponent(UIOpacity);
        const fire = this._fire = this._button(root, 'Fire', '开 炮', w / 2 - 77, -h / 2 + 50, 118, 58, C.gold, () => {});
        fire.addComponent(UIOpacity);
        this._power = this._node('Power', fire, -42, 21, 84, 4).addComponent(Graphics);
        fire.off(Node.EventType.TOUCH_END);
        fire.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; this.onCharge?.(); });
        fire.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; this.onFire?.(); });
        fire.on(Node.EventType.TOUCH_CANCEL, () => this.onCancel?.());
        this._label(root, 'Status', '', 0, h / 2 - 102, w - 40, 16, C.ink);
        this._modal = this._node('ResultOverlay', root, 0, 0, w, h); this._modal.active = false;
        this.setPower(this._powerValue);
    }

    render(state: HUDState) {
        this._state = state;
        this._text('Level', `第 ${String(state.level).padStart(2, '0')} 关`);
        this._text('Score', `得分 ${state.score}`);
        this._text('Ammo', `炮弹 ${state.ammo} / ${state.budget}`);
        this._text('Objective', `${state.cleared} / ${state.total}${state.stages > 1 ? ` · ${state.stage + 1}/${state.stages}` : ' 目标'}`);
        this._bar(this._progress, 224, state.total ? state.cleared / state.total : 0, C.teal);
        this._text('Status', state.phase === 'loading' ? '正在装填靶场…' : '');
        this._updateFire();
    }

    setPower(value: number) { this._powerValue = value; if (this._charging) this._bar(this._power, 84, value, C.ink); this._power.node.active = this._charging; }
    setCharging(charging: boolean) {
        if (this._charging === charging) return;
        this._charging = charging;
        if (charging) { this._hintTime = 0; this._text('Hint', ''); }
        if (charging && this._power) this._bar(this._power, 84, this._powerValue, C.ink);
        if (this._power) this._power.node.active = charging;
        this._updateFire();
    }
    setViewMode(enabled: boolean) { this._viewMode = enabled; this._text('View', enabled ? '瞄准' : '视角'); }
    isGameplayScreenPoint(x: number, y: number): boolean {
        if (this._modal?.active) return false;
        const p = this._root.getComponent(UITransform)!.convertToNodeSpaceAR(this._uiCamera.screenToWorld(new Vec3(x, y, 0)));
        if (Math.abs(p.x) > this._w / 2 || Math.abs(p.y) > this._h / 2) return false;
        return !this._hudBlockers.some(node => {
            if (!node.activeInHierarchy) return false;
            const box = node.getComponent(UITransform)!.getBoundingBox();
            return p.x >= box.x && p.x <= box.xMax && p.y >= box.y && p.y <= box.yMax;
        });
    }
    private _updateFire() {
        if (!this._fire) return;
        const ready = !!this._state && ['aiming', 'flying', 'settling'].includes(this._state.phase) && this._state.ammo > 0 && this._state.cleared < this._state.total;
        this._text('Fire', this._charging ? '松开发射' : ready ? '开 炮' : '等待');
        this._fire.getComponent(UIOpacity)!.opacity = ready ? 255 : 140;
    }
    setAimScreen(point: Vec3, visible: boolean) {
        if (!this._reticle?.isValid) return;
        this._reticle.active = visible;
        const p = this._root.getComponent(UITransform)!.convertToNodeSpaceAR(this._uiCamera.screenToWorld(point));
        this._reticle.setPosition(p.x, p.y, 0);
    }
    setSound(muted: boolean) { this._text('Sound', muted ? '音效：关' : '音效：开'); }
    toast(message: string) { this._messageTime = 1.7; this._text('Combo', message); }
    update(dt: number) {
        if (this._messageTime > 0 && (this._messageTime -= dt) <= 0) this._text('Combo', '');
        if (this._hintTime > 0) { this._hintTime = Math.max(0, this._hintTime - dt); this._hintOpacity.opacity = Math.min(1, this._hintTime / 1.2) * 255; if (this._hintTime <= 0) this._text('Hint', ''); }
    }

    showModal(kind: 'won' | 'lost' | 'paused' | 'error', stars = 0, detail = '') {
        this._modalKind = kind; this._modalStars = stars; this._modalDetail = detail; this._modal.active = true;
        for (const child of [...this._modal.children]) child.destroy();
        const shade = this._modal.getComponent(Graphics) || this._modal.addComponent(Graphics); shade.clear();
        shade.fillColor = new Color(6, 19, 29, 210); shade.rect(-this._w / 2, -this._h / 2, this._w, this._h); shade.fill();
        this._modal.off(Node.EventType.TOUCH_START);
        this._modal.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; });
        this._panel(this._modal, 'ResultCard', 0, 0, Math.min(this._w - 70, 520), 390, C.panel);
        const title = { won: '爆破成功', lost: '再来一发，扭转战局', paused: '稍作休整', error: '靶场加载失败' }[kind];
        this._label(this._modal, 'ResultEyebrow', kind === 'won' ? 'MISSION COMPLETE' : kind === 'paused' ? 'TAKE A BREAK' : 'CANNON / RETRY', 0, 145, 430, 16, C.gold);
        this._label(this._modal, 'ResultTitle', title, 0, 100, 460, 32, C.ink, true);
        this._label(this._modal, 'Stars', kind === 'won' ? Array.from({ length: 3 }, (_, i) => i < stars ? '★' : '☆').join('  ') : kind === 'paused' ? 'II' : '↻', 0, 35, 420, 46, C.gold, true);
        this._label(this._modal, 'ResultDetail', kind === 'paused' ? `关卡最佳 ${this._state?.best || 0} 分` : detail, 0, -30, 440, 18, C.muted);
        this._button(this._modal, 'Continue', kind === 'won' ? '下一关  →' : kind === 'paused' ? '继续战斗' : '重新挑战', 0, -100, 320, 60, C.gold, () => kind === 'won' ? this.onNext?.() : kind === 'paused' ? this.onPause?.() : this.onRetry?.());
        if (kind === 'paused') {
            this._button(this._modal, 'Sound', '音效开关', -90, -158, 150, 32, C.line, () => this.onSound?.());
            this._button(this._modal, 'ResetView', '回正视角', 90, -158, 150, 32, C.line, () => this.onResetView?.());
        }
    }
    hideModal() { this._modalKind = ''; this._modal.active = false; }

    private _text(key: string, text: string) { const label = this._labels.get(key); if (label) label.string = text; }
    private _bar(g: Graphics, width: number, fraction: number, color: string) {
        if (!g) return;
        const pixels = Math.round(width * Math.max(0, Math.min(1, fraction)));
        if (this._barPixels.get(g) === pixels) return;
        this._barPixels.set(g, pixels);
        g.clear(); g.fillColor = new Color().fromHEX(C.line); g.roundRect(0, -3, width, 6, 3); g.fill();
        if (fraction > 0) { g.fillColor = new Color().fromHEX(color); g.roundRect(0, -3, Math.max(6, width * Math.min(1, fraction)), 6, 3); g.fill(); }
    }
    private _node(name: string, parent: Node, x: number, y: number, w: number, h: number) {
        const node = new Node(name); node.parent = parent; node.layer = Layers.Enum.UI_2D; node.setPosition(x, y, 0); node.addComponent(UITransform).setContentSize(w, h); return node;
    }
    private _panel(parent: Node, name: string, x: number, y: number, w: number, h: number, color: string, alpha = 255) {
        const node = this._node(name, parent, x, y, w, h); const g = node.addComponent(Graphics);
        const fill = new Color().fromHEX(color); fill.a = alpha;
        g.fillColor = fill; g.roundRect(-w / 2, -h / 2, w, h, Math.min(14, h / 2)); g.fill(); return node;
    }
    private _label(parent: Node, key: string, text: string, x: number, y: number, width: number, font: number, color: string, bold = false, align = Label.HorizontalAlign.CENTER) {
        const node = this._node(key, parent, x, y, width, font * 2.2); const label = node.addComponent(Label);
        label.string = text; label.fontSize = font; label.lineHeight = font * 1.35; label.fontFamily = 'Microsoft YaHei'; label.isBold = bold;
        label.horizontalAlign = align; label.verticalAlign = Label.VerticalAlign.CENTER; label.color = new Color().fromHEX(color);
        if (align === Label.HorizontalAlign.LEFT) node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        this._labels.set(key, label); return label;
    }
    private _button(parent: Node, name: string, text: string, x: number, y: number, w: number, h: number, color: string, action: () => void) {
        const node = this._panel(parent, name, x, y, w, h, color, parent === this._root && color !== C.gold ? 165 : 255);
        if (parent === this._root) this._hudBlockers.push(node);
        this._label(node, name, text, 0, 0, w - 8, w <= 48 && text.length > 1 ? 14 : h > 48 ? 20 : 18, color === C.gold ? '#253640' : C.ink, true);
        node.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; if (this.canUseButtons()) action(); }); return node;
    }
}
