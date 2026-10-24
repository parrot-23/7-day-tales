// 界面视图：新一级视图「界面」下的二级落地页。
// 布局：左侧日期 / 任务 / OKR 三张小卡片，右侧计划 / 检查 / 收集 / 画廊 / 成就榜单 / 数据六张卡片，底部一个方框。
import { setIcon } from 'obsidian';
import type { App, Plugin } from 'obsidian';

import type { PrototypeTask, PrototypeTaskType } from '../../datatypes/prototype-task';
import { t } from '../../i18n';
import { AchievementPanel } from '../../panel/achievement-panel';
import { CheckPanel } from '../../panel/check-panel';
import { CollectPanel } from '../../panel/collect-panel';
import { DataPanel } from '../../panel/data-panel';
import { GalleryPanel } from '../../panel/gallery-panel';
import { PlanPanel } from '../../panel/plan-panel';
import { TaskDetailPanel } from '../../panel/task-detail-panel';
import { TaskPanel } from '../../panel/task-panel';
import { TaskRecordPanel } from '../../panel/task-record-panel';
import { TimeBoxPanel } from '../../panel/time-box-panel';
import { WeekCalendarPanel } from '../../panel/week-calendar-panel';
import type { CategoryRepo } from '../../repos/category-repo';
import type { PlanAssignmentRepo } from '../../repos/plan-assignment-repo';
import type { PrototypeTaskRepo } from '../../repos/prototype-task-repo';
import type { TaskExecutionRepo } from '../../repos/task-execution-repo';
import type { PlanCategoryData } from '../../shared/plan-category-manager';
import { getISOWeek, makeWeekKey } from '../../shared/plan-data';

/** 右侧入口卡片：文案 key */
const ENTRY_CARDS: Parameters<typeof t>[0][] = [
    'interface.plan',
    'interface.check',
    'interface.collect',
    'interface.gallery',
    'achievement.title',
    'nav.data',
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
    /** 任务记录面板 */
    private recordPanel: TaskRecordPanel | null = null;
    /** 24 小时时钟容器（计时中每秒重绘外环） */
    private clockEl: HTMLElement | null = null;

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

    /** 点击日期卡片：打开周历面板 */
    private openDatePanel(): void {
        this.datePanel ??= new WeekCalendarPanel();
        this.datePanel.open();
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

    /** 点击数据卡片：打开数据面板 */
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

    /** 渲染「今天任务」方框右侧列表：计划面板中排布到所选日期的任务 */
    private renderTodayTasks(): void {
        const listEl = this.todayTaskListEl;
        if (!listEl?.isConnected) return;
        listEl.empty();
        const weekday = this.selectedDate.getDay() === 0 ? 7 : this.selectedDate.getDay();
        const tasks = new Map(this.prototypeTaskRepo.tasks.map((task) => [task.id, task]));
        const planned = this.planAssignmentRepo.dayAssignments(this.selectedWeekKey(), weekday)
            .map((assignment) => tasks.get(assignment.taskId))
            .filter((task): task is PrototypeTask => task !== undefined);
        if (planned.length === 0) {
            this.selectedTodayTaskId = undefined;
            listEl.createDiv({ cls: 'interface-today-empty', text: t('interface.todayNoTask') });
            this.updateTodaySelection();
            return;
        }
        if (!planned.some((task) => task.id === this.selectedTodayTaskId)) {
            this.selectedTodayTaskId = undefined;
        }
        for (const task of planned) {
            const row = listEl.createDiv({ cls: 'interface-today-task' });
            row.dataset.taskId = task.id;
            row.toggleClass('is-selected', task.id === this.selectedTodayTaskId);
            row.title = task.name;
            row.createSpan({ cls: 'interface-today-task-name', text: task.name });
        }
        this.updateTodaySelection();
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

    /** 打开记录面板：默认开始时间为 30 分钟前、结束时间为当前时间 */
    private openRecordPanel(): void {
        const taskId = this.selectedTodayTaskId;
        if (!taskId) return;
        const task = this.prototypeTaskRepo.tasks.find((item) => item.id === taskId);
        if (!task) return;

        const end = new Date();
        const start = new Date(end.getTime() - 30 * 60000);
        this.recordPanel?.destroy();
        this.recordPanel = new TaskRecordPanel({
            title: `${t('panel.taskRecordTitle')} · ${task.name}`,
            startTime: this.formatClockTime(start),
            endTime: this.formatClockTime(end),
            onConfirm: (startAt, endAt) => {
                this.taskExecutionRepo.add(taskId, startAt, endAt);
                void (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
                this.refreshClock();
            },
        });
        this.recordPanel.open();
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

    /** 结束 / 放弃当前计时：停止计时、隐藏开始时间与计时器，恢复初始按钮组 */
    private stopRunningTodayTask(): void {
        this.stopTodayTimer();
        this.todayTimerEl?.addClass('is-hidden');
        if (this.todayTimerElapsedEl) this.todayTimerElapsedEl.textContent = '00:00';
        this.renderTodayActions(false);
        this.refreshClock();
    }

    /** 刷新任务列表选中态与开始按钮可用状态 */
    private updateTodaySelection(): void {
        this.todayTaskListEl?.querySelectorAll('.interface-today-task').forEach((el) => {
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

    /** 重绘时钟外环（容器被销毁时跳过） */
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
            const angle = (hour * 15 * Math.PI) / 180;
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

        // 24 条刻度与小时数字
        for (let hour = 0; hour < 24; hour++) {
            const [x1, y1] = point(hour, radius);
            const [x2, y2] = point(hour, radius - 6);
            add('line', { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2) })
                .style.stroke = 'var(--background-modifier-border)';

            const [labelX, labelY] = point(hour, radius - 20);
            const label = add('text', {
                x: String(labelX),
                y: String(labelY),
                'text-anchor': 'middle',
                'dominant-baseline': 'middle',
                'font-size': '9',
            });
            label.style.fill = 'var(--text-muted)';
            label.textContent = String(hour);
        }

        // 外环：所选日期已保存的执行记录（按时长占比绘制弧段，重叠按开始时间覆盖）
        const dayStart = new Date(this.selectedDate);
        const dayStartMs = dayStart.getTime();
        const dayEndMs = dayStartMs + 24 * 3600000;

        const drawArc = (startHour: number, endHour: number, color: string, opacity = 1): void => {
            const start = Math.max(0, Math.min(24, startHour));
            const end = Math.max(0, Math.min(24, endHour));
            if (end - start <= 0.0001) return;
            let node: SVGElement;
            if (start === 0 && end === 24) {
                node = add('circle', {
                    cx: String(cx),
                    cy: String(cy),
                    r: String(ringRadius),
                    fill: 'none',
                });
            } else {
                const [sx, sy] = point(start, ringRadius);
                const [ex, ey] = point(end, ringRadius);
                const largeArc = end - start > 12 ? 1 : 0;
                node = add('path', {
                    d: `M ${sx} ${sy} A ${ringRadius} ${ringRadius} 0 ${largeArc} 1 ${ex} ${ey}`,
                    fill: 'none',
                });
            }
            node.style.stroke = color;
            node.style.strokeWidth = '10';
            node.style.strokeLinecap = 'butt';
            if (opacity !== 1) node.style.opacity = String(opacity);
        };

        const todayRecords = this.taskExecutionRepo.records
            .filter((record) => record.endAt > dayStartMs && record.startAt < dayEndMs)
            .sort((a, b) => a.startAt - b.startAt);
        for (const record of todayRecords) {
            const start = Math.max(dayStartMs, record.startAt);
            const end = Math.min(dayEndMs, record.endAt);
            drawArc((start - dayStartMs) / 3600000, (end - dayStartMs) / 3600000, this.categoryColorOf(record.taskId));
        }

        // 进行中的计时：仅在查看今天时实时追加半透明弧段
        if (this.isTodaySelected() && this.runningStartedAt && this.runningTodayTaskId) {
            const now = Date.now();
            const start = Math.max(dayStartMs, this.runningStartedAt.getTime());
            const end = Math.min(dayEndMs, now);
            if (end > start) {
                drawArc((start - dayStartMs) / 3600000, (end - dayStartMs) / 3600000, this.categoryColorOf(this.runningTodayTaskId), 0.5);
            }
        }
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
        todayRight.createDiv({ cls: 'interface-today-section-title', text: t('interface.todayPlannedTitle') });
        this.todayTaskListEl = todayRight.createDiv({ cls: 'interface-today-tasks' });
        this.todayTaskListEl.addEventListener('click', (evt) => {
            const row = (evt.target as HTMLElement).closest('.interface-today-task') as HTMLElement | null;
            const taskId = row?.dataset.taskId;
            if (taskId) {
                this.selectedTodayTaskId = taskId;
                this.updateTodaySelection();
            }
        });
        this.renderTodayTasks();

        // 额外任务：标题行 + 新增按钮
        todayRight.createDiv({ cls: 'interface-today-section-title', text: t('interface.todayExtraTitle') });
        todayRight.createEl('button', {
            cls: 'interface-today-add',
            text: '+',
            attr: { 'aria-label': t('interface.todayAddExtra') },
        });

        // 底部占位：把计时器与按钮组压到方框底部
        todayRight.createDiv({ cls: 'interface-today-spacer' });

        // 开始时间 + 计时器（未开始计时时隐藏）
        this.todayTimerEl = todayRight.createDiv({ cls: 'interface-today-timer is-hidden' });
        this.todayTimerStartEl = this.todayTimerEl.createSpan({ cls: 'interface-today-timer-start' });
        this.todayTimerElapsedEl = this.todayTimerEl.createSpan({ cls: 'interface-today-timer-elapsed', text: '00:00' });

        // 任务列表下方的操作按钮组：未计时为「开始任务 / 记录任务」，计时中为「结束任务 / 放弃任务」
        this.todayActionsEl = todayRight.createDiv({ cls: 'interface-today-actions' });
        this.renderTodayActions(false);

        // 右侧：计划 / 检查 / 收集 / 画廊 / 成就榜单 / 数据
        const right = main.createDiv({ cls: 'interface-col is-right' });
        for (const key of ENTRY_CARDS) {
            const card = right.createDiv({ cls: 'interface-card interface-entry-card', text: t(key) });
            if (key === 'interface.plan') card.addEventListener('click', () => this.openPlanPanel());
            if (key === 'interface.check') card.addEventListener('click', () => this.openCheckPanel());
            if (key === 'interface.collect') card.addEventListener('click', () => this.openCollectPanel());
            if (key === 'interface.gallery') card.addEventListener('click', () => this.openGalleryPanel());
            if (key === 'achievement.title') card.addEventListener('click', () => this.openAchievementPanel());
            if (key === 'nav.data') card.addEventListener('click', () => this.openDataPanel());
        }

        // 底部方框
        const bottom = container.createDiv({ cls: 'interface-bottom' });
        bottom.createDiv({ cls: 'interface-bottom-title', text: t('interface.bottomTitle') });
    }
}