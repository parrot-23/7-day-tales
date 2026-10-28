// 任务板块信息面板：基于 FloatingPanel 展示单个任务的收集篮子 / 待办改进 / 文件目录。
// 第一行显示任务名称与任务分类；入口为点击「今日任务」卡片中的任务条目。
import { setIcon } from 'obsidian';
import type { App } from 'obsidian';

import type { PrototypeTask } from '../../datatypes/prototype-task';
import { t } from '../../i18n';
import type { FloatingPanelOptions } from './floating-panel';
import { FloatingPanel } from './floating-panel';

/** 板块 key */
type TaskSectionKey = 'basket' | 'todo' | 'file';

/** 板块：顺序与文案 */
const TASK_SECTIONS: { key: TaskSectionKey; labelKey: Parameters<typeof t>[0] }[] = [
    { key: 'basket', labelKey: 'interface.bottomTabBasket' },
    { key: 'todo', labelKey: 'interface.bottomTabTodo' },
    { key: 'file', labelKey: 'interface.bottomTabFile' },
];

/** 任务板块信息面板配置 */
export interface TaskSectionsPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    app: App;
    /** 按 id 读取任务（每次都从仓库读最新数据） */
    getTask: (taskId: string) => PrototypeTask | undefined;
    /** 分类列表（用于第一行显示任务分类） */
    categories: { id: string; label: string; color?: string }[];
}

export class TaskSectionsPanel extends FloatingPanel {
    private readonly sectionsOptions: TaskSectionsPanelOptions;
    /** 当前展示的任务 id */
    private taskId: string | null = null;
    /** 当前板块 */
    private section: TaskSectionKey = 'basket';

    constructor(options: TaskSectionsPanelOptions) {
        super({
            title: t('panel.taskBoardTitle'),
            width: 460,
            closeOnBlur: true,
            container: options.container,
            onClose: options.onClose,
        });
        this.sectionsOptions = options;
    }

    /** 打开并展示指定任务 */
    openForTask(taskId: string): void {
        this.taskId = taskId;
        this.section = 'basket';
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
                this.render();
            });
        }
    }

    /** 板块内容 */
    private renderContent(body: HTMLElement, task: PrototypeTask): void {
        const content = body.createDiv({ cls: 'task-sections-body' });

        if (this.section === 'basket') {
            const items = task.basket ?? [];
            if (items.length === 0) {
                content.createDiv({ cls: 'interface-today-empty', text: t('interface.bottomEmpty') });
                return;
            }
            for (const item of items) this.createItemRow(content, 'inbox', item.text);
            return;
        }

        if (this.section === 'todo') {
            const items = task.improvements ?? [];
            if (items.length === 0) {
                content.createDiv({ cls: 'interface-today-empty', text: t('interface.bottomEmpty') });
                return;
            }
            for (const item of items) {
                const row = this.createItemRow(content, item.done ? 'check-circle' : 'circle', item.text);
                if (item.done) row.addClass('is-done');
            }
            return;
        }

        const files = this.listTaskFiles(task.fileDir);
        if (files.length === 0) {
            content.createDiv({
                cls: 'interface-today-empty',
                text: task.fileDir ? t('interface.bottomEmpty') : t('interface.bottomNoFolder'),
            });
            return;
        }
        for (const file of files) {
            const row = this.createItemRow(content, 'file-text', file.name);
            row.title = file.path;
        }
    }

    /** 条目行：图标 + 文本 */
    private createItemRow(parentEl: HTMLElement, icon: string, text: string): HTMLElement {
        const row = parentEl.createDiv({ cls: 'interface-bottom-item' });
        setIcon(row.createSpan({ cls: 'interface-bottom-item-icon' }), icon);
        row.createSpan({ cls: 'interface-bottom-item-text', text });
        return row;
    }

    /** 任务文件目录下的一级文件（按修改时间倒序） */
    private listTaskFiles(dir: string | undefined): { name: string; path: string }[] {
        if (!dir) return [];
        return this.sectionsOptions.app.vault.getFiles()
            .filter((file) => file.parent?.path === dir)
            .sort((a, b) => b.stat.mtime - a.stat.mtime);
    }
}
