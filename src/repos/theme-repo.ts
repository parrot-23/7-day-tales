// 主题领域仓库：封装界面主题（ThemeData）的读取业务逻辑。
// 视图通过本仓库读取主题列表；写操作（增删改）后续在主题管理面板右侧内容中补充。
import type { Theme, ThemeData } from '../datatypes/theme';
import type { BaseRepo } from './base-repo';

/**
 * 主题领域仓库：只管 themeData（官方 / 本地主题列表）。
 * 通过 baseRepo 拿到 themeData 引用，写操作后由调用方触发 baseRepo.saveAll()。
 */
export class ThemeRepo {
    private baseRepo: BaseRepo;

    constructor(baseRepo: BaseRepo) {
        this.baseRepo = baseRepo;
    }

    /** 主题数据引用（视图读取用） */
    get data(): ThemeData {
        return this.baseRepo.data!.themeData;
    }

    /** 官方主题列表引用 */
    get officialThemes(): Theme[] {
        return this.data.officialThemes;
    }

    /** 本地主题列表引用 */
    get localThemes(): Theme[] {
        return this.data.localThemes;
    }

    /** 当前应用的主题 id */
    get currentThemeId(): string {
        return this.data.currentThemeId;
    }

    /** 切换当前主题（写操作后由调用方触发 baseRepo.saveAll()） */
    setCurrentTheme(themeId: string): void {
        this.data.currentThemeId = themeId;
    }
}
