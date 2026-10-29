// 文件编辑面板：把 Obsidian 原生 Markdown 编辑器「搬」进悬浮面板。
// 做法与社区 Sync Embeds / Hover Editor 一致：先在 workspace 里开一个真实 leaf 并打开文件，
// 再把该 leaf 的 view 容器 DOM 重新挂到面板内；撤销、光标、保存、多视图同步全部由原生负责。
// 面板关闭时保存并 detach 该 leaf（同时恢复被隐藏的标签页）。
import { MarkdownView, Notice } from 'obsidian';
import type { App, TFile, WorkspaceLeaf } from 'obsidian';

import { t } from '../../i18n';
import { log } from '../../shared/logger';
import { FloatingPanel } from './floating-panel';

export interface FileEditorPanelOptions {
    app: App;
    file: TFile;
    /** 面板关闭后回调（文件列表需要刷新修改时间） */
    onClose?: () => void;
}

export class FileEditorPanel extends FloatingPanel {
    private readonly editorApp: App;
    private readonly file: TFile;
    /** 承载原生编辑器 DOM 的容器 */
    private hostEl: HTMLElement | null = null;
    /** 保存状态文案 */
    private statusEl: HTMLElement | null = null;
    /** 承载原生编辑器的真实 leaf */
    private leaf: WorkspaceLeaf | null = null;
    /** leaf 对应的原生 Markdown 视图 */
    private view: MarkdownView | null = null;
    /** 为承载编辑器而隐藏的标签页元素（关闭时恢复） */
    private tabHeaderEl: HTMLElement | null = null;
    /** 原生事件监听（关闭时注销） */
    private eventOffs: (() => void)[] = [];
    /** 是否已完成清理，避免 close / destroy 重复执行 */
    private disposed = false;

    constructor(options: FileEditorPanelOptions) {
        super({
            width: 760,
            title: options.file.basename,
            onClose: () => {
                this.teardown();
                options.onClose?.();
            },
        });
        this.editorApp = options.app;
        this.file = options.file;
        this.body.addClass('file-editor-panel');
        this.renderChrome();
        void this.mountEditor();
    }

    /** 顶部路径栏 + 编辑器容器（先建好骨架，避免加载期间面板空白） */
    private renderChrome(): void {
        const toolbar = this.body.createDiv({ cls: 'file-editor-panel-toolbar' });
        const pathEl = toolbar.createDiv({ cls: 'file-editor-panel-path' });
        pathEl.setText(this.file.path);
        pathEl.title = this.file.path;
        this.statusEl = toolbar.createDiv({ cls: 'file-editor-panel-status' });
        this.setStatus(t('panel.fileSaved'));

        this.hostEl = this.body.createDiv({ cls: 'file-editor-panel-host' });
    }

    /** 打开真实 leaf 并把原生编辑器 DOM 挂到面板内 */
    private async mountEditor(): Promise<void> {
        const workspace = this.editorApp.workspace;
        const previousLeaf = workspace.activeLeaf;
        try {
            // 必须使用 workspace 创建的真实 leaf：游离 WorkspaceLeaf 不会走视图初始化流程
            const leaf = workspace.getLeaf('tab');
            this.leaf = leaf;
            // active: false —— 不抢走当前标签页焦点，主视图保持可见
            await leaf.openFile(this.file, { active: false });
            if (this.disposed) {
                // 加载期间面板已被关闭，直接释放 leaf
                try {
                    leaf.detach();
                } catch {
                    // 忽略
                }
                return;
            }
            if (!(leaf.view instanceof MarkdownView)) throw new Error('markdown view not created');
            const view = leaf.view;
            this.view = view;

            // 该 leaf 只是为了承载编辑器，隐藏它在标签栏里的标签，避免留下空白页签
            const tabHeader = (leaf as unknown as { tabHeaderEl?: HTMLElement }).tabHeaderEl;
            if (tabHeader) {
                this.tabHeaderEl = tabHeader;
                tabHeader.style.display = 'none';
            }

            this.hostEl?.appendChild(view.containerEl);
            this.registerEvents();

            // getLeaf('tab') 可能已把新标签页设为激活，切回原标签页避免主视图被顶掉
            if (previousLeaf && previousLeaf !== leaf) {
                workspace.setActiveLeaf(previousLeaf, { focus: false });
            }
        } catch (error) {
            // 嵌入失败时保持可用：清理 leaf，直接在 Obsidian 中打开该文件
            log('文件编辑面板嵌入失败', error);
            this.teardown();
            new Notice(t('panel.fileEmbedFailed'));
            void workspace.getLeaf(false).openFile(this.file);
            this.close();
        }
    }

    /** 监听原生编辑器的输入与落盘，刷新状态文案 */
    private registerEvents(): void {
        const workspace = this.editorApp.workspace;
        const vault = this.editorApp.vault;
        const changeRef = workspace.on('editor-change', (_editor, info) => {
            if (info?.file?.path === this.file.path) this.setStatus(t('panel.fileUnsaved'));
        });
        this.eventOffs.push(() => workspace.offref(changeRef));
        const modifyRef = vault.on('modify', (file) => {
            if (file.path === this.file.path) this.setStatus(t('panel.fileSaved'));
        });
        this.eventOffs.push(() => vault.offref(modifyRef));
    }

    private setStatus(text: string): void {
        this.statusEl?.setText(text);
    }

    /** 保存并释放原生视图与 leaf（close / destroy 都会调用，内部只执行一次） */
    private teardown(): void {
        if (this.disposed) return;
        this.disposed = true;

        const view = this.view;
        const leaf = this.leaf;
        this.view = null;
        this.leaf = null;

        for (const off of this.eventOffs) off();
        this.eventOffs = [];

        if (this.tabHeaderEl) {
            this.tabHeaderEl.style.display = '';
            this.tabHeaderEl = null;
        }

        if (!view || !leaf) return;
        void (async () => {
            try {
                await view.save();
            } catch {
                // 视图未完成初始化时保存可能失败，忽略即可
            }
            view.containerEl.remove();
            try {
                leaf.detach();
            } catch {
                // leaf 已被工作区移除时 detach 会报错，忽略即可
            }
        })();
    }

    override destroy(): void {
        this.teardown();
        super.destroy();
    }
}
