// 深空主题：纯黑深空 + 代码绘制的星点（缓慢迎面移动），不使用图片素材。
import type { ThemeDefinition } from '../theme-definition';
import { createStarfield } from './star-canvas';

export const deepskyTheme: ThemeDefinition = {
    id: 'deepsky',
    nameKey: 'theme.nameDeepsky',
    assets: [],
    mount(container) {
        // 场景层：承载星点画布，位于内容之下且不拦截交互
        const scene = container.createDiv({ cls: 'interface-theme-scene' });
        const canvasEl = scene.createEl('canvas', { cls: 'interface-theme-canvas' });
        return createStarfield(canvasEl, scene);
    },
};
