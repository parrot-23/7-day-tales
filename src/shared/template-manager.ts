import type { CategorizedRange } from './plan-data';

// 数据全部由 main.ts 中的主视图自己持有。

/** 日模板 */
export interface DayTemplate {
    id: string;
    name: string;
    /** 模板包含的时间区块（不含 id，应用时再生成） */
    ranges: Omit<CategorizedRange, 'id'>[];
}

/** 单日的模板属性（日属性绑定） */
export interface DayProperty {
    /** 星期几（1=周一 ～ 7=周日） */
    day: number;
    /** 绑定的日模板 ID */
    templateId: string;
}

/** 日模板相关数据的顶层容器 */
export interface DayTemplateData {
    dayTemplates: DayTemplate[];
    dayProperties: DayProperty[];
}
