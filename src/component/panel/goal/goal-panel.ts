// 任务目标面板：左右结构。
// 左侧：设置了目标的任务卡片列表（第一行任务层级路径，第二行任务名称，末尾目标数量）。
// 右侧：泳道图，每列一周（当前周前 4 周 ~ 后 8 周），每个任务一行，
// 按目标截止日期所在周绘制目标图标，图标下方显示目标文本。
import { setIcon } from 'obsidian';

import type { PrototypeTask, TaskGoalEntry } from '../../../datatypes/prototype-task';
import { t } from '../../../i18n';
import {
    getCurrentWeekKey,
    getISOWeek,
    makeDayKeyFromWeek,
    makeWeekKey,
    parseWeekKey,
    shiftWeekKey,
} from '../../../shared/plan-data';
import { FloatingPanel, type FloatingPanelOptions } from '../basic/floating-panel';

/** 任务目标面板配置 */
export interface GoalPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「任务目标」 */
    title?: string;
    /** 任务数据源 */
    getTasks: () => PrototypeTask[];
}

/** 当前周之前显示的周数 */
const WEEKS_BEFORE = 4;

/** 当前周之后显示的周数 */
const WEEKS_AFTER = 8;

/** 泳道图列宽（px） */
const COLUMN_WIDTH = 96;

/** 泳道图行高（px） */
const ROW_HEIGHT = 44;

/** 任务目标面板 */
export class GoalPanel extends FloatingPanel {
    private readonly panelOptions: GoalPanelOptions;

    constructor(options: GoalPanelOptions) {
        super({
            width: 900,
            title: options.title ?? t('panel.goalPanelTitle'),
            ...options,
        });
        this.panelOptions = options;
        this.body.addClass('goal-panel');
        this.render();
    }

    /** 每次打开时重新读取任务数据 */
    override open(): void {
        this.render();
        super.open();
    }

    /** 渲染左右结构：左侧任务卡片列表 + 右侧泳道图（两侧行高一致，纵向同步滚动） */
    private render(): void {
        this.body.empty();
        const tasks = this.panelOptions.getTasks().filter((task) => (task.goals ?? []).length > 0);
        const byId = new Map(this.panelOptions.getTasks().map((task) => [task.id, task]));

        const left = this.body.createDiv({ cls: 'goal-panel-left' });
        const right = this.body.createDiv({ cls: 'goal-panel-right' });

        if (tasks.length === 0) {
            left.createDiv({ cls: 'goal-panel-empty', text: t('panel.goalPanelEmpty') });
            return;
        }

        // 左侧：表头占位（与右侧周数表头等高）+ 任务卡片
        left.createDiv({ cls: 'goal-panel-left-header' });
        const leftList = left.createDiv({ cls: 'goal-panel-left-list' });
        for (const task of tasks) {
            this.renderTaskCard(leftList, task, byId);
        }

        // 右侧：周数表头 + 泳道行（横向滚动查看所有周）
        const rightHeader = right.createDiv({ cls: 'goal-panel-right-header' });
        const rightBody = right.createDiv({ cls: 'goal-panel-right-body' });
        this.renderLaneChart(rightHeader, rightBody, tasks);

        // 纵向滚动同步：任一侧滚动时另一侧跟随，保证卡片与泳道行始终对齐
        leftList.addEventListener('scroll', () => {
            rightBody.scrollTop = leftList.scrollTop;
        });
        rightBody.addEventListener('scroll', () => {
            leftList.scrollTop = rightBody.scrollTop;
        });
    }

    /** 左侧任务卡片：第一行层级路径，第二行任务名称，末尾目标数量 */
    private renderTaskCard(parentEl: HTMLElement, task: PrototypeTask, byId: Map<string, PrototypeTask>): void {
        const card = parentEl.createDiv({ cls: 'goal-panel-card' });
        card.style.height = `${ROW_HEIGHT}px`;
        card.createDiv({ cls: 'goal-panel-card-path', text: this.getParentPath(task, byId) });
        const head = card.createDiv({ cls: 'goal-panel-card-head' });
        head.createSpan({ cls: 'goal-panel-card-name', text: task.name });
        const count = head.createSpan({ cls: 'goal-panel-card-count' });
        setIcon(count.createSpan({ cls: 'goal-panel-card-count-icon' }), 'target');
        count.createSpan({ cls: 'goal-panel-card-count-text', text: String((task.goals ?? []).length) });
    }

    /** 任务的父层级路径（根任务 > 子任务 …，不含当前任务） */
    private getParentPath(task: PrototypeTask, byId: Map<string, PrototypeTask>): string {
        const names: string[] = [];
        let parentId = task.parentId;
        while (parentId) {
            const parent = byId.get(parentId);
            if (!parent) break;
            names.unshift(parent.name);
            parentId = parent.parentId;
        }
        return names.join(' > ');
    }

    /**
     * 右侧泳道图：表头（周数）与表体（任务行）分两层，宽度一致并一起横向滚动。
     * 表头单独一层，横向滚动时表体滚动、表头跟随，纵向滚动时表头固定。
     */
    private renderLaneChart(headerEl: HTMLElement, bodyEl: HTMLElement, tasks: PrototypeTask[]): void {
        const currentWeekKey = getCurrentWeekKey();
        const weekKeys: string[] = [];
        for (let offset = -WEEKS_BEFORE; offset <= WEEKS_AFTER; offset += 1) {
            weekKeys.push(shiftWeekKey(currentWeekKey, offset));
        }
        const chartWidth = weekKeys.length * COLUMN_WIDTH;

        // 表头：周数（W43）+ 该周周一日期
        const header = headerEl.createDiv({ cls: 'goal-lane-header-row' });
        header.style.width = `${chartWidth}px`;
        for (const weekKey of weekKeys) {
            const cell = header.createDiv({ cls: 'goal-lane-header' });
            cell.style.width = `${COLUMN_WIDTH}px`;
            if (weekKey === currentWeekKey) cell.addClass('is-current');
            const { week } = parseWeekKey(weekKey);
            cell.createDiv({ cls: 'goal-lane-header-week', text: `W${String(week).padStart(2, '0')}` });
            const dayKey = makeDayKeyFromWeek(weekKey, 1);
            cell.createDiv({
                cls: 'goal-lane-header-date',
                text: `${Number(dayKey.slice(5, 7))}/${Number(dayKey.slice(8, 10))}`,
            });
        }

        // 表体：每个任务一行，按目标截止日期所在周放置图标
        const body = bodyEl.createDiv({ cls: 'goal-lane-body' });
        // 用 min-width 撑开内容宽度：flex 子项默认会被压缩，只设 width 不会产生横向溢出
        body.style.minWidth = `${chartWidth}px`;
        for (const task of tasks) {
            const row = body.createDiv({ cls: 'goal-lane-row' });
            row.style.height = `${ROW_HEIGHT}px`;
            for (const goal of task.goals ?? []) {
                const weekKey = this.goalWeekKey(goal);
                // 无截止日期或不在显示范围内的目标不绘制（数量已在左侧卡片体现）
                if (!weekKey) continue;
                const index = weekKeys.indexOf(weekKey);
                if (index < 0) continue;
                const cell = row.createDiv({ cls: 'goal-lane-cell' });
                cell.style.left = `${index * COLUMN_WIDTH}px`;
                cell.style.width = `${COLUMN_WIDTH}px`;
                const iconEl = cell.createSpan({ cls: 'goal-lane-icon' });
                setIcon(iconEl, 'target');
                cell.createSpan({ cls: 'goal-lane-text', text: goal.text });
                cell.title = goal.text;
            }
        }

        // 横向滚动同步：表体滚动时表头跟随
        bodyEl.addEventListener('scroll', () => {
            headerEl.scrollLeft = bodyEl.scrollLeft;
        });
    }

    /** 目标截止日期所在的周键（无截止日期时返回 null） */
    private goalWeekKey(goal: TaskGoalEntry): string | null {
        if (!goal.dueDate) return null;
        const date = new Date(`${goal.dueDate}T00:00:00`);
        if (Number.isNaN(date.getTime())) return null;
        return makeWeekKey(date.getFullYear(), getISOWeek(date));
    }
}
