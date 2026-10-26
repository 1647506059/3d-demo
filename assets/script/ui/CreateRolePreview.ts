import { _decorator, Component, ResolutionPolicy, view } from 'cc';

const { ccclass, executionOrder } = _decorator;

/** 仅预览场景设置设计分辨率，VCreateRoleView 预制体可放入现有 Canvas。 */
@ccclass('CreateRolePreview')
@executionOrder(-1000)
export class CreateRolePreview extends Component {
    onLoad() {
        view.setDesignResolutionSize(720, 1680, ResolutionPolicy.FIXED_HEIGHT);
    }
}
