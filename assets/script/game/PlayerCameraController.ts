import { _decorator, Component, EventKeyboard, EventMouse, EventTouch, game, input, Input, KeyCode, Vec2, Vec3 } from 'cc';
import { GameUI } from '../ui/GameUI';
const { ccclass } = _decorator;

/** Owns the player camera transform; aiming and view gestures use separate inputs. */
@ccclass('PlayerCameraController')
export class PlayerCameraController extends Component {
    ui!: GameUI;
    canControl: () => boolean = () => false;
    onInteraction: (() => void) | null = null;
    viewMode = false;
    private _homePosition = new Vec3();
    private _homeFocus = new Vec3();
    private _pivot = new Vec3();
    private _radius = 10;
    private _homeRadius = 10;
    private _yaw = 0;
    private _pitch = 0;
    private _configured = false;
    private _manual = false;
    private _shake = 0;
    private _appliedShake = 0;
    private _poseDirty = false;
    private _mouseMode: 'orbit' | 'pan' | null = null;
    private _pointerButton = EventMouse.BUTTON_LEFT;
    private _captureMouse = (event: MouseEvent) => { this._pointerButton = event.button; };
    private _touches = new Map<number, Vec2>();
    private _multiTouch = false;
    private _pairCenter = new Vec2();
    private _pairDistance = 0;
    private _blur = () => this.cancelInteraction();
    private _contextMenu = (event: Event) => event.preventDefault();

    get nonPrimaryPointer(): boolean { return this._pointerButton !== EventMouse.BUTTON_LEFT; }
    get interacting(): boolean { return this.nonPrimaryPointer || this._mouseMode !== null || (this.viewMode || this._multiTouch) && this._touches.size > 0; }

    onEnable() {
        input.on(Input.EventType.MOUSE_DOWN, this._mouseDown, this);
        input.on(Input.EventType.MOUSE_MOVE, this._mouseMove, this);
        input.on(Input.EventType.MOUSE_UP, this._mouseUp, this);
        input.on(Input.EventType.MOUSE_WHEEL, this._wheel, this);
        input.on(Input.EventType.KEY_DOWN, this._key, this);
        game.canvas?.addEventListener('contextmenu', this._contextMenu);
        game.canvas?.addEventListener('mousedown', this._captureMouse, true);
        game.canvas?.addEventListener('mouseleave', this._blur);
        if (typeof window !== 'undefined') window.addEventListener('blur', this._blur);
    }
    onDisable() {
        input.off(Input.EventType.MOUSE_DOWN, this._mouseDown, this);
        input.off(Input.EventType.MOUSE_MOVE, this._mouseMove, this);
        input.off(Input.EventType.MOUSE_UP, this._mouseUp, this);
        input.off(Input.EventType.MOUSE_WHEEL, this._wheel, this);
        input.off(Input.EventType.KEY_DOWN, this._key, this);
        game.canvas?.removeEventListener('contextmenu', this._contextMenu);
        game.canvas?.removeEventListener('mousedown', this._captureMouse, true);
        game.canvas?.removeEventListener('mouseleave', this._blur);
        if (typeof window !== 'undefined') window.removeEventListener('blur', this._blur);
        this.cancelInteraction();
    }

    setHome(position: Vec3, focus: Vec3, preserveView = false) {
        this._homePosition.set(position); this._homeFocus.set(focus);
        this._homeRadius = Vec3.distance(position, focus);
        if (preserveView && this._configured && this._manual) return;
        this._configured = true; this.reset();
    }
    reset() {
        if (!this._configured) return;
        this.cancelInteraction(); this._manual = false; this.viewMode = false;
        this.ui?.setViewMode(false);
        this._pivot.set(this._homeFocus);
        const delta = Vec3.subtract(new Vec3(), this._homePosition, this._pivot);
        this._radius = delta.length(); this._yaw = Math.atan2(delta.x, delta.z);
        this._pitch = Math.asin(delta.y / this._radius);
        this._apply();
    }
    toggleViewMode() {
        this.cancelInteraction(); this.viewMode = !this.viewMode; this.ui.setViewMode(this.viewMode);
        this.ui.toast(this.viewMode ? '拖动画面环视 · 双指缩放' : '已切回瞄准 · V 回正视角');
    }
    cancelInteraction() { this._mouseMode = null; this._pointerButton = EventMouse.BUTTON_LEFT; this._touches.clear(); this._multiTouch = false; this._pairDistance = 0; this.onInteraction?.(); }
    setShake(value: number) { if (this._shake !== value) { this._shake = value; this._poseDirty = true; } }
    lateUpdate() { if (this._configured && (this._poseDirty || this._shake > 0 || this._appliedShake > 0)) this._apply(); }
    private _apply() {
        const horizontal = this._radius * Math.cos(this._pitch);
        this.node.setWorldPosition(this._pivot.x + Math.sin(this._yaw) * horizontal + (Math.random() - 0.5) * this._shake,
            Math.max(0.45, this._pivot.y + Math.sin(this._pitch) * this._radius) + (Math.random() - 0.5) * this._shake,
            this._pivot.z + Math.cos(this._yaw) * horizontal);
        this.node.lookAt(this._pivot);
        this._poseDirty = false; this._appliedShake = this._shake;
    }
    private _rotate(dx: number, dy: number) {
        this._manual = true; this._yaw -= dx * 0.0045;
        this._pitch = Math.max(-Math.PI / 9, Math.min(Math.PI * 0.43, this._pitch - dy * 0.0045));
        this._apply();
    }
    private _zoom(factor: number) { this._manual = true; this._radius = Math.max(Math.max(2, this._homeRadius * 0.35), Math.min(this._homeRadius * 3, this._radius * factor)); this._apply(); }
    private _pan(dx: number, dy: number) {
        this._manual = true;
        const scale = this._radius * 0.0015;
        const right = Vec3.transformQuat(new Vec3(), Vec3.RIGHT, this.node.worldRotation).multiplyScalar(-dx * scale);
        const up = Vec3.transformQuat(new Vec3(), Vec3.UP, this.node.worldRotation).multiplyScalar(-dy * scale);
        this._pivot.add(right).add(up); this._pivot.y = Math.max(0.5, this._pivot.y);
        const offset = Vec3.subtract(new Vec3(), this._pivot, this._homeFocus);
        if (offset.length() > this._homeRadius) this._pivot.set(this._homeFocus).add(offset.normalize().multiplyScalar(this._homeRadius));
        this._apply();
    }
    private _allowed(x: number, y: number) { return this._configured && this.canControl() && this.ui.isGameplayScreenPoint(x, y); }
    private _mouseDown(event: EventMouse) {
        const button = event.getButton();
        this._pointerButton = button;
        // Pink's engine also simulates touch for mouse buttons; cancel that provisional charge.
        if (button !== EventMouse.BUTTON_LEFT) this.onInteraction?.();
        if (!this._allowed(event.getLocationX(), event.getLocationY())) return;
        if (button === EventMouse.BUTTON_RIGHT || button === EventMouse.BUTTON_LEFT && this.viewMode) this._mouseMode = 'orbit';
        else if (button === EventMouse.BUTTON_MIDDLE) this._mouseMode = 'pan';
        if (this._mouseMode) this.onInteraction?.();
    }
    private _mouseMove(event: EventMouse) {
        if (!this._mouseMode || !this.canControl()) return;
        if (this._mouseMode === 'orbit') this._rotate(event.getDeltaX(), event.getDeltaY());
        else this._pan(event.getDeltaX(), event.getDeltaY());
    }
    private _mouseUp() { this._mouseMode = null; this._pointerButton = EventMouse.BUTTON_LEFT; }
    private _wheel(event: EventMouse) {
        if (!this._allowed(event.getLocationX(), event.getLocationY())) return;
        this.onInteraction?.(); this._zoom(Math.exp(-event.getScrollY() * 0.001));
    }
    private _key(event: EventKeyboard) { if (event.keyCode === KeyCode.KEY_V && this.canControl()) { this.reset(); this.ui.toast('已回到炮后视角'); } }
    touchStart(event: EventTouch) {
        if (!this._allowed(event.getLocationX(), event.getLocationY()) || !event.touch) return;
        this._touches.set(event.touch.getID(), event.getLocation());
        if (this._touches.size >= 2) { this._multiTouch = true; this._syncPair(); this.onInteraction?.(); }
        else if (this.viewMode) this.onInteraction?.();
    }
    touchMove(event: EventTouch) {
        if (!event.touch || !this.canControl()) return;
        const id = event.touch.getID(), previous = this._touches.get(id);
        if (!previous) return;
        const point = event.getLocation(); this._touches.set(id, point);
        if (this._mouseMode) return;
        if (this._multiTouch && this._touches.size >= 2) {
            const [a, b] = [...this._touches.values()];
            const center = new Vec2((a.x + b.x) / 2, (a.y + b.y) / 2), distance = Vec2.distance(a, b);
            this._rotate(center.x - this._pairCenter.x, center.y - this._pairCenter.y);
            if (this._pairDistance > 8 && distance > 8) this._zoom(this._pairDistance / distance);
            this._pairCenter.set(center); this._pairDistance = distance;
        } else if (this.viewMode && !this._multiTouch) this._rotate(point.x - previous.x, point.y - previous.y);
    }
    private _syncPair() {
        const [a, b] = [...this._touches.values()];
        this._pairCenter.set((a.x + b.x) / 2, (a.y + b.y) / 2); this._pairDistance = Vec2.distance(a, b);
    }
    touchEnd(event: EventTouch) {
        if (event.touch) this._touches.delete(event.touch.getID());
        if (!this._touches.size) { this._multiTouch = false; this._pairDistance = 0; }
    }
}
