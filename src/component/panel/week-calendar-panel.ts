// 周历面板：基于 FloatingPanel 的日历式展示。
// 结构：顶部窄条一行（第一列为 PLAN/CHECK，其余六列为 ACT），下方一行 × 七列日期格子（周一至周日），
// 日期行下方为一块填满剩余位置的「这周目标」卡片（汇总各任务绑定到该周的目标）。
import { setIcon } from 'obsidian';

import type { PrototypeTask, TaskGoalEntry } from '../../datatypes/prototype-task';
import { getLang, t } from '../../i18n';
import { getCurrentDayKey, getCurrentWeekKey, makeDayKeyFromWeek } from '../../shared/plan-data';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';

/** 周历面板配置 */
export interface WeekCalendarPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「周历」 */
    title?: string;
    /** 起始周键（第一行），默认本周 */
    startWeekKey?: string;
    /** 需要高亮的日期键（默认今天） */
    highlightDayKey?: string;
    /** 任务列表提供者（用于汇总该周绑定的目标） */
    getTasks?: () => PrototypeTask[];
    /** 点击周目标条目时回调（打开所属任务详情） */
    onOpenTask?: (task: PrototypeTask) => void;
}

/** 顶部窄条每列的文案：首列 PLAN/CHECK，其余 ACT */
const STRIP_LABELS = ['PLAN/CHECK', 'ACT', 'ACT', 'ACT', 'ACT', 'ACT', 'ACT'];

/** 周历面板 */
export class WeekCalendarPanel extends FloatingPanel {
    /** 面板配置（含数据提供者） */
    private readonly panelOptions: WeekCalendarPanelOptions;
    /** 当前展示的周键 */
    private startWeekKey: string;
    /** 当前高亮的日期键（未设置时高亮今天） */
    private highlightDayKey?: string;

    constructor(options: WeekCalendarPanelOptions = {}) {
        super({
            width: 560,
            title: options.title ?? t('panel.weekCalendarTitle'),
            ...options,
        });
        this.panelOptions = options;
        this.startWeekKey = options.startWeekKey ?? getCurrentWeekKey();
        this.highlightDayKey = options.highlightDayKey;
        this.renderCalendar();
    }

    /** 重新渲染（周目标数据变化后刷新） */
    refresh(): void {
        this.body.empty();
        this.renderCalendar();
    }

    /** 切换展示的周并高亮指定日期（不传则高亮今天） */
    showWeek(weekKey: string, highlightDayKey?: string): void {
        this.startWeekKey = weekKey;
        this.highlightDayKey = highlightDayKey;
        this.refresh();
    }

    /** 渲染顶部窄条 + 一行七列日期格子 + 「这周目标」卡片 */
    private renderCalendar(): void {
        const body = this.body;
        body.addClass('week-calendar-panel');
        const grid = body.createDiv({ cls: 'week-calendar-grid' });

        // 第一行：顶部窄条（每列一条，与下方格子对齐）
        for (let col = 0; col < 7; col++) {
            const strip = grid.createDiv({ cls: 'week-calendar-strip' });
            strip.setText(STRIP_LABELS[col]);
            if (col === 0) strip.addClass('is-plan-check');
        }

        // 日期格子：只保留一行（周一至周日）
        const highlightKey = this.highlightDayKey ?? getCurrentDayKey();
        for (let col = 0; col < 7; col++) {
            const dayKey = makeDayKeyFromWeek(this.startWeekKey, col + 1);
            const cell = grid.createDiv({ cls: 'week-calendar-cell' });
            if (dayKey === highlightKey) cell.addClass('is-today');
            cell.setText(String(Number(dayKey.slice(8, 10))));
        }

        // 原第二、三行的位置：一整块方片，填满剩余空间；首行为标题行
        const goalCard = grid.createDiv({ cls: 'week-calendar-goal-card' });
        goalCard.createDiv({ cls: 'week-calendar-goal-title', text: t('panel.weekCalendarGoal') });
        this.renderGoals(goalCard.createDiv({ cls: 'week-calendar-goal-body' }));
    }

    /** 汇总所有任务绑定到当前展示周的目标：按任务分组，任务名一行，目标行（图标 + 名称 + 截止）各一行 */
    private renderGoals(container: HTMLElement): void {
        const tasks = this.panelOptions.getTasks?.() ?? [];
        const seen = new Set<string>();
        const groups = new Map<string, { owner: PrototypeTask; goals: TaskGoalEntry[] }>();
        const ordered: { owner: PrototypeTask; goals: TaskGoalEntry[] }[] = [];
        for (const task of tasks) {
            const refs = task.weekGoals?.find((entry) => entry.weekKey === this.startWeekKey)?.goalRefs ?? [];
            for (const ref of refs) {
                const key = `${ref.taskId}:${ref.goalId}`;
                if (seen.has(key)) continue;
                const owner = tasks.find((item) => item.id === ref.taskId);
                const goal = owner?.goals?.find((item) => item.id === ref.goalId);
                if (!owner || !goal) continue;
                seen.add(key);
                let group = groups.get(owner.id);
                if (!group) {
                    group = { owner, goals: [] };
                    groups.set(owner.id, group);
                    ordered.push(group);
                }
                group.goals.push(goal);
            }
        }
        if (ordered.length === 0) {
            container.createDiv({ cls: 'week-calendar-goal-empty', text: t('panel.planGoalEmpty') });
            return;
        }
        const list = container.createDiv({ cls: 'week-calendar-goal-list' });
        for (const { owner, goals } of ordered) {
            const group = list.createDiv({ cls: 'week-calendar-goal-group' });
            group.createDiv({
                cls: 'week-calendar-goal-group-title',
                text: `${t('panel.weekGoalTaskPrefix')}${owner.name}`,
            });
            for (const goal of goals) {
                const item = group.createDiv({ cls: 'week-calendar-goal-item' });
                setIcon(item.createSpan({ cls: 'week-calendar-goal-icon' }), 'target');
                item.createSpan({ cls: 'week-calendar-goal-label', text: t('panel.weekGoalPrefix') });
                item.createSpan({ cls: 'week-calendar-goal-name', text: goal.text });
                if (goal.dueDate) {
                    item.createSpan({ cls: 'week-calendar-goal-due', text: formatGoalDue(goal.dueDate) });
                }
                if (this.panelOptions.onOpenTask) {
                    item.addClass('is-clickable');
                    item.addEventListener('click', () => this.panelOptions.onOpenTask?.(owner));
                }
            }
        }
    }
}

/** 目标截止日期文案（如 10月30日） */
function formatGoalDue(dueDate: string): string {
    const due = new Date(`${dueDate}T00:00:00`);
    if (Number.isNaN(due.getTime())) return '';
    return getLang() === 'zh'
        ? `${due.getMonth() + 1}月${due.getDate()}日`
        : `${due.getMonth() + 1}/${due.getDate()}`;
}
