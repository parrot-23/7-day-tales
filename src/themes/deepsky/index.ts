// 深空主题：深空场景完全由代码绘制（星云 / 极光渐变 + Canvas 动态星空 + 暗角），
// 星球图片仅作为场景中的一个「星球对象」叠加，不作为整张背景铺满。
import type { ThemeDefinition } from '../theme-definition';
import { createStarfield } from './star-canvas';
import { buildNebula } from './nebula';

/** 星球图片素材相对插件目录的路径 */
const SPRITE_PATH = 'cache/theme/deepsky/sprite.png';

export const deepskyTheme: ThemeDefinition = {
    id: 'deepsky',
    nameKey: 'theme.nameDeepsky',
    assets: [{ kind: 'image', path: SPRITE_PATH }],
    mount(container, ctx) {
        // 场景层：承载所有代码绘制元素，位于内容之下
        const scene = container.createDiv({ cls: 'interface-theme-scene' });

        // 星云 / 极光（代码绘制，CSS 渐变）
        const nebulaEl = scene.createDiv({ cls: 'interface-theme-nebula' });
        nebulaEl.style.backgroundImage = buildNebula();

        // 星球背后的冷色光晕（代码绘制）
        scene.createDiv({ cls: 'interface-theme-planet-halo' });

        // 星球对象：图片素材，通过遮罩与混合模式融入场景
        const spriteUrl = ctx.app.vault.adapter.getResourcePath(`${ctx.pluginDir}/${SPRITE_PATH}`);
        const planetEl = scene.createDiv({ cls: 'interface-theme-planet' });
        planetEl.style.backgroundImage = `url("${spriteUrl}")`;

        // 动态星空（代码绘制，Canvas）
        const canvasEl = scene.createEl('canvas', { cls: 'interface-theme-canvas' }) as HTMLCanvasElement;
        const disposeStars = createStarfield(canvasEl, scene);

        // 暗角：压暗四周，提升内容可读性
        scene.createDiv({ cls: 'interface-theme-vignette' });

        return disposeStars;
    },
};
