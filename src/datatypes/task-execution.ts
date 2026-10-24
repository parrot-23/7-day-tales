// 任务执行记录（界面视图「今天任务」计时产生的新设计数据，与旧的 executions 独立）。

/** 一条任务执行记录 */
export interface TaskExecutionRecord {
    /** 记录 id */
    id: string;
    /** 原型任务 id */
    taskId: string;
    /** 开始时间（毫秒时间戳） */
    startAt: number;
    /** 结束时间（毫秒时间戳） */
    endAt: number;
    /** 持续秒数 */
    durationSeconds: number;
}

/** 执行记录数据 */
export interface TaskExecutionData {
    records: TaskExecutionRecord[];
}
