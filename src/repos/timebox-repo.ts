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
