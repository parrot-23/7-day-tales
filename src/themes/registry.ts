// 主题注册表：内置官方主题由代码定义，统一在此登记。
import { DEFAULT_THEME_ID } from '../datatypes/theme';
import { deepskyTheme } from './deepsky';
import type { ThemeDefinition } from './theme-definition';

/** 内置官方主题列表 */
export const THEME_DEFINITIONS: ThemeDefinition[] = [deepskyTheme];

/** 按 id 查找主题定义（找不到时回退默认主题） */
export function getThemeDefinition(id: string): ThemeDefinition | undefined {
    return THEME_DEFINITIONS.find((theme) => theme.id === id)
        ?? THEME_DEFINITIONS.find((theme) => theme.id === DEFAULT_THEME_ID);
}
