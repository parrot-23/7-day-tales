// 时间盒数据契约：界面视图「时间盒面板」7×24 网格上按分类涂色的结果。
// 一个格子 = 周键 + 星期 + 小时 + 分类，独立持久化，与旧的时间计划（events）无关。

/** 时间盒格子 */
export interface TimeBoxCell {
    /** 周键，如 2026-W43 */
    weekKey: string;
    /** 星期：1=周一 … 7=周日 */
    weekday: number;
    /** 小时：0-23 */
    hour: number;
    /** 分类 id（对应 PlanCategory.id） */
    categoryId: string;
}

/** 时间盒数据 */
export interface TimeBoxData {
    cells: TimeBoxCell[];
}

/** 时间盒格子的唯一键（周键 + 星期 + 小时） */
export function timeBoxCellKey(weekKey: string, weekday: number, hour: number): string {
    return `${weekKey}|${weekday}|${hour}`;
}
