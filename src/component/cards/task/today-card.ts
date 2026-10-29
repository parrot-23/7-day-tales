// 今日任务方框：左侧 24 小时时钟 + 日期切换，右侧当日任务 / 额外任务 / 计时器 / 记录视图。
// 从「界面」二级视图中抽离，独立负责时钟、日期、任务列表、计时与执行记录相关交互。
import { setIcon } from 'obsidian';
import type { App, Plugin } from 'obsidian';

import type { PrototypeTask } from '../../../datatypes/prototype-task';
import { t } from '../../../i18n';
import { TaskPickerPanel } from '../../panel/task/task-picker-panel';
import { TaskRecordPanel } from '../../panel/task/task-record-panel';
import type { PdcaRepo } from '../../../repos/pdca-repo';
import type { PlanAssignmentRepo } from '../../../repos/plan-assignment-repo';
import type { PrototypeTaskRepo } from '../../../repos/prototype-task-repo';
import type { TaskExecutionRepo } from '../../../repos/task-execution-repo';
import type { TimeBoxRepo } from '../../../repos/timebox-repo';
import type { PlanCategoryData } from '../../../shared/plan-category-manager';
import { getCurrentDayKey, getISOWeek, makeDayKey, makeWeekKey } from '../../../shared/plan-data';
import { ConfirmModal } from '../../ob/confirm-modal';

/** 指定日期 0 点 */
function startOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
}

/** 当天 0 点 */
function startOfToday(): Date {
    return startOfDay(new Date());
}

/** 今日任务方框配置 */
export interface TodayCardOptions {
    app: App;
    plugin: Plugin;
    categoryData: PlanCategoryData;
    onRunningTaskChanged: () => void;
    /** 初始查看日期（默认今天） */
    initialDate?: Date;
    /** 卡片内切换日期后回调（供顶部工具栏同步） */
    onSelectedDateChange?: (date: Date) => void;
}

export class TodayCard {
    private readonly options: TodayCardOptions;
    /** 「今天任务」方框右侧任务列表容器 */
    private todayTaskListEl: HTMLElement | null = null;
    /** 「额外任务」列表容器 */
    private todayExtraListEl: HTMLElement | null = null;
    /** 任务选择面板（复用同一实例） */
    private taskPickerPanel: TaskPickerPanel | null = null;
    /** 当前查看的日期（默认今天，仅可回看过去） */
    private selectedDate: Date = startOfToday();
    /** 日期文本 */
    private dateLabelEl: HTMLElement | null = null;
    /** 日期相对标签（今天 / 昨天 / N天前） */
    private dateTagEl: HTMLElement | null = null;
    /** 下一天按钮（到达今天后禁用） */
    private nextDateBtn: HTMLButtonElement | null = null;
    /** 今天任务列表中选中的任务 id */
    private selectedTodayTaskId: string | undefined;
    /** 开始计时区域容器 */
    private todayTimerEl: HTMLElement | null = null;
    /** 开始时间文本 */
    private todayTimerStartEl: HTMLElement | null = null;
    /** 计时器文本 */
    private todayTimerElapsedEl: HTMLElement | null = null;
    /** 开始任务按钮 */
    private todayStartButton: HTMLButtonElement | null = null;
    /** 操作按钮组容器 */
    private todayActionsEl: HTMLElement | null = null;
    /** 本次开始时间 */
    private runningStartedAt: Date | null = null;
    /** 本次计时的任务 id */
    private runningTodayTaskId: string | undefined;
    /** 计时器定时器句柄 */
    private timerHandle: number | null = null;

    /** 分钟级时钟刷新句柄 */
    private clockTickHandle: number | null = null;
    /** 任务记录面板 */
    private recordPanel: TaskRecordPanel | null = null;
    /** 24 小时时钟容器（计时中每秒重绘外环） */
    private clockEl: HTMLElement | null = null;
    /** 常规视图容器（当日任务列表 + 额外任务 + 计时器 + 按钮组） */
    private todayNormalEl: HTMLElement | null = null;
    /** 记录视图容器（当日已完成任务列表 + 按钮组） */
    private todayRecordViewEl: HTMLElement | null = null;
    /** 记录视图标题 */
    private todayRecordTitleEl: HTMLElement | null = null;
    /** 记录视图列表容器 */
    private todayRecordListEl: HTMLElement | null = null;
    /** 记录视图按钮组容器 */
    private todayRecordActionsEl: HTMLElement | null = null;
    /** 记录视图中的删除按钮 */
    private recordDeleteButton: HTMLButtonElement | null = null;
    /** 是否处于记录视图（点击时钟弧段后进入） */
    private recordViewActive = false;
    /** 记录视图中选中的执行记录 id */
    private selectedRecordId: string | undefined;

    constructor(options: TodayCardOptions) {
        this.options = options;
        if (options.initialDate) this.selectedDate = startOfDay(options.initialDate);
    }

    private get app(): App {
        return this.options.app;
    }

    private get plugin(): Plugin {
        return this.options.plugin;
    }

    private get categoryData(): PlanCategoryData {
        return this.options.categoryData;
    }

    /** 原型任务仓库 */
    private get prototypeTaskRepo(): PrototypeTaskRepo {
        return (this.plugin as Plugin & { prototypeTaskRepo: PrototypeTaskRepo }).prototypeTaskRepo;
    }

    /** 计划排布仓库 */
    private get planAssignmentRepo(): PlanAssignmentRepo {
        return (this.plugin as Plugin & { planAssignmentRepo: PlanAssignmentRepo }).planAssignmentRepo;
    }

    /** 任务执行记录仓库 */
    private get taskExecutionRepo(): TaskExecutionRepo {
        return (this.plugin as Plugin & { taskExecutionRepo: TaskExecutionRepo }).taskExecutionRepo;
    }

    /** PDCA 领域仓库（持久化进行中任务） */
    private get pdcaRepo(): PdcaRepo {
        return (this.plugin as Plugin & { pdcaRepo: PdcaRepo }).pdcaRepo;
    }

    /** 唯一持久化出口 */
    private saveAll(): Promise<void> {
        return (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
    }

    /** 当前进行中的任务 id（综合方框读取用） */
    get runningTaskId(): string | undefined {
        return this.runningTodayTaskId;
    }

    /** 当前查看的日期（顶部工具栏同步用） */
    getSelectedDate(): Date {
        return new Date(this.selectedDate);
    }

    /** 外部切换查看日期（顶部工具栏调用，右边界为今天） */
    setSelectedDate(date: Date): void {
        const next = startOfDay(date);
        if (next.getTime() > startOfToday().getTime()) return;
        if (next.getTime() === this.selectedDate.getTime()) return;
        this.exitRecordView();
        this.selectedDate = next;
        this.selectedTodayTaskId = undefined;
        this.updateDateNav();
        this.renderTodayTasks();
        this.refreshClock();
    }

    /** 其他卡片开始 / 结束计时后同步计时展示与按钮组（卡片未渲染时跳过） */
    reloadRunningState(): void {
        if (!this.todayTimerEl) return;
        const running = this.pdcaRepo.runningTask;
        const startedAt = running?.source === 'prototype' ? running.startedAt : undefined;
        const taskExists = running
            ? this.prototypeTaskRepo.tasks.some((task) => task.id === running.inboxId)
            : false;
        if (running && typeof startedAt === 'number' && taskExists) {
            if (this.timerHandle !== null && this.runningTodayTaskId === running.inboxId) return;
            this.stopTodayTimer();
            this.runningTodayTaskId = running.inboxId;
            this.runningStartedAt = new Date(startedAt);
            this.todayTimerEl.removeClass('is-hidden');
            if (this.todayTimerStartEl) {
                this.todayTimerStartEl.textContent = t('interface.todayStartAt', {
                    time: this.formatClockTime(this.runningStartedAt),
                });
            }
            this.updateTodayTimerText();
            if (this.timerHandle === null) {
                this.timerHandle = window.setInterval(() => this.updateTodayTimerText(), 1000);
            }
            this.renderTodayActions(true);
            this.refreshClock();
            return;
        }
        this.stopTodayTimer();
        this.todayTimerEl.addClass('is-hidden');
        if (this.todayTimerElapsedEl) this.todayTimerElapsedEl.textContent = '00:00';
        this.renderTodayActions(false);
        this.refreshClock();
    }

    /** 外部记录变化后刷新时钟外环 */
    refreshClockDisplay(): void {
        this.refreshClock();
    }

    /** 在指定容器内渲染今日任务方框 */
    render(parentEl: HTMLElement): void {
        this.stopTodayTimer();
        // 视图重建后回到常规视图
        this.recordViewActive = false;
        this.selectedRecordId = undefined;

        // 中间：今日任务方框（左侧 24 小时时钟 + 右侧今日排布任务）
        const today = parentEl.createDiv({ cls: 'interface-today' });
        today.createDiv({ cls: 'interface-today-title', text: t('interface.todayTitle') });
        const todayBody = today.createDiv({ cls: 'interface-today-body' });
        const todayLeft = todayBody.createDiv({ cls: 'interface-today-left' });
        this.clockEl = todayLeft.createDiv({ cls: 'interface-today-clock' });
        this.renderClock(this.clockEl);

        // 日期切换：< 月/日 >，下方标签显示今天 / 昨天 / N天前
        const dateNav = todayLeft.createDiv({ cls: 'interface-today-date-nav' });
        const prevDateBtn = dateNav.createEl('button', { cls: 'interface-today-date-btn', text: '<' });
        prevDateBtn.addEventListener('click', () => this.shiftSelectedDate(-1));
        this.dateLabelEl = dateNav.createSpan({ cls: 'interface-today-date-label' });
        this.nextDateBtn = dateNav.createEl('button', { cls: 'interface-today-date-btn', text: '>' });
        this.nextDateBtn.addEventListener('click', () => this.shiftSelectedDate(1));
        this.dateTagEl = todayLeft.createDiv({ cls: 'interface-today-date-tag' });
        this.updateDateNav();

        const todayRight = todayBody.createDiv({ cls: 'interface-today-right' });

        // 常规视图：当日任务 + 额外任务（同一个滚动区）+ 计时器 + 按钮组（进入记录视图时整体隐藏）
        this.todayNormalEl = todayRight.createDiv({ cls: 'interface-today-normal' });
        this.todayNormalEl.addEventListener('click', (evt) => {
            const row = (evt.target as HTMLElement).closest('.interface-today-task') as HTMLElement | null;
            const taskId = row?.dataset.taskId;
            if (taskId) {
                this.selectedTodayTaskId = taskId;
                this.updateTodaySelection();
            }
        });

        // 当日任务与额外任务共用一个滚动区，任务再多也不会互相挤压，只出现一条滚动条
        const scrollEl = this.todayNormalEl.createDiv({ cls: 'interface-today-scroll' });
        scrollEl.createDiv({ cls: 'interface-today-section-title', text: t('interface.todayPlannedTitle') });
        this.todayTaskListEl = scrollEl.createDiv({ cls: 'interface-today-tasks' });

        // 额外任务：标题行（标题 + 新增按钮）+ 任务列表
        const extraHeader = scrollEl.createDiv({ cls: 'interface-today-section-header' });
        extraHeader.createDiv({ cls: 'interface-today-section-title', text: t('interface.todayExtraTitle') });
        const addExtraBtn = extraHeader.createEl('button', {
            cls: 'interface-today-add',
            attr: { 'aria-label': t('interface.todayAddExtra') },
        });
        setIcon(addExtraBtn, 'plus');
        addExtraBtn.addEventListener('click', () => this.openTaskPicker());
        this.todayExtraListEl = scrollEl.createDiv({ cls: 'interface-today-tasks' });

        this.renderTodayTasks();

        // 开始时间 + 计时器（未开始计时时隐藏）
        this.todayTimerEl = this.todayNormalEl.createDiv({ cls: 'interface-today-timer is-hidden' });
        this.todayTimerStartEl = this.todayTimerEl.createSpan({ cls: 'interface-today-timer-start' });
        this.todayTimerElapsedEl = this.todayTimerEl.createSpan({ cls: 'interface-today-timer-elapsed', text: '00:00' });

        // 任务列表下方的操作按钮组：未计时为「开始任务 / 记录任务」，计时中为「结束任务 / 放弃任务」
        this.todayActionsEl = this.todayNormalEl.createDiv({ cls: 'interface-today-actions' });
        this.renderTodayActions(false);

        // 记录视图：点击时钟弧段后展示当日已完成任务（默认隐藏）
        this.todayRecordViewEl = todayRight.createDiv({ cls: 'interface-today-records is-hidden' });
        this.todayRecordTitleEl = this.todayRecordViewEl.createDiv({ cls: 'interface-today-section-title' });
        this.todayRecordListEl = this.todayRecordViewEl.createDiv({ cls: 'interface-today-record-list' });
        this.todayRecordActionsEl = this.todayRecordViewEl.createDiv({ cls: 'interface-today-actions' });

        // 恢复持久化的进行中计时（切换视图 / 重开 Obsidian 后继续）
        this.restoreRunningTodayTask();
        this.startClockTicker();
    }

    /** 公开刷新入口：任务 / 计划数据变化时重绘当日任务列表 */
    refreshTasks(): void {
        this.renderTodayTasks();
    }

    /** 点击额外任务的「+」：打开任务选择面板，选中后加入当日额外任务 */
    private openTaskPicker(): void {
        if (!this.taskPickerPanel) {
            this.taskPickerPanel = new TaskPickerPanel({
                getTasks: () => this.prototypeTaskRepo.tasks,
                onSelect: (taskId) => {
                    this.taskExecutionRepo.addExtraTask(makeDayKey(this.selectedDate), taskId);
                    void this.saveAll();
                    this.renderTodayTasks();
                },
            });
        }
        this.taskPickerPanel.open();
    }

    /** 渲染「今天任务」方框右侧列表：计划排布任务 + 当日额外任务 */
    private renderTodayTasks(): void {
        const listEl = this.todayTaskListEl;
        if (!listEl?.isConnected) return;
        listEl.empty();
        this.todayExtraListEl?.empty();
        const weekday = this.selectedDate.getDay() === 0 ? 7 : this.selectedDate.getDay();
        const tasks = new Map(this.prototypeTaskRepo.tasks.map((task) => [task.id, task]));
        const planned = this.planAssignmentRepo.dayAssignments(this.selectedWeekKey(), weekday)
            .map((assignment) => tasks.get(assignment.taskId))
            .filter((task): task is PrototypeTask => task !== undefined);
        // 额外任务：任务选择面板加入当日的任务（与计划任务去重）
        const plannedIds = new Set(planned.map((task) => task.id));
        const extraTasks = this.taskExecutionRepo.extraTaskIds(makeDayKey(this.selectedDate))
            .map((taskId) => tasks.get(taskId))
            .filter((task): task is PrototypeTask => task !== undefined && !plannedIds.has(task.id));

        if (planned.length === 0) {
            listEl.createDiv({ cls: 'interface-today-empty', text: t('interface.todayNoTask') });
        } else {
            for (const task of planned) this.createTodayTaskRow(listEl, task);
        }
        if (this.todayExtraListEl) {
            for (const task of extraTasks) this.createTodayTaskRow(this.todayExtraListEl, task);
        }

        const dayTasks = [...planned, ...extraTasks];
        if (!dayTasks.some((task) => task.id === this.selectedTodayTaskId)) {
            this.selectedTodayTaskId = undefined;
        }
        this.updateTodaySelection();
    }

    /** 创建一条当日任务行（计划任务与额外任务共用） */
    private createTodayTaskRow(parentEl: HTMLElement, task: PrototypeTask): void {
        const row = parentEl.createDiv({ cls: 'interface-today-task' });
        row.dataset.taskId = task.id;
        row.toggleClass('is-selected', task.id === this.selectedTodayTaskId);
        row.title = task.name;
        row.createSpan({ cls: 'interface-today-task-name', text: task.name });
    }

    /** 所选日期所在的周键 */
    private selectedWeekKey(): string {
        return makeWeekKey(this.selectedDate.getFullYear(), getISOWeek(this.selectedDate));
    }

    /** 当前是否查看今天 */
    private isTodaySelected(): boolean {
        return this.selectedDate.getTime() === startOfToday().getTime();
    }

    /** 刷新日期文本、相对标签与下一天按钮可用状态 */
    private updateDateNav(): void {
        if (this.dateLabelEl) {
            this.dateLabelEl.textContent = `${this.selectedDate.getMonth() + 1}/${this.selectedDate.getDate()}`;
        }
        if (this.dateTagEl) this.dateTagEl.textContent = this.dateRelationLabel();
        if (this.nextDateBtn) this.nextDateBtn.disabled = this.isTodaySelected();
    }

    /** 日期相对标签：今天 / 昨天 / N天前（未来为明天 / N天后，当前不可选） */
    private dateRelationLabel(): string {
        const diff = Math.round((this.selectedDate.getTime() - startOfToday().getTime()) / 86400000);
        if (diff === 0) return t('interface.dateToday');
        if (diff < 0) {
            return diff === -1
                ? t('interface.dateYesterday')
                : t('interface.dateDaysAgo', { days: String(-diff) });
        }
        return diff === 1
            ? t('interface.dateTomorrow')
            : t('interface.dateDaysLater', { days: String(diff) });
    }

    /** 切换查看日期（右边界为今天） */
    private shiftSelectedDate(delta: number): void {
        const next = new Date(this.selectedDate);
        next.setDate(next.getDate() + delta);
        if (next.getTime() > startOfToday().getTime()) return;
        this.exitRecordView();
        this.selectedDate = next;
        this.selectedTodayTaskId = undefined;
        this.updateDateNav();
        this.renderTodayTasks();
        this.refreshClock();
        this.options.onSelectedDateChange?.(this.selectedDate);
    }

    /** 渲染操作按钮组：计时中显示「结束任务 / 放弃任务」，否则显示「开始任务 / 记录任务」 */
    private renderTodayActions(running: boolean): void {
        const actions = this.todayActionsEl;
        if (!actions) return;
        actions.empty();
        this.todayStartButton = null;
        if (running) {
            this.createTodayAction(actions, 'square', t('interface.todayEndTask'))
                .addEventListener('click', () => this.finishRunningTodayTask());
            this.createTodayAction(actions, 'x', t('interface.todayAbandonTask'))
                .addEventListener('click', () => this.stopRunningTodayTask());
        } else {
            this.todayStartButton = this.createTodayAction(actions, 'play', t('interface.todayStartTask'));
            this.todayStartButton.disabled = true;
            this.todayStartButton.addEventListener('click', () => this.startSelectedTodayTask());
            this.createTodayAction(actions, 'check', t('interface.todayRecordTask'))
                .addEventListener('click', () => this.openRecordPanel());
        }
        this.updateTodaySelection();
    }

    /** 打开记录面板：对今天任务列表中选中的任务记录 */
    private openRecordPanel(): void {
        if (!this.selectedTodayTaskId) return;
        this.openRecordPanelForTask(this.selectedTodayTaskId);
    }

    /** 打开记录面板：默认时间为所选日期上「30 分钟前 → 当前时刻」，记录归属所选日期 */
    private openRecordPanelForTask(taskId: string): void {
        const task = this.prototypeTaskRepo.tasks.find((item) => item.id === taskId);
        if (!task) return;

        // 以所选日期为基准，时间默认取当前时刻（因此查看昨天时默认记录到昨天同一时段）
        const now = new Date();
        const end = new Date(this.selectedDate);
        end.setHours(now.getHours(), now.getMinutes(), 0, 0);
        const start = new Date(end.getTime() - 30 * 60000);
        this.recordPanel?.destroy();
        this.recordPanel = new TaskRecordPanel({
            title: `${t('panel.taskRecordTitle')} · ${task.name}`,
            startTime: this.formatClockTime(start),
            endTime: this.formatClockTime(end),
            date: this.selectedDate,
            onConfirm: (startAt, endAt) => {
                this.taskExecutionRepo.add(taskId, startAt, endAt);
                void this.saveAll();
                this.refreshClock();
                if (this.recordViewActive) this.renderDayRecords();
            },
        });
        this.recordPanel.open();
    }

    /** 点击弧段：进入记录视图并选中对应条目（弧段保持选中样式） */
    private selectRecordFromArc(recordId: string): void {
        this.recordViewActive = true;
        this.selectedRecordId = recordId;
        this.todayNormalEl?.addClass('is-hidden');
        this.todayRecordViewEl?.removeClass('is-hidden');
        this.renderDayRecords();
        this.refreshClock();
    }

    /** 返回常规视图 */
    private exitRecordView(): void {
        this.recordViewActive = false;
        this.selectedRecordId = undefined;
        this.recordDeleteButton = null;
        this.todayRecordViewEl?.addClass('is-hidden');
        this.todayNormalEl?.removeClass('is-hidden');
        this.refreshClock();
    }

    /** 渲染记录视图：所选日期的已完成任务（开始-结束时间、任务名称、时长） */
    private renderDayRecords(): void {
        const listEl = this.todayRecordListEl;
        if (!listEl?.isConnected) return;
        listEl.empty();

        const dayStartMs = new Date(this.selectedDate).getTime();
        const dayEndMs = dayStartMs + 24 * 3600000;
        const records = this.taskExecutionRepo.records
            .filter((record) => record.endAt > dayStartMs && record.startAt < dayEndMs)
            .sort((a, b) => a.startAt - b.startAt);
        if (this.todayRecordTitleEl) {
            this.todayRecordTitleEl.textContent = records.length > 0
                ? `${t('interface.todayRecordedTitle')} (${records.length})`
                : t('interface.todayRecordedTitle');
        }
        if (!this.selectedRecordId || !records.some((record) => record.id === this.selectedRecordId)) {
            this.selectedRecordId = undefined;
        }

        if (records.length === 0) {
            listEl.createDiv({ cls: 'interface-today-empty', text: t('interface.todayRecordEmpty') });
            this.renderRecordViewActions();
            return;
        }

        const tasks = new Map(this.prototypeTaskRepo.tasks.map((task) => [task.id, task]));
        for (const record of records) {
            const row = listEl.createDiv({ cls: 'interface-today-record' });
            row.dataset.recordId = record.id;
            row.toggleClass('is-selected', record.id === this.selectedRecordId);
            row.createSpan({
                cls: 'interface-today-record-time',
                text: `${this.formatClockTime(new Date(record.startAt))} - ${this.formatClockTime(new Date(record.endAt))}`,
            });
            row.createSpan({
                cls: 'interface-today-record-name',
                text: tasks.get(record.taskId)?.name ?? t('interface.todayRecordUnknownTask'),
            });
            row.createSpan({
                cls: 'interface-today-record-duration',
                text: this.formatDuration(record.endAt - record.startAt),
            });
            row.addEventListener('click', () => {
                this.selectedRecordId = record.id;
                this.updateRecordSelection();
                // 同步时钟弧段的选中态
                this.refreshClock();
            });
        }
        this.renderRecordViewActions();
    }

    /** 刷新记录条目选中态与删除按钮可用状态 */
    private updateRecordSelection(): void {
        this.todayRecordListEl?.querySelectorAll('.interface-today-record').forEach((el) => {
            const row = el as HTMLElement;
            row.toggleClass('is-selected', row.dataset.recordId === this.selectedRecordId);
        });
        if (this.recordDeleteButton) this.recordDeleteButton.disabled = !this.selectedRecordId;
    }

    /** 记录视图按钮组：删除 / 返回 */
    private renderRecordViewActions(): void {
        const actions = this.todayRecordActionsEl;
        if (!actions) return;
        actions.empty();
        this.recordDeleteButton = null;

        this.recordDeleteButton = this.createTodayAction(actions, 'trash-2', t('interface.todayDeleteRecord'));
        this.recordDeleteButton.disabled = !this.selectedRecordId;
        this.recordDeleteButton.addEventListener('click', () => this.deleteSelectedRecord());

        this.createTodayAction(actions, 'arrow-left', t('interface.todayBack'))
            .addEventListener('click', () => this.exitRecordView());
        this.updateRecordSelection();
    }

    /** 删除选中的执行记录（带二次确认） */
    private deleteSelectedRecord(): void {
        const recordId = this.selectedRecordId;
        if (!recordId) return;
        const record = this.taskExecutionRepo.records.find((item) => item.id === recordId);
        if (!record) return;
        const taskName = this.prototypeTaskRepo.tasks.find((task) => task.id === record.taskId)?.name
            ?? t('interface.todayRecordUnknownTask');
        const timeRange = `${this.formatClockTime(new Date(record.startAt))} - ${this.formatClockTime(new Date(record.endAt))}`;
        new ConfirmModal(
            this.app,
            t('interface.todayDeleteRecordTitle'),
            t('interface.todayDeleteRecordDetail', { name: taskName, time: timeRange }),
            () => {
                this.taskExecutionRepo.remove(recordId);
                void this.saveAll();
                this.selectedRecordId = undefined;
                this.renderDayRecords();
                this.refreshClock();
            },
        ).open();
    }

    /** 时长文本：不足 1 小时显示分钟，否则显示小时（分钟） */
    private formatDuration(ms: number): string {
        const totalMinutes = Math.max(0, Math.round(ms / 60000));
        if (totalMinutes < 60) {
            return t('interface.durationMinutes', { minutes: String(totalMinutes) });
        }
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return minutes === 0
            ? t('interface.durationHours', { hours: String(hours) })
            : t('interface.durationHoursMinutes', { hours: String(hours), minutes: String(minutes) });
    }

    /** 结束当前计时：时长达 1 分钟时保存执行记录，然后恢复初始按钮组 */
    private finishRunningTodayTask(): void {
        const taskId = this.runningTodayTaskId;
        const startedAt = this.runningStartedAt;
        if (taskId && startedAt) {
            const endAt = Date.now();
            if (endAt - startedAt.getTime() >= 60000) {
                this.taskExecutionRepo.add(taskId, startedAt.getTime(), endAt);
                void (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
            }
        }
        this.stopRunningTodayTask();
    }

    /** 结束 / 放弃当前计时：停止计时、清除持久化状态、隐藏开始时间与计时器，恢复初始按钮组 */
    private stopRunningTodayTask(): void {
        this.stopTodayTimer();
        this.options.onRunningTaskChanged();
        this.clearPersistedRunningTask();
        this.todayTimerEl?.addClass('is-hidden');
        if (this.todayTimerElapsedEl) this.todayTimerElapsedEl.textContent = '00:00';
        this.renderTodayActions(false);
        this.refreshClock();
    }

    /** 刷新任务列表选中态与开始按钮可用状态 */
    private updateTodaySelection(): void {
        this.todayNormalEl?.querySelectorAll('.interface-today-task').forEach((el) => {
            const row = el as HTMLElement;
            row.toggleClass('is-selected', row.dataset.taskId === this.selectedTodayTaskId);
        });
        if (this.todayStartButton) {
            this.todayStartButton.disabled = this.selectedTodayTaskId === undefined;
        }
    }

    /** 开始选中任务的计时：显示开始时间并每秒刷新计时器 */
    private startSelectedTodayTask(): void {
        if (!this.selectedTodayTaskId || !this.todayTimerEl) return;
        this.stopTodayTimer();
        this.runningStartedAt = new Date();
        this.runningTodayTaskId = this.selectedTodayTaskId;
        this.persistRunningTask(this.runningTodayTaskId, this.runningStartedAt);
        this.options.onRunningTaskChanged();
        this.todayTimerEl.removeClass('is-hidden');
        if (this.todayTimerStartEl) {
            this.todayTimerStartEl.textContent = t('interface.todayStartAt', {
                time: this.formatClockTime(this.runningStartedAt),
            });
        }
        this.updateTodayTimerText();
        this.timerHandle = window.setInterval(() => this.updateTodayTimerText(), 1000);
        this.renderTodayActions(true);
    }

    /** 刷新计时器文本（分:秒），计时区域销毁后自动停止 */
    private updateTodayTimerText(): void {
        if (!this.runningStartedAt || !this.todayTimerEl?.isConnected) {
            this.stopTodayTimer();
            return;
        }
        if (!this.todayTimerElapsedEl) return;
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - this.runningStartedAt.getTime()) / 1000));
        const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
        const seconds = String(elapsedSeconds % 60).padStart(2, '0');
        this.todayTimerElapsedEl.textContent = `${minutes}:${seconds}`;
        this.refreshClock();
    }

    /** 每分钟刷新一次时钟，让时针随时间走动；时钟被移除后自动停止 */
    private startClockTicker(): void {
        if (this.clockTickHandle !== null) return;
        this.clockTickHandle = window.setInterval(() => {
            if (!this.clockEl?.isConnected) {
                if (this.clockTickHandle !== null) window.clearInterval(this.clockTickHandle);
                this.clockTickHandle = null;
                return;
            }
            this.refreshClock();
        }, 60000);
    }

    private refreshClock(): void {
        if (this.clockEl?.isConnected) this.renderClock(this.clockEl);
    }

    /** 停止计时（不清除界面上的开始时间展示） */
    private stopTodayTimer(): void {
        if (this.timerHandle !== null) {
            window.clearInterval(this.timerHandle);
            this.timerHandle = null;
        }
        this.runningStartedAt = null;
        this.runningTodayTaskId = undefined;
    }

    /** 把进行中的计时写入持久化字段（切换视图 / 重开 Obsidian 后可恢复） */
    private persistRunningTask(taskId: string, startedAt: Date): void {
        this.pdcaRepo.setRunningTask({
            inboxId: taskId,
            start: startedAt.getHours() * 60 + startedAt.getMinutes(),
            dayKey: getCurrentDayKey(),
            source: 'prototype',
            startedAt: startedAt.getTime(),
        });
        void this.saveAll();
        this.refreshRunningIndicators();
    }

    /** 清除持久化的进行中任务（只清除界面视图自己写入的原型任务） */
    private clearPersistedRunningTask(): void {
        if (this.pdcaRepo.runningTask?.source !== 'prototype') return;
        this.pdcaRepo.setRunningTask(undefined);
        void this.saveAll();
        this.refreshRunningIndicators();
    }

    /** 刷新状态栏与主视图顶部的「进行中任务」显示 */
    private refreshRunningIndicators(): void {
        (this.plugin as Plugin & { refreshRunningTaskCard?: () => void }).refreshRunningTaskCard?.();
    }

    /** 从持久化字段恢复进行中的计时（只恢复界面视图自己写入的原型任务） */
    private restoreRunningTodayTask(): void {
        const running = this.pdcaRepo.runningTask;
        if (!running || running.source !== 'prototype' || typeof running.startedAt !== 'number') return;
        if (!this.prototypeTaskRepo.tasks.some((task) => task.id === running.inboxId)) return;
        if (!this.todayTimerEl) return;

        this.runningTodayTaskId = running.inboxId;
        this.runningStartedAt = new Date(running.startedAt);
        this.todayTimerEl.removeClass('is-hidden');
        if (this.todayTimerStartEl) {
            this.todayTimerStartEl.textContent = t('interface.todayStartAt', {
                time: this.formatClockTime(this.runningStartedAt),
            });
        }
        this.updateTodayTimerText();
        if (this.timerHandle === null) {
            this.timerHandle = window.setInterval(() => this.updateTodayTimerText(), 1000);
        }
        this.renderTodayActions(true);
        this.refreshRunningIndicators();
        this.options.onRunningTaskChanged();
    }

    /** 时:分（各两位） */
    private formatClockTime(date: Date): string {
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    /** 创建图标 + 文字的操作按钮 */
    private createTodayAction(container: HTMLElement, icon: string, text: string): HTMLButtonElement {
        const button = container.createEl('button', { cls: 'interface-today-action' });
        const iconEl = button.createSpan({ cls: 'interface-today-action-icon' });
        setIcon(iconEl, icon);
        button.createSpan({ cls: 'interface-today-action-text', text });
        return button;
    }

    /** 渲染 24 小时时钟：18:00–06:00 为夜间灰色扇区，外环绘制当天执行记录 */
    private renderClock(container: HTMLElement): void {
        container.empty();
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 220 220');
        container.appendChild(svg);

        const cx = 110;
        const cy = 110;
        const radius = 88;
        /** 外环弧线半径 */
        const ringRadius = 99;
        const point = (hour: number, r: number): [number, number] => {
            // 整体旋转 180°：12 点朝上、0 点朝下（数字仍正向显示）
            const angle = ((hour * 15 + 180) * Math.PI) / 180;
            return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
        };
        const add = (tag: string, attrs: Record<string, string>): SVGElement => {
            const node = document.createElementNS(ns, tag);
            for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
            svg.appendChild(node);
            return node;
        };

        // 夜间扇区：18 点 → 24 点 → 6 点（顺时针经过顶部）
        const [nightStartX, nightStartY] = point(18, radius);
        const [nightEndX, nightEndY] = point(6, radius);
        add('path', {
            d: `M ${cx} ${cy} L ${nightStartX} ${nightStartY} A ${radius} ${radius} 0 0 1 ${nightEndX} ${nightEndY} Z`,
        }).style.fill = 'rgba(128, 128, 128, 0.18)';

        add('circle', { cx: String(cx), cy: String(cy), r: String(radius), fill: 'none' })
            .style.stroke = 'var(--background-modifier-border)';

        // 中心饼图：时间盒在该星期几的涂色分布，每个已涂色小时占 15°，未涂色的小时不绘制
        const pieRadius = 25;
        const weekday = this.selectedDate.getDay() === 0 ? 7 : this.selectedDate.getDay();
        const timeBoxRepo = (this.plugin as Plugin & { timeBoxRepo?: TimeBoxRepo }).timeBoxRepo;
        const pieHours = new Map<number, string>();
        for (const cell of timeBoxRepo?.weekCells(this.selectedWeekKey()) ?? []) {
            if (cell.weekday === weekday) pieHours.set(cell.hour, cell.categoryId);
        }
        const categoryColor = (categoryId: string): string =>
            this.categoryData.categories.find((category) => category.id === categoryId)?.color
            ?? 'var(--text-muted)';
        if (pieHours.size > 0) {
            const drawWedge = (startHour: number, endHour: number, color: string): void => {
                if (startHour <= 0 && endHour >= 24) {
                    add('circle', { cx: String(cx), cy: String(cy), r: String(pieRadius) })
                        .style.fill = color;
                    return;
                }
                const [sx, sy] = point(startHour, pieRadius);
                const [ex, ey] = point(endHour, pieRadius);
                const largeArc = endHour - startHour > 12 ? 1 : 0;
                add('path', {
                    d: `M ${cx} ${cy} L ${sx} ${sy} A ${pieRadius} ${pieRadius} 0 ${largeArc} 1 ${ex} ${ey} Z`,
                }).style.fill = color;
            };
            // 相邻且分类相同的小时合并成一个扇区，避免同色出现接缝
            const paintedHours = Array.from(pieHours.keys()).sort((a, b) => a - b);
            let startHour = paintedHours[0];
            let prevHour = paintedHours[0];
            for (let i = 1; i <= paintedHours.length; i++) {
                const hour = paintedHours[i];
                if (hour === prevHour + 1 && pieHours.get(hour) === pieHours.get(prevHour)) {
                    prevHour = hour;
                    continue;
                }
                drawWedge(startHour, prevHour + 1, categoryColor(pieHours.get(prevHour)!));
                if (hour === undefined) break;
                startHour = hour;
                prevHour = hour;
            }
        }

        // 24 条刻度与小时数字
        for (let hour = 0; hour < 24; hour++) {
            const [x1, y1] = point(hour, radius);
            const [x2, y2] = point(hour, radius - 6);
            add('line', { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2) })
                .style.stroke = 'var(--background-modifier-border)';

            const [labelX, labelY] = point(hour, radius - 20);
            const isMajorHour = hour % 6 === 0;
            const label = add('text', {
                x: String(labelX),
                y: String(labelY),
                'text-anchor': 'middle',
                'dominant-baseline': 'middle',
                'font-size': isMajorHour ? '14' : '9',
                'font-weight': isMajorHour ? '700' : '400',
            });
            label.style.fill = 'var(--text-muted)';
            label.textContent = String(hour);
        }

        // 背景半区图标：灰色夜间扇区放月亮，白昼一侧放太阳（位于时间数字内侧）
        const [moonX, moonY] = point(0, 50);
        const moon = add('text', {
            x: String(moonX),
            y: String(moonY),
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            'font-size': '18',
        });
        moon.textContent = '🌛';
        moon.style.opacity = '0.85';
        const [sunX, sunY] = point(12, 50);
        const sun = add('text', {
            x: String(sunX),
            y: String(sunY),
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            'font-size': '18',
        });
        sun.textContent = '🌞';
        sun.style.opacity = '0.85';

        // 时针：仅在查看今天时绘制，指向当前时:分（1 小时 = 15°）
        if (makeDayKey(new Date()) === makeDayKey(this.selectedDate)) {
            const now = new Date();
            const handHour = now.getHours() + now.getMinutes() / 60;
            const [tipX, tipY] = point(handHour, radius - 12);
            const [tailX, tailY] = point(handHour, -8);
            // 指针颜色跟随饼图上当前时刻所属小时的分类色，未涂色时回退为强调色
            const currentHour = Math.floor(handHour);
            const handColor = pieHours.has(currentHour)
                ? categoryColor(pieHours.get(currentHour)!)
                : 'var(--interactive-accent)';
            const hand = add('line', {
                x1: String(tailX),
                y1: String(tailY),
                x2: String(tipX),
                y2: String(tipY),
            });
            hand.style.stroke = handColor;
            hand.style.strokeWidth = '3.5';
            hand.style.strokeLinecap = 'round';
            hand.style.opacity = '0.8';
            const hub = add('circle', { cx: String(cx), cy: String(cy), r: '4' });
            hub.style.fill = handColor;
            hub.style.opacity = '0.8';
        }

        // 外环：所选日期已保存的执行记录（按时长占比绘制弧段，重叠按开始时间覆盖）
        const dayStart = new Date(this.selectedDate);
        const dayStartMs = dayStart.getTime();
        const dayEndMs = dayStartMs + 24 * 3600000;

        /** 生成 [startHour, endHour] 的弧线路径（指定半径） */
        const arcPath = (start: number, end: number, r: number): string => {
            const [sx, sy] = point(start, r);
            const [ex, ey] = point(end, r);
            const largeArc = end - start > 12 ? 1 : 0;
            return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`;
        };

        const drawArc = (startHour: number, endHour: number, color: string, opacity = 1): SVGElement | null => {
            const start = Math.max(0, Math.min(24, startHour));
            const end = Math.max(0, Math.min(24, endHour));
            if (end - start <= 0.0001) return null;
            const node: SVGElement = start === 0 && end === 24
                ? add('circle', { cx: String(cx), cy: String(cy), r: String(ringRadius), fill: 'none' })
                : add('path', { d: arcPath(start, end, ringRadius), fill: 'none' });
            node.style.stroke = color;
            node.style.strokeWidth = '10';
            node.style.strokeLinecap = 'butt';
            if (opacity !== 1) {
                node.style.opacity = String(opacity);
                // 半透明的进行中弧段不参与鼠标命中，避免遮挡下方记录的悬浮效果
                node.style.pointerEvents = 'none';
            }
            return node;
        };

        /**
         * 外环弧段的悬浮效果：整块时钟被悬浮时所有弧段一起外扩（半径增大 + 描边加粗），
         * 并在下方叠加一圈更宽的描边作为边框高亮。
         * selected 为 true 时保持选中态（与悬浮样式一致）。
         */
        const ringEntries: {
            applyActive: () => void;
            applyNormal: () => void;
            selected: boolean;
        }[] = [];
        const attachArcHover = (
            node: SVGElement,
            startHour: number,
            endHour: number,
            selected: boolean,
            isCircle: boolean,
            withHalo = true,
        ): void => {
            let halo: SVGElement | null = null;
            if (withHalo && !isCircle) {
                halo = add('path', { d: arcPath(startHour, endHour, ringRadius + 3), fill: 'none' });
                halo.style.stroke = 'var(--interactive-accent)';
                halo.style.strokeWidth = '18';
                halo.style.strokeLinecap = 'butt';
                halo.style.opacity = '0';
                halo.style.pointerEvents = 'none';
                // 光晕置于弧段下方，悬浮时表现为边框高亮
                node.parentNode?.insertBefore(halo, node);
            }

            const applyActive = (): void => {
                if (isCircle) node.setAttribute('r', String(ringRadius + 3));
                else node.setAttribute('d', arcPath(startHour, endHour, ringRadius + 3));
                node.style.strokeWidth = '14';
                if (halo) halo.style.opacity = '1';
            };
            const applyNormal = (): void => {
                if (isCircle) node.setAttribute('r', String(ringRadius));
                else node.setAttribute('d', arcPath(startHour, endHour, ringRadius));
                node.style.strokeWidth = '10';
                if (halo) halo.style.opacity = '0';
            };

            if (selected) applyActive();
            ringEntries.push({ applyActive, applyNormal, selected });
        };

        const todayRecords = this.taskExecutionRepo.records
            .filter((record) => record.endAt > dayStartMs && record.startAt < dayEndMs)
            .sort((a, b) => a.startAt - b.startAt);
        for (const record of todayRecords) {
            const start = Math.max(dayStartMs, record.startAt);
            const end = Math.min(dayEndMs, record.endAt);
            const startHour = (start - dayStartMs) / 3600000;
            const endHour = (end - dayStartMs) / 3600000;
            const arc = drawArc(startHour, endHour, this.categoryColorOf(record.taskId));
            if (arc) {
                const isSelected = record.id === this.selectedRecordId;
                // 整圈记录用 circle 绘制，同样参与整钟悬浮放大
                attachArcHover(arc, startHour, endHour, isSelected, startHour === 0 && endHour === 24);
                // 点击弧段：在记录视图中选中对应条目，并保持弧段选中态
                arc.style.cursor = 'pointer';
                arc.addEventListener('click', (event: MouseEvent) => {
                    event.stopPropagation();
                    this.selectRecordFromArc(record.id);
                });
            }
        }

        // 进行中的计时：仅在查看今天时实时追加半透明弧段
        if (this.isTodaySelected() && this.runningStartedAt && this.runningTodayTaskId) {
            const now = Date.now();
            const start = Math.max(dayStartMs, this.runningStartedAt.getTime());
            const end = Math.min(dayEndMs, now);
            if (end > start) {
                const runningArc = drawArc(
                    (start - dayStartMs) / 3600000,
                    (end - dayStartMs) / 3600000,
                    this.categoryColorOf(this.runningTodayTaskId),
                    0.5,
                );
                // 进行中弧段同样随整钟悬浮加宽，但不叠加光晕
                if (runningArc) {
                    attachArcHover(
                        runningArc,
                        (start - dayStartMs) / 3600000,
                        (end - dayStartMs) / 3600000,
                        false,
                        false,
                        false,
                    );
                }
            }
        }

        // 整块时钟悬浮：所有环形一起加宽；移出后恢复（选中弧段保持加宽）
        svg.addEventListener('mouseenter', () => {
            for (const entry of ringEntries) {
                if (!entry.selected) entry.applyActive();
            }
        });
        svg.addEventListener('mouseleave', () => {
            for (const entry of ringEntries) {
                if (!entry.selected) entry.applyNormal();
            }
        });
    }

    /** 任务分类颜色（无分类 / 分类已删除时使用未分类灰色） */
    private categoryColorOf(taskId: string): string {
        const task = this.prototypeTaskRepo.tasks.find((item) => item.id === taskId);
        const category = task?.categoryId
            ? this.categoryData.categories.find((item) => item.id === task.categoryId)
            : undefined;
        return category?.color ?? '#888888';
    }
}
