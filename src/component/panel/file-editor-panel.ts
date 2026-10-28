// 文件编辑面板：在悬浮面板内展示并编辑任务文件内容。
// 保存策略与 Obsidian 原生 TextFileView 一致：每次输入只调用 requestSave()（2s 防抖），
// 停止输入 2s 后写盘；关闭 / 销毁时再强制保存一次。
import { Notice } from 'obsidian';
import type { App, TFile } from 'obsidian';

import { t } from '../../i18n';
import { FloatingPanel } from './floating-panel';

export interface FileEditorPanelOptions {
    app: App;
    file: TFile;
    /** 面板关闭后回调（文件列表需要刷新修改时间） */
    onClose?: () => void;
}

/** 防抖保存延迟（毫秒，与原生 requestSave 一致） */
const SAVE_DEBOUNCE_MS = 2000;

export class FileEditorPanel extends FloatingPanel {
    private readonly editorApp: App;
    private readonly file: TFile;
    /** 编辑区 */
    private textarea: HTMLTextAreaElement | null = null;
    /** 防抖保存定时器 */
    private saveTimer: number | null = null;
    /** 保存状态文案 */
    private statusEl: HTMLElement | null = null;
    /** 是否有未保存的修改 */
    private dirty = false;

    constructor(options: FileEditorPanelOptions) {
        super({
            width: 760,
            title: options.file.basename,
            onClose: () => {
                void this.save();
                options.onClose?.();
            },
        });
        this.editorApp = options.app;
        this.file = options.file;
        this.body.addClass('file-editor-panel');
        void this.loadContent();
    }

    /** 读取文件内容并渲染编辑器 */
    private async loadContent(): Promise<void> {
        try {
            const content = await this.editorApp.vault.read(this.file);
            this.renderEditor(content);
        } catch {
            new Notice(t('panel.fileReadFailed'));
            this.close();
        }
    }

    private renderEditor(content: string): void {
        this.body.empty();

        const toolbar = this.body.createDiv({ cls: 'file-editor-panel-toolbar' });
        const pathEl = toolbar.createDiv({ cls: 'file-editor-panel-path' });
        pathEl.setText(this.file.path);
        pathEl.title = this.file.path;
        this.statusEl = toolbar.createDiv({ cls: 'file-editor-panel-status' });
        this.setStatus(t('panel.fileSaved'), false);

        this.textarea = this.body.createEl('textarea', { cls: 'file-editor-panel-input' });
        this.textarea.value = content;
        this.textarea.spellcheck = false;
        this.textarea.addEventListener('input', () => {
            this.dirty = true;
            this.setStatus(t('panel.fileUnsaved'), false);
            this.requestSave();
        });
    }

    private setStatus(text: string, saving: boolean): void {
        if (!this.statusEl) return;
        this.statusEl.setText(text);
        this.statusEl.toggleClass('is-saving', saving);
    }

    /** 请求保存：每次输入都会重置计时，停止输入 2s 后才真正写盘 */
    private requestSave(): void {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            void this.save();
        }, SAVE_DEBOUNCE_MS);
    }

    /** 立即保存：无未保存修改时直接返回，避免无谓更新修改时间 */
    private async save(): Promise<void> {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (!this.textarea || !this.dirty) return;
        this.setStatus(t('panel.fileSaving'), true);
        try {
            await this.editorApp.vault.modify(this.file, this.textarea.value);
            this.dirty = false;
            this.setStatus(t('panel.fileSaved'), false);
        } catch {
            this.setStatus(t('panel.fileUnsaved'), false);
            new Notice(t('panel.fileSaveFailed'));
        }
    }

    override destroy(): void {
        void this.save();
        super.destroy();
    }
}
