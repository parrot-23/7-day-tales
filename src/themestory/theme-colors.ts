// 主题颜色注入：把 ThemeColors 令牌注入为 CSS 变量，供卡片 / 浮动面板统一继承。
// 除注入 --sdt-* 自定义令牌外，同时覆盖 Obsidian 原生变量（--interactive-normal 等），
// 这样 Obsidian 全局的 button:not(.clickable-icon) 等规则在主题作用域内也会跟随主题，
// 无需为每个按钮逐个提升选择器特异性。
import type { ThemeColors } from './theme-definition';

/** ThemeColors 字段 → 自定义令牌 + 对应覆盖的 Obsidian 原生变量 */
const THEME_COLOR_MAP: Array<{ key: keyof ThemeColors; sdtVar: string; obsidianVars: string[] }> = [
    { key: 'cardBackground', sdtVar: '--sdt-card-bg', obsidianVars: ['--background-secondary'] },
    { key: 'cardBorder', sdtVar: '--sdt-card-border', obsidianVars: ['--background-modifier-border'] },
    { key: 'textPrimary', sdtVar: '--sdt-text-primary', obsidianVars: ['--text-normal'] },
    { key: 'textSecondary', sdtVar: '--sdt-text-secondary', obsidianVars: ['--text-muted'] },
    { key: 'hoverBackground', sdtVar: '--sdt-hover-bg', obsidianVars: ['--background-modifier-hover'] },
    // 按钮 + 下拉框背景共用交互底色；下拉框悬停跟随交互悬停
    { key: 'interactiveBackground', sdtVar: '--sdt-interactive-bg', obsidianVars: ['--interactive-normal', '--dropdown-background'] },
    { key: 'interactiveHover', sdtVar: '--sdt-interactive-hover', obsidianVars: ['--interactive-hover', '--dropdown-background-hover'] },
    // 控件 / 面板 / 输入框背景统一用控件底色
    { key: 'controlBackground', sdtVar: '--sdt-control-bg', obsidianVars: ['--background-primary', '--background-modifier-form-field'] },
    // 输入框悬浮背景：Obsidian 在 body 上把它解析成 form-field 的浅色值后再继承，
    // 只覆盖 form-field 无法影响面板内的输入框，需单独注入，否则悬浮 / 聚焦时回退成白色
    { key: 'interactiveHover', sdtVar: '--sdt-form-field-hover', obsidianVars: ['--background-modifier-form-field-hover'] },
];

/**
 * 把主题颜色令牌注入到指定容器。
 * colors 为空（如空白主题）时仅清空旧变量，容器回退到 Obsidian 默认值。
 */
export function applyThemeColors(container: HTMLElement, colors?: ThemeColors): void {
    for (const { sdtVar, obsidianVars } of THEME_COLOR_MAP) {
        container.style.removeProperty(sdtVar);
        for (const obsidianVar of obsidianVars) container.style.removeProperty(obsidianVar);
    }
    if (!colors) return;
    for (const { key, sdtVar, obsidianVars } of THEME_COLOR_MAP) {
        const value = colors[key];
        if (!value) continue;
        container.style.setProperty(sdtVar, value);
        for (const obsidianVar of obsidianVars) container.style.setProperty(obsidianVar, value);
    }
}

/** 需要跟随主题颜色的对象（如浮动面板） */
export interface ThemeColorsConsumer {
    applyThemeColors(colors?: ThemeColors): void;
}

/** 当前主题颜色（供延迟创建的面板在构造时同步） */
let currentColors: ThemeColors | undefined;
const consumers = new Set<ThemeColorsConsumer>();

/** 更新全局主题颜色，并通知所有已注册消费者（浮动面板）刷新 */
export function setCurrentThemeColors(colors?: ThemeColors): void {
    currentColors = colors;
    consumers.forEach((consumer) => consumer.applyThemeColors(colors));
}

/** 读取当前主题颜色 */
export function getCurrentThemeColors(): ThemeColors | undefined {
    return currentColors;
}

/** 注册主题颜色消费者（浮动面板构造时调用） */
export function registerThemeColorsConsumer(consumer: ThemeColorsConsumer): void {
    consumers.add(consumer);
}

/** 注销主题颜色消费者（浮动面板销毁时调用） */
export function unregisterThemeColorsConsumer(consumer: ThemeColorsConsumer): void {
    consumers.delete(consumer);
}
