// 任务面板：基于 FloatingPanel 的任务添加入口。
// 布局从上到下：第一行输入框 + 类型下拉 + 添加按钮；第二行归属方块（收集篮子 / 待办改进等）；
// 最下方为已有任务的单行列表（主线 / 支线用左侧颜色竖条区分）。
import { setIcon } from 'obsidian';

import type { PrototypeTask } from '../../datatypes/prototype-task';
import { t } from '../../i18n';
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
    /** 点击已有任务条目的回调 */
    onTaskClick?: (task: PrototypeTask) => void;
    /** 切换已有任务类型（主线 / 支线）的回调 */
    onChangeTaskType?: (task: PrototypeTask, type: TaskPanelTaskType) => void;
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
    private inputEl!: HTMLInputElement;
    private typeSelectEl!: HTMLSelectElement;
    private existingEl!: HTMLElement;
    /** 类型切换下拉（挂在 body 上，保证层级高于悬浮面板） */
    private typeMenuEl: HTMLElement | null = null;
    private typeMenuCleanup: (() => void) | null = null;

    constructor(options: TaskPanelOptions = {}) {
        super({
            width: 520,
            ...options,
            title: options.title ?? t('panel.taskPanelTitle'),
            onClose: () => {
                this.closeTypeMenu();
                options.onClose?.();
            },
        });
        this.panelOptions = options;
        this.renderContent();
    }

    /** 渲染输入区 + 归属方块 + 已有任务列表 */
    private renderContent(): void {
        const body = this.body;
        body.addClass('task-panel');

        // 第一行：任务名称输入 + 类型下拉 + 添加按钮（常显）
        const nameRow = body.createDiv({ cls: 'task-panel-name-row' });
        this.inputEl = nameRow.createEl('input', { cls: 'task-panel-input' });
        this.inputEl.type = 'text';
        this.inputEl.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') this.submit();
        });

        this.typeSelectEl = nameRow.createEl('select', { cls: 'dropdown task-panel-type-select' });
        this.typeSelectEl.createEl('option', { text: t('panel.mainTaskBadge'), value: 'main' });
        this.typeSelectEl.createEl('option', { text: t('panel.sideTaskBadge'), value: 'side' });
        this.typeSelectEl.addEventListener('change', () => this.syncPlaceholder());
        this.syncPlaceholder();

        const addBtn = nameRow.createEl('button', {
            cls: 'mod-cta task-panel-add-btn',
            text: t('panel.addTask'),
        });
        addBtn.addEventListener('click', () => this.submit());

        // 第二行：归属方块（仅展示，压缩高度）
        const targets = body.createDiv({ cls: 'task-panel-targets' });
        for (const target of TARGETS) {
            const el = targets.createDiv({ cls: 'task-panel-target' });
            const iconEl = el.createDiv({ cls: 'task-panel-target-icon' });
            setIcon(iconEl, target.icon);
            el.createDiv({ cls: 'task-panel-target-label', text: t(target.labelKey) });
        }

        // 已有任务：单行列表
        this.existingEl = body.createDiv({ cls: 'task-panel-existing' });
        this.setTasks(this.panelOptions.tasks ?? []);
    }

    /** 刷新已有任务列表 */
    setTasks(tasks: PrototypeTask[]): void {
        this.existingEl.empty();
        for (const task of tasks) {
            const el = this.existingEl.createDiv({ cls: `task-panel-existing-item is-${task.type}` });
            el.setAttribute('title', task.name);

            // 左侧方块：图标 + 任务名称
            const tileEl = el.createDiv({ cls: 'task-panel-task-tile' });
            const iconEl = tileEl.createDiv({ cls: 'task-panel-task-icon' });
            setIcon(iconEl, task.type === 'main' ? 'star' : 'git-branch');
            tileEl.createDiv({ cls: 'task-panel-task-name', text: task.name });

            // 右侧：任务描述（无描述时显示占位文案）
            const bodyEl = el.createDiv({ cls: 'task-panel-task-body' });
            const hasDescription = Boolean(task.description && task.description.trim());
            bodyEl.createDiv({
                cls: `task-panel-task-desc${hasDescription ? '' : ' is-empty'}`,
                text: hasDescription ? task.description! : t('panel.noDescription'),
            });

            // 最右侧：类型标签（可点击下拉切换）
            const typeEl = el.createDiv({
                cls: `task-panel-task-type${this.panelOptions.onChangeTaskType ? ' is-switchable' : ''}`,
            });
            typeEl.createSpan({ text: t(task.type === 'main' ? 'panel.mainTaskBadge' : 'panel.sideTaskBadge') });
            if (this.panelOptions.onChangeTaskType) {
                setIcon(typeEl.createSpan({ cls: 'task-panel-task-type-caret' }), 'chevron-down');
                typeEl.addEventListener('click', (evt) => {
                    evt.stopPropagation();
                    this.openTypeMenu(evt, typeEl, task);
                });
            }

            if (this.panelOptions.onTaskClick) {
                el.addClass('is-clickable');
                el.addEventListener('click', () => this.panelOptions.onTaskClick?.(task));
            }
        }
    }

    /** 在类型标签下方弹出切换菜单（自绘，层级高于悬浮面板） */
    private openTypeMenu(evt: MouseEvent, anchor: HTMLElement, task: PrototypeTask): void {
        evt.stopPropagation();
        this.closeTypeMenu();

        const menu = document.body.createDiv({ cls: 'task-panel-type-menu' });
        const renderOption = (type: TaskPanelTaskType, labelKey: 'panel.mainTaskBadge' | 'panel.sideTaskBadge') => {
            const isActive = task.type === type;
            const item = menu.createDiv({ cls: `task-panel-type-menu-item${isActive ? ' is-active' : ''}` });
            item.createSpan({ text: t(labelKey) });
            if (isActive) setIcon(item.createSpan({ cls: 'task-panel-type-menu-check' }), 'check');
            item.addEventListener('click', (itemEvt) => {
                itemEvt.stopPropagation();
                this.closeTypeMenu();
                if (!isActive) this.panelOptions.onChangeTaskType?.(task, type);
            });
        };
        renderOption('main', 'panel.mainTaskBadge');
        renderOption('side', 'panel.sideTaskBadge');

        // 右对齐到标签右边缘，展开在标签下方
        const rect = anchor.getBoundingClientRect();
        menu.style.top = `${Math.round(rect.bottom + 4)}px`;
        menu.style.right = `${Math.round(Math.max(8, window.innerWidth - rect.right))}px`;

        // 点击菜单外、按 Esc、面板滚动时关闭
        const onPointerDown = (downEvt: PointerEvent) => {
            const target = downEvt.target as Node | null;
            if (target && menu.contains(target)) return;
            this.closeTypeMenu();
        };
        const onKeyDown = (keyEvt: KeyboardEvent) => {
            if (keyEvt.key === 'Escape') this.closeTypeMenu();
        };
        const onScroll = () => this.closeTypeMenu();
        window.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('scroll', onScroll, true);
        this.typeMenuCleanup = () => {
            window.removeEventListener('pointerdown', onPointerDown, true);
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('scroll', onScroll, true);
        };
        this.typeMenuEl = menu;
    }

    /** 关闭类型切换下拉 */
    private closeTypeMenu(): void {
        this.typeMenuCleanup?.();
        this.typeMenuCleanup = null;
        this.typeMenuEl?.remove();
        this.typeMenuEl = null;
    }

    /** 按下拉选中的类型更新占位文案 */
    private syncPlaceholder(): void {
        this.inputEl.placeholder = this.typeSelectEl.value === 'side'
            ? t('panel.sideTaskName')
            : t('panel.mainTaskName');
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
        this.inputEl.value = '';
        this.close();
    }
}
