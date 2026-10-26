import { _decorator, Camera, Canvas, Color, Component, EventTouch, Graphics, Label, Layers, Node, ResolutionPolicy, UITransform, Vec3, view, screen } from 'cc';
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
    onCharge: (() => void) | null = null;
    onFire: (() => void) | null = null;
    onCancel: (() => void) | null = null;
    onRetry: (() => void) | null = null;
    onNext: (() => void) | null = null;
    onPause: (() => void) | null = null;
    onSound: (() => void) | null = null;
    private _root!: Node;
    private _labels = new Map<string, Label>();
    private _progress!: Graphics;
    private _power!: Graphics;
    private _modal!: Node;
    private _w = 1280;
    private _h = 800;
    private _state: HUDState | null = null;
    private _message = '';
    private _messageTime = 0;
    private _modalKind = '';
    private _modalStars = 0;
    private _modalDetail = '';
    private _uiCamera!: Camera;
    private _reticle!: Node;

    onLoad() { this._build(); view.on('canvas-resize', this._resize, this); }
    onDestroy() { view.off('canvas-resize', this._resize, this); this._root?.destroy(); }
    private _resize() {
        const kind = this._modalKind, stars = this._modalStars, detail = this._modalDetail;
        this._build(); if (this._state) this.render(this._state);
        if (kind) this.showModal(kind as 'won' | 'lost' | 'paused' | 'error', stars, detail);
    }

    private _build() {
        this._root?.destroy(); this._labels.clear();
        const portrait = screen.windowSize.width / screen.windowSize.height < 0.85;
        view.setDesignResolutionSize(portrait ? 720 : 1280, portrait ? 1100 : 800, ResolutionPolicy.SHOW_ALL);
        this._w = portrait ? 720 : 1280; this._h = portrait ? 1100 : 800;
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
        const surface = this._node('AimSurface', root, 0, 0, w, h - 300);
        surface.on(Node.EventType.TOUCH_START, (e: EventTouch) => this.onAimStart?.(e));
        surface.on(Node.EventType.TOUCH_MOVE, (e: EventTouch) => this.onAimMove?.(e));
        surface.on(Node.EventType.TOUCH_END, () => this.onAimEnd?.());
        surface.on(Node.EventType.TOUCH_CANCEL, () => this.onCancel?.());
        this._reticle = this._node('AimReticle', root, 0, 0, 30, 30);
        const reticle = this._reticle.addComponent(Graphics);
        reticle.strokeColor = new Color().fromHEX(C.gold); reticle.lineWidth = 2; reticle.circle(0, 0, 12);
        for (const sign of [-1, 1]) { reticle.moveTo(sign * 8, 0); reticle.lineTo(sign * 18, 0); reticle.moveTo(0, sign * 8); reticle.lineTo(0, sign * 18); } reticle.stroke();
        this._panel(root, 'Header', 0, h / 2 - 63, w - 48, 90, C.panel);
        const left = -w / 2 + 48;
        this._label(root, 'Brand', 'CANNON / 01', left, h / 2 - 45, 190, 18, C.gold, true, Label.HorizontalAlign.LEFT);
        this._label(root, 'Title', '油桶爆破行动', left, h / 2 - 77, 230, portrait ? 25 : 28, C.ink, true, Label.HorizontalAlign.LEFT);
        this._label(root, 'Level', '', portrait ? 72 : -180, h / 2 - 49, 180, 25, C.ink, true);
        this._label(root, 'Stage', '靶场 / 精准打击', portrait ? 72 : -180, h / 2 - 79, 190, 15, C.muted);
        if (!portrait) {
            this._label(root, 'ScoreCaption', '本局得分', 165, h / 2 - 47, 160, 14, C.muted);
            this._label(root, 'Score', '0000', 165, h / 2 - 77, 160, 29, C.teal, true);
            this._label(root, 'BestCaption', '关卡最佳', 335, h / 2 - 47, 150, 14, C.muted);
            this._label(root, 'Best', '0000', 335, h / 2 - 77, 150, 24, C.ink);
        }
        this._button(root, 'Pause', 'II', w / 2 - 73, h / 2 - 62, 48, 48, C.line, () => this.onPause?.());
        this._panel(root, 'Mission', -w / 2 + 153, h / 2 - 154, 258, 58, C.panel);
        this._label(root, 'Objective', '', -w / 2 + 152, h / 2 - 144, 224, 17, C.ink);
        this._progress = this._node('Progress', root, -w / 2 + 50, h / 2 - 169, 206, 5).addComponent(Graphics);
        if (portrait) {
            this._panel(root, 'ScoreCard', 190, h / 2 - 154, 292, 58, C.panel);
            this._label(root, 'Score', '得分 0000', 125, h / 2 - 154, 155, 21, C.teal, true);
            this._label(root, 'Best', '最佳 0000', 260, h / 2 - 154, 120, 14, C.muted);
        }
        this._label(root, 'Combo', '', 0, 105, w - 40, 40, C.gold, true);
        this._panel(root, 'Footer', 0, -h / 2 + 82, w - 48, 122, C.panel);
        this._label(root, 'AmmoCaption', '剩余炮弹', left, -h / 2 + 118, 130, 15, C.muted, false, Label.HorizontalAlign.LEFT);
        this._label(root, 'Ammo', '', left, -h / 2 + 81, 150, 30, C.gold, true, Label.HorizontalAlign.LEFT);
        this._label(root, 'PowerCaption', '蓄力 / POWER', portrait ? -12 : -80, -h / 2 + 112, portrait ? 180 : 240, 14, C.muted);
        this._power = this._node('Power', root, portrait ? -100 : -200, -h / 2 + 82, portrait ? 180 : 240, 10).addComponent(Graphics);
        this._label(root, 'Hint', '拖动瞄准 · 按住蓄力 · 松开发射', portrait ? 0 : -70, -h / 2 + 44, portrait ? 400 : 540, portrait ? 14 : 16, C.muted);
        const fire = this._button(root, 'Fire', '开 炮', w / 2 - 138, -h / 2 + 90, 170, 62, C.gold, () => {});
        fire.off(Node.EventType.TOUCH_END);
        fire.on(Node.EventType.TOUCH_START, (e: EventTouch) => { e.propagationStopped = true; this.onCharge?.(); });
        fire.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; this.onFire?.(); });
        fire.on(Node.EventType.TOUCH_CANCEL, () => this.onCancel?.());
        this._button(root, 'Retry', '重 来', w / 2 - 138, -h / 2 + 32, 100, 30, C.line, () => this.onRetry?.());
        this._label(root, 'Status', '寻找薄弱处，让连锁反应替你完成任务。', 0, -h / 2 + 165, w - 60, 17, C.ink);
        this._modal = this._node('ResultOverlay', root, 0, 0, w, h); this._modal.active = false;
        this.setPower(0.55);
    }

    render(state: HUDState) {
        this._state = state;
        this._text('Level', `第 ${String(state.level).padStart(2, '0')} 关`);
        this._text('Stage', state.stages > 1 ? `阶段 ${state.stage + 1} / ${state.stages}` : '靶场 / 精准打击');
        this._text('Score', `${this._w < 1000 ? '得分 ' : ''}${String(state.score).padStart(4, '0')}`); this._text('Best', `${this._w < 1000 ? '最佳 ' : ''}${String(state.best).padStart(4, '0')}`);
        this._text('Ammo', `${String(state.ammo).padStart(2, '0')} / ${String(state.budget).padStart(2, '0')}`);
        this._text('Objective', `摧毁目标   ${state.cleared} / ${state.total}`);
        this._bar(this._progress, 206, state.total ? state.cleared / state.total : 0, C.teal);
        const hints: Record<string, string> = { loading: '正在装填靶场…', flying: '炮弹飞行中…', settling: '连锁爆破中…', showcase: '目标清空！', aiming: '瞄准油桶下层，制造更大的连锁爆破。' };
        if (hints[state.phase]) this._text('Status', hints[state.phase]);
    }

    setPower(value: number) { this._bar(this._power, this._w < 1000 ? 180 : 240, value, C.gold); }
    setAimScreen(point: Vec3, visible: boolean) {
        if (!this._reticle?.isValid) return;
        this._reticle.active = visible;
        const p = this._root.getComponent(UITransform)!.convertToNodeSpaceAR(this._uiCamera.screenToWorld(point));
        this._reticle.setPosition(p.x, p.y, 0);
    }
    setSound(muted: boolean) { this._text('Sound', muted ? '音效：关' : '音效：开'); }
    toast(message: string) { this._message = message; this._messageTime = 1.7; this._text('Combo', message); }
    update(dt: number) { if (this._messageTime > 0 && (this._messageTime -= dt) <= 0) this._text('Combo', ''); }

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
        this._label(this._modal, 'ResultDetail', detail, 0, -30, 440, 18, C.muted);
        this._button(this._modal, 'Continue', kind === 'won' ? '下一关  →' : kind === 'paused' ? '继续战斗' : '重新挑战', 0, -100, 320, 60, C.gold, () => kind === 'won' ? this.onNext?.() : kind === 'paused' ? this.onPause?.() : this.onRetry?.());
        if (kind === 'paused') this._button(this._modal, 'Sound', '音效开关', 0, -158, 150, 32, C.line, () => this.onSound?.());
    }
    hideModal() { this._modalKind = ''; this._modal.active = false; }

    private _text(key: string, text: string) { const label = this._labels.get(key); if (label) label.string = text; }
    private _bar(g: Graphics, width: number, fraction: number, color: string) {
        if (!g) return; g.clear(); g.fillColor = new Color().fromHEX(C.line); g.roundRect(0, -3, width, 6, 3); g.fill();
        if (fraction > 0) { g.fillColor = new Color().fromHEX(color); g.roundRect(0, -3, Math.max(6, width * Math.min(1, fraction)), 6, 3); g.fill(); }
    }
    private _node(name: string, parent: Node, x: number, y: number, w: number, h: number) {
        const node = new Node(name); node.parent = parent; node.layer = Layers.Enum.UI_2D; node.setPosition(x, y, 0); node.addComponent(UITransform).setContentSize(w, h); return node;
    }
    private _panel(parent: Node, name: string, x: number, y: number, w: number, h: number, color: string) {
        const node = this._node(name, parent, x, y, w, h); const g = node.addComponent(Graphics);
        g.fillColor = new Color().fromHEX(color); g.roundRect(-w / 2, -h / 2, w, h, 18); g.fill(); return node;
    }
    private _label(parent: Node, key: string, text: string, x: number, y: number, width: number, font: number, color: string, bold = false, align = Label.HorizontalAlign.CENTER) {
        const node = this._node(key, parent, x, y, width, font * 2.2); const label = node.addComponent(Label);
        label.string = text; label.fontSize = font; label.lineHeight = font * 1.35; label.fontFamily = 'Microsoft YaHei'; label.isBold = bold;
        label.horizontalAlign = align; label.verticalAlign = Label.VerticalAlign.CENTER; label.color = new Color().fromHEX(color);
        if (align === Label.HorizontalAlign.LEFT) node.getComponent(UITransform)!.setAnchorPoint(0, 0.5);
        this._labels.set(key, label); return label;
    }
    private _button(parent: Node, name: string, text: string, x: number, y: number, w: number, h: number, color: string, action: () => void) {
        const node = this._panel(parent, name, x, y, w, h, color);
        this._label(node, name, text, 0, 0, w - 8, h > 40 ? 22 : 15, color === C.gold ? '#253640' : C.ink, true);
        node.on(Node.EventType.TOUCH_END, (e: EventTouch) => { e.propagationStopped = true; action(); }); return node;
    }
}
