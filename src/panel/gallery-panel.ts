// 画廊面板：基于 FloatingPanel，左侧菜单 + 右侧页面。
// 左侧菜单最底部为「管理源」按钮，激活后在右侧显示源列表与添加源按钮。
import { setIcon } from 'obsidian';

import { t } from '../i18n';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';

/** 画廊面板配置 */
export interface GalleryPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「画廊」 */
    title?: string;
}

/** 左侧菜单项 */
type GalleryMenuKey = 'gallery' | 'sources';

/** 画廊面板 */
export class GalleryPanel extends FloatingPanel {
    private menuEl!: HTMLElement;
    private paneEl!: HTMLElement;
    /** 当前激活的菜单项 */
    private activeMenu: GalleryMenuKey = 'gallery';
    /** 画廊源列表（暂未接入持久化，先空列表占位） */
    private sources: string[] = [];

    constructor(options: GalleryPanelOptions = {}) {
        super({
            width: 720,
            title: options.title ?? t('panel.galleryPanelTitle'),
            ...options,
        });
        this.body.addClass('gallery-panel');
        this.renderLayout();
    }

    private renderLayout(): void {
        const left = this.body.createDiv({ cls: 'gallery-menu' });
        this.renderMenuItems(left, 'gallery', 'image', t('panel.galleryMenuAll'));

        // 底部「管理源」按钮
        const manageBtn = left.createDiv({ cls: 'gallery-menu-manage' });
        const manageIcon = manageBtn.createSpan({ cls: 'gallery-menu-manage-icon' });
        setIcon(manageIcon, 'database');
        manageBtn.createSpan({ text: t('panel.galleryManageSources') });
        manageBtn.dataset.menu = 'sources';
        manageBtn.addEventListener('click', () => this.switchMenu('sources'));

        this.paneEl = this.body.createDiv({ cls: 'gallery-pane' });
        this.renderPane();
    }

    /** 渲染普通菜单项（可扩展多个） */
    private renderMenuItems(container: HTMLElement, key: GalleryMenuKey, icon: string, label: string): void {
        this.menuEl = container.createDiv({ cls: 'gallery-menu-list' });
        const item = this.menuEl.createDiv({ cls: 'gallery-menu-item' });
        item.dataset.menu = key;
        const iconEl = item.createSpan({ cls: 'gallery-menu-item-icon' });
        setIcon(iconEl, icon);
        item.createSpan({ cls: 'gallery-menu-item-label', text: label });
        item.addEventListener('click', () => this.switchMenu(key));
        this.updateMenuState();
    }

    private switchMenu(key: GalleryMenuKey): void {
        if (this.activeMenu === key) return;
        this.activeMenu = key;
        this.renderPane();
    }

    /** 更新菜单激活态 */
    private updateMenuState(): void {
        this.body.querySelectorAll<HTMLElement>('[data-menu]').forEach((el) => {
            el.toggleClass('is-active', el.dataset.menu === this.activeMenu);
        });
    }

    private renderPane(): void {
        this.paneEl.empty();
        this.updateMenuState();
        if (this.activeMenu === 'sources') {
            this.renderSourcesPane();
        }
    }

    /** 管理源：源列表 + 添加源按钮 */
    private renderSourcesPane(): void {
        const list = this.paneEl.createDiv({ cls: 'gallery-source-list' });
        if (this.sources.length === 0) {
            list.createDiv({ cls: 'gallery-source-empty', text: t('panel.galleryNoSources') });
        } else {
            for (const source of this.sources) {
                list.createDiv({ cls: 'gallery-source-item', text: source });
            }
        }

        const addBtn = this.paneEl.createEl('button', { cls: 'gallery-source-add' });
        const addIcon = addBtn.createSpan({ cls: 'gallery-source-add-icon' });
        setIcon(addIcon, 'plus');
        addBtn.createSpan({ text: t('panel.galleryAddSource') });
    }
}
