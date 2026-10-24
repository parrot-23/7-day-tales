// 计划排布领域仓库：管理界面视图「计划面板」周视图上任务到天列的排布数据。
// 通过 baseRepo 拿到 planAssignmentData 引用，写操作后由调用方触发 baseRepo.saveAll()。
import type { PlanAssignment, PlanAssignmentData } from '../datatypes/plan-assignment';
import type { BaseRepo } from './base-repo';

export class PlanAssignmentRepo {
    private baseRepo: BaseRepo;

    constructor(baseRepo: BaseRepo) {
        this.baseRepo = baseRepo;
    }

    /** 计划排布数据引用（视图读取用） */
    get data(): PlanAssignmentData {
        return this.baseRepo.data!.planAssignmentData;
    }

    /** 某一周某一天已排布的任务（按排布顺序） */
    dayAssignments(weekKey: string, weekday: number): PlanAssignment[] {
        return this.data.assignments.filter(
            (assignment) => assignment.weekKey === weekKey && assignment.weekday === weekday,
        );
    }

    /** 把任务排布到某一天；同一天重复排布同一任务时直接返回已有记录 */
    add(weekKey: string, weekday: number, taskId: string): PlanAssignment {
        const existing = this.data.assignments.find(
            (assignment) => assignment.weekKey === weekKey
                && assignment.weekday === weekday
                && assignment.taskId === taskId,
        );
        if (existing) return existing;
        const assignment: PlanAssignment = { weekKey, weekday, taskId, createdAt: Date.now() };
        this.data.assignments.push(assignment);
        return assignment;
    }

    /** 移除某一天已排布的任务；不存在时忽略 */
    remove(weekKey: string, weekday: number, taskId: string): void {
        const assignments = this.data.assignments;
        const index = assignments.findIndex(
            (assignment) => assignment.weekKey === weekKey
                && assignment.weekday === weekday
                && assignment.taskId === taskId,
        );
        if (index >= 0) assignments.splice(index, 1);
    }
}
