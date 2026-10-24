// 时间盒面板：基于 FloatingPanel，用于配置时间盒。
// 结构：顶部图例（复用周计划视图的分类图例）+ 7 列 × 24 小时的日历格子。
// 交互：选中图例分类后，在网格上点击或拖动即可把该分类涂到格子上，数据存入 TimeBoxRepo。
import type { App } from 'obsidian';

import type { TimeBoxRepo } from '../repos/timebox-repo';
import { t } from '../i18n';
import type { CategoryRepo } from '../repos/category-repo';
import { renderPlanCategoryLegend } from '../shared/category-legend';
import type { PlanCategoryData } from '../shared/plan-category-manager';
import { getCurrentDayKey, getCurrentWeekKey, makeDayKeyFromWeek } from '../shared/plan-data';
import { CategoryPanel } from './category-panel';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';

/** 时间盒面板配置 */
export interface TimeBoxPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** Obsidian App（图例配置弹窗需要） */
    app: App;
    /** 分类数据（图例行数据源，与周计划视图共享同一份） */
    categoryData: PlanCategoryData;
    /** 分类仓库（图例配置保存走仓库） */
    categoryRepo?: CategoryRepo;
    /** 时间盒数据仓库 */
    timeBoxRepo: TimeBoxRepo;
    /** 数据保存回调 */
    save: () => Promise<void>;
    /** 面板标题，默认「时间盒」 */
    title?: string;
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

/** 一天的小时数 */
const HOURS = 24;

/** 时间盒面板 */
export class TimeBoxPanel extends FloatingPanel {
    private legendEl!: HTMLElement;
    /** 图例当前选中的分类 id */
    private selectedCategoryId: string | undefined;
    /** 当前面板展示的周键 */
    private readonly weekKey = getCurrentWeekKey();
    /** 是否处于拖动涂色中 */
    private painting = false;
    /** 本次涂色是否有改动（决定是否保存） */
    private dirty = false;
    /** 分类配置面板（懒加载，复用同一实例） */
    private categoryPanel: CategoryPanel | null = null;

    constructor(private readonly panelOptions: TimeBoxPanelOptions) {
        super({
            width: 760,
            title: panelOptions.title ?? t('panel.timeBoxTitle'),
            ...panelOptions,
        });
        this.body.addClass('timebox-panel');

        // 顶部：图例行（复用周计划的分类图例，可选中分类）
        this.legendEl = this.body.createDiv({ cls: 'timebox-legend' });
        this.renderLegend();

        // 下方：7 列 × 24 小时日历
        this.renderCalendar();
    }

    /** 渲染分类图例行（选中态随点击更新，末尾附分类配置图标） */
    private renderLegend(): void {
        this.legendEl.empty();
        const legend = renderPlanCategoryLegend(
            this.panelOptions.app,
            this.legendEl,
            this.panelOptions.categoryData,
            () => this.renderLegend(),
            this.selectedCategoryId,
            (id) => {
                this.selectedCategoryId = this.selectedCategoryId === id ? undefined : id;
                this.renderLegend();
            },
            false,
            this.panelOptions.categoryRepo,
        );

        const gearBtn = legend.createDiv({ cls: 'category-gear-btn', text: '⚙️' });
        gearBtn.setAttribute('aria-label', t('category.config'));
        gearBtn.onclick = () => this.openCategoryPanel();
    }

    /** 打开分类面板（与周计划分类配置弹窗内容一致，但独立实现） */
    private openCategoryPanel(): void {
        this.categoryPanel ??= new CategoryPanel({
            categoryData: this.panelOptions.categoryData,
            categoryRepo: this.panelOptions.categoryRepo,
            save: this.panelOptions.save,
            onChange: () => this.refreshAfterCategoryChange(),
        });
        this.categoryPanel.open();
    }

    /** 分类变更后刷新图例与日历格子的颜色 */
    private refreshAfterCategoryChange(): void {
        const categories = this.panelOptions.categoryData.categories;
        if (this.selectedCategoryId && !categories.some((cat) => cat.id === this.selectedCategoryId)) {
            this.selectedCategoryId = undefined;
        }
        this.renderLegend();
        this.body.querySelector('.timebox-calendar')?.remove();
        this.renderCalendar();
    }

    /** 渲染 7 列 × 24 小时日历（左侧为小时刻度列），并按已有数据上色 */
    private renderCalendar(): void {
        const wrap = this.body.createDiv({ cls: 'timebox-calendar' });
        const grid = wrap.createDiv({ cls: 'timebox-grid' });

        // 表头：小时刻度列占位 + 周一至周日（带日期）
        grid.createDiv({ cls: 'timebox-hour-cell is-header' });
        const todayKey = getCurrentDayKey();
        for (let col = 0; col < 7; col++) {
            const dayKey = makeDayKeyFromWeek(this.weekKey, col + 1);
            const header = grid.createDiv({ cls: 'timebox-day-header' });
            header.createDiv({ cls: 'timebox-day-name', text: t(WEEKDAY_KEYS[col]) });
            header.createDiv({
                cls: 'timebox-day-date',
                text: `${Number(dayKey.slice(5, 7))}/${Number(dayKey.slice(8, 10))}`,
            });
            if (dayKey === todayKey) header.addClass('is-today');
        }

        // 已有涂色数据：按 周键+星期+小时 建立索引，便于渲染时直接上色
        const painted = new Map<string, string>();
        for (const cell of this.panelOptions.timeBoxRepo.weekCells(this.weekKey)) {
            painted.set(`${cell.weekday}-${cell.hour}`, cell.categoryId);
        }

        // 24 行：每小时一行，每行 7 个格子
        for (let hour = 0; hour < HOURS; hour++) {
            const hourLabel = grid.createDiv({
                cls: 'timebox-hour-cell',
                text: `${String(hour).padStart(2, '0')}:00`,
            });
            hourLabel.setAttribute('data-hour', String(hour));
            for (let col = 0; col < 7; col++) {
                const weekday = col + 1;
                const cell = grid.createDiv({ cls: 'timebox-cell' });
                cell.setAttribute('data-hour', String(hour));
                cell.setAttribute('data-day', String(col));

                // 已有分类：直接填充分类颜色
                const categoryId = painted.get(`${weekday}-${hour}`);
                if (categoryId) this.applyCellColor(cell, categoryId);

                // 点击涂色（按下即涂一格，并进入拖动涂色状态）
                cell.addEventListener('mousedown', (evt) => {
                    if (!this.selectedCategoryId) return;
                    evt.preventDefault();
                    this.painting = true;
                    this.dirty = false;
                    this.paintCell(cell, weekday, hour);
                    const finish = () => {
                        this.painting = false;
                        if (this.dirty) void this.panelOptions.save();
                        this.dirty = false;
                    };
                    document.addEventListener('mouseup', finish, { once: true });
                });
                // 拖动经过格子时继续涂色
                cell.addEventListener('mouseenter', () => {
                    if (!this.painting || !this.selectedCategoryId) return;
                    this.paintCell(cell, weekday, hour);
                });
            }
        }
    }

    /** 给单个格子涂上当前选中分类，并写入仓库（保存统一在鼠标松开时触发） */
    private paintCell(cell: HTMLElement, weekday: number, hour: number): void {
        const categoryId = this.selectedCategoryId;
        if (!categoryId) return;
        this.panelOptions.timeBoxRepo.paint(this.weekKey, weekday, hour, categoryId);
        this.applyCellColor(cell, categoryId);
        this.dirty = true;
    }

    /** 把分类颜色应用到格子背景 */
    private applyCellColor(cell: HTMLElement, categoryId: string): void {
        cell.style.backgroundColor = this.categoryColor(categoryId);
        cell.addClass('is-painted');
    }

    /** 分类颜色（找不到时回退为未分类灰色） */
    private categoryColor(categoryId: string): string {
        const category = this.panelOptions.categoryData.categories.find((item) => item.id === categoryId);
        return category?.color ?? '#888888';
    }
}
