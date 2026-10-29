// 设置面板：由顶部工具栏「设置」按钮打开，基于 FloatingPanel。
// 内容：项目库根目录绑定（点击更换）+ 说明文字。
import type { App } from 'obsidian';
import { setIcon } from 'obsidian';

import { t } from '../../../i18n';
import { FloatingPanel, type FloatingPanelOptions } from '../basic/floating-panel';
import { FolderPickerPanel } from '../basic/folder-picker-panel';

/** 设置面板配置 */
export interface SettingsPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** Obsidian App（目录选择用） */
    app: App;
    /** 读取任务库根目录（vault 相对路径，空表示未绑定） */
    getTaskLibraryRoot: () => string;
    /** 保存任务库根目录 */
    saveTaskLibraryRoot: (path: string) => Promise<void>;
}

/** 设置面板 */
export class SettingsPanel extends FloatingPanel {
    private readonly panelOptions: SettingsPanelOptions;

    constructor(options: SettingsPanelOptions) {
        super({
            width: 460,
            title: t('panel.settingsTitle'),
            closeOnBlur: true,
            ...options,
        });
        this.panelOptions = options;
        this.body.addClass('settings-panel');
        this.renderContent();
    }

    /** 每次打开时重新渲染，保证展示的目录为最新值 */
    override open(): void {
        this.renderContent();
        super.open();
    }

    /** 渲染面板内容：项目库目录行 + 说明文字 */
    private renderContent(): void {
        this.body.empty();

        // 第一行：项目库 + 目录绑定（点击更换）
        const row = this.body.createDiv({ cls: 'settings-panel-row' });
        row.createSpan({ cls: 'settings-panel-label', text: t('panel.taskLibrary') });
        const folderEl = row.createDiv({
            cls: 'settings-panel-folder',
            attr: { role: 'button', title: t('panel.taskLibraryChange') },
        });
        setIcon(folderEl.createSpan({ cls: 'settings-panel-folder-icon' }), 'folder');
        const path = this.panelOptions.getTaskLibraryRoot();
        folderEl.createSpan({
            cls: path ? 'settings-panel-folder-path' : 'settings-panel-folder-path is-empty',
            text: path || t('panel.taskLibraryUnbound'),
        });
        folderEl.addEventListener('click', () => this.openFolderPicker());

        // 说明文字
        this.body.createDiv({ cls: 'settings-panel-desc', text: t('panel.taskLibraryDesc') });
    }

    /** 打开目录选择面板，选定后保存并刷新展示 */
    private openFolderPicker(): void {
        const picker = new FolderPickerPanel(this.panelOptions.app, {
            onConfirm: (result) => {
                void this.panelOptions.saveTaskLibraryRoot(result.path)
                    .then(() => this.renderContent());
            },
        });
        // 目录面板内的点击不触发本面板的失焦关闭
        this.addIgnoreElement(picker.element);
        picker.open();
    }
}
