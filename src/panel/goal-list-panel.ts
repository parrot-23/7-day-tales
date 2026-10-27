// 目标清单面板：从任务详情面板「目标」设置面板第一行的 + 按钮打开。
// 结构：输入行（输入框 + 新建按钮）+ 工具栏（设置截止时间）+ 目标条目列表（名称 / 截止日期 / 删除）。
import { setIcon } from 'obsidian';

import type { PrototypeTask, TaskGoalEntry } from '../datatypes/prototype-task';
import { getLang, t } from '../i18n';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';

/** 目标清单面板配置 */
export interface GoalListPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 当前任务（直接读写其 goals 字段） */
    task: PrototypeTask;
    /** 数据保存回调（增删改后持久化） */
    save: () => Promise<void>;
    /** 目标变更回调（父面板据此刷新目标方块） */
    onChanged?: () => void;
}

/** 目标清单面板 */
export class GoalListPanel extends FloatingPanel {
    private readonly task: PrototypeTask;
    private readonly save: () => Promise<void>;
    private readonly onChanged?: () => void;
    /** 目标条目列表容器（截止日期编辑行插入到它前面） */
    private listEl!: HTMLElement;
    /** 当前选中的目标条目 id（供「设置截止时间」使用） */
    private selectedGoalId: string | null = null;

    constructor(options: GoalListPanelOptions) {
        super({
            width: 420,
            title: t('panel.goalListTitle'),
            closeOnBlur: true,
            onClose: options.onClose,
        });
        this.task = options.task;
        this.save = options.save;
        this.onChanged = options.onChanged;
        this.body.addClass('goal-list-panel');
        this.render();
    }

    /** 渲染整个面板内容 */
    private render(): void {
        this.body.empty();

        // 第一行：输入框 + 新建按钮
        const inputRow = this.body.createDiv({ cls: 'goal-list-input-row' });
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

        // 第二行：设置截止时间（需先选中条目）
        const toolbar = this.body.createDiv({ cls: 'goal-list-toolbar' });
        const dueBtn = toolbar.createEl('button', {
            cls: 'goal-list-tool-btn',
            text: t('panel.todoSetDue'),
        });
        dueBtn.disabled = !this.selectedGoalId;
        dueBtn.addEventListener('click', () => this.openDueEditor());

        // 第三行起：目标条目
        this.listEl = this.body.createDiv({ cls: 'goal-list' });
        const goals = this.task.goals ?? [];
        if (goals.length === 0) {
            this.listEl.createDiv({ cls: 'goal-list-empty', text: t('panel.goalEmpty') });
            return;
        }
        for (const goal of goals) {
            this.renderRow(goal);
        }
    }

    /** 渲染单个目标条目：名称 + 截止日期 + 删除按钮 */
    private renderRow(goal: TaskGoalEntry): void {
        const row = this.listEl.createDiv({ cls: 'goal-list-item' });
        row.toggleClass('is-selected', this.selectedGoalId === goal.id);
        row.createSpan({ cls: 'goal-list-item-name', text: goal.text });
        if (goal.dueDate) {
            row.createSpan({ cls: 'goal-list-item-due', text: this.formatDue(goal.dueDate) });
        }
        const delBtn = row.createEl('button', {
            cls: 'goal-list-item-delete',
            text: '×',
            attr: { type: 'button' },
        });
        delBtn.addEventListener('click', (evt) => {
            evt.stopPropagation();
            void this.removeGoal(goal.id);
        });
        row.addEventListener('click', () => {
            this.selectedGoalId = this.selectedGoalId === goal.id ? null : goal.id;
            this.render();
        });
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
        this.body.querySelector<HTMLInputElement>('.goal-list-input')?.focus();
    }

    /** 删除目标条目 */
    private async removeGoal(goalId: string): Promise<void> {
        this.task.goals = (this.task.goals ?? []).filter((goal) => goal.id !== goalId);
        if (this.selectedGoalId === goalId) this.selectedGoalId = null;
        await this.save();
        this.onChanged?.();
        this.render();
    }

    /** 选中条目的截止日期编辑行：日期输入框 + 确定 / 清除 / 取消 */
    private openDueEditor(): void {
        const goal = (this.task.goals ?? []).find((item) => item.id === this.selectedGoalId);
        if (!goal) return;
        this.body.querySelector('.goal-list-due-editor')?.remove();
        const editor = this.body.createDiv({ cls: 'goal-list-due-editor' });
        const input = editor.createEl('input', { cls: 'goal-list-due-input' });
        input.type = 'date';
        input.value = goal.dueDate ?? '';
        const commit = (value: string): void => {
            if (value) {
                goal.dueDate = value;
            } else {
                delete goal.dueDate;
            }
            void this.save().then(() => {
                this.onChanged?.();
                this.render();
            });
        };
        const saveBtn = editor.createEl('button', { cls: 'goal-list-tool-btn', text: t('panel.todoDueSave') });
        saveBtn.addEventListener('click', () => commit(input.value));
        const clearBtn = editor.createEl('button', { cls: 'goal-list-tool-btn', text: t('panel.todoDueClear') });
        clearBtn.addEventListener('click', () => {
            input.value = '';
            commit('');
        });
        const cancelBtn = editor.createEl('button', { cls: 'goal-list-tool-btn', text: t('panel.todoDueCancel') });
        cancelBtn.addEventListener('click', () => editor.remove());
        this.body.insertBefore(editor, this.listEl);
        input.focus();
    }

    /** 截止日期展示文案（如「截止日期：10月30日」） */
    private formatDue(dueDate: string): string {
        const due = new Date(`${dueDate}T00:00:00`);
        if (Number.isNaN(due.getTime())) return '';
        const label = getLang() === 'zh'
            ? `${due.getMonth() + 1}月${due.getDate()}日`
            : `${due.getMonth() + 1}/${due.getDate()}`;
        return t('panel.todoDueDateTag', { date: label });
    }
}
