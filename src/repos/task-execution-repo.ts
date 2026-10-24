// 任务执行记录领域仓库：管理界面视图「今天任务」计时结束后的执行记录。
// 通过 baseRepo 拿到 taskExecutionData 引用，写操作后由调用方触发 baseRepo.saveAll()。
import type { TaskExecutionData, TaskExecutionRecord } from '../datatypes/task-execution';
import type { BaseRepo } from './base-repo';

export class TaskExecutionRepo {
    private baseRepo: BaseRepo;

    constructor(baseRepo: BaseRepo) {
        this.baseRepo = baseRepo;
    }

    /** 执行记录数据引用（视图读取用） */
    get data(): TaskExecutionData {
        return this.baseRepo.data!.taskExecutionData;
    }

    /** 全部执行记录 */
    get records(): TaskExecutionRecord[] {
        return this.data.records;
    }

    /** 新增一条执行记录（持续时长由起止时间计算） */
    add(taskId: string, startAt: number, endAt: number): TaskExecutionRecord {
        const record: TaskExecutionRecord = {
            id: `exec-${endAt}-${Math.random().toString(36).slice(2, 8)}`,
            taskId,
            startAt,
            endAt,
            durationSeconds: Math.max(0, Math.round((endAt - startAt) / 1000)),
        };
        this.data.records.push(record);
        return record;
    }
}
