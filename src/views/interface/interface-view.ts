// 界面视图：新一级视图「界面」下的二级落地页。
// 布局：左侧日期 / 任务 / OKR 三张小卡片，右侧计划 / 检查 / 收集 / 画廊 / 成就榜单 / 数据六张卡片，底部一个方框。
import { Menu, TFolder, setIcon } from 'obsidian';
import type { App, Plugin } from 'obsidian';

import type { PrototypeTask, PrototypeTaskType } from '../../datatypes/prototype-task';
import { t } from '../../i18n';
import { AchievementPanel } from '../../panel/achievement-panel';
import { CheckPanel } from '../../panel/check-panel';
import { CollectPanel } from '../../panel/collect-panel';
import { DataPanel } from '../../panel/data-panel';
import { FolderPickerPanel } from '../../panel/folder-picker-panel';
import { GalleryPanel } from '../../panel/gallery-panel';
import { PlanPanel } from '../../panel/plan-panel';
import { TaskDetailPanel } from '../../panel/task-detail-panel';
import { TaskPanel } from '../../panel/task-panel';
import { TaskPickerPanel } from '../../panel/task-picker-panel';
import { TaskRecordPanel } from '../../panel/task-record-panel';
import { TimeBoxPanel } from '../../panel/time-box-panel';
import { WeekCalendarPanel } from '../../panel/week-calendar-panel';
import type { CategoryRepo } from '../../repos/category-repo';
import type { BottomItemRepo } from '../../repos/bottom-item-repo';
import type { PdcaRepo } from '../../repos/pdca-repo';
import type { PlanAssignmentRepo } from '../../repos/plan-assignment-repo';
import type { PrototypeTaskRepo } from '../../repos/prototype-task-repo';
import type { TaskExecutionRepo } from '../../repos/task-execution-repo';
import type { PlanCategoryData } from '../../shared/plan-category-manager';
import { getCurrentDayKey, getISOWeek, makeDayKey, makeWeekKey } from '../../shared/plan-data';
import { ConfirmModal } from '../../system/confirm-modal';
import type { TimeBoxRepo } from '../../repos/timebox-repo';

/** 右侧入口卡片：文案 key */
const ENTRY_CARDS: Parameters<typeof t>[0][] = [
    'interface.plan',
    'interface.check',
    'interface.collect',
    'interface.gallery',
    'achievement.title',
];

/** 当天 0 点 */
function startOfToday(): Date {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
}

/**
 * 界面视图：与其它二级视图一致，通过 renderInto 渲染到指定容器。
 */
export class InterfaceView {
    private app: App;
    private plugin: Plugin;
    /** 日期卡片对应的周历面板（懒创建，复用同一个实例） */
    private datePanel: WeekCalendarPanel | null = null;
    /** 任务卡片对应的任务面板 */
    private taskPanel: TaskPanel | null = null;
    /** 任务详情面板（按任务 id 复用） */
    private detailPanels = new Map<string, TaskDetailPanel>();
    /** 时间盒卡片对应的面板 */
    private timeBoxPanel: TimeBoxPanel | null = null;
    /** 任务选择面板（复用同一实例） */
    private taskPickerPanel: TaskPickerPanel | null = null;
    /** 文件夹选择面板（复用同一实例） */
    private folderPickerPanel: FolderPickerPanel | null = null;
    /** 底部方框条目列表容器 */
    private bottomListEl: HTMLElement | null = null;
    /** 计划卡片对应的面板 */
    private planPanel: PlanPanel | null = null;
    /** 检查卡片对应的面板 */
    private checkPanel: CheckPanel | null = null;
    /** 收集卡片对应的面板 */
    private collectPanel: CollectPanel | null = null;
    /** 画廊卡片对应的面板 */
    private galleryPanel: GalleryPanel | null = null;
    /** 成就榜单卡片对应的面板 */
    private achievementPanel: AchievementPanel | null = null;
    /** 数据卡片对应的面板 */
    private dataPanel: DataPanel | null = null;
    /** 分类数据（与周计划视图共享同一份） */
    private categoryData: PlanCategoryData;
    /** 「今天任务」方框右侧任务列表容器 */
    private todayTaskListEl: HTMLElement | null = null;
    /** 「额外任务」列表容器 */
    private todayExtraListEl: HTMLElement | null = null;
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

    constructor(app: App, plugin: Plugin, categoryData: PlanCategoryData) {
        this.app = app;
        this.plugin = plugin;
        this.categoryData = categoryData;
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

    /** 底部方框条目仓库 */
    private get bottomItemRepo(): BottomItemRepo {
        return (this.plugin as Plugin & { bottomItemRepo: BottomItemRepo }).bottomItemRepo;
    }

    /** 唯一持久化出口 */
    private saveAll(): Promise<void> {
        return (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
    }

    /** 点击日期卡片：打开周历面板 */
    private openDatePanel(): void {
        this.datePanel ??= new WeekCalendarPanel();
        this.datePanel.open();
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

    /** 点击任务卡片：打开任务面板 */
    private openTaskPanel(): void {
        if (!this.taskPanel) {
            this.taskPanel = new TaskPanel({
                tasks: this.rootPrototypeTasks(),
                onSubmit: (payload) => this.addPrototypeTask(payload.name, payload.type),
                onTaskClick: (task) => this.openTaskDetail(task),
            });
        } else {
            this.taskPanel.setTasks(this.rootPrototypeTasks());
        }
        this.taskPanel.open();
    }

    /** 点击时间盒卡片：打开时间盒面板 */
    private openTimeBoxPanel(): void {
        if (!this.timeBoxPanel) {
            const holder = this.plugin as Plugin & {
                timeBoxRepo: ConstructorParameters<typeof TimeBoxPanel>[0]['timeBoxRepo'];
                saveAll: () => Promise<void>;
            };
            this.timeBoxPanel = new TimeBoxPanel({
                app: this.app,
                categoryData: this.categoryData,
                categoryRepo: (this.plugin as Plugin & { categoryRepo: CategoryRepo }).categoryRepo,
                timeBoxRepo: holder.timeBoxRepo,
                save: () => holder.saveAll(),
            });
        }
        this.timeBoxPanel.open();
    }

    /** 点击计划卡片：打开计划面板 */
    private openPlanPanel(): void {
        if (!this.planPanel) {
            const holder = this.plugin as Plugin & {
                planAssignmentRepo: ConstructorParameters<typeof PlanPanel>[0]['planAssignmentRepo'];
                saveAll: () => Promise<void>;
            };
            this.planPanel = new PlanPanel({
                getTasks: () => this.prototypeTaskRepo.tasks,
                getCategories: () => this.categoryData.categories,
                planAssignmentRepo: holder.planAssignmentRepo,
                save: () => holder.saveAll(),
                onChanged: () => this.renderTodayTasks(),
            });
        }
        this.planPanel.open();
    }

    /** 点击检查卡片：打开检查面板 */
    private openCheckPanel(): void {
        if (!this.checkPanel) {
            const holder = this.plugin as Plugin & {
                timeBoxRepo: ConstructorParameters<typeof CheckPanel>[0]['timeBoxRepo'];
            };
            this.checkPanel = new CheckPanel({
                categoryData: this.categoryData,
                timeBoxRepo: holder.timeBoxRepo,
                taskExecutionRepo: this.taskExecutionRepo,
                getTasks: () => this.prototypeTaskRepo.tasks,
                onOpenData: () => this.openDataPanel(),
            });
        }
        this.checkPanel.open();
    }

    /** 点击收集卡片：打开收集面板（内容复用 GTD 收集视图） */
    private openCollectPanel(): void {
        const holder = this.plugin as Plugin & {
            gtdRepo: ConstructorParameters<typeof CollectPanel>[0]['gtdRepo'];
            saveAll: () => Promise<void>;
        };
        this.collectPanel ??= new CollectPanel({
            app: this.app,
            gtdRepo: holder.gtdRepo,
            save: () => holder.saveAll(),
            getTasks: () => this.prototypeTaskRepo.tasks,
        });
        this.collectPanel.open();
    }

    /** 点击画廊卡片：打开画廊面板 */
    private openGalleryPanel(): void {
        this.galleryPanel ??= new GalleryPanel();
        this.galleryPanel.open();
    }

    /** 点击成就榜单卡片：打开成就榜单面板 */
    private openAchievementPanel(): void {
        this.achievementPanel ??= new AchievementPanel();
        this.achievementPanel.open();
    }

    /** 打开数据面板（由检查面板顶部的「数据」按钮触发） */
    private openDataPanel(): void {
        this.dataPanel ??= new DataPanel();
        this.dataPanel.open();
    }

    /** 打开任务详情面板（同一任务复用实例） */
    private openTaskDetail(task: PrototypeTask): void {
        let panel = this.detailPanels.get(task.id);
        if (!panel) {
            panel = new TaskDetailPanel({
                task,
                tasks: this.prototypeTaskRepo.tasks,
                categoryData: this.categoryData,
                onAddChild: (name, parentId) => this.addPrototypeTask(name, task.type, parentId),
                onUpdateTask: (taskId, patch) => this.updatePrototypeTask(taskId, patch),
            });
            this.detailPanels.set(task.id, panel);
        } else {
            panel.setTasks(this.prototypeTaskRepo.tasks);
        }
        panel.open();
    }

    /** 根原型任务（不含子任务） */
    private rootPrototypeTasks(): PrototypeTask[] {
        return this.prototypeTaskRepo.tasks.filter((task) => !task.parentId);
    }

    /** 新增原型任务：写仓库 + 持久化 + 刷新面板列表与详情树 */
    private addPrototypeTask(name: string, type: PrototypeTaskType, parentId?: string): void {
        this.prototypeTaskRepo.add(name, type, parentId);
        void (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
        this.taskPanel?.setTasks(this.rootPrototypeTasks());
        this.detailPanels.forEach((panel) => panel.setTasks(this.prototypeTaskRepo.tasks));
        this.renderTodayTasks();
    }

    /** 更新原型任务的描述 / 分类：写仓库 + 持久化 */
    private updatePrototypeTask(taskId: string, patch: { description?: string; categoryId?: string }): void {
        this.prototypeTaskRepo.update(taskId, patch);
        void (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
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

    async renderInto(container: HTMLElement): Promise<void> {
        this.stopTodayTimer();
        // 视图重建后回到常规视图
        this.recordViewActive = false;
        this.selectedRecordId = undefined;
        container.empty();
        container.addClass('interface-view');

        const main = container.createDiv({ cls: 'interface-main' });

        // 左侧：日期 / 任务
        const left = main.createDiv({ cls: 'interface-col is-left' });

        const dateCard = left.createDiv({ cls: 'interface-card interface-date-card' });
        const now = new Date();
        dateCard.createDiv({
            cls: 'interface-date-month',
            text: t('interface.monthTitle', { month: String(now.getMonth() + 1) }),
        });
        dateCard.createDiv({ cls: 'interface-date-day', text: String(now.getDate()) });
        dateCard.addEventListener('click', () => this.openDatePanel());

        const taskCard = left.createDiv({ cls: 'interface-card interface-metric-card' });
        taskCard.createSpan({ cls: 'interface-metric-label', text: t('interface.task') });
        taskCard.createSpan({ cls: 'interface-metric-value', text: '0' });
        taskCard.addEventListener('click', () => this.openTaskPanel());

        const timeBoxCard = left.createDiv({ cls: 'interface-card interface-entry-card', text: t('interface.timeBox') });
        timeBoxCard.addEventListener('click', () => this.openTimeBoxPanel());

        // 中间：今日任务方框（左侧 24 小时时钟 + 右侧今日排布任务）
        const today = main.createDiv({ cls: 'interface-today' });
        today.createDiv({ cls: 'interface-today-title', text: t('interface.todayTitle') });
        const todayBody = today.createDiv({ cls: 'interface-today-body' });
        const todayLeft = todayBody.createDiv({ cls: 'interface-today-left' });
        this.clockEl = todayLeft.createDiv({ cls: 'interface-today-clock' });
        this.renderClock(this.clockEl);
        this.startClockTicker();

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

        // 右侧：计划 / 检查 / 收集 / 画廊 / 成就榜单
        const right = main.createDiv({ cls: 'interface-col is-right' });
        for (const key of ENTRY_CARDS) {
            const card = right.createDiv({ cls: 'interface-card interface-entry-card', text: t(key) });
            if (key === 'interface.plan') card.addEventListener('click', () => this.openPlanPanel());
            if (key === 'interface.check') card.addEventListener('click', () => this.openCheckPanel());
            if (key === 'interface.collect') card.addEventListener('click', () => this.openCollectPanel());
            if (key === 'interface.gallery') card.addEventListener('click', () => this.openGalleryPanel());
            if (key === 'achievement.title') card.addEventListener('click', () => this.openAchievementPanel());
        }

        // 底部方框：右上角 + 号（下拉菜单）+ 条目卡片列表
        const bottom = container.createDiv({ cls: 'interface-bottom' });
        const bottomHeader = bottom.createDiv({ cls: 'interface-bottom-header' });
        bottomHeader.createDiv({ cls: 'interface-bottom-title', text: t('interface.bottomTitle') });
        const bottomAddBtn = bottomHeader.createEl('button', {
            cls: 'interface-today-add',
            attr: { 'aria-label': t('interface.bottomAdd') },
        });
        setIcon(bottomAddBtn, 'plus');
        bottomAddBtn.addEventListener('click', (evt) => this.openBottomAddMenu(evt));
        this.bottomListEl = bottom.createDiv({ cls: 'interface-bottom-list' });
        this.renderBottomItems();
    }

    /** 底部方框「+」：下拉菜单（当前仅「文件夹」） */
    private openBottomAddMenu(evt: MouseEvent): void {
        const menu = new Menu();
        menu.addItem((item) => item
            .setTitle(t('interface.bottomFolder'))
            .setIcon('folder')
            .onClick(() => this.openFolderPicker()));
        menu.showAtMouseEvent(evt);
    }

    /** 打开文件夹选择面板，确认后加入底部方框并持久化 */
    private openFolderPicker(): void {
        if (!this.folderPickerPanel) {
            this.folderPickerPanel = new FolderPickerPanel(this.app, {
                onConfirm: (result) => {
                    this.bottomItemRepo.addFolder(result.path, result.name);
                    void this.saveAll();
                    this.renderBottomItems();
                },
            });
        }
        this.folderPickerPanel.open();
    }

    /** 渲染底部方框条目 */
    private renderBottomItems(): void {
        const listEl = this.bottomListEl;
        if (!listEl) return;
        listEl.empty();
        const items = this.bottomItemRepo.items;
        if (items.length === 0) {
            listEl.createDiv({ cls: 'interface-today-empty', text: t('interface.bottomEmpty') });
            return;
        }
        for (const item of items) {
            const card = listEl.createDiv({ cls: 'interface-bottom-card' });
            const iconEl = card.createSpan({ cls: 'interface-bottom-card-icon' });
            setIcon(iconEl, 'folder');
            card.createSpan({ cls: 'interface-bottom-card-label', text: item.name });
            card.addEventListener('click', () => this.revealFolder(item.path));
        }
    }

    /** 在 Obsidian 文件列表中定位并展开指定文件夹 */
    private revealFolder(path: string): void {
        const folder = this.app.vault.getAbstractFileByPath(path);
        if (!(folder instanceof TFolder)) return;
        type FileExplorer = { instance?: { revealInFolder?: (target: TFolder) => void } };
        const explorer = (this.app as unknown as {
            internalPlugins: { getPluginById(id: string): FileExplorer | null };
        }).internalPlugins.getPluginById('file-explorer');
        explorer?.instance?.revealInFolder?.(folder);
    }
}