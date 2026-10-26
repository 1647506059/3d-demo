import { _decorator, Component } from 'cc';
import { GameManager } from './game/GameManager';
const { ccclass, property } = _decorator;

/** Pink scene entry. Runtime nodes are recreated for each play session. */
@ccclass('Main')
export class Main extends Component {
    @property({ tooltip: '起始关卡；1 表示从本地保存的进度继续' })
    levelIndex = 1;

    start() { void this.node.addComponent(GameManager).initialize(this.levelIndex); }
}
