import { _decorator, Component, EditBox, isValid, Label, Node, Sprite, UITransform, Vec3 } from 'cc';

const { ccclass } = _decorator;

export interface CreateRoleInput {
    surname: string;
    givenName: string;
}

/** 与传送带项目一致：业务节点按名称收集，_ 开头的装饰子树不参与绑定。 */
@ccclass('VCreateRoleView')
export class VCreateRoleView extends Component {
    readonly ui: Record<string, Node> = {};
    private readonly _bindings: Array<{ node: Node; type: string; callback: (...args: any[]) => void }> = [];

    onLoad() {
        this._collect(this.node);
        this.node.on(Node.EventType.SIZE_CHANGED, this._adapt, this);
        this._adapt();

        this._bindAction('btnBack', 'create-role-back');
        this._bindAction('btnRandomRole', 'create-role-random-avatar');
        this._bindAction('btnRandomAttributes', 'create-role-random-attributes');
        this._bindAction('btnRandomName', 'create-role-random-name');
        this._bindAction('btnNext', 'create-role-next');
        this._bindClick('btnEditSurname', () => this.ui.inputSurname.getComponent(EditBox)?.focus());
        this._bindClick('btnEditName', () => this.ui.inputName.getComponent(EditBox)?.focus());
    }

    onDestroy() {
        this.node.off(Node.EventType.SIZE_CHANGED, this._adapt, this);
        for (const binding of this._bindings) {
            if (isValid(binding.node)) binding.node.off(binding.type, binding.callback, this);
        }
        this._bindings.length = 0;
    }

    /** 供业务层设置姓名，EditBox 与显示文字使用同一份数据。 */
    setRoleInput(value: Partial<CreateRoleInput>) {
        if (value.surname !== undefined) this.ui.inputSurname.getComponent(EditBox)!.string = value.surname;
        if (value.givenName !== undefined) this.ui.inputName.getComponent(EditBox)!.string = value.givenName;
    }

    getRoleInput(): CreateRoleInput {
        return {
            surname: this.ui.inputSurname.getComponent(EditBox)!.string.trim(),
            givenName: this.ui.inputName.getComponent(EditBox)!.string.trim(),
        };
    }

    /** 业务层可按 labGender、labJob、labTotalCost 等节点名更新原生 Label。 */
    setText(nodeName: string, text: string) {
        const label = this.ui[nodeName]?.getComponent(Label);
        if (label) label.string = text;
    }

    private _collect(parent: Node) {
        for (const child of parent.children) {
            if (child.name.startsWith('_')) continue;
            this.ui[child.name] = child;
            this._collect(child);
        }
    }

    private _adapt() {
        const size = this.node.getComponent(UITransform)!.contentSize;
        const root = this.ui.root;
        if (!root || size.width <= 0 || size.height <= 0) return;
        const scale = Math.min(size.width / 720, size.height / 1680);
        root.setScale(scale, scale, 1);
        const background = this.ui.bg;
        if (background) {
            background.getComponent(UITransform)!.setContentSize(size.width, size.height);
            const sprite = background.getComponent(Sprite);
            if (sprite) sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        }
    }

    private _bindAction(nodeName: string, eventName: string) {
        this._bindClick(nodeName, () => this.node.emit(eventName, this.getRoleInput()));
    }

    private _bindClick(nodeName: string, action: () => void) {
        const node = this.ui[nodeName];
        if (!node) return;
        const initialScale = node.scale.clone();
        const pressedScale = new Vec3(initialScale.x * 0.97, initialScale.y * 0.97, initialScale.z);
        const bind = (type: string, callback: () => void) => {
            node.on(type, callback, this);
            this._bindings.push({ node, type, callback });
        };
        bind(Node.EventType.TOUCH_START, () => node.setScale(pressedScale));
        bind(Node.EventType.TOUCH_CANCEL, () => node.setScale(initialScale));
        bind(Node.EventType.TOUCH_END, () => {
            node.setScale(initialScale);
            action();
        });
    }
}
