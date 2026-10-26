// 原型任务数据：界面视图「任务面板」中新建的主线 / 支线任务原型，独立持久化。
// 与收集盒任务（InboxItem）无关，仅作为界面视图的原型数据。

import type { TaskStatus } from './domain';

/** 原型任务类型：主线 / 支线 */
export type PrototypeTaskType = 'main' | 'side';

/** 任务习惯设置 */
export interface TaskHabit {
    /** 是否启用习惯 */
    enabled: boolean;
    /** 习惯时间（HH:mm） */
    time: string;
    /** 生效星期（1 = 周一 … 7 = 周日） */
    weekdays: number[];
}

/** 原型任务 */
export interface PrototypeTask {
    id: string;
    /** 任务名称 */
    name: string;
    /** 任务类型 */
    type: PrototypeTaskType;
    /** 父任务 id（子任务使用；根任务为空） */
    parentId?: string;
    /** 任务描述 */
    description?: string;
    /** 任务分类 id（对应图例分类） */
    categoryId?: string;
    /** 任务状态（可选，旧任务无此字段，默认未开始） */
    status?: TaskStatus;
    /** 习惯设置（可选，未设置时视为未启用） */
    habit?: TaskHabit;
    /** 创建时间戳 */
    createdAt: number;
}