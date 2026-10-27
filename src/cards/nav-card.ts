// 垂直功能栏卡片：竖排「图标 + 文字」按钮，点击打开对应面板。
// 默认显示，编辑模式下可移除并可从「添加」面板重新加入。
import { setIcon } from 'obsidian';

import { t } from '../i18n';

/** 功能栏条目：文案 key + 图标 + 点击行为 */
export interface NavCardItem {
    labelKey: Parameters<typeof t>[0];
    icon: string;
    onClick: () => void;
}

export interface NavCardOptions {
    items: NavCardItem[];
}

export class NavCard {
    private readonly options: NavCardOptions;

    constructor(options: NavCardOptions) {
        this.options = options;
    }

    /** 在指定容器内渲染竖排按钮 */
    render(parentEl: HTMLElement): void {
        const list = parentEl.createDiv({ cls: 'interface-nav-list' });
        for (const { labelKey, icon, onClick } of this.options.items) {
            const btn = list.createEl('button', { cls: 'interface-nav-btn', attr: { type: 'button' } });
            setIcon(btn.createSpan({ cls: 'interface-nav-btn-icon' }), icon);
            btn.createSpan({ cls: 'interface-nav-btn-text', text: t(labelKey) });
            btn.addEventListener('click', onClick);
        }
    }
}
