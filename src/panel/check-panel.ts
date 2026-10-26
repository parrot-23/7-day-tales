// 检查面板：基于 FloatingPanel，用于配置检查。
// 结构：顶部选项卡（计划vs对比 / 统计）。
// 计划vs对比：周数切换 + 计划分布（时间盒数据）/ 执行分布（任务执行记录），
// 视觉复用二级视图（检查）的分布图样式（24 小时、2 小时一格、7 列）。
import type { App } from 'obsidian';

import type { PrototypeTask } from '../datatypes/prototype-task';
import type { CardInstance } from '../datatypes/card';
import type { CardTemplate } from '../datatypes/form';
import type { ExecutionRecord, InboxItem } from '../datatypes/domain';
import { renderCardContent } from '../cardmake/card-component';
import { createDataProvider } from '../cardmake/engine/provider';
import { t, getWeekDays } from '../i18n';
import type { TimeBoxRepo } from '../repos/timebox-repo';
import type { TaskExecutionRepo } from '../repos/task-execution-repo';
import type { PlanCategoryData } from '../shared/plan-category-manager';
import { UNCATEGORIZED_CATEGORY_ID } from '../shared/plan-category-manager';
import {
    getCurrentWeekKey,
    getISOWeek,
    makeDayKeyFromWeek,
    makeWeekKey,
    parseWeekKey,
    shiftWeekKey,
} from '../shared/plan-data';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';

/** 检查面板配置 */
export interface CheckPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「检查」 */
    title?: string;
    /** 分类数据（颜色来源，与图例一致） */
    categoryData: PlanCategoryData;
    /** 时间盒仓库（计划分布的数据来源） */
    timeBoxRepo: TimeBoxRepo;
    /** 任务执行记录仓库（执行分布的数据来源） */
    taskExecutionRepo: TaskExecutionRepo;
    /** 原型任务数据源（用于按任务取分类颜色） */
    getTasks: () => PrototypeTask[];
    /** 点击右上角「数据」按钮的回调 */
    onOpenData?: () => void;
    /** Obsidian App（具体任务分析的图表渲染需要） */
    app: App;
}

/** 顶部选项卡 */
type CheckTab = 'planVsActual' | 'stats' | 'taskAnalysis';

/** 分布图中的一个时间块（分钟） */
interface ChartBlock {
    start: number;
    end: number;
    categoryId?: string;
}

/** 检查面板 */
export class CheckPanel extends FloatingPanel {
    private planVsActualTabEl!: HTMLElement;
    private statsTabEl!: HTMLElement;
    private taskAnalysisTabEl!: HTMLElement;
    /** 内容区容器 */
    private paneEl!: HTMLElement;
    /** 当前选项卡 */
    private tab: CheckTab = 'planVsActual';
    /** 计划vs对比当前查看的周键 */
    private weekKey: string = getCurrentWeekKey();
    /** 具体任务分析选中的任务 id（跨选项卡 / 重开保留） */
    private analyzedTaskId: string | undefined;

    constructor(private readonly panelOptions: CheckPanelOptions) {
        super({
            width: 900,
            title: panelOptions.title ?? t('panel.checkPanelTitle'),
            ...panelOptions,
        });
        this.body.addClass('check-panel');
        this.renderLayout();
    }

    private renderLayout(): void {
        const tabs = this.body.createDiv({ cls: 'plan-tabs' });
        this.planVsActualTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.checkPlanVsActual') });
        this.statsTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.checkStats') });
        this.taskAnalysisTabEl = tabs.createDiv({ cls: 'plan-tab', text: t('panel.checkTaskAnalysis') });
        this.planVsActualTabEl.addEventListener('click', () => this.switchTab('planVsActual'));
        this.statsTabEl.addEventListener('click', () => this.switchTab('stats'));
        this.taskAnalysisTabEl.addEventListener('click', () => this.switchTab('taskAnalysis'));

        // 选项卡行最右侧的「数据」按钮：打开数据面板
        const dataButton = tabs.createEl('button', {
            cls: 'check-data-button',
            text: t('panel.checkData'),
            attr: { type: 'button' },
        });
        dataButton.addEventListener('click', () => this.panelOptions.onOpenData?.());

        this.paneEl = this.body.createDiv({ cls: 'plan-pane' });
        this.switchTab(this.tab);
    }

    private switchTab(tab: CheckTab): void {
        this.tab = tab;
        this.planVsActualTabEl.toggleClass('is-active', tab === 'planVsActual');
        this.statsTabEl.toggleClass('is-active', tab === 'stats');
        this.taskAnalysisTabEl.toggleClass('is-active', tab === 'taskAnalysis');
        this.renderPane();
    }

    private renderPane(): void {
        this.paneEl.empty();
        if (this.tab === 'planVsActual') this.renderPlanVsActual();
        if (this.tab === 'stats') this.renderStats();
        if (this.tab === 'taskAnalysis') this.renderTaskAnalysis();
    }

    // ===== 具体任务分析：任务搜索 + 项目活跃度柱状图（含整棵子树） =====
    private renderTaskAnalysis(): void {
        const wrap = this.paneEl.createDiv({ cls: 'check-task-analysis' });

        // 第一行：任务搜索框（输入关键字，点击结果确认选择）
        const searchRow = wrap.createDiv({ cls: 'check-task-analysis-search' });
        const input = searchRow.createEl('input', { cls: 'check-task-analysis-input' });
        input.type = 'text';
        input.placeholder = t('panel.taskAnalysisPlaceholder');
        const selected = this.panelOptions.getTasks().find((task) => task.id === this.analyzedTaskId);
        if (selected) input.value = selected.name;

        const resultList = wrap.createDiv({ cls: 'check-task-analysis-results' });
        const showResults = (): void => this.renderTaskAnalysisResults(resultList, input);
        input.addEventListener('input', showResults);
        input.addEventListener('focus', showResults);

        // 第二行：柱形图（与任务视图的「项目活跃度」同一套渲染管线）
        const chart = wrap.createDiv({ cls: 'check-task-analysis-chart' });
        if (!selected) {
            chart.createDiv({ cls: 'check-task-analysis-empty', text: t('panel.taskAnalysisEmpty') });
            return;
        }
        this.renderTaskAnalysisChart(chart, selected.id);
    }

    /** 搜索结果列表：按名称模糊匹配任务，点击结果确认选择并刷新图表 */
    private renderTaskAnalysisResults(list: HTMLElement, input: HTMLInputElement): void {
        list.empty();
        const keyword = input.value.trim().toLowerCase();
        const tasks = this.panelOptions.getTasks()
            .filter((task) => !keyword || task.name.toLowerCase().includes(keyword))
            .slice(0, 8);
        if (tasks.length === 0) {
            list.createDiv({ cls: 'check-task-analysis-no-result', text: t('panel.taskAnalysisNoResult') });
            return;
        }
        for (const task of tasks) {
            const row = list.createDiv({
                cls: 'check-task-analysis-result',
                text: task.name,
            });
            row.addEventListener('click', () => {
                this.analyzedTaskId = task.id;
                this.renderPane();
            });
        }
    }

    /** 具体任务分析柱状图：按周聚合整棵子树的执行时长，周数随容器宽度自适应 */
    private renderTaskAnalysisChart(container: HTMLElement, rootId: string): void {
        const tasks = this.panelOptions.getTasks();
        const ids = new Set<string>([rootId]);
        const collect = (id: string): void => {
            for (const task of tasks) {
                if (task.parentId === id) {
                    ids.add(task.id);
                    collect(task.id);
                }
            }
        };
        collect(rootId);

        const provider = createDataProvider(
            () => [],
            () => this.analysisExecutions(ids),
            () => this.analysisItems(),
            () => this.panelOptions.categoryData.categories,
        );

        const render = (width: number): void => {
            const plotWidth = Math.max(32, width - 34 - 8);
            const windowWeeks = Math.max(1, Math.min(104, Math.floor(plotWidth / 64) + 1));
            const template: CardTemplate = {
                id: 'task-analysis-chart',
                name: t('panel.checkTaskAnalysis'),
                mode: 'chart',
                renderer: 'stats',
                source: {
                    dataSource: 'executions',
                    aggregation: 'by-week',
                    chart: 'bar',
                    params: {
                        metric: 'duration',
                        windowWeeks,
                        shortLabel: true,
                        showAxes: true,
                        yUnit: 'hours',
                        width,
                        stackedByTask: true,
                    },
                },
            };
            const instance: CardInstance = {
                id: `task_analysis_${rootId}`,
                templateId: 'task-analysis-chart',
                mode: 'chart',
            };
            renderCardContent(container, instance, template, {
                app: this.panelOptions.app,
                save: async () => { /* 只读图表，无需保存 */ },
                refresh: () => this.renderPane(),
                provider,
            });
        };

        if (container.clientWidth > 0) {
            render(container.clientWidth);
        } else {
            requestAnimationFrame(() => render(container.clientWidth || this.paneEl.clientWidth || 620));
        }
    }

    /** 执行记录 → 图表数据（限定任务子树，补齐周键与当天分钟数） */
    private analysisExecutions(ids: Set<string>): ExecutionRecord[] {
        return this.panelOptions.taskExecutionRepo.records
            .filter((record) => ids.has(record.taskId))
            .map((record) => {
                const start = new Date(record.startAt);
                const dayStart = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
                return {
                    id: record.id,
                    inboxId: record.taskId,
                    day: 0,
                    start: (record.startAt - dayStart) / 60000,
                    end: (record.endAt - dayStart) / 60000,
                    weekKey: makeWeekKey(start.getFullYear(), getISOWeek(start)),
                };
            });
    }

    /** 原型任务 → 图表任务列表（用于柱内按任务堆叠与取分类颜色） */
    private analysisItems(): InboxItem[] {
        return this.panelOptions.getTasks().map((task) => ({
            id: task.id,
            title: task.name,
            description: task.description ?? '',
            categoryId: task.categoryId,
            parentId: task.parentId,
            createdAt: task.createdAt,
            status: task.status,
        }));
    }

    // ===== 统计：本周七天，每天两个方框（分类已执行时长 / 任务占比） =====
    private renderStats(): void {
        this.renderWeekNav();

        const days = this.paneEl.createDiv({ cls: 'check-stats-days' });
        const weekDays = getWeekDays();
        for (let day = 1; day <= 7; day++) {
            const row = days.createDiv({ cls: 'today-stats-row check-stats-day-row' });
            row.createDiv({ cls: 'check-stats-day-label', text: weekDays[day - 1] });
            this.renderCategoryDurationBox(row, day);
            this.renderTaskShareBox(row, day);
        }
    }

    /** 指定星期的执行记录：按任务聚合分钟数（跨午夜按天裁剪） */
    private minutesByTaskForDay(day: number): Map<string, number> {
        const dayKey = makeDayKeyFromWeek(this.weekKey, day);
        const [year, month, date] = dayKey.split('-').map(Number);
        const dayStart = new Date(year, month - 1, date).getTime();
        const dayEnd = dayStart + 24 * 3600000;

        const minutesByTask = new Map<string, number>();
        for (const record of this.panelOptions.taskExecutionRepo.records) {
            const startMs = Math.max(dayStart, record.startAt);
            const endMs = Math.min(dayEnd, record.endAt);
            if (endMs <= startMs) continue;
            const minutes = (endMs - startMs) / 60000;
            minutesByTask.set(record.taskId, (minutesByTask.get(record.taskId) ?? 0) + minutes);
        }
        return minutesByTask;
    }

    /** 当天各分类已执行时长（样式与二级视图（日执行）的今日情况一致） */
    private renderCategoryDurationBox(panel: HTMLElement, day: number): void {
        const minutesByTask = this.minutesByTaskForDay(day);

        const minutesByCat = new Map<string, number>();
        for (const [taskId, minutes] of Array.from(minutesByTask.entries())) {
            const task = this.panelOptions.getTasks().find((item) => item.id === taskId);
            const catId = task?.categoryId ?? UNCATEGORIZED_CATEGORY_ID;
            minutesByCat.set(catId, (minutesByCat.get(catId) ?? 0) + minutes);
        }

        const box = panel.createDiv({ cls: 'today-cat-duration-box' });
        box.createDiv({ cls: 'today-cat-duration-title', text: t('today.categoryDurationTitle') });

        if (minutesByCat.size === 0) {
            box.createDiv({ cls: 'today-cat-duration-empty', text: t('today.categoryDurationEmpty') });
            return;
        }

        const rows = this.panelOptions.categoryData.categories
            .map((cat) => ({ cat, minutes: minutesByCat.get(cat.id) ?? 0 }))
            .filter((row) => row.minutes > 0);

        const chart = box.createDiv({ cls: 'today-cat-duration-chart' });
        for (const { cat, minutes } of rows) {
            const row = chart.createDiv({ cls: 'today-cat-duration-row' });
            row.createDiv({ cls: 'today-cat-duration-label', text: cat.label });
            const blocks = row.createDiv({ cls: 'today-cat-duration-blocks' });
            const fullHours = Math.floor(minutes / 60);
            const remainder = minutes % 60;
            const blockCount = fullHours + (remainder > 0 ? 1 : 0);
            for (let i = 0; i < blockCount; i++) {
                const block = blocks.createDiv({ cls: 'today-cat-duration-block' });
                block.setCssProps({ '--block-color': cat.color ?? '#888888' });
                const isPartial = remainder > 0 && i === blockCount - 1;
                const fillPercent = isPartial ? Math.round((remainder / 60) * 100) : 100;
                const fill = block.createDiv({ cls: 'today-cat-duration-block-fill' });
                fill.setCssProps({ '--fill-width': `${fillPercent}%` });
            }
            row.createDiv({ cls: 'today-cat-duration-value', text: formatHours(minutes) });
        }
    }

    /** 当天任务占比（样式与二级视图（日执行）的今日情况一致） */
    private renderTaskShareBox(panel: HTMLElement, day: number): void {
        const minutesByTask = this.minutesByTaskForDay(day);
        const totalMinutes = Array.from(minutesByTask.values()).reduce((sum, value) => sum + value, 0);

        const box = panel.createDiv({ cls: 'today-task-share-box' });
        box.createDiv({ cls: 'today-cat-duration-title', text: t('today.taskShareTitle') });

        if (minutesByTask.size === 0 || totalMinutes <= 0) {
            box.createDiv({ cls: 'today-cat-duration-empty', text: t('today.taskShareEmpty') });
            return;
        }

        const content = box.createDiv({ cls: 'today-task-share-content' });

        const pie = content.createDiv({ cls: 'today-task-share-pie' });
        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('class', 'today-task-share-svg');
        pie.appendChild(svg);

        const cx = 50;
        const cy = 50;
        const r = 50;
        const dividerWidth = 2;
        const slices: { label: string; midDeg: number; ratio: number }[] = [];
        let acc = 0;
        for (const [taskId, minutes] of Array.from(minutesByTask.entries())) {
            const task = this.panelOptions.getTasks().find((item) => item.id === taskId);
            const cat = task?.categoryId
                ? this.panelOptions.categoryData.categories.find((item) => item.id === task.categoryId)
                : undefined;
            const color = cat?.color ?? '#888888';
            const startDeg = (acc / totalMinutes) * 360;
            acc += minutes;
            const endDeg = (acc / totalMinutes) * 360;

            const path = document.createElementNS(svgNs, 'path');
            path.setAttribute('d', this.describePieSlice(cx, cy, r, startDeg, endDeg));
            path.setAttribute('fill', color);
            svg.appendChild(path);

            slices.push({
                label: task?.name ?? t('inbox.noCategory'),
                midDeg: (startDeg + endDeg) / 2,
                ratio: minutes / totalMinutes,
            });
        }

        if (minutesByTask.size > 1) {
            let boundaryDeg = 0;
            for (const minutes of Array.from(minutesByTask.values())) {
                const rad = ((boundaryDeg - 90) * Math.PI) / 180;
                const line = document.createElementNS(svgNs, 'line');
                line.setAttribute('x1', String(cx));
                line.setAttribute('y1', String(cy));
                line.setAttribute('x2', String(cx + r * Math.cos(rad)));
                line.setAttribute('y2', String(cy + r * Math.sin(rad)));
                line.setAttribute('stroke', '#ffffff');
                line.setAttribute('stroke-width', String(dividerWidth));
                svg.appendChild(line);
                boundaryDeg += (minutes / totalMinutes) * 360;
            }
        }

        for (const slice of slices) {
            if (slice.ratio < 0.06) continue;
            const label = pie.createDiv({ cls: 'today-task-share-slice-label', text: slice.label });
            label.setCssProps({ '--slice-angle': `${slice.midDeg}deg` });
        }

        const list = content.createDiv({ cls: 'today-task-share-list' });
        const sortedEntries = Array.from(minutesByTask.entries()).sort((a, b) => b[1] - a[1]);
        for (const [taskId, minutes] of sortedEntries) {
            const task = this.panelOptions.getTasks().find((item) => item.id === taskId);
            const cat = task?.categoryId
                ? this.panelOptions.categoryData.categories.find((item) => item.id === task.categoryId)
                : undefined;
            const color = cat?.color ?? '#888888';
            const label = task?.name ?? t('inbox.noCategory');

            const row = list.createDiv({ cls: 'today-task-share-row' });
            const dot = row.createSpan({ cls: 'today-task-share-dot' });
            dot.setCssProps({ '--dot-color': color });
            row.createSpan({ cls: 'today-task-share-name', text: label });
            row.createSpan({ cls: 'today-task-share-value', text: formatHours(minutes) });
        }
    }

    /** 生成 SVG 饼图扇区路径（从 12 点方向顺时针计算角度） */
    private describePieSlice(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
        const span = endDeg - startDeg;
        if (span >= 359.999) {
            return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
        }
        const toPoint = (deg: number) => {
            const rad = ((deg - 90) * Math.PI) / 180;
            return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
        };
        const p0 = toPoint(startDeg);
        const p1 = toPoint(endDeg);
        const largeArc = span > 180 ? 1 : 0;
        return `M ${cx} ${cy} L ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeArc} 1 ${p1.x} ${p1.y} Z`;
    }

    // ===== 计划vs对比：周数切换 + 计划 / 执行分布 =====
    private renderPlanVsActual(): void {
        this.renderWeekNav();

        const chartsRow = this.paneEl.createDiv({ cls: 'check-charts-row' });
        this.renderDistributionChart(chartsRow, t('check.detailPlanChartTitle'), this.planBlocksByDay());
        this.renderDistributionChart(chartsRow, t('check.detailExecChartTitle'), this.executionBlocksByDay());
    }

    /** 周数切换：‹ 第 N 周 › */
    private renderWeekNav(): void {
        const { week } = parseWeekKey(this.weekKey);
        const nav = this.paneEl.createDiv({ cls: 'plan-nav-row' });
        const prev = nav.createEl('button', { cls: 'plan-nav-btn', text: '←' });
        prev.addEventListener('click', () => {
            this.weekKey = shiftWeekKey(this.weekKey, -1);
            this.renderPane();
        });
        nav.createSpan({ cls: 'plan-nav-label', text: t('panel.planWeekLabel', { week: String(week) }) });
        const next = nav.createEl('button', { cls: 'plan-nav-btn', text: '→' });
        next.addEventListener('click', () => {
            this.weekKey = shiftWeekKey(this.weekKey, 1);
            this.renderPane();
        });
    }

    /** 计划分布：时间盒数据，相邻同分类的小时格合并为一块 */
    private planBlocksByDay(): Map<number, ChartBlock[]> {
        const cells = [...this.panelOptions.timeBoxRepo.weekCells(this.weekKey)]
            .sort((a, b) => a.hour - b.hour);
        const blocksByDay = new Map<number, ChartBlock[]>();
        for (let day = 1; day <= 7; day++) {
            const dayBlocks: ChartBlock[] = [];
            for (const cell of cells.filter((item) => item.weekday === day)) {
                const start = cell.hour * 60;
                const end = start + 60;
                const last = dayBlocks[dayBlocks.length - 1];
                if (last && last.end === start && last.categoryId === cell.categoryId) {
                    last.end = end;
                } else {
                    dayBlocks.push({ start, end, categoryId: cell.categoryId });
                }
            }
            blocksByDay.set(day, dayBlocks);
        }
        return blocksByDay;
    }

    /** 执行分布：任务执行记录，跨午夜按天裁剪 */
    private executionBlocksByDay(): Map<number, ChartBlock[]> {
        const records = this.panelOptions.taskExecutionRepo.records;
        const blocksByDay = new Map<number, ChartBlock[]>();
        for (let day = 1; day <= 7; day++) {
            const dayKey = makeDayKeyFromWeek(this.weekKey, day);
            const [year, month, date] = dayKey.split('-').map(Number);
            const dayStart = new Date(year, month - 1, date).getTime();
            const dayEnd = dayStart + 24 * 3600000;
            const dayBlocks: ChartBlock[] = [];
            for (const record of records) {
                const startMs = Math.max(dayStart, record.startAt);
                const endMs = Math.min(dayEnd, record.endAt);
                if (endMs <= startMs) continue;
                dayBlocks.push({
                    start: (startMs - dayStart) / 60000,
                    end: (endMs - dayStart) / 60000,
                    categoryId: this.categoryIdOf(record.taskId),
                });
            }
            dayBlocks.sort((a, b) => a.start - b.start);
            blocksByDay.set(day, dayBlocks);
        }
        return blocksByDay;
    }

    /** 原型任务的分类 id */
    private categoryIdOf(taskId: string): string | undefined {
        return this.panelOptions.getTasks().find((task) => task.id === taskId)?.categoryId;
    }

    /** 渲染分布图（计划 / 执行共用，样式与二级视图（检查）一致） */
    private renderDistributionChart(
        body: HTMLElement,
        title: string,
        blocksByDay: Map<number, ChartBlock[]>,
    ): void {
        const section = body.createDiv({ cls: 'check-daily-section' });
        section.createDiv({ cls: 'check-daily-section-title', text: title });

        const chart = section.createDiv({ cls: 'check-plan-chart' });

        // 左侧时间刻度（每 2 小时一格，共 12 格）
        const axis = chart.createDiv({ cls: 'check-plan-chart-axis' });
        for (let hour = 0; hour < 24; hour += 2) {
            axis.createDiv({ cls: 'check-plan-chart-axis-cell' })
                .setText(`${String(hour).padStart(2, '0')}:00`);
        }

        const cols = chart.createDiv({ cls: 'check-plan-chart-cols' });
        const weekDays = getWeekDays();
        for (let day = 1; day <= 7; day++) {
            const col = cols.createDiv({ cls: 'check-plan-chart-col' });
            col.createDiv({ cls: 'check-plan-chart-col-title', text: weekDays[day - 1] });

            const track = col.createDiv({ cls: 'check-plan-chart-track' });
            for (const block of blocksByDay.get(day) ?? []) {
                const category = block.categoryId
                    ? this.panelOptions.categoryData.categories.find((item) => item.id === block.categoryId)
                    : undefined;
                const blockEl = track.createDiv({ cls: 'check-plan-chart-block' });
                blockEl.setCssProps({
                    '--block-color': category?.color ?? '#888888',
                    '--block-top': `${(block.start / 1440) * 100}%`,
                    '--block-height': `${(Math.max(0, block.end - block.start) / 1440) * 100}%`,
                });
                blockEl.setAttribute('title', `${category?.label ?? t('inbox.noCategory')} ${formatMinutes(block.start)}-${formatMinutes(block.end)}`);
            }
        }
    }
}

/** 分钟数 → HH:MM */
function formatMinutes(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** 分钟数 → 小时（保留一位小数，如 1.5h） */
function formatHours(minutes: number): string {
    return `${Number((minutes / 60).toFixed(1))}h`;
}
