// 卡片选择面板：界面视图编辑模式下从左下角「添加」按钮打开，选择要加入界面的卡片。
// 目前仅提供「今日时钟任务」一个选项，方块样式复用工作台添加卡片菜单。

import { t } from '../i18n';
import { FloatingPanel } from './floating-panel';

export class CardPickerPanel extends FloatingPanel {
    constructor(onPickTodayClock: () => void) {
        super({
            title: t('interface.cardPickerTitle'),
            width: 360,
            closeOnBlur: true,
        });

        this.setContent((body) => {
            const grid = body.createDiv({ cls: 'wb-add-section-grid' });
            const item = grid.createDiv({ cls: 'wb-add-menu-item' });
            item.createDiv({ cls: 'wb-add-menu-item-icon', text: '⏰' });
            item.createDiv({ cls: 'wb-add-menu-item-label', text: t('interface.cardTodayClock') });
            item.addEventListener('click', () => {
                this.close();
                onPickTodayClock();
            });
        });
    }
}
