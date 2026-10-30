// 计划面板：基于 FloatingPanel，用于配置计划。
// 结构：左侧（顶部根任务下拉 + 选中根任务的后代任务树）+ 右侧（年 / 周选项卡，对应 52 周日历与一周七列日历）。
// 排布：选中左侧任务条目后，点击周视图的某一天列，即可把该任务排布到该列（写入 PlanAssignmentRepo）。
import { setIcon } from 'obsidian';

import type { PrototypeTask, TaskGoalEntry, TaskHabit } from '../../../datatypes/prototype-task';
import type { TaskStatus } from '../../../datatypes/domain';
import { t } from '../../../i18n';
import type { PlanAssignmentRepo } from '../../../repos/plan-assignment-repo';
import type { PlanCategory } from '../../../shared/plan-category-manager';
import { getCurrentWeekKey, makeDayKeyFromWeek, makeWeekKey, parseWeekKey, shiftWeekKey } from '../../../shared/plan-data';
import { applyThemeColors, getCurrentThemeColors } from '../../../themestory/theme-colors';
import { FloatingPanel, type FloatingPanelOptions } from '../basic/floating-panel';

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
    /** 点击标题栏跳转图标：在任务详情面板中打开左侧选中的任务 */
    onOpenTaskDetail?: (taskId: string) => void;
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
    /** 右侧底部的任务信息面板 */
    private infoPanelEl!: HTMLElement;
    /** 右侧底部的习惯设置面板 */
    private habitPanelEl!: HTMLElement;
    /** 「任务信息」是否处于激活状态 */
    private infoActive = false;
    /** 「设置习惯」是否处于激活状态 */
    private habitActive = false;
    /** 年视图中当前高亮的周（1-52，未选择时为 null） */
    private selectedYearWeek: number | null = null;
    /** 周格子信息浮层（选中周格子时贴在格子右侧） */
    private weekPopoverEl: HTMLElement | null = null;
    /** 浮层当前展示的周（1-52，null 表示未显示） */
    private popoverWeek: number | null = null;
    /** 周视图日期行末尾的「周任务」按钮 */
    private weekTaskButtonEl: HTMLButtonElement | null = null;
    /** 「周任务」是否处于激活状态（激活时在按钮右侧展开任务面板） */
    private weekTaskActive = false;
    /** 周任务面板（贴在「周任务」按钮右侧） */
    private weekTaskPanelEl: HTMLElement | null = null;

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
    /** 标题栏「跳转到任务详情」按钮（仅在提供回调时创建） */
    private detailButtonEl: HTMLElement | null = null;

    /** 点击浮层外关闭（周格子内的点击交给格子点击逻辑处理，避免先关闭再重开） */
    private readonly onWeekPopoverOutside = (evt: MouseEvent): void => {
        if (!this.weekPopoverEl) return;
        const target = evt.target;
        if (!(target instanceof Element)) return;
        if (this.weekPopoverEl.contains(target)) return;
        if (target.closest('.plan-year-cell')) return;
        this.closeWeekPopover();
    };

    private readonly onWeekPopoverKeyDown = (evt: KeyboardEvent): void => {
        if (evt.key === 'Escape') this.closeWeekPopover();
    };

    /** 面板滚动 / 窗口缩放时重新贴合周格子 */
    private readonly onWeekPopoverReposition = (): void => {
        this.placeWeekPopover();
    };

    /** 面板滚动 / 窗口缩放时重新贴合周任务面板 */
    private readonly onWeekTaskReposition = (): void => {
        this.placeWeekTaskPanel();
    };

    /** 拖动计划面板时重新贴合周任务面板（拖动只改面板位置，不触发 scroll / resize） */
    private readonly onWeekTaskDragReposition = (): void => {
        if (this.weekTaskPanelEl) this.placeWeekTaskPanel();
    };

    constructor(private readonly panelOptions: PlanPanelOptions) {
        super({
            width: 900,
            title: panelOptions.title ?? t('panel.planPanelTitle'),
            ...panelOptions,
        });
        this.body.addClass('plan-panel');
        this.weekKey = panelOptions.initialWeekKey ?? getCurrentWeekKey();
        this.year = parseWeekKey(this.weekKey).year;
        // 标题栏钉住按钮左侧：跳转到任务详情面板（未提供回调时不显示）
        if (panelOptions.onOpenTaskDetail) {
            this.detailButtonEl = this.addHeaderAction(
                'square-arrow-up-right',
                t('panel.openTaskDetail'),
                () => {
                    if (this.selectedTaskId) this.panelOptions.onOpenTaskDetail?.(this.selectedTaskId);
                },
                'start',
            );
            this.updateDetailButton();
        }
        this.renderLayout();
    }

    /** 每次打开时刷新任务数据，避免任务面板新增后下拉不更新 */
    override open(): void {
        this.refreshRootSelect();
        this.renderInfoPanel();
        this.renderHabitPanel();
        super.open();
    }

    /** 关闭面板时一并关闭周格子信息浮层与周任务面板 */
    override close(): void {
        this.closeWeekPopover();
        this.closeWeekTaskPanel();
        super.close();
    }

    /** 销毁面板时移除挂在 body 上的周格子信息浮层与周任务面板 */
    override destroy(): void {
        this.closeWeekPopover();
        this.closeWeekTaskPanel();
        super.destroy();
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
        this.refreshYearChipHighlight();
        this.refreshWeekTaskSelection();
        this.updateDetailButton();
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
        this.refreshYearChipHighlight();
        this.refreshWeekTaskSelection();
        this.updateDetailButton();
    }

    /** 同步标题栏「跳转到任务详情」按钮的显隐：未选中任务时隐藏 */
    private updateDetailButton(): void {
        this.detailButtonEl?.toggleClass('is-hidden', !this.selectedTaskId);
    }

    /** 切换「任务信息」激活状态 */
    private toggleInfoPanel(): void {
        this.infoActive = !this.infoActive;
        // 信息 / 习惯面板共用右侧底部位置，互斥显示
        if (this.infoActive) {
            this.setHabitActive(false);
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
        // 信息 / 习惯面板共用右侧底部位置，互斥显示
        if (this.habitActive) {
            this.setInfoActive(false);
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

    /** 渲染任务信息面板第一行（颜色圆点 + 任务名称 + 分类） */
    private renderTaskHead(parentEl: HTMLElement, task: PrototypeTask): void {
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
        this.renderHabitPanel();
        this.refreshYearChipHighlight();
    }

    private renderPane(): void {
        this.paneEl.empty();
        // 周任务面板挂在 body 上，重绘前先移除旧节点；重绘后若仍处于激活状态则重新挂回，
        // 保证在周视图排布任务（会触发重绘）时面板保持展开
        const keepWeekTaskPanel = this.weekTaskActive;
        this.closeWeekTaskPanel();
        if (this.tab === 'year') {
            this.renderYearPane();
            // 周格子重建后同步浮层：任务增删后刷新内容与位置，无任务时自动关闭
            this.syncWeekPopover(this.popoverWeek);
        } else {
            this.closeWeekPopover();
            this.renderWeekPane();
        }
        if (keepWeekTaskPanel && this.tab === 'week') {
            this.weekTaskActive = true;
            this.weekTaskButtonEl?.addClass('is-active');
            this.openWeekTaskPanel();
        }
    }

    /** 年视图：年度选择行 + 52 周（7 列 × 8 行，点击周格子把选中任务整周排布） */
    private renderYearPane(): void {
        const nav = this.paneEl.createDiv({ cls: 'plan-nav-row' });
        this.createNavButton(nav, '←', () => {
            this.year -= 1;
            this.selectedYearWeek = null;
            this.closeWeekPopover();
            this.renderPane();
        });
        nav.createSpan({ cls: 'plan-nav-label', text: t('panel.planYearLabel', { year: String(this.year) }) });
        this.createNavButton(nav, '→', () => {
            this.year += 1;
            this.selectedYearWeek = null;
            this.closeWeekPopover();
            this.renderPane();
        });

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
                    // 信息面板激活时，高亮下方正在展示的任务 / 周对应的卡片
                    chip.toggleClass('is-highlighted', this.isYearChipHighlighted(week, task.id));
                    chip.addEventListener('click', (evt) => {
                        evt.stopPropagation();
                        this.selectTask(task.id);
                        this.selectedYearWeek = week;
                        this.renderPane();
                        // 选中任务卡片同样视为选中该周：展开周信息浮层
                        this.syncWeekPopover(week);
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

    /** 年历事件卡片是否需要高亮：信息面板激活，且该卡片属于左侧选中任务、位于选中的周 */
    private isYearChipHighlighted(week: number, taskId: string): boolean {
        return this.infoActive
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
        // 浮层已展开在该周时，本次点击只负责关闭浮层
        const closePopover = this.popoverWeek === week;
        this.selectedYearWeek = week;
        if (this.selectedTaskId) {
            this.panelOptions.planAssignmentRepo.addWeek(makeWeekKey(this.year, week), this.selectedTaskId);
            void this.panelOptions.save();
            this.panelOptions.onChanged?.();
        }
        this.renderPane();
        this.syncWeekPopover(week, closePopover);
    }

    /** 同步周格子信息浮层：无该周任务时关闭；toggle 时再次点击同一周关闭 */
    private syncWeekPopover(week: number | null, toggle = false): void {
        if (week === null) {
            this.closeWeekPopover();
            return;
        }
        const tasks = this.panelOptions.getTasks();
        const hasTasks = this.panelOptions.planAssignmentRepo
            .weekAssignments(makeWeekKey(this.year, week))
            .some((assignment) => tasks.some((task) => task.id === assignment.taskId));
        if (!hasTasks || (toggle && this.popoverWeek === week)) {
            this.closeWeekPopover();
            return;
        }
        this.openWeekPopover(week);
    }

    /** 打开（或刷新）周格子信息浮层 */
    private openWeekPopover(week: number): void {
        if (this.popoverWeek !== week) {
            this.closeWeekPopover();
            this.popoverWeek = week;
            this.weekPopoverEl = document.body.createDiv({ cls: 'plan-week-popover' });
            applyThemeColors(this.weekPopoverEl, getCurrentThemeColors());
        }
        if (!this.weekPopoverEl) return;
        this.renderWeekPopoverContent();
        this.placeWeekPopover();
        document.addEventListener('mousedown', this.onWeekPopoverOutside, true);
        document.addEventListener('keydown', this.onWeekPopoverKeyDown);
        window.addEventListener('resize', this.onWeekPopoverReposition);
        window.addEventListener('scroll', this.onWeekPopoverReposition, true);
    }

    /** 关闭周格子信息浮层 */
    private closeWeekPopover(): void {
        document.removeEventListener('mousedown', this.onWeekPopoverOutside, true);
        document.removeEventListener('keydown', this.onWeekPopoverKeyDown);
        window.removeEventListener('resize', this.onWeekPopoverReposition);
        window.removeEventListener('scroll', this.onWeekPopoverReposition, true);
        this.weekPopoverEl?.remove();
        this.weekPopoverEl = null;
        this.popoverWeek = null;
    }

    /** 浮层内容：该周每个已排布任务（分类色圆点 + 任务名），下方逐行列出绑定到该任务的祖先目标 */
    private renderWeekPopoverContent(): void {
        if (!this.weekPopoverEl || this.popoverWeek === null) return;
        const container = this.weekPopoverEl;
        container.empty();
        const tasks = this.panelOptions.getTasks();
        const byId = new Map(tasks.map((task) => [task.id, task]));
        const categories = this.panelOptions.getCategories();
        const assignments = this.panelOptions.planAssignmentRepo
            .weekAssignments(makeWeekKey(this.year, this.popoverWeek));
        for (const assignment of assignments) {
            const task = byId.get(assignment.taskId);
            if (!task) continue;
            const item = container.createDiv({ cls: 'plan-week-popover-item' });
            const head = item.createDiv({ cls: 'plan-week-popover-task' });
            const dot = head.createSpan({ cls: 'plan-week-popover-dot' });
            dot.style.background = categories.find((category) => category.id === task.categoryId)?.color
                ?? '#888888';
            head.createSpan({ cls: 'plan-week-popover-name', text: task.name });
            for (const { owner, goal } of this.getBoundAncestorGoals(task, byId)) {
                const row = item.createDiv({ cls: 'plan-week-popover-goal' });
                setIcon(row.createSpan({ cls: 'plan-week-popover-goal-icon' }), 'target');
                row.createSpan({ cls: 'plan-week-popover-goal-owner', text: owner.name });
                row.createSpan({ cls: 'plan-week-popover-goal-text', text: goal.text });
            }
        }
    }

    /** 祖先任务中通过「绑定子任务」绑定了当前任务的目标（由近及远） */
    private getBoundAncestorGoals(
        task: PrototypeTask,
        byId: Map<string, PrototypeTask>,
    ): { owner: PrototypeTask; goal: TaskGoalEntry }[] {
        const result: { owner: PrototypeTask; goal: TaskGoalEntry }[] = [];
        const visited = new Set<string>([task.id]);
        let parentId = task.parentId;
        while (parentId && !visited.has(parentId)) {
            visited.add(parentId);
            const owner = byId.get(parentId);
            if (!owner) break;
            for (const goal of owner.goals ?? []) {
                if ((goal.subtaskIds ?? []).includes(task.id)) result.push({ owner, goal });
            }
            parentId = owner.parentId;
        }
        return result;
    }

    /** 浮层贴着周格子右侧定位（右侧空间不足时翻到左侧，纵向对齐格子顶部并收敛在视口内） */
    private placeWeekPopover(): void {
        if (!this.weekPopoverEl || this.popoverWeek === null) return;
        const cell = this.paneEl.querySelector<HTMLElement>(
            `.plan-year-cell[data-week="${this.popoverWeek}"]`,
        );
        if (!cell) {
            this.closeWeekPopover();
            return;
        }
        const rect = cell.getBoundingClientRect();
        const width = this.weekPopoverEl.offsetWidth;
        const height = this.weekPopoverEl.offsetHeight;
        let left = rect.right + 8;
        if (left + width > window.innerWidth - 8) left = rect.left - width - 8;
        let top = rect.top;
        if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8;
        this.weekPopoverEl.style.left = `${Math.max(8, left)}px`;
        this.weekPopoverEl.style.top = `${Math.max(8, top)}px`;
    }

    /** 周视图：周数选择行 + 一周七列日历 */
    private renderWeekPane(): void {
        const { week } = parseWeekKey(this.weekKey);
        const nav = this.paneEl.createDiv({ cls: 'plan-nav-row' });
        this.createNavButton(nav, '←', () => {
            this.weekKey = shiftWeekKey(this.weekKey, -1);
            this.year = parseWeekKey(this.weekKey).year;
            this.renderPane();
        });
        nav.createSpan({ cls: 'plan-nav-label', text: t('panel.planWeekLabel', { week: String(week) }) });
        this.createNavButton(nav, '→', () => {
            this.weekKey = shiftWeekKey(this.weekKey, 1);
            this.year = parseWeekKey(this.weekKey).year;
            this.renderPane();
        });
        // 日期切换旁：「习惯」开关（仅周视图）
        this.habitButtonEl = this.createNavToggle(nav, 'repeat', t('panel.planSetHabit'), this.habitActive, () => this.toggleHabitPanel());
        // 同一行末尾：「周任务 已排/总数」按钮，点击在按钮右侧展开周任务面板
        this.renderWeekTaskButton(nav);

        // 与周计划视图一致：表头一行 7 格，表体 7 列共用分隔线
        const grid = this.paneEl.createDiv({ cls: 'plan-week-grid' });
        const headerRow = grid.createDiv({ cls: 'plan-week-header' });
        const columnsRow = grid.createDiv({ cls: 'plan-week-columns' });
        // 卡片跨列合并：任务卡片按排布日、习惯卡片按生效星期，各自算出连续区段与所在行（泳道）
        const segments = this.habitActive ? [] : this.buildWeekSegments();
        const habitSegments = this.habitActive ? this.buildHabitSegments() : [];
        const laneCount = [...segments, ...habitSegments].reduce((max, item) => Math.max(max, item.lane + 1), 0);
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
        }
        // 卡片层：与日列共用同一网格，按区段跨列显示
        for (const segment of segments) this.renderWeekSegment(columnsRow, segment);
        for (const segment of habitSegments) this.renderHabitSegment(columnsRow, segment);
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

    /** 周视图中跨列合并的一段习惯卡片：按时间排序固定行，同一习惯的连续星期合并为一段 */
    private buildHabitSegments(): {
        task: PrototypeTask;
        habit: TaskHabit;
        start: number;
        end: number;
        lane: number;
    }[] {
        const habits = this.panelOptions.getTasks()
            .filter((task): task is PrototypeTask & { habit: TaskHabit } => task.habit?.enabled === true)
            .sort((a, b) => a.habit.time.localeCompare(b.habit.time)
                || a.name.localeCompare(b.name));
        const segments: { task: PrototypeTask; habit: TaskHabit; start: number; end: number; lane: number }[] = [];
        habits.forEach((task, lane) => {
            const { habit } = task;
            const days = Array.from(new Set(habit.weekdays))
                .filter((day) => day >= 1 && day <= 7)
                .sort((a, b) => a - b);
            if (days.length === 0) return;
            // 连续星期合并为一段，不连续的拆成多段
            let start = days[0];
            let prev = days[0];
            for (let i = 1; i < days.length; i += 1) {
                const day = days[i];
                if (day === prev + 1) {
                    prev = day;
                    continue;
                }
                segments.push({ task, habit, start, end: prev, lane });
                start = day;
                prev = day;
            }
            segments.push({ task, habit, start, end: prev, lane });
        });
        return segments;
    }

    /** 渲染一段跨列习惯卡片（时间 + 任务名，点击选中左侧对应任务） */
    private renderHabitSegment(
        parentEl: HTMLElement,
        segment: { task: PrototypeTask; habit: TaskHabit; start: number; end: number; lane: number },
    ): void {
        const { task, habit, start, end, lane } = segment;
        const span = end - start + 1;
        const chip = parentEl.createDiv({ cls: 'plan-week-task-chip plan-week-habit-chip' });
        chip.style.gridColumn = `${start} / span ${span}`;
        chip.style.gridRow = String(lane + 1);
        chip.title = `${habit.time} ${task.name}`;
        chip.createSpan({ cls: 'plan-week-habit-time', text: habit.time });
        chip.createSpan({ cls: 'plan-week-task-chip-name', text: task.name });
        chip.addEventListener('click', (evt) => {
            evt.stopPropagation();
            this.selectTask(task.id);
        });
    }

    /** 把左侧选中的任务排布到点击的列（同一列重复排布同一任务会被仓库忽略） */
    private assignSelectedTask(weekday: number): void {
        if (!this.selectedTaskId) return;
        this.panelOptions.planAssignmentRepo.add(this.weekKey, weekday, this.selectedTaskId);
        // 反向同步：周视图排布的任务若不在年视图该周格子里，自动补进去
        this.panelOptions.planAssignmentRepo.addWeek(this.weekKey, this.selectedTaskId);
        void this.panelOptions.save();
        this.renderPane();
        this.panelOptions.onChanged?.();
    }

    /** 本周已整周排布（年视图周格子）的任务 id 列表 */
    private weekTaskIds(): string[] {
        const tasks = new Map(this.panelOptions.getTasks().map((task) => [task.id, task]));
        return this.panelOptions.planAssignmentRepo.weekAssignments(this.weekKey)
            .map((assignment) => assignment.taskId)
            .filter((taskId) => tasks.has(taskId));
    }

    /** 本周已排布到具体某天的任务 id 集合 */
    private scheduledTaskIds(): Set<string> {
        const ids = new Set<string>();
        for (let weekday = 1; weekday <= 7; weekday += 1) {
            for (const assignment of this.panelOptions.planAssignmentRepo.dayAssignments(this.weekKey, weekday)) {
                ids.add(assignment.taskId);
            }
        }
        return ids;
    }

    /** 渲染日期行末尾的「周任务 已排/总数」按钮（始终显示，激活时展开周任务面板） */
    private renderWeekTaskButton(headerRow: HTMLElement): void {
        const taskIds = this.weekTaskIds();
        const scheduledIds = this.scheduledTaskIds();
        const total = taskIds.length;
        const scheduled = taskIds.filter((taskId) => scheduledIds.has(taskId)).length;
        const button = headerRow.createEl('button', {
            cls: 'plan-week-task-toggle',
            attr: { type: 'button' },
        });
        // 未全部排布到天时显示警告图标，全部排布后恢复普通图标
        const allScheduled = total > 0 && scheduled === total;
        const iconEl = button.createSpan({ cls: 'plan-toolbar-btn-icon' });
        setIcon(iconEl, allScheduled ? 'list-checks' : 'alert-triangle');
        iconEl.toggleClass('is-warning', !allScheduled);
        button.createSpan({
            cls: 'plan-toolbar-btn-text',
            text: t('panel.planWeekTask', { done: String(scheduled), total: String(total) }),
        });
        button.toggleClass('is-active', this.weekTaskActive);
        button.addEventListener('click', () => this.toggleWeekTaskPanel());
        this.weekTaskButtonEl = button;
    }

    /** 切换周任务面板：仅通过再次点击按钮关闭 */
    private toggleWeekTaskPanel(): void {
        if (this.weekTaskActive) {
            this.closeWeekTaskPanel();
            return;
        }
        this.weekTaskActive = true;
        this.weekTaskButtonEl?.addClass('is-active');
        this.openWeekTaskPanel();
    }

    /** 打开（或刷新）周任务面板：挂在 body 上，按按钮位置计算坐标贴在按钮右侧 */
    private openWeekTaskPanel(): void {
        if (!this.weekTaskButtonEl) return;
        if (!this.weekTaskPanelEl) {
            this.weekTaskPanelEl = document.body.createDiv({ cls: 'plan-week-task-panel' });
            applyThemeColors(this.weekTaskPanelEl, getCurrentThemeColors());
        }
        this.renderWeekTaskPanelContent();
        this.placeWeekTaskPanel();
        window.addEventListener('resize', this.onWeekTaskReposition);
        window.addEventListener('scroll', this.onWeekTaskReposition, true);
        // 拖动计划面板（标题栏 pointermove）时同步跟随
        this.element.addEventListener('pointermove', this.onWeekTaskDragReposition);
    }

    /** 关闭周任务面板 */
    private closeWeekTaskPanel(): void {
        window.removeEventListener('resize', this.onWeekTaskReposition);
        window.removeEventListener('scroll', this.onWeekTaskReposition, true);
        this.element.removeEventListener('pointermove', this.onWeekTaskDragReposition);
        this.weekTaskPanelEl?.remove();
        this.weekTaskPanelEl = null;
        this.weekTaskActive = false;
        this.weekTaskButtonEl?.removeClass('is-active');
    }

    /** 周任务面板内容：本周（年视图周格子）任务条目，选中后点击日历列即可排布 */
    private renderWeekTaskPanelContent(): void {
        const container = this.weekTaskPanelEl;
        if (!container) return;
        container.empty();
        const tasks = new Map(this.panelOptions.getTasks().map((task) => [task.id, task]));
        const categories = this.panelOptions.getCategories();
        const scheduled = this.scheduledTaskIds();
        const taskIds = this.weekTaskIds();
        if (taskIds.length === 0) {
            container.createDiv({ cls: 'plan-week-task-empty', text: t('panel.planWeekTaskEmpty') });
            return;
        }
        for (const taskId of taskIds) {
            const task = tasks.get(taskId);
            if (!task) continue;
            const row = container.createDiv({ cls: 'plan-week-task-item' });
            row.dataset.taskId = task.id;
            row.toggleClass('is-selected', task.id === this.selectedTaskId);
            const dot = row.createSpan({ cls: 'plan-week-task-dot' });
            dot.style.background = categories.find((category) => category.id === task.categoryId)?.color
                ?? '#888888';
            row.createSpan({ cls: 'plan-week-task-name', text: task.name });
            // 已排布到本周某一天：末尾显示标识图标
            if (scheduled.has(task.id)) {
                const iconEl = row.createSpan({ cls: 'plan-week-task-scheduled' });
                setIcon(iconEl, 'calendar-check');
                iconEl.setAttribute('aria-label', t('panel.planWeekTaskScheduled'));
            }
            row.addEventListener('click', () => {
                // 与左侧任务树共用同一个选中状态
                if (task.id === this.selectedTaskId) this.clearTaskSelection();
                else this.selectTask(task.id);
            });
        }
    }

    /** 同步周任务面板条目的选中态（与左侧任务树共用选中状态） */
    private refreshWeekTaskSelection(): void {
        if (!this.weekTaskPanelEl) return;
        this.weekTaskPanelEl.querySelectorAll('.plan-week-task-item').forEach((el) => {
            const row = el as HTMLElement;
            row.toggleClass('is-selected', row.dataset.taskId === this.selectedTaskId);
        });
    }

    /** 周任务面板贴着按钮右侧定位（右侧空间不足时翻到左侧，纵向收敛在视口内） */
    private placeWeekTaskPanel(): void {
        if (!this.weekTaskPanelEl || !this.weekTaskButtonEl) return;
        const rect = this.weekTaskButtonEl.getBoundingClientRect();
        const width = this.weekTaskPanelEl.offsetWidth;
        const height = this.weekTaskPanelEl.offsetHeight;
        let left = rect.right + 8;
        if (left + width > window.innerWidth - 8) left = rect.left - width - 8;
        let top = rect.top;
        if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8;
        this.weekTaskPanelEl.style.left = `${Math.max(8, left)}px`;
        this.weekTaskPanelEl.style.top = `${Math.max(8, top)}px`;
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
