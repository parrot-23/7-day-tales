// 底部方框条目领域仓库：管理界面视图底部方框里的文件夹条目。
// 通过 baseRepo 拿到 bottomItems 引用，写操作后由调用方触发 baseRepo.saveAll()。
import type { BottomItem } from '../datatypes/bottom-item';
import type { BaseRepo } from './base-repo';

export class BottomItemRepo {
    private baseRepo: BaseRepo;

    constructor(baseRepo: BaseRepo) {
        this.baseRepo = baseRepo;
    }

    /** 底部方框条目列表 */
    get items(): BottomItem[] {
        return this.baseRepo.data?.bottomItems ?? [];
    }

    /** 新增一条文件夹条目 */
    addFolder(path: string, name: string): BottomItem {
        const item: BottomItem = {
            id: `bottom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type: 'folder',
            path,
            name: name || path,
        };
        this.items.push(item);
        return item;
    }

    /** 删除一条条目 */
    remove(id: string): void {
        const data = this.baseRepo.data;
        if (!data) return;
        data.bottomItems = data.bottomItems.filter((item) => item.id !== id);
    }
}
