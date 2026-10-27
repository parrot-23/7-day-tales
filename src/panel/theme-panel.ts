// 主题管理面板：界面视图编辑模式下从「主题」按钮打开。
// 左右结构：左侧菜单（官方 / 本地），右侧为官方主题预览卡片；
// 预览卡片的数据来自 src/themes 下由代码定义的主题（代码绘制层 + 图片素材）。
import type { App } from 'obsidian';

import { t } from '../i18n';
import { THEME_DEFINITIONS } from '../themes/registry';
import { FloatingPanel } from './floating-panel';

/** 左侧菜单项 */
type ThemeMenuKey = 'official' | 'local';

/** 菜单项定义：key + 文案 key */
const MENU_ITEMS: { key: ThemeMenuKey; labelKey: Parameters<typeof t>[0] }[] = [
    { key: 'official', labelKey: 'theme.menuOfficial' },
    { key: 'local', labelKey: 'theme.menuLocal' },
];

/** 主题管理面板配置 */
export interface ThemePanelOptions {
    /** Obsidian App（读取主题素材资源路径） */
    app: App;
    /** 插件目录（vault 相对路径） */
    pluginDir: string;
    /** 读取当前应用的主题 id */
    getCurrentThemeId: () => string;
    /** 应用主题 */
    onApply: (themeId: string) => void;
}

export class ThemePanel extends FloatingPanel {
    private readonly panelOptions: ThemePanelOptions;
    /** 当前选中的菜单项 */
    private activeKey: ThemeMenuKey = 'official';
    /** 右侧内容容器 */
    private contentEl: HTMLElement | null = null;

    constructor(options: ThemePanelOptions) {
        super({
            title: t('theme.panelTitle'),
            width: 640,
        });
        this.panelOptions = options;

        this.setContent((body) => {
            body.addClass('theme-panel');

            // 左侧菜单
            const menu = body.createDiv({ cls: 'theme-panel-menu' });
            for (const { key, labelKey } of MENU_ITEMS) {
                const item = menu.createDiv({ cls: 'theme-panel-menu-item' });
                item.setText(t(labelKey));
                item.toggleClass('is-active', key === this.activeKey);
                item.addEventListener('click', () => this.selectMenu(key));
            }

            // 右侧内容
            this.contentEl = body.createDiv({ cls: 'theme-panel-content' });
            this.renderContent();
        });
    }

    /** 重新渲染内容（外部主题变化后同步选中态） */
    refresh(): void {
        this.renderContent();
    }

    /** 切换左侧菜单 */
    private selectMenu(key: ThemeMenuKey): void {
        if (this.activeKey === key) return;
        this.activeKey = key;
        const menu = this.body.querySelector('.theme-panel-menu');
        if (menu) {
            menu.querySelectorAll('.theme-panel-menu-item').forEach((el, index) => {
                el.toggleClass('is-active', MENU_ITEMS[index].key === key);
            });
        }
        this.renderContent();
    }

    /** 渲染右侧内容：官方菜单展示主题预览卡片，本地菜单暂为占位 */
    private renderContent(): void {
        const contentEl = this.contentEl;
        if (!contentEl) return;
        contentEl.empty();
        const isOfficial = this.activeKey === 'official';
        contentEl.toggleClass('is-empty', !isOfficial);

        if (!isOfficial) {
            contentEl.createDiv({ cls: 'theme-panel-placeholder', text: t('theme.contentPlaceholder') });
            return;
        }

        const currentThemeId = this.panelOptions.getCurrentThemeId();
        for (const theme of THEME_DEFINITIONS) {
            const isActive = theme.id === currentThemeId;
            const card = contentEl.createDiv({ cls: 'theme-preview-card' });
            card.toggleClass('is-active', isActive);

            // 缩略图：使用主题的图片素材；无素材的主题显示占位（空白主题为「不使用任何主题」）
            const thumb = card.createDiv({ cls: 'theme-preview-thumb' });
            const assetPath = theme.assets[0]?.path;
            if (assetPath) {
                const url = this.panelOptions.app.vault.adapter.getResourcePath(
                    `${this.panelOptions.pluginDir}/${assetPath}`,
                );
                thumb.style.backgroundImage = `url("${url}")`;
            } else if (theme.noteKey) {
                thumb.addClass('is-blank');
                thumb.createSpan({ cls: 'theme-preview-thumb-note', text: t(theme.noteKey) });
            } else {
                thumb.addClass('is-plain');
            }

            const info = card.createDiv({ cls: 'theme-preview-info' });
            info.createSpan({ cls: 'theme-preview-name', text: t(theme.nameKey) });
            const applyBtn = info.createEl('button', {
                cls: 'theme-preview-apply',
                attr: { type: 'button' },
            });
            applyBtn.setText(isActive ? t('theme.inUse') : t('theme.apply'));
            applyBtn.disabled = isActive;
            applyBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.applyTheme(theme.id);
            });
            card.addEventListener('click', () => this.applyTheme(theme.id));
        }
    }

    /** 应用主题并刷新预览卡片选中态 */
    private applyTheme(themeId: string): void {
        if (themeId === this.panelOptions.getCurrentThemeId()) return;
        this.panelOptions.onApply(themeId);
        this.renderContent();
    }
}
