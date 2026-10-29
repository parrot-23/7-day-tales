// 周历面板：基于 FloatingPanel 的日历式展示。
// 结构：顶部窄条一行（第一列为 PLAN/CHECK，其余六列为 ACT），下方一行 × 七列日期格子（周一至周日）。
import { t } from '../../../i18n';
import { getCurrentDayKey, getCurrentWeekKey, makeDayKeyFromWeek } from '../../../shared/plan-data';
import { FloatingPanel, type FloatingPanelOptions } from '../basic/floating-panel';

/** 周历面板配置 */
export interface WeekCalendarPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「周历」 */
    title?: string;
    /** 起始周键（第一行），默认本周 */
    startWeekKey?: string;
    /** 需要高亮的日期键（默认今天） */
    highlightDayKey?: string;
}

/** 顶部窄条每列的文案：首列 PLAN/CHECK，其余 ACT */
const STRIP_LABELS = ['PLAN/CHECK', 'ACT', 'ACT', 'ACT', 'ACT', 'ACT', 'ACT'];

/** 周历面板 */
export class WeekCalendarPanel extends FloatingPanel {
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
        this.startWeekKey = options.startWeekKey ?? getCurrentWeekKey();
        this.highlightDayKey = options.highlightDayKey;
        this.renderCalendar();
    }

    /** 重新渲染 */
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

    /** 渲染顶部窄条 + 一行七列日期格子 */
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
    }
}
