// 计划面板：基于 FloatingPanel，用于配置计划。
// 结构：左侧（顶部根任务下拉 + 选中根任务的后代任务树）+ 右侧（年 / 周选项卡，对应 52 周日历与一周七列日历）。
// 排布：选中左侧任务条目后，点击周视图的某一天列，即可把该任务排布到该列（写入 PlanAssignmentRepo）。
import type { PrototypeTask } from '../datatypes/prototype-task';
import { t } from '../i18n';
import type { PlanAssignmentRepo } from '../repos/plan-assignment-repo';
import { getCurrentWeekKey, makeDayKeyFromWeek, parseWeekKey, shiftWeekKey } from '../shared/plan-data';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';

/** 计划面板配置 */
export interface PlanPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「计划」 */
    title?: string;
    /** 任务数据源（每次打开时重新读取，保证与其他视图一致） */
    getTasks: () => PrototypeTask[];
    /** 计划排布数据仓库（点击周视图列时写入） */
    planAssignmentRepo: PlanAssignmentRepo;
    /** 数据保存回调（排布写入后持久化） */
    save: () => Promise<void>;
    /** 排布变更回调（界面视图「今天任务」方框据此刷新） */
    onChanged?: () => void;
    /** 初始周键，默认本周 */
    initialWeekKey?: string;
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
        super.open();
    }

    private renderLayout(): void {
        // 左侧：根任务下拉 + 任务树
        const left = this.body.createDiv({ cls: 'plan-left' });
        this.rootSelectEl = left.createEl('select', { cls: 'dropdown plan-root-select' });
        this.rootSelectEl.addEventListener('change', () => {
            this.rootTaskId = this.rootSelectEl.value || undefined;
            this.selectedTaskId = undefined;
            this.renderTree();
        });
        this.treeEl = left.createDiv({ cls: 'plan-tree' });
        this.treeEl.addEventListener('click', (evt) => {
            const row = (evt.target as HTMLElement).closest('.task-detail-tree-row') as HTMLElement | null;
            const taskId = row?.dataset.taskId;
            if (taskId) this.selectTask(taskId);
        });

        // 右侧：年 / 周选项卡 + 对应内容
        const right = this.body.createDiv({ cls: 'plan-right' });
        const tabs = right.createDiv({ cls: 'plan-tabs' });
        this.yearTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.planYearTab') });
        this.weekTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.planWeekTab') });
        this.yearTabEl.addEventListener('click', () => this.switchTab('year'));
        this.weekTabEl.addEventListener('click', () => this.switchTab('week'));

        this.paneEl = right.createDiv({ cls: 'plan-pane' });
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

    /** 渲染选中根任务的后代任务树 */
    private renderTree(): void {
        this.treeEl.empty();
        if (!this.rootTaskId) return;
        this.renderTreeNodes(this.treeEl, this.rootTaskId, 0);
    }

    private renderTreeNodes(parentEl: HTMLElement, parentId: string, depth: number): void {
        const children = this.panelOptions.getTasks().filter((task) => task.parentId === parentId);
        for (const child of children) {
            const row = parentEl.createDiv({ cls: 'task-detail-tree-row' });
            row.style.marginLeft = `${depth * 14}px`;
            row.dataset.taskId = child.id;
            row.toggleClass('is-selected', child.id === this.selectedTaskId);
            row.createSpan({ cls: 'task-detail-tree-label', text: child.name });
            this.renderTreeNodes(parentEl, child.id, depth + 1);
        }
    }

    /** 选中任务条目（高亮，并让周视图的列进入可排布状态） */
    private selectTask(taskId: string): void {
        this.selectedTaskId = taskId;
        this.treeEl.querySelectorAll('.task-detail-tree-row').forEach((el) => {
            const row = el as HTMLElement;
            row.toggleClass('is-selected', row.dataset.taskId === taskId);
        });
        this.paneEl.querySelectorAll('.plan-week-column').forEach((el) => {
            (el as HTMLElement).toggleClass('is-assignable', true);
        });
    }

    /** 切换年 / 周选项卡 */
    private switchTab(tab: PlanTab): void {
        this.tab = tab;
        this.yearTabEl.toggleClass('is-active', tab === 'year');
        this.weekTabEl.toggleClass('is-active', tab === 'week');
        this.renderPane();
    }

    private renderPane(): void {
        this.paneEl.empty();
        if (this.tab === 'year') {
            this.renderYearPane();
        } else {
            this.renderWeekPane();
        }
    }

    /** 年视图：年度选择行 + 52 周（7 列 × 8 行） */
    private renderYearPane(): void {
        const nav = this.paneEl.createDiv({ cls: 'plan-nav-row' });
        this.createNavButton(nav, '←', () => {
            this.year -= 1;
            this.renderPane();
        });
        nav.createSpan({ cls: 'plan-nav-label', text: t('panel.planYearLabel', { year: String(this.year) }) });
        this.createNavButton(nav, '→', () => {
            this.year += 1;
            this.renderPane();
        });

        const current = parseWeekKey(getCurrentWeekKey());
        const grid = this.paneEl.createDiv({ cls: 'plan-year-grid' });
        for (let week = 1; week <= WEEKS_PER_YEAR; week++) {
            const cell = grid.createDiv({ cls: 'plan-year-cell', text: `W${String(week).padStart(2, '0')}` });
            if (current.year === this.year && current.week === week) cell.addClass('is-current');
        }
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

        // 与周计划视图一致：表头一行 7 格，表体 7 列共用分隔线
        const grid = this.paneEl.createDiv({ cls: 'plan-week-grid' });
        const headerRow = grid.createDiv({ cls: 'plan-week-header' });
        const columnsRow = grid.createDiv({ cls: 'plan-week-columns' });
        for (let col = 0; col < 7; col++) {
            const dayKey = makeDayKeyFromWeek(this.weekKey, col + 1);
            const header = headerRow.createDiv({ cls: 'plan-week-header-cell' });
            header.createSpan({ cls: 'plan-week-header-name', text: t(WEEKDAY_KEYS[col]) });
            header.createSpan({
                cls: 'plan-week-header-date',
                text: `${Number(dayKey.slice(5, 7))}/${Number(dayKey.slice(8, 10))}`,
            });
            const column = columnsRow.createDiv({ cls: 'plan-week-column' });
            column.dataset.weekday = String(col + 1);
            column.toggleClass('is-assignable', this.selectedTaskId !== undefined);
            column.addEventListener('click', () => this.assignSelectedTask(col + 1));
            this.renderWeekColumn(column, col + 1);
        }
    }

    /** 渲染某一天列内已排布的任务 */
    private renderWeekColumn(column: HTMLElement, weekday: number): void {
        const tasks = new Map(this.panelOptions.getTasks().map((task) => [task.id, task]));
        for (const assignment of this.panelOptions.planAssignmentRepo.dayAssignments(this.weekKey, weekday)) {
            const task = tasks.get(assignment.taskId);
            if (!task) continue;
            const chip = column.createDiv({ cls: 'plan-week-task-chip' });
            chip.title = task.name;
            chip.createSpan({ cls: 'plan-week-task-chip-name', text: task.name });
            // 卡片本身不冒泡到列：避免点击卡片时被当作「排布选中任务」
            chip.addEventListener('click', (evt) => evt.stopPropagation());
            const del = chip.createSpan({ cls: 'plan-week-task-chip-del', text: '×' });
            del.addEventListener('click', (evt) => {
                evt.stopPropagation();
                this.panelOptions.planAssignmentRepo.remove(this.weekKey, weekday, assignment.taskId);
                void this.panelOptions.save();
                this.renderPane();
                this.panelOptions.onChanged?.();
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
}
