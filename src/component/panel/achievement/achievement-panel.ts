// 成就榜单面板：基于 FloatingPanel，内容暂留空，后续再接入榜单数据。
import { t } from '../../../i18n';
import { FloatingPanel, type FloatingPanelOptions } from '../basic/floating-panel';

/** 成就榜单面板配置 */
export interface AchievementPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「成就榜单」 */
    title?: string;
}

/** 成就榜单面板 */
export class AchievementPanel extends FloatingPanel {
    constructor(options: AchievementPanelOptions = {}) {
        super({
            width: 720,
            title: options.title ?? t('achievement.title'),
            ...options,
        });
        this.body.addClass('achievement-panel');
    }
}
