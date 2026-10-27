// 主题定义：一个主题由「代码绘制层」与「图片素材」两部分组成。
// 代码绘制层（星空 / 光晕等）由 src/themes 下的模块实现，
// 图片素材放在插件目录的 cache/theme/<主题>/ 下，路径按插件目录相对表示。
import type { App } from 'obsidian';

import type { I18nMessages } from '../i18n/zh';

/** 主题使用的图片素材 */
export interface ThemeAsset {
    /** 素材类型（目前仅图片） */
    kind: 'image';
    /** 相对插件目录的路径（如 cache/theme/deepsky/back.png） */
    path: string;
}

/** 挂载主题代码绘制层时的上下文 */
export interface ThemeMountContext {
    /** Obsidian App（用于读取 vault 资源路径） */
    app: App;
    /** 插件目录（vault 相对路径） */
    pluginDir: string;
}

/** 主题定义 */
export interface ThemeDefinition {
    /** 主题唯一标识 */
    id: string;
    /** 主题名文案 key */
    nameKey: keyof I18nMessages;
    /** 主题使用的图片素材 */
    assets: ThemeAsset[];
    /** 缩略图占位文案 key（无图片素材时显示，如空白主题） */
    noteKey?: keyof I18nMessages;
    /** 在容器内绘制代码层（星空 / 光晕 / 星云），可返回清理函数用于停止动画 */
    mount: (container: HTMLElement, ctx: ThemeMountContext) => (() => void) | void;
}
