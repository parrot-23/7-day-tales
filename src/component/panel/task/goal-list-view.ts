// 目标清单视图：嵌入任务详情面板「目标」选项卡。
// 结构：输入行（输入框 + 新建按钮）+ 目标条目列表。
// 条目两行：第一行名称 + 悬停操作图标，第二行展示绑定的子任务与截止日期。
import { setIcon } from 'obsidian';

import type { PrototypeTask, TaskGoalEntry } from '../../../datatypes/prototype-task';
import { getLang, t } from '../../../i18n';
import { DatePickerPopover } from '../basic/date-picker-popover';
import { TaskPickerPanel } from './task-picker-panel';

/** 目标清单视图配置 */
export interface GoalListViewOptions {
    /** 当前任务（直接读写其 goals 字段） */
    task: PrototypeTask;
    /** 全部任务数据源（解析已绑定子任务、提供可绑定的后代候选） */
    getTasks: () => PrototypeTask[];
    /** 数据保存回调（增删改后持久化） */
    save: () => Promise<void>;
    /** 目标变更回调（父面板据此刷新目标方块） */
    onChanged?: () => void;
}

/** 目标清单视图 */
export class GoalListView {
    private readonly container: HTMLElement;
    private readonly task: PrototypeTask;
    private readonly getTasks: () => PrototypeTask[];
    private readonly save: () => Promise<void>;
    private readonly onChanged?: () => void;
    /** 目标条目列表容器 */
    private listEl!: HTMLElement;

    constructor(container: HTMLElement, options: GoalListViewOptions) {
        this.container = container;
        this.task = options.task;
        this.getTasks = options.getTasks;
        this.save = options.save;
        this.onChanged = options.onChanged;
        this.container.addClass('goal-list-view');
        this.render();
    }

    /** 渲染整个视图 */
    private render(): void {
        this.container.empty();

        // 第一行：输入框 + 新建按钮
        const inputRow = this.container.createDiv({ cls: 'goal-list-input-row' });
        const input = inputRow.createEl('input', { cls: 'goal-list-input' });
        input.type = 'text';
        input.placeholder = t('panel.goalAddPlaceholder');
        const addBtn = inputRow.createEl('button', {
            cls: 'goal-list-add-btn',
            attr: { type: 'button', 'aria-label': t('panel.goalListTitle') },
        });
        setIcon(addBtn, 'plus');
        const submit = (): void => void this.addGoal(input);
        addBtn.addEventListener('click', submit);
        input.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') submit();
        });

        // 第二行起：目标条目
        this.listEl = this.container.createDiv({ cls: 'goal-list' });
        const goals = this.task.goals ?? [];
        if (goals.length === 0) {
            this.listEl.createDiv({ cls: 'goal-list-empty', text: t('panel.goalEmpty') });
            return;
        }
        for (const goal of goals) {
            this.renderRow(goal);
        }
    }

    /** 渲染单个目标条目：第一行名称 + 操作图标，第二行绑定的子任务与截止日期 */
    private renderRow(goal: TaskGoalEntry): void {
        const row = this.listEl.createDiv({ cls: 'goal-list-item' });

        const main = row.createDiv({ cls: 'goal-list-item-main' });
        setIcon(main.createSpan({ cls: 'goal-list-item-icon' }), 'target');
        main.createSpan({ cls: 'goal-list-item-name', text: goal.text });

        const boundTasks = this.boundTasks(goal);

        // 截止日期标签：紧贴操作图标左侧，位于日历图标左边
        if (goal.dueDate) this.renderDueTag(main, goal);

        // 悬停时显示：设置截止时间 / 绑定子任务 / 删除
        const actions = main.createDiv({ cls: 'goal-list-item-actions' });
        this.createAction(actions, 'calendar', t('panel.checklistSetDue'), false, (button) => {
            this.openDuePicker(goal, button);
        });
        this.createAction(actions, 'link-2', t('panel.goalBindSubtask'), boundTasks.length > 0, () => {
            this.openSubtaskPicker(goal);
        });
        this.createAction(actions, 'x', t('common.delete'), false, () => void this.removeGoal(goal.id));

        // 第二行：绑定的子任务标签（没有绑定时不占位）
        if (boundTasks.length === 0) return;
        const meta = row.createDiv({ cls: 'goal-list-item-meta' });
        for (const task of boundTasks) {
            const tag = meta.createSpan({ cls: 'goal-list-item-subtask', attr: { title: task.name } });
            setIcon(tag.createSpan({ cls: 'goal-list-item-subtask-icon' }), 'git-branch');
            tag.createSpan({ cls: 'goal-list-item-subtask-name', text: task.name });
        }
    }

    /** 截止日期标签：悬浮时末尾出现清除按钮 */
    private renderDueTag(parentEl: HTMLElement, goal: TaskGoalEntry): void {
        const due = parentEl.createSpan({ cls: 'goal-list-item-due' });
        due.createSpan({ text: this.formatDue(goal.dueDate ?? '') });
        const clearBtn = due.createSpan({
            cls: 'goal-list-item-due-clear',
            text: '×',
            attr: { role: 'button', 'aria-label': t('panel.checklistDueClear') },
        });
        clearBtn.addEventListener('click', (evt) => {
            evt.stopPropagation();
            delete goal.dueDate;
            void this.save().then(() => {
                this.onChanged?.();
                this.render();
            });
        });
    }

    /** 条目末尾的操作图标按钮 */
    private createAction(
        parentEl: HTMLElement,
        icon: string,
        label: string,
        active: boolean,
        onClick: (button: HTMLButtonElement) => void,
    ): HTMLButtonElement {
        const button = parentEl.createEl('button', {
            cls: 'goal-list-item-action',
            attr: { type: 'button', 'aria-label': label, title: label },
        });
        button.toggleClass('is-active', active);
        setIcon(button, icon);
        button.addEventListener('click', (evt) => {
            evt.stopPropagation();
            onClick(button);
        });
        return button;
    }

    /** 绑定子任务：复用任务选择面板（多选，限定在当前任务的后代里） */
    private openSubtaskPicker(goal: TaskGoalEntry): void {
        const picker: TaskPickerPanel = new TaskPickerPanel({
            title: t('panel.goalBindSubtask'),
            getTasks: this.getTasks,
            scopeTaskId: this.task.id,
            multiple: true,
            initialSelectedIds: (goal.subtaskIds ?? []).filter((id) => this.findTask(id)),
            onClose: () => picker.destroy(),
            onSelect: (taskIds) => {
                if (taskIds.length > 0) goal.subtaskIds = taskIds;
                else delete goal.subtaskIds;
                void this.save().then(() => {
                    this.onChanged?.();
                    this.render();
                });
            },
        });
        picker.open();
    }

    /** 设置截止时间：在图标下方弹出自绘日历，不额外占一行 */
    private openDuePicker(goal: TaskGoalEntry, anchor: HTMLElement): void {
        const popover: DatePickerPopover = new DatePickerPopover({
            anchor,
            value: goal.dueDate,
            onSelect: (value) => {
                goal.dueDate = value;
                void this.save().then(() => {
                    this.onChanged?.();
                    this.render();
                });
            },
            onClose: () => popover.destroy(),
        });
        popover.open();
    }

    /** 新增目标条目 */
    private async addGoal(input: HTMLInputElement): Promise<void> {
        const text = input.value.trim();
        if (!text) return;
        const entry: TaskGoalEntry = {
            id: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            text,
            createdAt: Date.now(),
        };
        this.task.goals = [...(this.task.goals ?? []), entry];
        await this.save();
        this.onChanged?.();
        this.render();
        this.container.querySelector<HTMLInputElement>('.goal-list-input')?.focus();
    }

    /** 删除目标条目 */
    private async removeGoal(goalId: string): Promise<void> {
        this.task.goals = (this.task.goals ?? []).filter((goal) => goal.id !== goalId);
        await this.save();
        this.onChanged?.();
        this.render();
    }

    /** 目标已绑定的子任务（指向已删除任务时自动忽略） */
    private boundTasks(goal: TaskGoalEntry): PrototypeTask[] {
        const byId = new Map(this.getTasks().map((task) => [task.id, task]));
        return (goal.subtaskIds ?? [])
            .map((id) => byId.get(id))
            .filter((task): task is PrototypeTask => task !== undefined);
    }

    /** 按 id 查找任务 */
    private findTask(taskId?: string): PrototypeTask | undefined {
        if (!taskId) return undefined;
        return this.getTasks().find((item) => item.id === taskId);
    }

    /** 截止日期展示文案（如「截止日期：10月30日」） */
    private formatDue(dueDate: string): string {
        const due = new Date(`${dueDate}T00:00:00`);
        if (Number.isNaN(due.getTime())) return '';
        const label = getLang() === 'zh'
            ? `${due.getMonth() + 1}月${due.getDate()}日`
            : `${due.getMonth() + 1}/${due.getDate()}`;
        return t('panel.checklistDueDateTag', { date: label });
    }
}
