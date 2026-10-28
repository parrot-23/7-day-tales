// 深空主题：纯黑深空 + 代码绘制的星点（缓慢迎面移动），不使用图片素材。
import type { ThemeDefinition } from '../theme-definition';
import { createStarfield } from './star-canvas';

export const deepskyTheme: ThemeDefinition = {
    id: 'deepsky',
    nameKey: 'theme.nameDeepsky',
    assets: [],
    colors: {
        cardBackground: 'rgba(22, 26, 40, 0.55)',
        cardBorder: 'rgba(255, 255, 255, 0.14)',
        textPrimary: '#e8ecf5',
        textSecondary: '#a6aec4',
        hoverBackground: 'rgba(255, 255, 255, 0.08)',
        interactiveBackground: 'rgba(255, 255, 255, 0.06)',
        interactiveHover: 'rgba(255, 255, 255, 0.12)',
        controlBackground: 'rgba(22, 26, 40, 0.9)',
    },
    mount(container) {
        // 场景层：承载星点画布，位于内容之下且不拦截交互
        const scene = container.createDiv({ cls: 'interface-theme-scene' });
        const canvasEl = scene.createEl('canvas', { cls: 'interface-theme-canvas' });
        return createStarfield(canvasEl, scene);
    },
};
