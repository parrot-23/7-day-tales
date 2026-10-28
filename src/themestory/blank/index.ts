// 空白主题：不使用任何主题，不绘制代码层，也不使用图片素材。
import type { ThemeDefinition } from '../theme-definition';

export const blankTheme: ThemeDefinition = {
    id: 'blank',
    nameKey: 'theme.blank',
    assets: [],
    noteKey: 'theme.blankNote',
    // 不绘制任何内容，因此无需返回清理函数
    mount: () => undefined,
};
