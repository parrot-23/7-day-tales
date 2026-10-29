// 任务板块信息面板：基于 FloatingPanel 展示单个任务的收集篮子 / 待办改进 / 文件目录。
// 第一行显示任务名称与任务分类；入口为点击「今日任务」卡片中的任务条目。
import { Notice, setIcon } from 'obsidian';
import type { App, TFile } from 'obsidian';

import type { ChecklistItem } from '../../../datatypes/domain';
import type { PrototypeTask } from '../../../datatypes/prototype-task';
import { t } from '../../../i18n';
import { buildTaskFileName, listTaskFiles } from '../../../shared/task-file';
import { FileEditorPanel } from '../basic/file-editor-panel';
import type { FloatingPanelOptions } from '../basic/floating-panel';
import { FloatingPanel } from '../basic/floating-panel';
import { FolderPickerPanel } from '../basic/folder-picker-panel';

/** 板块 key */
type TaskSectionKey = 'checklist' | 'file';

/** 板块：顺序与文案 */
const TASK_SECTIONS: { key: TaskSectionKey; labelKey: Parameters<typeof t>[0] }[] = [
    { key: 'checklist', labelKey: 'interface.bottomTabChecklist' },
    { key: 'file', labelKey: 'interface.bottomTabFile' },
];

/** 任务板块信息面板配置 */
export interface TaskSectionsPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    app: App;
    /** 按 id 读取任务（每次都从仓库读最新数据） */
    getTask: (taskId: string) => PrototypeTask | undefined;
    /** 分类列表（用于第一行显示任务分类） */
    categories: { id: string; label: string; color?: string }[];
    /** 持久化出口（文件目录 / 时间戳开关修改后保存） */
    save: () => Promise<void>;
    /** 点击第一行跳转图标：在任务详情面板中打开该任务 */
    onOpenTaskDetail?: (taskId: string) => void;
}

export class TaskSectionsPanel extends FloatingPanel {
    private readonly sectionsOptions: TaskSectionsPanelOptions;
    /** 当前展示的任务 id */
    private taskId: string | null = null;
    /** 当前板块 */
    private section: TaskSectionKey = 'checklist';
    /** 文件目录是否处于新建文件输入状态 */
    private fileCreateMode = false;
    /** 文件编辑面板（切换文件时销毁重建） */
    private fileEditorPanel: FileEditorPanel | null = null;

    constructor(options: TaskSectionsPanelOptions) {
        super({
            title: t('panel.taskBoardTitle'),
            width: 460,
            closeOnBlur: true,
            // 任务板块面板需要钉住能力：钉住后点击面板外不关闭
            pinnable: true,
            container: options.container,
            onClose: options.onClose,
        });
        this.sectionsOptions = options;
        // 标题栏钉住按钮左侧：跳转到任务详情面板（未提供回调时不显示）
        if (options.onOpenTaskDetail) {
            this.addHeaderAction(
                'square-arrow-up-right',
                t('panel.openTaskDetail'),
                () => {
                    if (this.taskId) this.sectionsOptions.onOpenTaskDetail?.(this.taskId);
                },
                'start',
            );
        }
    }

    /** 打开并展示指定任务 */
    openForTask(taskId: string): void {
        this.taskId = taskId;
        this.section = 'checklist';
        this.fileCreateMode = false;
        this.render();
        this.open();
    }

    /** 重绘面板内容 */
    private render(): void {
        const task = this.taskId ? this.sectionsOptions.getTask(this.taskId) : undefined;
        this.setContent((body) => {
            if (!task) {
                body.createDiv({ cls: 'interface-today-empty', text: t('interface.bottomEmpty') });
                return;
            }
            this.renderHead(body, task);
            this.renderSections(body);
            this.renderContent(body, task);
        });
    }

    /** 第一行：任务名称 + 任务分类 */
    private renderHead(body: HTMLElement, task: PrototypeTask): void {
        const head = body.createDiv({ cls: 'task-sections-head' });
        head.createDiv({ cls: 'task-sections-name', text: task.name });
        const category = task.categoryId
            ? this.sectionsOptions.categories.find((item) => item.id === task.categoryId)
            : undefined;
        const pill = head.createDiv({ cls: 'task-sections-category' });
        const dot = pill.createSpan({ cls: 'task-sections-category-dot' });
        dot.style.background = category?.color ?? '#888888';
        pill.createSpan({
            cls: 'task-sections-category-label',
            text: category?.label ?? t('defaultCategory.uncategorized'),
        });
    }

    /** 第二行：板块选项卡 */
    private renderSections(body: HTMLElement): void {
        const tabs = body.createDiv({ cls: 'task-sections-tabs' });
        for (const item of TASK_SECTIONS) {
            const button = tabs.createEl('button', {
                cls: 'interface-bottom-tab',
                text: t(item.labelKey),
                attr: { type: 'button' },
            });
            button.toggleClass('is-active', this.section === item.key);
            button.addEventListener('click', () => {
                if (this.section === item.key) return;
                this.section = item.key;
                this.fileCreateMode = false;
                this.render();
            });
        }
    }

    /** 板块内容 */
    private renderContent(body: HTMLElement, task: PrototypeTask): void {
        const content = body.createDiv({ cls: 'task-sections-body' });

        if (this.section === 'checklist') {
            const items = task.checklist ?? [];
            if (items.length === 0) {
                content.createDiv({ cls: 'interface-today-empty', text: t('interface.bottomEmpty') });
                return;
            }
            // 未完成在前、已完成沉底
            const ordered = [
                ...items.filter((item) => !item.done),
                ...items.filter((item) => item.done),
            ];
            for (const item of ordered) this.renderChecklistRow(content, item);
            return;
        }

        this.renderFileToolbar(content, task);
        if (this.fileCreateMode) this.renderFileCreateRow(content, task);

        const files = listTaskFiles(this.sectionsOptions.app, task.fileDir);
        if (!task.fileDir) {
            content.createDiv({ cls: 'interface-today-empty', text: t('interface.bottomNoFolder') });
            return;
        }
        if (files.length === 0) {
            content.createDiv({ cls: 'interface-today-empty', text: t('interface.bottomEmpty') });
            return;
        }
        for (const file of files) {
            const row = this.createItemRow(content, 'file-text', file.name);
            row.title = file.path;
            row.addClass('is-clickable');
            row.addEventListener('click', () => this.openTaskFile(file));
        }
    }

    /** 文件目录操作栏：时间戳开关 / 绑定目录 / 添加文件（与任务详情面板的「任务文件」一致） */
    private renderFileToolbar(parentEl: HTMLElement, task: PrototypeTask): void {
        const toolbar = parentEl.createDiv({ cls: 'task-detail-files-toolbar' });

        // 启用时间戳开关
        const switchWrap = toolbar.createDiv({ cls: 'task-detail-files-switch' });
        const switchContainer = switchWrap.createDiv({ cls: 'checkbox-container' });
        switchContainer.toggleClass('is-enabled', task.fileTimestamp === true);
        const checkbox = switchContainer.createEl('input');
        checkbox.type = 'checkbox';
        checkbox.checked = task.fileTimestamp === true;
        checkbox.addEventListener('change', () => {
            switchContainer.toggleClass('is-enabled', checkbox.checked);
            task.fileTimestamp = checkbox.checked;
            void this.sectionsOptions.save();
        });
        switchWrap.createSpan({ cls: 'task-detail-files-switch-label', text: t('panel.fileTimestamp') });

        // 绑定目录
        const dirBtn = toolbar.createEl('button', { cls: 'task-detail-files-btn' });
        setIcon(dirBtn.createSpan({ cls: 'task-detail-files-btn-icon' }), 'folder');
        dirBtn.createSpan({ cls: 'task-detail-files-btn-text', text: task.fileDir || t('panel.fileDir') });
        dirBtn.title = task.fileDir || t('panel.fileDir');
        dirBtn.addEventListener('click', () => this.openFileDirPicker(task));

        // 新建文件
        const addBtn = toolbar.createEl('button', { cls: 'task-detail-files-btn' });
        setIcon(addBtn.createSpan({ cls: 'task-detail-files-btn-icon' }), 'plus');
        addBtn.createSpan({ cls: 'task-detail-files-btn-text', text: t('panel.fileAdd') });
        addBtn.addEventListener('click', () => {
            if (!task.fileDir) {
                new Notice(t('panel.fileNoDir'));
                return;
            }
            this.fileCreateMode = true;
            this.render();
        });
    }

    /** 新建文件输入行 */
    private renderFileCreateRow(parentEl: HTMLElement, task: PrototypeTask): void {
        const createRow = parentEl.createDiv({ cls: 'task-detail-files-create' });
        const nameInput = createRow.createEl('input', { cls: 'task-detail-files-create-input' });
        nameInput.type = 'text';
        nameInput.placeholder = t('panel.fileCreatePlaceholder');
        const confirmBtn = createRow.createEl('button', { text: t('panel.fileCreate') });
        const cancelBtn = createRow.createEl('button', { text: t('common.cancel') });
        const submit = (): void => {
            const name = nameInput.value.trim();
            if (!name) return;
            void this.createTaskFile(task, name);
        };
        confirmBtn.addEventListener('click', submit);
        nameInput.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') submit();
            if (evt.key === 'Escape') {
                this.fileCreateMode = false;
                this.render();
            }
        });
        cancelBtn.addEventListener('click', () => {
            this.fileCreateMode = false;
            this.render();
        });
        nameInput.focus();
    }

    /** 打开目录选择面板：确认后写回任务并保存（选择时本面板会失焦关闭，确认后重新打开） */
    private openFileDirPicker(task: PrototypeTask): void {
        const picker = new FolderPickerPanel(this.sectionsOptions.app, {
            onConfirm: (result) => {
                task.fileDir = result.path;
                this.fileCreateMode = false;
                void this.sectionsOptions.save().then(() => {
                    this.render();
                    this.open();
                });
            },
        });
        picker.open();
    }

    /** 在绑定目录下新建 Markdown 文件（启用时间戳时加前缀），并打开内置编辑面板 */
    private async createTaskFile(task: PrototypeTask, name: string): Promise<void> {
        const dir = task.fileDir;
        if (!dir) return;
        const fileName = buildTaskFileName(name, task.fileTimestamp === true);
        if (!fileName) return;
        try {
            const file = await this.sectionsOptions.app.vault.create(`${dir}/${fileName}`, '');
            this.fileCreateMode = false;
            this.render();
            this.openTaskFile(file);
        } catch {
            new Notice(t('panel.fileCreateFailed'));
        }
    }

    /** 打开任务文件：Markdown 使用内置编辑面板，其它类型交给 Obsidian 默认打开方式 */
    private openTaskFile(file: TFile): void {
        if (file.extension !== 'md') {
            void this.sectionsOptions.app.workspace.getLeaf(false).openFile(file);
            return;
        }
        this.fileEditorPanel?.destroy();
        this.fileEditorPanel = new FileEditorPanel({
            app: this.sectionsOptions.app,
            file,
            onClose: () => {
                if (this.taskId) this.render();
            },
        });
        this.fileEditorPanel.open();
    }

    /** 条目行：图标 + 文本 */
    private createItemRow(parentEl: HTMLElement, icon: string, text: string): HTMLElement {
        const row = parentEl.createDiv({ cls: 'interface-bottom-item' });
        setIcon(row.createSpan({ cls: 'interface-bottom-item-icon' }), icon);
        row.createSpan({ cls: 'interface-bottom-item-text', text });
        return row;
    }

    /** 清单条目行：勾选框 + 文本，已完成时显示完成时间 */
    private renderChecklistRow(parentEl: HTMLElement, item: ChecklistItem): void {
        const row = parentEl.createDiv({ cls: 'interface-bottom-item task-sections-todo-row' });
        if (item.done) row.addClass('is-done');
        const checkbox = row.createEl('input', { cls: 'task-sections-todo-checkbox' });
        checkbox.type = 'checkbox';
        checkbox.checked = item.done === true;
        checkbox.addEventListener('change', () => {
            item.done = checkbox.checked;
            // 完成时记录时间戳，取消完成时清除
            if (checkbox.checked) item.completedAt = Date.now();
            else delete item.completedAt;
            void this.sectionsOptions.save().then(() => this.render());
        });
        row.createSpan({ cls: 'interface-bottom-item-text', text: item.text });
        if (item.done && item.completedAt) {
            row.createSpan({
                cls: 'interface-bottom-item-time',
                text: t('panel.checklistCompletedAt', { time: formatCompletedTime(item.completedAt) }),
            });
        }
    }
}

/** 完成时间格式化为 MM-DD HH:MM（清单条目上展示） */
function formatCompletedTime(ts: number): string {
    const d = new Date(ts);
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mo}-${da} ${h}:${mi}`;
}
