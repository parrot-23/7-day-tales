// 分类图例公共组件：在任意容器中渲染「分类色块 + 名称」的图例行。
// 周计划视图、时间盒面板等共用，保证图例表现一致。
import type { App } from 'obsidian';

import { t } from '../i18n';
import type { CategoryRepo } from '../repos/category-repo';
import { CategoryConfigModal, type PlanCategoryData } from './plan-category-manager';

export function renderPlanCategoryLegend(
    app: App,
    container: HTMLElement,
    categoryData: PlanCategoryData,
    onChange?: () => void,
    selectedId?: string,
    onSelect?: (id: string) => void,
    /** 是否显示配置（齿轮）按钮，默认显示 */
    showConfigButton: boolean = true,
    /** 分类领域仓库（提供后，配置弹窗保存走仓库方法，保证跨视图一致） */
    categoryRepo?: CategoryRepo,
): HTMLElement {
    const legend = container.createDiv({ cls: 'range-legend' });
    legend.createDiv({ text: t('category.legend'), cls: 'legend-title' });

    for (const cat of categoryData.categories) {
        const row = legend.createDiv({ cls: 'legend-item' });
        if (cat.id === selectedId) row.addClass('is-selected');
        const swatch = row.createDiv({ cls: `legend-color` });
        swatch.setCssProps({ '--swatch-color': cat.color ?? '#888888' });
        row.createSpan({ text: cat.label });
        row.onclick = () => onSelect?.(cat.id);
    }

    // 齿轮按钮（可选，放在图例末尾）
    if (showConfigButton) {
        const gearBtn = legend.createDiv({ cls: 'category-gear-btn' });
        gearBtn.setText('⚙️');
        gearBtn.onclick = () => {
            new CategoryConfigModal(app, categoryData, () => {
                onChange?.();
            }, categoryRepo).open();
        };
    }

    return legend;
}
