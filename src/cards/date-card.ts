// 今日日期卡片：月份 + 大号日号，点击打开周历面板。
// 作为可通过编辑模式「添加」面板加入的独立卡片，默认隐藏。
import { t } from '../i18n';

/** 今日日期卡片配置 */
export interface DateCardOptions {
    onClick: () => void;
}

export class DateCard {
    private readonly options: DateCardOptions;

    constructor(options: DateCardOptions) {
        this.options = options;
    }

    /** 在指定容器内渲染卡片 */
    render(parentEl: HTMLElement): void {
        const now = new Date();
        const card = parentEl.createDiv({ cls: 'interface-date-card' });
        card.createDiv({
            cls: 'interface-date-month',
            text: t('interface.monthTitle', { month: String(now.getMonth() + 1) }),
        });
        card.createDiv({ cls: 'interface-date-day', text: String(now.getDate()) });
        card.addEventListener('click', () => this.options.onClick());
    }
}
