// 时间盒领域仓库：管理界面视图「时间盒面板」的格子涂色数据。
// 通过 baseRepo 拿到 timeBoxData 引用，写操作后由调用方触发 baseRepo.saveAll()。
import type { TimeBoxCell, TimeBoxData } from '../datatypes/timebox-data';
import { timeBoxCellKey } from '../datatypes/timebox-data';
import type { BaseRepo } from './base-repo';

export class TimeBoxRepo {
    private baseRepo: BaseRepo;

    constructor(baseRepo: BaseRepo) {
        this.baseRepo = baseRepo;
    }

    /** 时间盒数据引用（视图读取用） */
    get data(): TimeBoxData {
        return this.baseRepo.data!.timeBoxData;
    }

    /** 读取单个格子 */
    getCell(weekKey: string, weekday: number, hour: number): TimeBoxCell | undefined {
        const key = timeBoxCellKey(weekKey, weekday, hour);
        return this.data.cells.find(
            (cell) => timeBoxCellKey(cell.weekKey, cell.weekday, cell.hour) === key,
        );
    }

    /** 某一周的全部格子（用于渲染时批量上色） */
    weekCells(weekKey: string): TimeBoxCell[] {
        return this.data.cells.filter((cell) => cell.weekKey === weekKey);
    }

    /**
     * 确保指定周有初始排布：若该周还没有任何格子，则把最近一个有数据的更早周复制过来。
     * 返回是否发生了复制（调用方据此决定是否保存）。
     */
    ensureWeekInitialized(weekKey: string): boolean {
        if (this.weekCells(weekKey).length > 0) return false;
        const previousKey = this.latestWeekBefore(weekKey);
        if (!previousKey) return false;
        const copied = this.weekCells(previousKey).map((cell) => ({ ...cell, weekKey }));
        this.data.cells.push(...copied);
        return true;
    }

    /** 早于指定周键的最近一个有数据的周键 */
    private latestWeekBefore(weekKey: string): string | undefined {
        const keys = Array.from(new Set(this.data.cells.map((cell) => cell.weekKey)))
            .filter((key) => key < weekKey)
            .sort();
        return keys.length > 0 ? keys[keys.length - 1] : undefined;
    }

    /** 给格子涂上分类颜色；同一格子重复涂色则覆盖分类 */
    paint(weekKey: string, weekday: number, hour: number, categoryId: string): TimeBoxCell {
        const existing = this.getCell(weekKey, weekday, hour);
        if (existing) {
            existing.categoryId = categoryId;
            return existing;
        }
        const cell: TimeBoxCell = { weekKey, weekday, hour, categoryId };
        this.data.cells.push(cell);
        return cell;
    }
}
