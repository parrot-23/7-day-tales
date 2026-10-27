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

    /** 删除一条执行记录 */
    remove(id: string): void {
        this.data.records = this.data.records.filter((record) => record.id !== id);
    }

    /** 某日的额外任务 id 列表 */
    extraTaskIds(dayKey: string): string[] {
        return this.data.extraTasksByDay[dayKey] ?? [];
    }

    /** 追加当日额外任务（同一任务不重复加入） */
    addExtraTask(dayKey: string, taskId: string): void {
        const list = this.data.extraTasksByDay[dayKey] ?? (this.data.extraTasksByDay[dayKey] = []);
        if (!list.includes(taskId)) list.push(taskId);
    }

    /** 移除当日额外任务 */
    removeExtraTask(dayKey: string, taskId: string): void {
        const list = this.data.extraTasksByDay[dayKey];
        if (!list) return;
        this.data.extraTasksByDay[dayKey] = list.filter((id) => id !== taskId);
    }

    /** 某任务在某日是否已标记完成 */
    isTaskCompleted(dayKey: string, taskId: string): boolean {
        return (this.data.completedTasksByDay[dayKey] ?? []).includes(taskId);
    }

    /** 设置某任务在某日的完成标记 */
    setTaskCompleted(dayKey: string, taskId: string, completed: boolean): void {
        const list = this.data.completedTasksByDay[dayKey] ?? (this.data.completedTasksByDay[dayKey] = []);
        const next = completed
            ? (list.includes(taskId) ? list : [...list, taskId])
            : list.filter((id) => id !== taskId);
        this.data.completedTasksByDay[dayKey] = next;
    }
}
