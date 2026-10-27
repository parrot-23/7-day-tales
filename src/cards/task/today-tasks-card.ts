// 今日任务卡片：界面视图编辑模式下通过「添加」面板加入。
// 结构：< 日期 >（第二行标签：第x周 / 周x / 几天前）+ 习惯 / 当天任务 / 额外任务三个可折叠列表。
import { setIcon } from 'obsidian';
import type { Plugin } from 'obsidian';

import type { PrototypeTask } from '../../datatypes/prototype-task';
import { t } from '../../i18n';
import type { PlanAssignmentRepo } from '../../repos/plan-assignment-repo';
import type { PrototypeTaskRepo } from '../../repos/prototype-task-repo';
import type { TaskExecutionRepo } from '../../repos/task-execution-repo';
import { getISOWeek, makeDayKey, makeWeekKey } from '../../shared/plan-data';

/** 当天 0 点 */
function startOfToday(): Date {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
}

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

/** 三个折叠分区 */
type SectionKey = 'habit' | 'planned' | 'extra';

/** 今日任务卡片配置 */
export interface TodayTasksCardOptions {
    plugin: Plugin;
}

export class TodayTasksCard {
    private readonly options: TodayTasksCardOptions;
    /** 卡片容器 */
    private containerEl: HTMLElement | null = null;
    /** 当前查看的日期（默认今天，仅可回看过去） */
    private selectedDate: Date = startOfToday();
    /** 三个分区的展开状态（默认全部展开） */
    private expanded: Record<SectionKey, boolean> = { habit: true, planned: true, extra: true };

    constructor(options: TodayTasksCardOptions) {
        this.options = options;
    }

    private get plugin(): Plugin {
        return this.options.plugin;
    }

    private get prototypeTaskRepo(): PrototypeTaskRepo {
        return (this.plugin as Plugin & { prototypeTaskRepo: PrototypeTaskRepo }).prototypeTaskRepo;
    }

    private get planAssignmentRepo(): PlanAssignmentRepo {
        return (this.plugin as Plugin & { planAssignmentRepo: PlanAssignmentRepo }).planAssignmentRepo;
    }

    private get taskExecutionRepo(): TaskExecutionRepo {
        return (this.plugin as Plugin & { taskExecutionRepo: TaskExecutionRepo }).taskExecutionRepo;
    }

    /** 在指定容器内渲染卡片 */
    render(parentEl: HTMLElement): void {
        this.containerEl = parentEl.createDiv({ cls: 'interface-today-tasks-card' });
        this.renderContent();
    }

    /** 外部数据变化后刷新（卡片不在 DOM 中时跳过） */
    refresh(): void {
        if (this.containerEl?.isConnected) this.renderContent();
    }

    private renderContent(): void {
        const card = this.containerEl;
        if (!card) return;
        card.empty();
        this.renderNav(card);
        const body = card.createDiv({ cls: 'interface-today-tasks-body' });
        this.renderSection(body, 'habit', t('interface.todayHabitTitle'), this.habitTasks());
        this.renderSection(body, 'planned', t('interface.todayPlannedTitle'), this.plannedTasks());
        this.renderSection(body, 'extra', t('interface.todayExtraTitle'), this.extraTasks());
    }

    /** 第一行：左右箭头 + 日期；第二行：第x周 / 周x / 几天前 标签 */
    private renderNav(card: HTMLElement): void {
        const nav = card.createDiv({ cls: 'interface-today-tasks-nav' });

        const prevBtn = nav.createEl('button', {
            cls: 'interface-today-tasks-nav-btn',
            attr: { type: 'button', 'aria-label': t('interface.dateYesterday') },
        });
        setIcon(prevBtn, 'chevron-left');
        prevBtn.addEventListener('click', () => this.shiftDate(-1));

        const wrap = nav.createDiv({ cls: 'interface-today-tasks-date-wrap' });
        wrap.createDiv({
            cls: 'interface-today-tasks-date',
            text: `${this.selectedDate.getMonth() + 1}/${this.selectedDate.getDate()}`,
        });
        const tags = wrap.createDiv({ cls: 'interface-today-tasks-tags' });
        tags.createSpan({
            cls: 'interface-today-tasks-tag',
            text: t('interface.todayWeekTag', { week: String(getISOWeek(this.selectedDate)) }),
        });
        tags.createSpan({
            cls: 'interface-today-tasks-tag',
            text: t(WEEKDAY_KEYS[this.weekday() - 1]),
        });
        tags.createSpan({ cls: 'interface-today-tasks-tag', text: this.dateRelationLabel() });

        const nextBtn = nav.createEl('button', {
            cls: 'interface-today-tasks-nav-btn',
            attr: { type: 'button', 'aria-label': t('interface.dateTomorrow') },
        });
        setIcon(nextBtn, 'chevron-right');
        nextBtn.disabled = this.isTodaySelected();
        nextBtn.addEventListener('click', () => this.shiftDate(1));
    }

    /** 渲染一个可折叠分区（标题 + 数量 + 任务行） */
    private renderSection(
        body: HTMLElement,
        key: SectionKey,
        title: string,
        tasks: PrototypeTask[],
    ): void {
        const section = body.createDiv({ cls: 'interface-today-tasks-section' });
        const head = section.createDiv({ cls: 'interface-today-tasks-section-head' });
        const chevron = head.createSpan({ cls: 'interface-today-tasks-section-chevron' });
        setIcon(chevron, this.expanded[key] ? 'chevron-down' : 'chevron-right');
        head.createSpan({ cls: 'interface-today-tasks-section-title', text: title });
        head.createSpan({ cls: 'interface-today-tasks-section-count', text: String(tasks.length) });
        head.addEventListener('click', () => {
            this.expanded[key] = !this.expanded[key];
            this.renderContent();
        });
        if (!this.expanded[key]) return;

        const list = section.createDiv({ cls: 'interface-today-tasks-list' });
        if (tasks.length === 0) {
            list.createDiv({ cls: 'interface-today-tasks-empty', text: t('interface.bottomEmpty') });
            return;
        }
        for (const task of tasks) {
            const row = list.createDiv({ cls: 'interface-today-tasks-item' });
            row.title = task.name;
            row.createSpan({ cls: 'interface-today-tasks-item-name', text: task.name });
            row.createSpan({
                cls: 'interface-today-tasks-item-badge',
                text: task.type === 'main' ? t('panel.mainTaskBadge') : t('panel.sideTaskBadge'),
            });
        }
    }

    /** 习惯列表：启用习惯且所选星期生效的任务（按习惯时间排序） */
    private habitTasks(): PrototypeTask[] {
        const weekday = this.weekday();
        return this.prototypeTaskRepo.tasks
            .filter((task) => task.habit?.enabled === true && task.habit.weekdays.includes(weekday))
            .sort((a, b) => (a.habit?.time ?? '').localeCompare(b.habit?.time ?? ''));
    }

    /** 当天任务：计划排布到所选日期的任务 */
    private plannedTasks(): PrototypeTask[] {
        const tasks = this.taskMap();
        return this.planAssignmentRepo
            .dayAssignments(this.weekKey(), this.weekday())
            .map((assignment) => tasks.get(assignment.taskId))
            .filter((task): task is PrototypeTask => task !== undefined);
    }

    /** 额外任务：当日额外加入的任务（与计划任务去重） */
    private extraTasks(): PrototypeTask[] {
        const tasks = this.taskMap();
        const plannedIds = new Set(this.plannedTasks().map((task) => task.id));
        return this.taskExecutionRepo
            .extraTaskIds(makeDayKey(this.selectedDate))
            .map((taskId) => tasks.get(taskId))
            .filter((task): task is PrototypeTask => task !== undefined && !plannedIds.has(task.id));
    }

    private taskMap(): Map<string, PrototypeTask> {
        return new Map(this.prototypeTaskRepo.tasks.map((task) => [task.id, task]));
    }

    /** 所选日期对应星期（1 = 周一 … 7 = 周日） */
    private weekday(): number {
        const day = this.selectedDate.getDay();
        return day === 0 ? 7 : day;
    }

    private weekKey(): string {
        return makeWeekKey(this.selectedDate.getFullYear(), getISOWeek(this.selectedDate));
    }

    private isTodaySelected(): boolean {
        return this.selectedDate.getTime() === startOfToday().getTime();
    }

    /** 切换日期：只能回看过去，不能超过今天 */
    private shiftDate(delta: number): void {
        const next = new Date(this.selectedDate);
        next.setDate(next.getDate() + delta);
        if (next.getTime() > startOfToday().getTime()) return;
        this.selectedDate = next;
        this.renderContent();
    }

    /** 日期相对标签：今天 / 昨天 / N天前 */
    private dateRelationLabel(): string {
        const diff = Math.round((startOfToday().getTime() - this.selectedDate.getTime()) / 86400000);
        if (diff <= 0) return t('interface.dateToday');
        if (diff === 1) return t('interface.dateYesterday');
        return t('interface.dateDaysAgo', { days: String(diff) });
    }
}
