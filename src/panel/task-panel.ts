// 任务面板：基于 FloatingPanel 的任务添加入口。
// 上方两个大按钮（图标 + 文字）：添加主线任务 / 添加支线任务；
// 点击后展开表单：任务名称输入 + 一行归属方块（收集篮子 / 待办改进清单 / OKR 篮子 / 任务文件）。
import { setIcon } from 'obsidian';

import type { PrototypeTask } from '../datatypes/prototype-task';
import { t } from '../i18n';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';

/** 任务类型：主线 / 支线 */
export type TaskPanelTaskType = 'main' | 'side';

/** 提交数据 */
export interface TaskPanelSubmitPayload {
    type: TaskPanelTaskType;
    name: string;
}

/** 任务面板配置 */
export interface TaskPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「任务」 */
    title?: string;
    /** 点击确认后的回调 */
    onSubmit?: (payload: TaskPanelSubmitPayload) => void;
    /** 已有的主线 / 支线任务（用于展示） */
    tasks?: PrototypeTask[];
    /** 点击已有任务方块的回调 */
    onTaskClick?: (task: PrototypeTask) => void;
}

/** 归属方块定义（仅展示，不参与选择） */
const TARGETS: { icon: string; labelKey: Parameters<typeof t>[0] }[] = [
    { icon: 'inbox', labelKey: 'panel.targetInbox' },
    { icon: 'list-checks', labelKey: 'panel.targetTodo' },
    { icon: 'check-square', labelKey: 'panel.targetFormCheck' },
    { icon: 'target', labelKey: 'panel.targetOkr' },
    { icon: 'file-text', labelKey: 'panel.targetFile' },
];

/** 任务面板 */
export class TaskPanel extends FloatingPanel {
    private panelOptions: TaskPanelOptions;
    private formEl!: HTMLElement;
    private inputEl!: HTMLInputElement;
    private typeSelectEl!: HTMLSelectElement;
    private existingEl!: HTMLElement;

    constructor(options: TaskPanelOptions = {}) {
        super({
            width: 520,
            title: options.title ?? t('panel.taskPanelTitle'),
            ...options,
        });
        this.panelOptions = options;
        this.renderContent();
    }

    /** 渲染任务方块区 + 表单区 */
    private renderContent(): void {
        const body = this.body;
        body.addClass('task-panel');

        // 已有任务方块，末尾跟一个「+」添加按钮
        this.existingEl = body.createDiv({ cls: 'task-panel-existing' });
        this.setTasks(this.panelOptions.tasks ?? []);

        // 表单：默认隐藏，点击「+」后展开
        this.formEl = body.createDiv({ cls: 'task-panel-form' });
        this.formEl.style.display = 'none';

        // 第一行：任务名称 + 类型下拉（主线 / 支线）
        const nameRow = this.formEl.createDiv({ cls: 'task-panel-name-row' });
        this.inputEl = nameRow.createEl('input', { cls: 'task-panel-input' });
        this.inputEl.type = 'text';
        this.inputEl.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') this.submit();
        });
        this.typeSelectEl = nameRow.createEl('select', { cls: 'dropdown task-panel-type-select' });
        this.typeSelectEl.createEl('option', { text: t('panel.mainTaskBadge'), value: 'main' });
        this.typeSelectEl.createEl('option', { text: t('panel.sideTaskBadge'), value: 'side' });
        this.typeSelectEl.addEventListener('change', () => this.syncPlaceholder());

        // 第二行：归属方块（仅展示）
        const targets = this.formEl.createDiv({ cls: 'task-panel-targets' });
        for (const target of TARGETS) {
            const el = targets.createDiv({ cls: 'task-panel-target' });
            const iconEl = el.createDiv({ cls: 'task-panel-target-icon' });
            setIcon(iconEl, target.icon);
            el.createDiv({ cls: 'task-panel-target-label', text: t(target.labelKey) });
        }

        // 底部：取消 / 确认
        const footer = this.formEl.createDiv({ cls: 'task-panel-form-footer' });
        const cancelBtn = footer.createEl('button', { text: t('common.cancel') });
        cancelBtn.addEventListener('click', () => this.hideForm());
        const confirmBtn = footer.createEl('button', {
            cls: 'mod-cta',
            text: t('common.confirm'),
        });
        confirmBtn.addEventListener('click', () => this.submit());
    }

    /** 刷新已有任务方块（末尾始终保留「+」添加按钮） */
    setTasks(tasks: PrototypeTask[]): void {
        this.existingEl.empty();
        for (const task of tasks) {
            const el = this.existingEl.createDiv({
                cls: `task-panel-existing-item is-${task.type}`,
            });
            el.setAttribute('title', task.name);
            const iconEl = el.createDiv({ cls: 'task-panel-existing-icon' });
            setIcon(iconEl, task.type === 'main' ? 'star' : 'git-branch');
            el.createDiv({ cls: 'task-panel-existing-label', text: task.name });
            el.createDiv({
                cls: 'task-panel-existing-type',
                text: t(task.type === 'main' ? 'panel.mainTaskBadge' : 'panel.sideTaskBadge'),
            });
            if (this.panelOptions.onTaskClick) {
                el.addClass('is-clickable');
                el.addEventListener('click', () => this.panelOptions.onTaskClick?.(task));
            }
        }

        // 末尾「+」按钮：与任务方块同尺寸
        const addEl = this.existingEl.createDiv({ cls: 'task-panel-existing-item task-panel-add-item' });
        addEl.setAttribute('title', t('panel.addTask'));
        const addIconEl = addEl.createDiv({ cls: 'task-panel-existing-icon' });
        setIcon(addIconEl, 'plus');
        addEl.addEventListener('click', () => this.showForm());
    }

    /** 展开表单，默认类型为主线任务 */
    private showForm(): void {
        this.typeSelectEl.value = 'main';
        this.syncPlaceholder();
        this.formEl.style.display = 'flex';
        this.inputEl.focus();
    }

    /** 按下拉选中的类型更新占位文案 */
    private syncPlaceholder(): void {
        this.inputEl.placeholder = this.typeSelectEl.value === 'side'
            ? t('panel.sideTaskName')
            : t('panel.mainTaskName');
    }

    /** 收起表单 */
    private hideForm(): void {
        this.formEl.style.display = 'none';
        this.inputEl.value = '';
    }

    /** 确认提交 */
    private submit(): void {
        const name = this.inputEl.value.trim();
        if (!name) {
            this.inputEl.focus();
            return;
        }
        this.panelOptions.onSubmit?.({
            type: this.typeSelectEl.value === 'side' ? 'side' : 'main',
            name,
        });
        this.hideForm();
        this.close();
    }
}