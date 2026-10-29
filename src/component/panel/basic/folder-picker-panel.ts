// 文件夹选择面板：基于 FloatingPanel，搜索并选择 vault 内文件夹，第二行填写展示名称。
import type { App } from 'obsidian';
import { TFolder, setIcon } from 'obsidian';

import { t } from '../../../i18n';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';

/** 文件夹选择结果 */
export interface FolderPickerResult {
    /** vault 相对路径 */
    path: string;
    /** 展示名称 */
    name: string;
}

/** 文件夹选择面板配置 */
export interface FolderPickerPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「选择文件夹」 */
    title?: string;
    /** 点「确认」后的回调 */
    onConfirm: (result: FolderPickerResult) => void;
}

export class FolderPickerPanel extends FloatingPanel {
    private searchEl!: HTMLInputElement;
    private listEl!: HTMLElement;
    private nameEl!: HTMLInputElement;
    private confirmButton!: HTMLButtonElement;

    /** 当前选中的文件夹 */
    private selectedFolder: TFolder | null = null;

    constructor(
        private readonly app: App,
        private readonly pickerOptions: FolderPickerPanelOptions,
    ) {
        super({
            width: 420,
            title: pickerOptions.title ?? t('panel.folderPickerTitle'),
            closeOnBlur: true,
            ...pickerOptions,
        });
        this.body.addClass('folder-picker-panel');
        this.renderLayout();
    }

    /** 每次打开时重置搜索、选中与名称 */
    override open(): void {
        this.searchEl.value = '';
        this.nameEl.value = '';
        this.selectedFolder = null;
        this.renderList();
        this.updateConfirmState();
        super.open();
    }

    private renderLayout(): void {
        this.searchEl = this.body.createEl('input', {
            cls: 'folder-picker-search',
            attr: { type: 'text', placeholder: t('panel.folderPickerSearch') },
        });
        this.searchEl.addEventListener('input', () => this.renderList());

        this.listEl = this.body.createDiv({ cls: 'folder-picker-list' });
        this.listEl.addEventListener('click', (evt) => {
            const row = (evt.target as HTMLElement).closest('.folder-picker-row') as HTMLElement | null;
            const path = row?.dataset.path;
            if (!path) return;
            const folder = this.app.vault.getAbstractFileByPath(path);
            if (folder instanceof TFolder) this.selectFolder(folder);
        });

        const nameField = this.body.createDiv({ cls: 'folder-picker-name-field' });
        nameField.createDiv({ cls: 'folder-picker-name-label', text: t('panel.folderPickerName') });
        this.nameEl = nameField.createEl('input', {
            cls: 'folder-picker-name',
            attr: { type: 'text', placeholder: t('panel.folderPickerNamePlaceholder') },
        });
        this.nameEl.addEventListener('input', () => this.updateConfirmState());

        const footer = this.body.createDiv({ cls: 'folder-picker-footer' });
        const cancelButton = footer.createEl('button', {
            cls: 'folder-picker-button',
            text: t('panel.folderPickerCancel'),
        });
        cancelButton.addEventListener('click', () => this.close());
        this.confirmButton = footer.createEl('button', {
            cls: 'folder-picker-button mod-cta',
            text: t('panel.folderPickerConfirm'),
        });
        this.confirmButton.disabled = true;
        this.confirmButton.addEventListener('click', () => {
            const folder = this.selectedFolder;
            if (!folder) return;
            const name = this.nameEl.value.trim() || folder.name;
            this.close();
            this.pickerOptions.onConfirm({ path: folder.path, name });
        });

        this.renderList();
    }

    /** 渲染匹配的文件夹列表（按名称 / 路径过滤，隐藏 vault 根目录） */
    private renderList(): void {
        this.listEl.empty();
        const keyword = this.searchEl.value.trim().toLowerCase();
        const folders = this.app.vault.getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder && file.path !== '')
            .filter((folder) =>
                !keyword
                || folder.name.toLowerCase().includes(keyword)
                || folder.path.toLowerCase().includes(keyword))
            .sort((a, b) => a.path.localeCompare(b.path));

        if (folders.length === 0) {
            this.listEl.createDiv({ cls: 'folder-picker-empty', text: t('panel.folderPickerEmpty') });
            return;
        }

        for (const folder of folders) {
            const row = this.listEl.createDiv({ cls: 'folder-picker-row' });
            row.dataset.path = folder.path;
            row.toggleClass('is-selected', folder.path === this.selectedFolder?.path);
            const iconEl = row.createSpan({ cls: 'folder-picker-row-icon' });
            setIcon(iconEl, 'folder');
            const textEl = row.createDiv({ cls: 'folder-picker-row-text' });
            textEl.createDiv({ cls: 'folder-picker-row-name', text: folder.name });
            // 路径提示：仅当文件夹位于其他文件夹内时显示，便于区分同名文件夹
            if (folder.parent && folder.parent.path !== '') {
                textEl.createDiv({ cls: 'folder-picker-row-path', text: folder.path });
            }
        }
    }

    /** 选中文件夹：高亮并把名称自动填入输入框 */
    private selectFolder(folder: TFolder): void {
        this.selectedFolder = folder;
        this.listEl.querySelectorAll('.folder-picker-row').forEach((el) => {
            const row = el as HTMLElement;
            row.toggleClass('is-selected', row.dataset.path === folder.path);
        });
        this.nameEl.value = folder.name;
        this.updateConfirmState();
    }

    private updateConfirmState(): void {
        this.confirmButton.disabled = !this.selectedFolder || this.nameEl.value.trim() === '';
    }
}
