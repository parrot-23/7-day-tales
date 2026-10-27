// 计划面板：基于 FloatingPanel，用于配置计划。
// 结构：左侧（顶部根任务下拉 + 选中根任务的后代任务树）+ 右侧（年 / 周选项卡，对应 52 周日历与一周七列日历）。
// 排布：选中左侧任务条目后，点击周视图的某一天列，即可把该任务排布到该列（写入 PlanAssignmentRepo）。
import { setIcon } from 'obsidian';

import type { PrototypeTask, TaskGoalEntry, TaskHabit, WeekGoalRef } from '../datatypes/prototype-task';
import type { TaskStatus } from '../datatypes/domain';
import { t } from '../i18n';
import type { PlanAssignmentRepo } from '../repos/plan-assignment-repo';
import type { PlanCategory } from '../shared/plan-category-manager';
import { getCurrentWeekKey, makeDayKeyFromWeek, makeWeekKey, parseWeekKey, shiftWeekKey } from '../shared/plan-data';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';
import { GoalAssignmentPanel, type GoalCandidateGroup } from './goal-assignment-panel';

/** 计划面板配置 */
export interface PlanPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「计划」 */
    title?: string;
    /** 任务数据源（每次打开时重新读取，保证与其他视图一致） */
    getTasks: () => PrototypeTask[];
    /** 分类数据源（任务信息面板显示分类名称与颜色） */
    getCategories: () => PlanCategory[];
    /** 计划排布数据仓库（点击周视图列时写入） */
    planAssignmentRepo: PlanAssignmentRepo;
    /** 数据保存回调（排布写入后持久化） */
    save: () => Promise<void>;
    /** 排布变更回调（界面视图「今天任务」方框据此刷新） */
    onChanged?: () => void;
    /** 初始周键，默认本周 */
    initialWeekKey?: string;
}

/** 任务信息面板的状态选项（图标 + 文案，点击可切换） */
const STATUS_OPTIONS: {
    value: TaskStatus;
    icon: string;
    labelKey: 'taskPlan.statusNotStarted' | 'taskPlan.statusInProgress' | 'taskPlan.statusDone' | 'taskPlan.statusPaused';
}[] = [
    { value: 'notStarted', icon: 'circle', labelKey: 'taskPlan.statusNotStarted' },
    { value: 'inProgress', icon: 'play', labelKey: 'taskPlan.statusInProgress' },
    { value: 'done', icon: 'check-circle', labelKey: 'taskPlan.statusDone' },
    { value: 'paused', icon: 'pause', labelKey: 'taskPlan.statusPaused' },
];

/** 周一至周日的文案 key */
const WEEKDAY_KEYS = [
    'week.monday',
    'week.tuesday',
    'week.wednesday',
    'week.thursday',
    'week.friday',
    'week.saturday',
    'week.sunday',
] as const;

/** 一年显示的周数 */
const WEEKS_PER_YEAR = 52;

/** 右侧选项卡 */
type PlanTab = 'year' | 'week';

/** 计划面板 */
export class PlanPanel extends FloatingPanel {
    private rootSelectEl!: HTMLSelectElement;
    private treeEl!: HTMLElement;
    private paneEl!: HTMLElement;
    private yearTabEl!: HTMLElement;
    private weekTabEl!: HTMLElement;
    /** 左侧底部工具栏的「任务信息」按钮 */
    private infoButtonEl!: HTMLButtonElement;
    /** 左侧底部工具栏的「设置习惯」按钮（仅在周视图渲染） */
    private habitButtonEl: HTMLButtonElement | null = null;
    /** 年视图日期切换行右侧的「目标」按钮 */
    private goalButtonEl: HTMLButtonElement | null = null;
    /** 右侧底部的任务信息面板 */
    private infoPanelEl!: HTMLElement;
    /** 右侧底部的习惯设置面板 */
    private habitPanelEl!: HTMLElement;
    /** 右侧底部的周目标面板 */
    private goalPanelEl!: HTMLElement;
    /** 「任务信息」是否处于激活状态 */
    private infoActive = false;
    /** 「设置习惯」是否处于激活状态 */
    private habitActive = false;
    /** 「目标」是否处于激活状态 */
    private goalActive = false;
    /** 周目标分配面板（由「目标」面板的「分配」按钮打开） */
    private goalPicker: GoalAssignmentPanel | null = null;
    /** 年视图中当前高亮的周（1-52，未选择时为 null） */
    private selectedYearWeek: number | null = null;

    /** 当前选项卡 */
    private tab: PlanTab = 'year';
    /** 年视图当前年份 */
    private year: number;
    /** 周视图当前周键 */
    private weekKey: string;
    /** 下拉选中的根任务 id */
    private rootTaskId: string | undefined;
    /** 任务树中选中的任务 id（选中后可点击右侧周视图列进行排布） */
    private selectedTaskId: string | undefined;

    constructor(private readonly panelOptions: PlanPanelOptions) {
        super({
            width: 900,
            title: panelOptions.title ?? t('panel.planPanelTitle'),
            ...panelOptions,
        });
        this.body.addClass('plan-panel');
        this.weekKey = panelOptions.initialWeekKey ?? getCurrentWeekKey();
        this.year = parseWeekKey(this.weekKey).year;
        this.renderLayout();
    }

    /** 每次打开时刷新任务数据，避免任务面板新增后下拉不更新 */
    override open(): void {
        this.refreshRootSelect();
        this.renderInfoPanel();
        this.renderHabitPanel();
        this.renderGoalPanel();
        super.open();
    }

    /** 关闭计划面板时一并销毁周目标分配面板 */
    override close(): void {
        this.goalPicker?.destroy();
        this.goalPicker = null;
        super.close();
    }

    private renderLayout(): void {
        // 左侧：根任务下拉 + 任务树
        const left = this.body.createDiv({ cls: 'plan-left' });
        this.rootSelectEl = left.createEl('select', { cls: 'dropdown plan-root-select' });
        this.rootSelectEl.addEventListener('change', () => {
            this.rootTaskId = this.rootSelectEl.value || undefined;
            this.selectedTaskId = undefined;
            this.renderTree();
            this.renderInfoPanel();
        });
        this.treeEl = left.createDiv({ cls: 'plan-tree' });
        this.treeEl.addEventListener('click', (evt) => {
            const row = (evt.target as HTMLElement).closest('.task-detail-tree-row') as HTMLElement | null;
            const taskId = row?.dataset.taskId;
            if (!taskId) return;
            // 再次点击已选中的条目则取消选中
            if (taskId === this.selectedTaskId) {
                this.clearTaskSelection();
            } else {
                this.selectTask(taskId);
            }
        });

        // 左侧底部工具栏：「任务信息」开关
        const toolbar = left.createDiv({ cls: 'plan-left-toolbar' });
        this.infoButtonEl = toolbar.createEl('button', { cls: 'plan-toolbar-btn' });
        const infoIconEl = this.infoButtonEl.createSpan({ cls: 'plan-toolbar-btn-icon' });
        setIcon(infoIconEl, 'info');
        this.infoButtonEl.createSpan({ cls: 'plan-toolbar-btn-text', text: t('panel.planTaskInfo') });
        this.infoButtonEl.addEventListener('click', () => this.toggleInfoPanel());

        // 右侧：年 / 周选项卡（图标 + 文字）+ 对应内容
        const right = this.body.createDiv({ cls: 'plan-right' });
        const tabs = right.createDiv({ cls: 'plan-tabs' });
        this.yearTabEl = tabs.createDiv({ cls: 'plan-tab' });
        setIcon(this.yearTabEl.createSpan({ cls: 'plan-tab-icon' }), 'calendar-days');
        this.yearTabEl.createSpan({ cls: 'plan-tab-text', text: t('panel.planYearTab') });
        this.weekTabEl = tabs.createDiv({ cls: 'plan-tab' });
        setIcon(this.weekTabEl.createSpan({ cls: 'plan-tab-icon' }), 'calendar-range');
        this.weekTabEl.createSpan({ cls: 'plan-tab-text', text: t('panel.planWeekTab') });
        this.yearTabEl.addEventListener('click', () => this.switchTab('year'));
        this.weekTabEl.addEventListener('click', () => this.switchTab('week'));

        this.paneEl = right.createDiv({ cls: 'plan-pane' });
        // 右侧底部：任务信息面板（默认隐藏，由左侧工具栏按钮控制）
        this.infoPanelEl = right.createDiv({ cls: 'plan-info-panel is-hidden' });
        // 右侧底部：习惯设置面板（与信息面板共用同一位置，互斥显示）
        this.habitPanelEl = right.createDiv({ cls: 'plan-info-panel plan-habit-panel is-hidden' });
        // 右侧底部：周目标面板（与信息 / 习惯面板共用同一位置，互斥显示）
        this.goalPanelEl = right.createDiv({ cls: 'plan-info-panel plan-goal-panel is-hidden' });
        this.switchTab(this.tab);
        this.refreshRootSelect();
    }

    /** 重建根任务下拉（顶层任务 = 无父任务的主线/支线） */
    private refreshRootSelect(): void {
        const roots = this.panelOptions.getTasks().filter((task) => !task.parentId);
        if (!roots.some((task) => task.id === this.rootTaskId)) {
            this.rootTaskId = roots[0]?.id;
        }
        this.rootSelectEl.empty();
        if (roots.length === 0) {
            const option = this.rootSelectEl.createEl('option', { text: t('panel.planNoTask') });
            option.value = '';
            this.rootTaskId = undefined;
        } else {
            for (const task of roots) {
                const option = this.rootSelectEl.createEl('option', { text: task.name });
                option.value = task.id;
            }
            this.rootSelectEl.value = this.rootTaskId ?? '';
        }
        this.renderTree();
    }

    /** 渲染选中根任务（含根任务自身）的任务树 */
    private renderTree(): void {
        this.treeEl.empty();
        if (!this.rootTaskId) return;
        const rootTask = this.panelOptions.getTasks().find((task) => task.id === this.rootTaskId);
        if (rootTask) this.renderTreeRow(this.treeEl, rootTask, 0);
        this.renderTreeNodes(this.treeEl, this.rootTaskId, 1);
    }

    private renderTreeNodes(parentEl: HTMLElement, parentId: string, depth: number): void {
        const children = this.panelOptions.getTasks().filter((task) => task.parentId === parentId);
        for (const child of children) {
            this.renderTreeRow(parentEl, child, depth);
            this.renderTreeNodes(parentEl, child.id, depth + 1);
        }
    }

    /** 渲染单条任务行（缩进 + 分支图标 + 名称 + 末尾图标） */
    private renderTreeRow(parentEl: HTMLElement, task: PrototypeTask, depth: number): void {
        const row = parentEl.createDiv({ cls: 'task-detail-tree-row' });
        row.style.marginLeft = `${depth * 14}px`;
        row.dataset.taskId = task.id;
        row.toggleClass('is-selected', task.id === this.selectedTaskId);
        const iconEl = row.createSpan({ cls: 'task-detail-tree-icon' });
        setIcon(iconEl, 'git-branch');
        row.createSpan({ cls: 'task-detail-tree-label', text: task.name });
        this.renderTrailingIcon(row, task);
    }

    /**
     * 渲染任务行末尾图标：
     * - 「设置习惯」激活时：已启用习惯 → repeat，未启用 → 不显示；
     * - 否则：按任务状态显示（未开始不显示）。
     */
    private renderTrailingIcon(row: HTMLElement, task: PrototypeTask): void {
        row.querySelector('.plan-tree-status-icon')?.remove();
        row.querySelector('.plan-tree-goal-badge')?.remove();
        // 目标面板激活时，末尾显示目标图标 + 该任务自身目标数量（为 0 不显示）
        if (this.goalActive) {
            const count = task.goals?.length ?? 0;
            if (count > 0) {
                const badge = row.createSpan({ cls: 'plan-tree-goal-badge' });
                const iconEl = badge.createSpan({ cls: 'plan-tree-goal-icon' });
                setIcon(iconEl, 'target');
                badge.createSpan({ cls: 'plan-tree-goal-count', text: String(count) });
            }
            return;
        }
        let icon: string | null = null;
        if (this.habitActive) {
            icon = task.habit?.enabled ? 'repeat' : null;
        } else if (task.status && task.status !== 'notStarted') {
            icon = this.getStatusIcon(task.status);
        }
        if (!icon) return;
        const statusEl = row.createSpan({ cls: 'plan-tree-status-icon' });
        setIcon(statusEl, icon);
    }

    /** 按当前激活的面板刷新所有任务行的末尾图标 */
    private refreshTreeTrailingIcons(): void {
        const tasks = this.panelOptions.getTasks();
        this.treeEl.querySelectorAll('.task-detail-tree-row').forEach((el) => {
            const row = el as HTMLElement;
            const task = tasks.find((item) => item.id === row.dataset.taskId);
            if (task) this.renderTrailingIcon(row, task);
        });
    }

    /** 任务状态对应的图标（与任务信息面板保持一致） */
    private getStatusIcon(status: TaskStatus | undefined): string {
        return STATUS_OPTIONS.find((option) => option.value === (status ?? 'notStarted'))?.icon
            ?? STATUS_OPTIONS[0].icon;
    }

    /** 状态切换后同步任务条目末尾的图标 */
    private updateTreeRowStatusIcon(taskId: string): void {
        const row = this.treeEl.querySelector(
            `.task-detail-tree-row[data-task-id="${taskId}"]`,
        ) as HTMLElement | null;
        const task = this.panelOptions.getTasks().find((item) => item.id === taskId);
        if (row && task) this.renderTrailingIcon(row, task);
    }

    /** 选中任务条目（高亮，并让周视图的列进入可排布状态） */
    private selectTask(taskId: string): void {
        this.selectedTaskId = taskId;
        this.treeEl.querySelectorAll('.task-detail-tree-row').forEach((el) => {
            const row = el as HTMLElement;
            row.toggleClass('is-selected', row.dataset.taskId === taskId);
        });
        this.paneEl.querySelectorAll('.plan-week-column, .plan-year-cell').forEach((el) => {
            (el as HTMLElement).toggleClass('is-assignable', true);
        });
        this.renderInfoPanel();
        this.renderHabitPanel();
        this.renderGoalPanel();
        this.refreshYearChipHighlight();
    }

    /** 取消选中任务条目（清除高亮与周格子可排布状态） */
    private clearTaskSelection(): void {
        this.selectedTaskId = undefined;
        this.treeEl.querySelectorAll('.task-detail-tree-row').forEach((el) => {
            (el as HTMLElement).removeClass('is-selected');
        });
        this.paneEl.querySelectorAll('.plan-week-column, .plan-year-cell').forEach((el) => {
            (el as HTMLElement).removeClass('is-assignable');
        });
        this.renderInfoPanel();
        this.renderHabitPanel();
        this.renderGoalPanel();
        this.refreshYearChipHighlight();
    }

    /** 切换「任务信息」激活状态 */
    private toggleInfoPanel(): void {
        this.infoActive = !this.infoActive;
        // 三个面板共用右侧底部位置，互斥显示
        if (this.infoActive) {
            this.setHabitActive(false);
            this.setGoalActive(false);
        }
        this.infoButtonEl.toggleClass('is-active', this.infoActive);
        // 信息面板决定年视图事件卡片是否高亮
        this.refreshYearChipHighlight();
        // 激活时若尚未选中任务，默认选中当前根任务，保证信息面板一定可见
        if (this.infoActive && !this.selectedTaskId && this.rootTaskId) {
            this.selectTask(this.rootTaskId);
            return;
        }
        this.renderInfoPanel();
    }

    /** 切换「设置习惯」激活状态 */
    private toggleHabitPanel(): void {
        this.habitActive = !this.habitActive;
        // 三个面板共用右侧底部位置，互斥显示
        if (this.habitActive) {
            this.setInfoActive(false);
            this.setGoalActive(false);
        }
        this.habitButtonEl?.toggleClass('is-active', this.habitActive);
        this.refreshTreeTrailingIcons();
        this.renderPane();
        // 激活时若尚未选中任务，默认选中当前根任务，保证习惯面板一定可见
        if (this.habitActive && !this.selectedTaskId && this.rootTaskId) {
            this.selectTask(this.rootTaskId);
            return;
        }
        this.renderHabitPanel();
    }

    /** 设置信息面板激活状态（不触发选中逻辑） */
    private setInfoActive(active: boolean): void {
        this.infoActive = active;
        this.infoButtonEl.toggleClass('is-active', active);
        this.refreshYearChipHighlight();
        this.renderInfoPanel();
    }

    /** 设置习惯面板激活状态（不触发选中逻辑） */
    private setHabitActive(active: boolean): void {
        this.habitActive = active;
        this.habitButtonEl?.toggleClass('is-active', active);
        this.refreshTreeTrailingIcons();
        this.renderPane();
        this.renderHabitPanel();
    }

    /** 切换「目标」激活状态 */
    private toggleGoalPanel(): void {
        this.goalActive = !this.goalActive;
        // 三个面板共用右侧底部位置，互斥显示
        if (this.goalActive) {
            this.setInfoActive(false);
            this.setHabitActive(false);
        }
        this.goalButtonEl?.toggleClass('is-active', this.goalActive);
        // 目标面板决定年视图事件卡片是否高亮，以及任务条目末尾是否显示目标数量
        this.refreshYearChipHighlight();
        this.refreshTreeTrailingIcons();
        // 激活时若尚未选中任务，默认选中当前根任务，保证目标面板一定可见
        if (this.goalActive && !this.selectedTaskId && this.rootTaskId) {
            this.selectTask(this.rootTaskId);
            return;
        }
        this.renderGoalPanel();
    }

    /** 设置目标面板激活状态（不触发选中逻辑） */
    private setGoalActive(active: boolean): void {
        this.goalActive = active;
        this.goalButtonEl?.toggleClass('is-active', active);
        this.refreshYearChipHighlight();
        this.refreshTreeTrailingIcons();
        this.renderGoalPanel();
    }

    /** 渲染任务信息面板第一行（颜色圆点 + 任务名称 + 分类；目标面板额外追加周标签与分配按钮） */
    private renderTaskHead(
        parentEl: HTMLElement,
        task: PrototypeTask,
        goal?: { weekLabel: string; onAssign: () => void },
    ): void {
        const head = parentEl.createDiv({ cls: 'plan-info-head' });
        const category = this.panelOptions.getCategories()
            .find((item) => item.id === task.categoryId);
        const dot = head.createSpan({ cls: 'plan-info-dot' });
        dot.style.background = category?.color ?? '#888888';
        head.createSpan({ cls: 'plan-info-name', text: task.name });
        head.createSpan({
            cls: 'plan-info-category',
            text: category?.label ?? t('defaultCategory.uncategorized'),
        });
        if (goal) {
            head.createSpan({ cls: 'plan-goal-week-badge', text: goal.weekLabel });
            const assignBtn = head.createEl('button', {
                cls: 'plan-goal-assign-btn',
                attr: { type: 'button' },
                text: t('panel.planGoalAssign'),
            });
            assignBtn.addEventListener('click', goal.onAssign);
        }
    }

    /** 渲染右侧底部的任务信息面板（未激活或未选中任务时隐藏） */
    private renderInfoPanel(): void {
        const task = this.selectedTaskId
            ? this.panelOptions.getTasks().find((item) => item.id === this.selectedTaskId)
            : undefined;
        this.infoPanelEl.empty();
        const visible = this.infoActive && !!task;
        this.infoPanelEl.toggleClass('is-hidden', !visible);
        if (!visible || !task) return;

        this.renderTaskHead(this.infoPanelEl, task);

        // 第二行：任务状态（图标 + 文字，点击切换并保存）
        const statusRow = this.infoPanelEl.createDiv({ cls: 'plan-info-status' });
        const currentStatus = task.status ?? 'notStarted';
        for (const option of STATUS_OPTIONS) {
            const button = statusRow.createEl('button', {
                cls: 'plan-info-status-btn',
                attr: { type: 'button' },
            });
            const iconEl = button.createSpan({ cls: 'plan-info-status-icon' });
            setIcon(iconEl, option.icon);
            button.createSpan({ cls: 'plan-info-status-text', text: t(option.labelKey) });
            button.toggleClass('is-active', option.value === currentStatus);
            button.addEventListener('click', () => {
                task.status = option.value;
                void this.panelOptions.save();
                this.updateTreeRowStatusIcon(task.id);
                this.renderInfoPanel();
                this.panelOptions.onChanged?.();
            });
        }
    }

    /** 渲染右侧底部的习惯设置面板（未激活或未选中任务时隐藏） */
    private renderHabitPanel(): void {
        const task = this.selectedTaskId
            ? this.panelOptions.getTasks().find((item) => item.id === this.selectedTaskId)
            : undefined;
        this.habitPanelEl.empty();
        const visible = this.habitActive && this.tab === 'week' && !!task;
        this.habitPanelEl.toggleClass('is-hidden', !visible);
        if (!visible || !task) return;

        this.renderTaskHead(this.habitPanelEl, task);

        const habit = this.getHabit(task);

        // 第二行：开关 + 图标 + 文字（启用习惯）
        const enableRow = this.habitPanelEl.createDiv({ cls: 'plan-habit-enable' });
        const switchEl = enableRow.createDiv({ cls: 'checkbox-container' });
        const switchInput = switchEl.createEl('input', { type: 'checkbox' });
        switchInput.checked = habit.enabled;
        // Obsidian 的开关圆球位置由容器的 is-enabled 类控制，而不是 input:checked
        switchEl.toggleClass('is-enabled', habit.enabled);
        const enableIconEl = enableRow.createSpan({ cls: 'plan-habit-enable-icon' });
        setIcon(enableIconEl, 'repeat');
        enableRow.createSpan({ cls: 'plan-habit-enable-text', text: t('panel.planHabitEnable') });
        switchInput.addEventListener('change', () => {
            this.saveHabit(task, { enabled: switchInput.checked });
            this.refreshTreeTrailingIcons();
            this.renderHabitPanel();
        });

        // 第三 / 四行：时间 + 星期（仅启用后可配置）
        const config = this.habitPanelEl.createDiv({ cls: 'plan-habit-config' });
        config.toggleClass('is-disabled', !habit.enabled);

        const timeRow = config.createDiv({ cls: 'plan-habit-time-row' });
        timeRow.createSpan({ cls: 'plan-habit-time-label', text: t('panel.planHabitTime') });
        const timeInput = timeRow.createEl('input', {
            cls: 'plan-habit-time',
            type: 'time',
        });
        timeInput.value = habit.time;
        timeInput.disabled = !habit.enabled;
        timeInput.addEventListener('change', () => {
            this.saveHabit(task, { time: timeInput.value || '09:00' });
        });

        const daysRow = config.createDiv({ cls: 'plan-habit-days' });
        for (let day = 1; day <= 7; day += 1) {
            const button = daysRow.createEl('button', {
                cls: 'plan-habit-day',
                attr: { type: 'button' },
                text: t(WEEKDAY_KEYS[day - 1]),
            });
            button.toggleClass('is-active', habit.weekdays.includes(day));
            button.disabled = !habit.enabled;
            button.addEventListener('click', () => {
                const current = this.getHabit(task);
                const weekdays = current.weekdays.includes(day)
                    ? current.weekdays.filter((item) => item !== day)
                    : [...current.weekdays, day].sort((a, b) => a - b);
                this.saveHabit(task, { weekdays });
                button.toggleClass('is-active', weekdays.includes(day));
            });
        }
    }

    /** 目标面板当前作用的周：年视图优先使用选中的周格子 */
    private getActiveWeekKey(): string {
        if (this.tab === 'year' && this.selectedYearWeek !== null) {
            return makeWeekKey(this.year, this.selectedYearWeek);
        }
        return this.weekKey;
    }

    /** 渲染右侧底部的周目标面板（未激活或未选中任务时隐藏，仅显示已分配到当前周的待办） */
    private renderGoalPanel(): void {
        const task = this.selectedTaskId
            ? this.panelOptions.getTasks().find((item) => item.id === this.selectedTaskId)
            : undefined;
        this.goalPanelEl.empty();
        const visible = this.goalActive && this.tab === 'year' && !!task;
        this.goalPanelEl.toggleClass('is-hidden', !visible);
        if (!visible || !task) return;

        const weekKey = this.getActiveWeekKey();
        const { week } = parseWeekKey(weekKey);
        this.renderTaskHead(this.goalPanelEl, task, {
            weekLabel: t('panel.planWeekLabel', { week: String(week) }),
            onAssign: () => this.openGoalPicker(task, weekKey),
        });

        // 仅显示已绑定到当前周的目标（可来自当前任务或祖先任务）
        const refs = this.getWeekGoalRefs(task, weekKey);
        const tasks = this.panelOptions.getTasks();
        const bound = refs
            .map((ref) => {
                const owner = tasks.find((item) => item.id === ref.taskId);
                const goal = owner?.goals?.find((item) => item.id === ref.goalId);
                return goal && owner ? { ref, goal, owner } : null;
            })
            .filter(
                (item): item is { ref: WeekGoalRef; goal: TaskGoalEntry; owner: PrototypeTask } =>
                    item !== null,
            );
        const list = this.goalPanelEl.createDiv({ cls: 'plan-goal-list' });
        if (bound.length === 0) {
            list.createDiv({ cls: 'plan-goal-empty', text: t('panel.planGoalEmpty') });
            return;
        }
        for (const { ref, goal, owner } of bound) {
            this.renderGoalRow(
                list,
                goal.text,
                owner.id === task.id ? null : owner.name,
                () => this.setWeekGoalSelected(task, ref, false, weekKey),
            );
        }
    }

    /** 打开周目标选择面板：候选目标为当前任务自身及各祖先任务的目标 */
    private openGoalPicker(task: PrototypeTask, weekKey: string): void {
        this.goalPicker?.destroy();
        const { week } = parseWeekKey(weekKey);
        this.goalPicker = new GoalAssignmentPanel({
            taskName: task.name,
            weekLabel: t('panel.planWeekLabel', { week: String(week) }),
            groups: this.buildGoalGroups(task),
            selectedRefs: this.getWeekGoalRefs(task, weekKey),
            onToggle: (ref, selected) => {
                this.setWeekGoalSelected(task, ref, selected, weekKey);
            },
            onClose: () => {
                this.goalPicker = null;
            },
        });
        this.goalPicker.open();
    }

    /** 当前任务 + 各祖先任务的目标分组（自身在前，父级依次在后） */
    private buildGoalGroups(task: PrototypeTask): GoalCandidateGroup[] {
        const tasks = this.panelOptions.getTasks();
        const groups: GoalCandidateGroup[] = [];
        const visited = new Set<string>();
        let current: PrototypeTask | undefined = task;
        while (current && !visited.has(current.id)) {
            visited.add(current.id);
            groups.push({ taskId: current.id, taskName: current.name, goals: current.goals ?? [] });
            const parentId: string | undefined = current.parentId;
            current = parentId ? tasks.find((item) => item.id === parentId) : undefined;
        }
        return groups;
    }

    /** 周目标条目行：目标文本 +（父级目标时）所属任务标签 + 末尾「已分配」标签（点击取消绑定） */
    private renderGoalRow(
        parentEl: HTMLElement,
        text: string,
        ownerName: string | null,
        onClick: () => void,
    ): void {
        const row = parentEl.createDiv({ cls: 'plan-goal-item is-selected' });
        row.createSpan({ cls: 'plan-goal-item-text', text });
        if (ownerName) {
            row.createSpan({ cls: 'plan-goal-owner-tag', text: ownerName });
        }
        row.createSpan({ cls: 'plan-goal-assigned-tag', text: t('panel.planGoalAssigned') });
        row.addEventListener('click', onClick);
    }

    /** 读取某任务在指定周已绑定的目标引用（默认当前作用的周） */
    private getWeekGoalRefs(task: PrototypeTask, weekKey = this.getActiveWeekKey()): WeekGoalRef[] {
        return task.weekGoals?.find((goal) => goal.weekKey === weekKey)?.goalRefs ?? [];
    }

    /** 绑定 / 取消绑定某个目标到指定周并持久化 */
    private setWeekGoalSelected(
        task: PrototypeTask,
        ref: WeekGoalRef,
        selected: boolean,
        weekKey = this.getActiveWeekKey(),
    ): void {
        const goals = task.weekGoals ?? [];
        const current = goals.find((goal) => goal.weekKey === weekKey);
        const refs = current?.goalRefs ?? [];
        const exists = refs.some((item) => item.taskId === ref.taskId && item.goalId === ref.goalId);
        const nextRefs = selected
            ? (exists ? refs : [...refs, ref])
            : refs.filter((item) => !(item.taskId === ref.taskId && item.goalId === ref.goalId));
        if (current) {
            current.goalRefs = nextRefs;
        } else {
            goals.push({ weekKey, goalRefs: nextRefs });
        }
        task.weekGoals = goals;
        void this.panelOptions.save();
        this.panelOptions.onChanged?.();
        this.renderGoalPanel();
    }

    /** 读取任务习惯设置（未设置时返回默认值） */
    private getHabit(task: PrototypeTask): TaskHabit {
        return task.habit ?? { enabled: false, time: '09:00', weekdays: [1, 2, 3, 4, 5, 6, 7] };
    }

    /** 写入任务习惯设置并持久化 */
    private saveHabit(task: PrototypeTask, patch: Partial<TaskHabit>): void {
        task.habit = { ...this.getHabit(task), ...patch };
        void this.panelOptions.save();
        // 习惯激活时周日历展示的是习惯，改动后需要同步重绘
        if (this.habitActive) this.renderPane();
        this.panelOptions.onChanged?.();
    }

    /** 切换年 / 周选项卡 */
    private switchTab(tab: PlanTab): void {
        this.tab = tab;
        this.yearTabEl.toggleClass('is-active', tab === 'year');
        this.weekTabEl.toggleClass('is-active', tab === 'week');
        this.renderPane();
        this.renderGoalPanel();
        this.renderHabitPanel();
        this.refreshYearChipHighlight();
    }

    private renderPane(): void {
        this.paneEl.empty();
        if (this.tab === 'year') {
            this.renderYearPane();
        } else {
            this.renderWeekPane();
        }
    }

    /** 年视图：年度选择行 + 52 周（7 列 × 8 行，点击周格子把选中任务整周排布） */
    private renderYearPane(): void {
        const nav = this.paneEl.createDiv({ cls: 'plan-nav-row' });
        this.createNavButton(nav, '←', () => {
            this.year -= 1;
            this.selectedYearWeek = null;
            this.renderPane();
            this.renderGoalPanel();
        });
        nav.createSpan({ cls: 'plan-nav-label', text: t('panel.planYearLabel', { year: String(this.year) }) });
        this.createNavButton(nav, '→', () => {
            this.year += 1;
            this.selectedYearWeek = null;
            this.renderPane();
            this.renderGoalPanel();
        });
        // 日期切换旁：「目标」开关（仅年视图）
        this.goalButtonEl = this.createNavToggle(nav, 'target', t('panel.planWeekGoal'), this.goalActive, () => this.toggleGoalPanel());

        const current = parseWeekKey(getCurrentWeekKey());
        const tasks = new Map(this.panelOptions.getTasks().map((task) => [task.id, task]));
        const grid = this.paneEl.createDiv({ cls: 'plan-year-grid' });
        for (let week = 1; week <= WEEKS_PER_YEAR; week++) {
            const weekKey = makeWeekKey(this.year, week);
            const cell = grid.createDiv({ cls: 'plan-year-cell' });
            if (current.year === this.year && current.week === week) cell.addClass('is-current');
            cell.toggleClass('is-selected', this.selectedYearWeek === week);
            cell.toggleClass('is-assignable', this.selectedTaskId !== undefined);
            cell.dataset.week = String(week);
            // 该周进入新的月份时，在左上角标注月份
            const weekStart = makeDayKeyFromWeek(weekKey, 1);
            const prevWeekStart = makeDayKeyFromWeek(shiftWeekKey(weekKey, -1), 1);
            const month = Number(weekStart.slice(5, 7));
            if (month !== Number(prevWeekStart.slice(5, 7))) {
                cell.createDiv({ cls: 'plan-year-cell-month', text: `${month}月` });
            }
            cell.createDiv({ cls: 'plan-year-cell-label', text: `W${String(week).padStart(2, '0')}` });

            // 已整周排布的任务卡片（点击卡片选中左侧对应任务，× 移除该周排布）
            const assignments = this.panelOptions.planAssignmentRepo.weekAssignments(weekKey);
            if (assignments.length > 0) {
                const list = cell.createDiv({ cls: 'plan-year-cell-tasks' });
                for (const assignment of assignments) {
                    const task = tasks.get(assignment.taskId);
                    if (!task) continue;
                    const chip = list.createDiv({ cls: 'plan-year-cell-task', text: task.name });
                    chip.title = task.name;
                    chip.dataset.taskId = task.id;
                    // 信息 / 目标面板激活时，高亮下方正在展示的任务 / 周对应的卡片
                    chip.toggleClass('is-highlighted', this.isYearChipHighlighted(week, task.id));
                    chip.addEventListener('click', (evt) => {
                        evt.stopPropagation();
                        this.selectTask(task.id);
                        this.selectedYearWeek = week;
                        this.renderPane();
                        this.renderGoalPanel();
                    });
                    const del = chip.createSpan({ cls: 'plan-year-cell-task-del', text: '×' });
                    del.addEventListener('click', (evt) => {
                        evt.stopPropagation();
                        this.panelOptions.planAssignmentRepo.removeWeek(weekKey, task.id);
                        void this.panelOptions.save();
                        this.renderPane();
                        this.panelOptions.onChanged?.();
                    });
                }
            }

            cell.addEventListener('click', () => this.assignSelectedTaskToWeek(week));
        }
    }

    /** 年历事件卡片是否需要高亮：信息 / 目标面板激活，且该卡片属于左侧选中任务、位于选中的周 */
    private isYearChipHighlighted(week: number, taskId: string): boolean {
        return (this.infoActive || (this.goalActive && this.tab === 'year'))
            && this.selectedYearWeek === week
            && taskId === this.selectedTaskId;
    }

    /** 按当前面板与选中的任务 / 周刷新年历事件卡片的高亮 */
    private refreshYearChipHighlight(): void {
        this.paneEl.querySelectorAll('.plan-year-cell').forEach((el) => {
            const cell = el as HTMLElement;
            const week = Number(cell.dataset.week);
            cell.querySelectorAll('.plan-year-cell-task').forEach((chipEl) => {
                const chip = chipEl as HTMLElement;
                chip.toggleClass('is-highlighted', this.isYearChipHighlighted(week, chip.dataset.taskId ?? ''));
            });
        });
    }

    /** 点击年视图周格子：高亮该周；若左侧已选中任务则整周排布 */
    private assignSelectedTaskToWeek(week: number): void {
        this.selectedYearWeek = week;
        if (this.selectedTaskId) {
            this.panelOptions.planAssignmentRepo.addWeek(makeWeekKey(this.year, week), this.selectedTaskId);
            void this.panelOptions.save();
            this.panelOptions.onChanged?.();
        }
        this.renderPane();
        this.renderGoalPanel();
    }

    /** 周视图：周数选择行 + 一周七列日历 */
    private renderWeekPane(): void {
        const { week } = parseWeekKey(this.weekKey);
        const nav = this.paneEl.createDiv({ cls: 'plan-nav-row' });
        this.createNavButton(nav, '←', () => {
            this.weekKey = shiftWeekKey(this.weekKey, -1);
            this.year = parseWeekKey(this.weekKey).year;
            this.renderPane();
            this.renderGoalPanel();
        });
        nav.createSpan({ cls: 'plan-nav-label', text: t('panel.planWeekLabel', { week: String(week) }) });
        this.createNavButton(nav, '→', () => {
            this.weekKey = shiftWeekKey(this.weekKey, 1);
            this.year = parseWeekKey(this.weekKey).year;
            this.renderPane();
            this.renderGoalPanel();
        });
        // 日期切换旁：「习惯」开关（仅周视图）
        this.habitButtonEl = this.createNavToggle(nav, 'repeat', t('panel.planSetHabit'), this.habitActive, () => this.toggleHabitPanel());

        // 与周计划视图一致：表头一行 7 格，表体 7 列共用分隔线
        const grid = this.paneEl.createDiv({ cls: 'plan-week-grid' });
        const headerRow = grid.createDiv({ cls: 'plan-week-header' });
        const columnsRow = grid.createDiv({ cls: 'plan-week-columns' });
        // 任务卡片跨列合并：先算出同一任务连续排布的区段与所在行（泳道）
        const segments = this.habitActive ? [] : this.buildWeekSegments();
        const laneCount = segments.reduce((max, item) => Math.max(max, item.lane + 1), 0);
        columnsRow.style.gridTemplateRows = laneCount > 0
            ? `repeat(${laneCount}, min-content) 1fr`
            : '1fr';
        for (let col = 0; col < 7; col++) {
            const dayKey = makeDayKeyFromWeek(this.weekKey, col + 1);
            const header = headerRow.createDiv({ cls: 'plan-week-header-cell' });
            // 当天进入新的月份时，在左上角标注月份
            const month = Number(dayKey.slice(5, 7));
            if (month !== this.getPreviousDayMonth(dayKey)) {
                header.createSpan({ cls: 'plan-week-header-month', text: `${month}月` });
            }
            header.createSpan({ cls: 'plan-week-header-name', text: t(WEEKDAY_KEYS[col]) });
            header.createSpan({
                cls: 'plan-week-header-date',
                text: `${month}/${Number(dayKey.slice(8, 10))}`,
            });
            // 日列作为背景层，跨满所有行：负责点击排布、分隔线与悬停反馈
            const column = columnsRow.createDiv({ cls: 'plan-week-column' });
            column.style.gridColumn = String(col + 1);
            column.style.gridRow = '1 / -1';
            column.dataset.weekday = String(col + 1);
            column.toggleClass('is-assignable', this.selectedTaskId !== undefined);
            column.addEventListener('click', () => this.assignSelectedTask(col + 1));
            if (this.habitActive) this.renderHabitWeekColumn(column, col + 1);
        }
        // 卡片层：与日列共用同一网格，按区段跨列显示
        for (const segment of segments) this.renderWeekSegment(columnsRow, segment);
    }

    /** 取指定日期前一天的月份（用于判断当天是否跨入新月份） */
    private getPreviousDayMonth(dayKey: string): number {
        const date = new Date(`${dayKey}T00:00:00`);
        date.setDate(date.getDate() - 1);
        return date.getMonth() + 1;
    }

    /** 周视图中跨列合并的一段任务卡片 */
    private buildWeekSegments(): {
        task: PrototypeTask;
        start: number;
        end: number;
        lane: number;
    }[] {
        const tasks = new Map(this.panelOptions.getTasks().map((task) => [task.id, task]));
        const weekdaysByTask = new Map<string, number[]>();
        for (let weekday = 1; weekday <= 7; weekday += 1) {
            for (const assignment of this.panelOptions.planAssignmentRepo.dayAssignments(this.weekKey, weekday)) {
                if (!tasks.has(assignment.taskId)) continue;
                const days = weekdaysByTask.get(assignment.taskId) ?? [];
                days.push(weekday);
                weekdaysByTask.set(assignment.taskId, days);
            }
        }
        // 同一任务连续的天合并为一段，不连续的拆成多段
        const segments: { task: PrototypeTask; start: number; end: number; lane: number }[] = [];
        weekdaysByTask.forEach((days, taskId) => {
            const task = tasks.get(taskId);
            if (!task) return;
            const sorted = days.slice().sort((a, b) => a - b)
                .filter((day, index, list) => index === 0 || day !== list[index - 1]);
            let start = sorted[0];
            let prev = sorted[0];
            for (let i = 1; i < sorted.length; i += 1) {
                const day = sorted[i];
                if (day === prev + 1) {
                    prev = day;
                    continue;
                }
                segments.push({ task, start, end: prev, lane: 0 });
                start = day;
                prev = day;
            }
            segments.push({ task, start, end: prev, lane: 0 });
        });
        // 依次放入第一条不冲突的泳道，避免卡片互相覆盖
        segments.sort((a, b) => a.start - b.start
            || (b.end - b.start) - (a.end - a.start)
            || a.task.name.localeCompare(b.task.name));
        const lanes: { start: number; end: number }[][] = [];
        for (const segment of segments) {
            let lane = 0;
            while (lanes[lane]?.some((item) => !(item.end < segment.start || item.start > segment.end))) {
                lane += 1;
            }
            (lanes[lane] ??= []).push({ start: segment.start, end: segment.end });
            segment.lane = lane;
        }
        return segments;
    }

    /** 渲染一段跨列任务卡片（第一行父层级，第二行任务名；每列一个删除按钮） */
    private renderWeekSegment(
        parentEl: HTMLElement,
        segment: { task: PrototypeTask; start: number; end: number; lane: number },
    ): void {
        const { task, start, end, lane } = segment;
        const span = end - start + 1;
        const chip = parentEl.createDiv({ cls: 'plan-week-task-chip plan-week-span-chip' });
        chip.style.gridColumn = `${start} / span ${span}`;
        chip.style.gridRow = String(lane + 1);
        const parentPath = this.getParentPath(task);
        chip.title = parentPath ? `${parentPath} > ${task.name}` : task.name;
        // 无父层级（根任务）时第一行留空，保证卡片两行高度一致
        chip.createDiv({ cls: 'plan-week-task-chip-path', text: parentPath });
        chip.createDiv({ cls: 'plan-week-task-chip-name', text: task.name });
        chip.addEventListener('click', (evt) => evt.stopPropagation());

        // 每一列各自一个删除按钮，位置对齐该列右上角；只删除该列的排布
        const delButtons: HTMLElement[] = [];
        for (let offset = 0; offset < span; offset += 1) {
            const weekday = start + offset;
            const del = chip.createSpan({ cls: 'plan-week-task-chip-del plan-week-span-del', text: '×' });
            del.style.right = `calc(${((span - offset - 1) * 100) / span}% + 2px)`;
            del.addEventListener('click', (evt) => {
                evt.stopPropagation();
                this.panelOptions.planAssignmentRepo.remove(this.weekKey, weekday, task.id);
                void this.panelOptions.save();
                this.renderPane();
                this.panelOptions.onChanged?.();
            });
            delButtons.push(del);
        }

        // 鼠标位于卡片内某一列区域时，只显示该列的删除按钮
        chip.addEventListener('mousemove', (evt) => {
            const rect = chip.getBoundingClientRect();
            const columnWidth = rect.width / span;
            const index = Math.max(0, Math.min(span - 1, Math.floor((evt.clientX - rect.left) / columnWidth)));
            delButtons.forEach((button, i) => button.toggleClass('is-visible', i === index));
        });
        chip.addEventListener('mouseleave', () => {
            delButtons.forEach((button) => button.removeClass('is-visible'));
        });
    }

    /** 任务的父层级路径（根任务 > 子任务 …，不含当前任务） */
    private getParentPath(task: PrototypeTask): string {
        const tasks = new Map(this.panelOptions.getTasks().map((item) => [item.id, item]));
        const names: string[] = [];
        let parentId = task.parentId;
        while (parentId) {
            const parent = tasks.get(parentId);
            if (!parent) break;
            names.unshift(parent.name);
            parentId = parent.parentId;
        }
        return names.join(' > ');
    }

    /** 渲染某一天列内生效的习惯（按时间升序，点击卡片选中左侧对应任务） */
    private renderHabitWeekColumn(column: HTMLElement, weekday: number): void {
        const habits: { task: PrototypeTask; habit: TaskHabit }[] = [];
        for (const task of this.panelOptions.getTasks()) {
            if (task.habit?.enabled && task.habit.weekdays.includes(weekday)) {
                habits.push({ task, habit: task.habit });
            }
        }
        habits.sort((a, b) => a.habit.time.localeCompare(b.habit.time)
            || a.task.name.localeCompare(b.task.name));
        for (const { task, habit } of habits) {
            const chip = column.createDiv({ cls: 'plan-week-task-chip plan-week-habit-chip' });
            chip.title = `${habit.time} ${task.name}`;
            chip.createSpan({ cls: 'plan-week-habit-time', text: habit.time });
            chip.createSpan({ cls: 'plan-week-task-chip-name', text: task.name });
            chip.addEventListener('click', (evt) => {
                evt.stopPropagation();
                this.selectTask(task.id);
            });
        }
    }

    /** 把左侧选中的任务排布到点击的列（同一列重复排布同一任务会被仓库忽略） */
    private assignSelectedTask(weekday: number): void {
        if (!this.selectedTaskId) return;
        this.panelOptions.planAssignmentRepo.add(this.weekKey, weekday, this.selectedTaskId);
        void this.panelOptions.save();
        this.renderPane();
        this.panelOptions.onChanged?.();
    }

    private createNavButton(container: HTMLElement, text: string, onClick: () => void): void {
        const button = container.createEl('button', { cls: 'plan-nav-btn', text });
        button.addEventListener('click', onClick);
    }

    /** 日期切换行右侧的开关按钮（图标 + 文字，带激活态） */
    private createNavToggle(
        container: HTMLElement,
        icon: string,
        label: string,
        active: boolean,
        onClick: () => void,
    ): HTMLButtonElement {
        const button = container.createEl('button', { cls: 'plan-toolbar-btn plan-nav-toggle', attr: { type: 'button' } });
        setIcon(button.createSpan({ cls: 'plan-toolbar-btn-icon' }), icon);
        button.createSpan({ cls: 'plan-toolbar-btn-text', text: label });
        button.toggleClass('is-active', active);
        button.addEventListener('click', onClick);
        return button;
    }
}
