// 任务目标面板：左右结构。
// 左侧：设置了目标的任务卡片列表（第一行任务层级路径，第二行任务名称，末尾目标数量）。
// 右侧：泳道图，每列一周（当前周前 4 周 ~ 后 8 周），每个任务一组行，
// 每个目标独占一行：图标画在截止日期所在周，文字向右延伸（可跨列），
// 遇到后面周的目标图标时提前截断；同一任务内相邻目标之间用白色横线连接。
import { setIcon } from 'obsidian';

import type { PrototypeTask, TaskGoalEntry } from '../../../datatypes/prototype-task';
import { getLang, t } from '../../../i18n';
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

/** 泳道图行高（px）：左侧任务卡片高度 */
const ROW_HEIGHT = 44;

/** 单个目标行高（px） */
const GOAL_ROW_HEIGHT = 20;

/** 任务组内目标行之间的间距（px） */
const GOAL_ROW_GAP = 2;

/** 任务组之间的间距（px） */
const GROUP_GAP = 4;

/** 目标图标列宽（px） */
const ICON_WIDTH = 18;

/** 目标文字与图标之间的间距（px） */
const TEXT_GAP = 4;

/** 目标文字右侧留白（px） */
const TEXT_PADDING = 6;

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
        this.renderLaneChart(rightHeader, rightBody, tasks, byId);

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
        card.style.height = `${this.groupHeight(task)}px`;
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
    private renderLaneChart(
        headerEl: HTMLElement,
        bodyEl: HTMLElement,
        tasks: PrototypeTask[],
        byId: Map<string, PrototypeTask>,
    ): void {
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

        // 表体：每个任务一组行，组内每个目标独占一行
        const body = bodyEl.createDiv({ cls: 'goal-lane-body' });
        // 用 min-width 撑开内容宽度：flex 子项默认会被压缩，只设 width 不会产生横向溢出
        body.style.minWidth = `${chartWidth}px`;
        for (const task of tasks) {
            const group = body.createDiv({ cls: 'goal-lane-group' });
            group.style.height = `${this.groupHeight(task)}px`;
            this.renderGoalRows(group, task, weekKeys, byId);
        }

        // 横向滚动同步：表体滚动时表头跟随
        bodyEl.addEventListener('scroll', () => {
            headerEl.scrollLeft = bodyEl.scrollLeft;
        });
    }

    /**
     * 任务组内的目标：同一行内从左到右依次排布（图标 + 文字 + 白色横线 + 下一个图标 …）。
     * 文字最多延伸到下一个目标图标所在列之前，避免遮挡后面的目标；
     * 一行放不下时换到下一行继续排布。
     */
    private renderGoalRows(
        groupEl: HTMLElement,
        task: PrototypeTask,
        weekKeys: string[],
        byId: Map<string, PrototypeTask>,
    ): void {
        // 只保留有截止日期且落在显示范围内的目标，按截止周从左到右排列
        const placed = (task.goals ?? [])
            .map((goal) => ({ goal, index: this.goalColumnIndex(goal, weekKeys) }))
            .filter((item): item is { goal: TaskGoalEntry; index: number } => item.index >= 0)
            .sort((a, b) => a.index - b.index);

        const chartWidth = weekKeys.length * COLUMN_WIDTH;
        let row: HTMLElement | null = null;
        let rowIndex = -1;
        // 当前行已占用的最右位置（下一个目标图标必须在其右侧）
        let cursor = 0;

        placed.forEach((item, i) => {
            const iconLeft = item.index * COLUMN_WIDTH;
            // 图标落在当前行已占用位置左侧时换行
            if (!row || iconLeft < cursor) {
                rowIndex += 1;
                row = groupEl.createDiv({ cls: 'goal-lane-goal' });
                row.style.top = `${rowIndex * (GOAL_ROW_HEIGHT + GOAL_ROW_GAP)}px`;
                row.style.height = `${GOAL_ROW_HEIGHT}px`;
                cursor = 0;
            }
            const rowEl = row;
            if (item.goal.done) rowEl.addClass('is-done');

            const iconEl = rowEl.createSpan({ cls: 'goal-lane-icon' });
            iconEl.style.left = `${iconLeft}px`;
            iconEl.style.width = `${ICON_WIDTH}px`;
            setIcon(iconEl, item.goal.done ? 'circle-check' : 'target');

            // 文字右边界：下一个目标图标所在列之前（没有下一个则到图表末尾）
            const next = placed[i + 1];
            const textLeft = iconLeft + ICON_WIDTH + TEXT_GAP;
            const textRight = next ? next.index * COLUMN_WIDTH : chartWidth;
            const textEl = rowEl.createSpan({ cls: 'goal-lane-text', text: item.goal.text });
            textEl.style.left = `${textLeft}px`;
            textEl.style.maxWidth = `${Math.max(textRight - textLeft - TEXT_PADDING, 0)}px`;

            // 相邻目标之间：从当前文字末端到下一个图标之间画白色横线
            if (next) {
                const line = rowEl.createSpan({ cls: 'goal-lane-link' });
                line.style.left = `${textLeft}px`;
                line.style.width = `${Math.max(next.index * COLUMN_WIDTH - textLeft, 0)}px`;
            }

            this.attachGoalTooltip(rowEl, iconLeft, item.goal, task, byId);
            cursor = next ? next.index * COLUMN_WIDTH : chartWidth;
        });
    }

    /** 悬浮详情：目标名称、完成状态、截止日期、所属任务、绑定的子任务 */
    private attachGoalTooltip(
        rowEl: HTMLElement,
        anchorLeft: number,
        goal: TaskGoalEntry,
        task: PrototypeTask,
        byId: Map<string, PrototypeTask>,
    ): void {
        const tip = rowEl.createDiv({ cls: 'goal-lane-tooltip' });
        // 悬浮面板对齐目标图标所在列，而不是行首
        tip.style.left = `${anchorLeft}px`;
        const title = tip.createDiv({ cls: 'goal-lane-tooltip-title' });
        setIcon(title.createSpan({ cls: 'goal-lane-tooltip-icon' }), goal.done ? 'circle-check' : 'target');
        title.createSpan({ cls: 'goal-lane-tooltip-name', text: goal.text });

        const meta = tip.createDiv({ cls: 'goal-lane-tooltip-meta' });
        meta.createSpan({
            cls: 'goal-lane-tooltip-status',
            text: goal.done ? t('panel.goalMarkUndone') : t('panel.goalMarkDone'),
        });
        if (goal.dueDate) {
            meta.createSpan({ cls: 'goal-lane-tooltip-due', text: this.formatDue(goal.dueDate) });
        }

        const path = this.getParentPath(task, byId);
        tip.createDiv({
            cls: 'goal-lane-tooltip-task',
            text: path ? `${path} > ${task.name}` : task.name,
        });

        const subtasks = (goal.subtaskIds ?? [])
            .map((id) => byId.get(id))
            .filter((item): item is PrototypeTask => item !== undefined);
        if (subtasks.length > 0) {
            const list = tip.createDiv({ cls: 'goal-lane-tooltip-subtasks' });
            for (const subtask of subtasks) {
                const tag = list.createSpan({ cls: 'goal-lane-tooltip-subtask' });
                setIcon(tag.createSpan({ cls: 'goal-lane-tooltip-subtask-icon' }), 'git-branch');
                tag.createSpan({ cls: 'goal-lane-tooltip-subtask-name', text: subtask.name });
            }
        }
    }

    /** 任务组高度：至少与左侧卡片等高，目标多时按目标行数撑开 */
    private groupHeight(task: PrototypeTask): number {
        const count = (task.goals ?? []).length;
        const content = count * GOAL_ROW_HEIGHT + Math.max(count - 1, 0) * GOAL_ROW_GAP;
        return Math.max(ROW_HEIGHT, content) + GROUP_GAP;
    }

    /** 目标截止日期所在列下标（无截止日期或不在显示范围内时返回 -1） */
    private goalColumnIndex(goal: TaskGoalEntry, weekKeys: string[]): number {
        const weekKey = this.goalWeekKey(goal);
        if (!weekKey) return -1;
        return weekKeys.indexOf(weekKey);
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

    /** 目标截止日期所在的周键（无截止日期时返回 null） */
    private goalWeekKey(goal: TaskGoalEntry): string | null {
        if (!goal.dueDate) return null;
        const date = new Date(`${goal.dueDate}T00:00:00`);
        if (Number.isNaN(date.getTime())) return null;
        return makeWeekKey(date.getFullYear(), getISOWeek(date));
    }
}
