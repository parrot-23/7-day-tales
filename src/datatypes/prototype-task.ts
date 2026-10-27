// 原型任务数据：界面视图「任务面板」中新建的主线 / 支线任务原型，独立持久化。
// 与收集盒任务（InboxItem）无关，仅作为界面视图的原型数据。

import type { BasketItem, ImprovementEntry, TaskStatus } from './domain';

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

/** 周目标引用：某个任务下的某个目标条目（所属任务可能是当前任务或其祖先） */
export interface WeekGoalRef {
    /** 目标所属任务 id */
    taskId: string;
    /** 目标条目 id */
    goalId: string;
}

/** 周目标：某一周绑定到某个任务上的目标条目 */
export interface TaskWeekGoal {
    /** 周键，如 2026-W43 */
    weekKey: string;
    /** 绑定的目标引用 */
    goalRefs: WeekGoalRef[];
}

/** 任务目标条目（任务详情「目标」清单） */
export interface TaskGoalEntry {
    id: string;
    /** 目标名称 */
    text: string;
    /** 创建时间（时间戳） */
    createdAt: number;
    /** 截止日期（YYYY-MM-DD，可选） */
    dueDate?: string;
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
    /** 收集篮子条目（任务详情「收集篮子」选项卡） */
    basket?: BasketItem[];
    /** 待办 / 改进条目（任务详情「待办/改进清单」选项卡，可勾选完成） */
    improvements?: ImprovementEntry[];
    /** 任务文件绑定的目录（vault 相对路径，空表示未绑定） */
    fileDir?: string;
    /** 任务文件新建时是否在文件名前加时间戳 */
    fileTimestamp?: boolean;
    /** 习惯设置（可选，未设置时视为未启用） */
    habit?: TaskHabit;
    /** 周目标（按周键记录选中的待办条目 id，可选） */
    weekGoals?: TaskWeekGoal[];
    /** 目标清单条目（任务详情「目标」面板，可选） */
    goals?: TaskGoalEntry[];
    /** 创建时间戳 */
    createdAt: number;
}