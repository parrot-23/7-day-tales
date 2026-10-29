// 界面主题原型数据：定义主题的数据结构与当前应用的主题。
// 主题的代码绘制层与图片素材定义在 src/themes 下，这里只记录当前选中的主题 id。

/** 主题来源：官方内置 / 本地自定义 */
export type ThemeSource = 'official' | 'local';

/** 默认主题 id（时空之旅） */
export const DEFAULT_THEME_ID = 'timespace';

/** 界面主题（id / name / source 骨架） */
export interface Theme {
    /** 主题唯一标识 */
    id: string;
    /** 主题名称 */
    name: string;
    /** 主题来源 */
    source: ThemeSource;
}

/** 主题数据（当前主题 + 官方 / 本地主题列表） */
export interface ThemeData {
    /** 当前应用的主题 id */
    currentThemeId: string;
    /** 官方主题列表 */
    officialThemes: Theme[];
    /** 本地主题列表 */
    localThemes: Theme[];
}

/** 默认主题数据（默认应用时空之旅，列表为空占位） */
export function defaultThemeData(): ThemeData {
    return { currentThemeId: DEFAULT_THEME_ID, officialThemes: [], localThemes: [] };
}
