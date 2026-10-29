// 文件编辑面板：借 Obsidian 内部嵌入工厂（embedRegistry）取原生 Markdown 编辑器原型，
// 用 EmbeddableMarkdownEditor 包装类自己 new 一个编辑器挂进悬浮面板（社区标准做法，参考 mgmeyers / Fevol）。
// 关键点：
// 1. 临时嵌入视图只用来取编辑器原型，取完立即 unload，不保留、不搬 DOM；
// 2. 包装类在构造后 mock owner（owner.editMode / owner.editor），让编辑器以为自己挂在 MarkdownView 上；
// 3. 内容变化用 CodeMirror 6 的 updateListener 监听，写回文件带防抖；
// 4. 全程不创建 leaf、不开标签页、不激活 workspace，因此不会闪烁。
import { Component, Notice } from 'obsidian';
import type { App, TFile } from 'obsidian';

import { t } from '../../../i18n';
import { log } from '../../../shared/logger';
import { FloatingPanel } from './floating-panel';

export interface FileEditorPanelOptions {
    app: App;
    file: TFile;
    /** 面板关闭后回调（文件列表需要刷新修改时间） */
    onClose?: () => void;
}

/** 内部 CodeMirror 6 视图的最小结构 */
interface CodeMirrorLike {
    refresh?: () => void;
    requestMeasure?: () => void;
    focus?: () => void;
    contentDOM?: HTMLElement;
    state?: { doc?: { length?: number; toString: () => string } };
    dispatch?: (spec: { selection: { anchor: number; head: number } }) => void;
}

/** 内部 Markdown 编辑器实例（ScrollableMarkdownEditor）的最小结构 */
interface MarkdownEditorLike {
    /** 设置内容 */
    set?: (value: string) => void;
    /** 获取内容 */
    get?: () => string;
    /** 聚焦 */
    focus?: () => void;
    /** 销毁编辑器 */
    destroy?: () => void;
    /** 卸载（Component 生命周期） */
    unload?: () => void;
    /** 内部编辑器包装（含 CodeMirror 实例） */
    editor?: { cm?: CodeMirrorLike };
    /** CodeMirror 实例 */
    cm?: CodeMirrorLike;
    /** 所属视图（构造后由包装类 mock） */
    owner?: { editMode?: unknown; editor?: unknown };
}

/** 内部嵌入编辑器视图（WidgetEditorView）的最小结构 */
interface EmbeddedEditorViewLike {
    editable?: boolean;
    showEditor?: () => void;
    editMode?: unknown;
    unload?: () => void;
}

/** 内部嵌入注册表（embedRegistry）的最小结构 */
interface EmbedRegistryLike {
    embedByExtension: Record<string, (
        ctx: { app: App; containerEl: HTMLElement; linktext: string; sourcePath: string; displayMode?: boolean },
        file: TFile | null,
        subpath?: string,
    ) => EmbeddedEditorViewLike>;
}

/** 编辑器构造函数（内部 API，签名不固定，统一按宽松类型处理） */
type MarkdownEditorCtor = new (
    app: App,
    containerEl: HTMLElement,
    options: Record<string, unknown>,
) => MarkdownEditorLike;

/** 编辑器原型缓存（同一会话只解析一次） */
let cachedEditorCtor: MarkdownEditorCtor | null = null;

/** 写回防抖时间（毫秒） */
const SAVE_DEBOUNCE_MS = 300;

export class FileEditorPanel extends FloatingPanel {
    private readonly editorApp: App;
    private readonly file: TFile;
    /** 承载编辑器 DOM 的容器 */
    private hostEl: HTMLElement | null = null;
    /** 保存状态文案 */
    private statusEl: HTMLElement | null = null;
    /** 自己持有的原生编辑器实例 */
    private editor: MarkdownEditorLike | null = null;
    /** 写回防抖定时器 */
    private saveTimer: number | undefined;
    /** 输入监听的清理函数 */
    private inputCleanup: (() => void) | null = null;
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

    /** 取编辑器原型 → 在面板内 new 一个编辑器 → mock owner → 绑定内容写回 */
    private async mountEditor(): Promise<void> {
        const host = this.hostEl;
        if (!host) return;
        try {
            const Ctor = this.resolveEditorCtor();
            if (!Ctor) throw new Error('editor constructor unavailable');

            // 等面板完成布局（有非零宽高）后再构造编辑器，否则 CM6 会按不可见测量，光标层不绘制
            await this.waitForLayout(host);
            if (this.disposed) return;

            const editor = new Ctor(this.editorApp, host, {
                app: this.editorApp,
                onMarkdownScroll: (): void => undefined,
                getMode: (): string => 'source',
            });
            this.editor = editor;

            // 关键：让编辑器以为自己挂在 MarkdownView 上，否则滚动同步 / 内部命令会拿不到 editMode
            this.mockOwner(editor);

            // 初始内容
            const initial = await this.editorApp.vault.read(this.file);
            if (this.disposed) {
                this.teardown();
                return;
            }
            editor.set?.(initial);

            // 内容变化写回文件（CodeMirror 6 updateListener）
            this.bindChange(editor);

            // 等两帧让 CodeMirror 完成布局后再聚焦（聚焦后光标才会显示）
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    if (this.disposed) return;
                    this.focusEditor(editor);
                });
            });
        } catch (error) {
            // 嵌入失败时保持可用：清理并直接在 Obsidian 中打开该文件
            log('文件编辑面板嵌入失败', error);
            this.teardown();
            new Notice(t('panel.fileEmbedFailed'));
            void this.editorApp.workspace.getLeaf(false).openFile(this.file);
            this.close();
        }
    }

    /** 等待容器完成布局（有非零宽高），最多等 10 帧 */
    private waitForLayout(host: HTMLElement): Promise<void> {
        return new Promise((resolve) => {
            let frames = 0;
            const check = (): void => {
                frames += 1;
                if ((host.clientWidth > 0 && host.clientHeight > 0) || frames > 10) {
                    resolve();
                    return;
                }
                window.requestAnimationFrame(check);
            };
            window.requestAnimationFrame(check);
        });
    }

    /** mock owner：让编辑器认为自己属于某个 MarkdownView */
    private mockOwner(editor: MarkdownEditorLike): void {
        const owner = editor.owner;
        if (!owner) return;
        owner.editMode = editor;
        owner.editor = editor.editor ?? editor;
    }

    /** 取编辑器内部的 CodeMirror 6 视图 */
    private codeMirrorOf(editor: MarkdownEditorLike): CodeMirrorLike | undefined {
        return editor.editor?.cm ?? editor.cm;
    }

    /** 聚焦编辑器：CM6 需要 requestMeasure + focus，并接管 workspace.activeEditor */
    private focusEditor(editor: MarkdownEditorLike): void {
        const cm = this.codeMirrorOf(editor);
        try {
            // 先让 CM6 重新测量布局，再聚焦，否则光标层不会绘制
            cm?.requestMeasure?.();
            cm?.focus?.();
            // 把光标放到文档末尾，触发一次选区重绘
            const length = cm?.state?.doc?.length ?? 0;
            cm?.dispatch?.({ selection: { anchor: length, head: length } });
        } catch {
            // CodeMirror 未就绪时忽略
        }
        try {
            editor.focus?.();
        } catch {
            // 内部 focus 不可用时忽略
        }
        // 接管 activeEditor，让 Obsidian 内部命令 / 光标管理认为存在活跃编辑器
        try {
            (this.editorApp.workspace as unknown as { activeEditor?: unknown }).activeEditor = editor.editor ?? editor;
        } catch {
            // 只读属性时忽略
        }
        // 兜底：直接聚焦 CodeMirror 的 contentDOM（部分版本 focus() 不生效）
        try {
            cm?.contentDOM?.focus();
        } catch {
            // 忽略
        }
        // 再补一次测量：聚焦后布局可能变化，光标层需要重新绘制
        window.requestAnimationFrame(() => {
            if (this.disposed) return;
            try {
                cm?.requestMeasure?.();
            } catch {
                // 忽略
            }
            this.forceCaretVisible(editor);
        });
    }

    /**
     * 让 CodeMirror 认为自身处于聚焦态。
     * 原生编辑器依赖 view.hasFocus 决定是否绘制光标；脱离 MarkdownView 后该状态可能一直为 false，
     * 只有选中文本（选区高亮）时才可见。这里通过内部 focus 状态标记 + 重新测量强制绘制光标。
     */
    private forceCaretVisible(editor: MarkdownEditorLike): void {
        const cm = this.codeMirrorOf(editor) as unknown as {
            hasFocus?: boolean;
            inputState?: { focusChange?: (focused: boolean) => void };
            requestMeasure?: () => void;
            focus?: () => void;
            dom?: HTMLElement;
        };
        try {
            if (cm && cm.hasFocus === false) {
                // 内部 API：通知 CM 焦点变化，触发光标层重绘
                cm.inputState?.focusChange?.(true);
            }
            cm?.focus?.();
            // 兜底：CM6 的 CSS 依赖 .cm-focused 类显示光标，直接补上
            cm?.dom?.classList.add('cm-focused');
            cm?.requestMeasure?.();
        } catch {
            // 内部 API 不可用时忽略
        }
    }

    /** 借临时嵌入视图取编辑器构造函数（取完立即 unload，不保留视图） */
    private resolveEditorCtor(): MarkdownEditorCtor | null {
        if (cachedEditorCtor) return cachedEditorCtor;
        const registry = (this.editorApp as unknown as { embedRegistry?: EmbedRegistryLike }).embedRegistry;
        const factory = registry?.embedByExtension?.md;
        if (!factory) return null;

        const tempEl = document.createElement('div');
        tempEl.addClass('file-editor-offscreen-host');
        document.body.appendChild(tempEl);
        let temp: EmbeddedEditorViewLike | null = null;
        try {
            temp = factory(
                {
                    app: this.editorApp,
                    containerEl: tempEl,
                    linktext: '',
                    sourcePath: '',
                    displayMode: false,
                },
                null,
                '',
            );
            temp.editable = true;
            temp.showEditor?.();
            // 编辑器实例挂在 editMode 上，其原型再往上一层即编辑器类（社区标准取法）
            const editMode = temp.editMode as object | undefined;
            if (!editMode) throw new Error('editMode unavailable');
            const proto = Object.getPrototypeOf(Object.getPrototypeOf(editMode)) as { constructor?: MarkdownEditorCtor };
            cachedEditorCtor = proto?.constructor ?? null;
            return cachedEditorCtor;
        } catch (error) {
            log('解析编辑器构造函数失败', error);
            return null;
        } finally {
            try {
                temp?.unload?.();
            } catch {
                // 临时视图卸载失败时忽略
            }
            tempEl.remove();
        }
    }

    /** 绑定内容变化：CodeMirror 6 的 updateListener（CM6 没有 cm.on('change')） */
    private bindChange(editor: MarkdownEditorLike): void {
        const cm = this.codeMirrorOf(editor) as unknown as {
            dom?: HTMLElement;
            contentDOM?: HTMLElement;
        };
        const target = cm?.contentDOM ?? cm?.dom;
        if (!target) return;
        // 用 DOM 事件兜底监听输入：CM6 的 updateListener 需要在构造时注入扩展，
        // 这里改为监听编辑器容器的 input 事件，再读取文档内容写回
        const handler = (): void => this.scheduleSave(editor);
        target.addEventListener('input', handler);
        this.inputCleanup = () => target.removeEventListener('input', handler);
    }

    /** 防抖写回文件 */
    private scheduleSave(editor: MarkdownEditorLike): void {
        this.setStatus(t('panel.fileUnsaved'));
        if (this.saveTimer !== undefined) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = undefined;
            const value = this.readEditorValue(editor);
            if (value === null) return;
            void this.editorApp.vault.process(this.file, () => value)
                .then(() => this.setStatus(t('panel.fileSaved')))
                .catch((error) => log('写回任务文件失败', error));
        }, SAVE_DEBOUNCE_MS);
    }

    /** 读取编辑器当前内容 */
    private readEditorValue(editor: MarkdownEditorLike): string | null {
        const cm = this.codeMirrorOf(editor);
        const fromCm = cm?.state?.doc?.toString();
        if (typeof fromCm === 'string') return fromCm;
        const fromEditor = editor.get?.();
        return typeof fromEditor === 'string' ? fromEditor : null;
    }

    private setStatus(text: string): void {
        this.statusEl?.setText(text);
    }

    /** 销毁编辑器（close / destroy 都会调用，内部只执行一次） */
    private teardown(): void {
        if (this.disposed) return;
        this.disposed = true;

        if (this.saveTimer !== undefined) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = undefined;
        }
        this.inputCleanup?.();
        this.inputCleanup = null;

        const editor = this.editor;
        this.editor = null;
        if (!editor) return;
        try {
            // 原生编辑器是 Component：先 unload 再 destroy，避免残留监听
            if (editor instanceof Component) editor.unload();
            else editor.unload?.();
        } catch {
            // 已卸载时忽略
        }
        try {
            editor.destroy?.();
        } catch {
            // 已销毁时忽略
        }
    }

    override destroy(): void {
        this.teardown();
        super.destroy();
    }
}
