// 周历面板：基于 FloatingPanel 的日历式展示。
// 结构：顶部窄条一行（第一列为 PLAN/CHECK，其余六列为 ACT），下方三行 × 七列日期格子（周一至周日）。
import { t } from '../i18n';
import { getCurrentDayKey, getCurrentWeekKey, makeDayKeyFromWeek, shiftWeekKey } from '../shared/plan-data';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';

/** 周历面板配置 */
export interface WeekCalendarPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「周历」 */
    title?: string;
    /** 起始周键（第一行），默认本周 */
    startWeekKey?: string;
}

/** 顶部窄条每列的文案：首列 PLAN/CHECK，其余 ACT */
const STRIP_LABELS = ['PLAN/CHECK', 'ACT', 'ACT', 'ACT', 'ACT', 'ACT', 'ACT'];

/** 周历面板 */
export class WeekCalendarPanel extends FloatingPanel {
    constructor(options: WeekCalendarPanelOptions = {}) {
        super({
            width: 560,
            title: options.title ?? t('panel.weekCalendarTitle'),
            ...options,
        });
        this.renderCalendar(options.startWeekKey ?? getCurrentWeekKey());
    }

    /** 渲染顶部窄条 + 三行七列日期格子 */
    private renderCalendar(startWeekKey: string): void {
        const body = this.body;
        body.addClass('week-calendar-panel');
        const grid = body.createDiv({ cls: 'week-calendar-grid' });

        // 第一行：顶部窄条（每列一条，与下方格子对齐）
        for (let col = 0; col < 7; col++) {
            const strip = grid.createDiv({ cls: 'week-calendar-strip' });
            strip.setText(STRIP_LABELS[col]);
            if (col === 0) strip.addClass('is-plan-check');
        }

        // 三行日期格子：从起始周开始，每行一周（周一至周日）
        const todayKey = getCurrentDayKey();
        let weekKey = startWeekKey;
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 7; col++) {
                const dayKey = makeDayKeyFromWeek(weekKey, col + 1);
                const cell = grid.createDiv({ cls: 'week-calendar-cell' });
                if (dayKey === todayKey) cell.addClass('is-today');
                cell.setText(String(Number(dayKey.slice(8, 10))));
            }
            weekKey = shiftWeekKey(weekKey, 1);
        }
    }
}