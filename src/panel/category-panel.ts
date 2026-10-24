// 分类面板：基于 FloatingPanel，用于管理计划分类。
// 内容与周计划视图的分类配置弹窗一致（分类色块 / 名称 / 删除，新增，确认 / 取消），
// 但独立实现，不复用 CategoryConfigModal。
import { Setting } from 'obsidian';

import { t } from '../i18n';
import type { CategoryRepo } from '../repos/category-repo';
import {
    ensureUncategorizedCategory,
    UNCATEGORIZED_CATEGORY_ID,
    type PlanCategory,
    type PlanCategoryData,
} from '../shared/plan-category-manager';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';

/** 分类面板配置 */
export interface CategoryPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「分类配置」 */
    title?: string;
    /** 分类数据（与周计划 / 时间盒共享同一份引用） */
    categoryData: PlanCategoryData;
    /** 分类领域仓库（提供后保存走仓库方法） */
    categoryRepo?: CategoryRepo;
    /** 数据保存回调 */
    save: () => Promise<void>;
    /** 保存成功后的回调（用于刷新入口处的图例与颜色） */
    onChange?: () => void;
}

/** 分类面板 */
export class CategoryPanel extends FloatingPanel {
    /** 编辑草稿，取消不影响原数据 */
    private draft: PlanCategory[];
    private listEl!: HTMLElement;

    constructor(private readonly panelOptions: CategoryPanelOptions) {
        super({
            width: 520,
            title: panelOptions.title ?? t('category.config'),
            ...panelOptions,
        });
        this.body.addClass('category-panel');
        this.draft = this.copyDraft();
        this.renderContent();
    }

    /** 每次打开时重置草稿并重新渲染，保证与当前分类数据一致 */
    override open(): void {
        this.draft = this.copyDraft();
        this.renderContent();
        super.open();
    }

    private copyDraft(): PlanCategory[] {
        return this.panelOptions.categoryData.categories.map(c => ({ ...c }));
    }

    /** 渲染：新增按钮 + 分类列表 + 底部确认 / 取消 */
    private renderContent(): void {
        this.body.empty();

        const toolbar = this.body.createDiv({ cls: 'category-panel-add-row' });
        const addBtn = toolbar.createEl('button', {
            text: '+',
            cls: 'tbcat-add-btn',
        });
        addBtn.setAttribute('aria-label', t('category.new'));
        addBtn.addEventListener('click', () => {
            this.draft.push({
                id: 'cat_' + Date.now().toString(36),
                label: t('category.new'),
                color: '#888888',
            });
            this.renderList();
        });

        this.listEl = this.body.createDiv({ cls: 'tbcat-list' });
        this.renderList();

        new Setting(this.body)
            .addButton(btn => btn
                .setButtonText(t('common.cancel'))
                .onClick(() => this.close()))
            .addButton(btn => btn
                .setButtonText(t('common.confirm'))
                .setCta()
                .onClick(() => this.applyDraft()));
    }

    private renderList(): void {
        this.listEl.empty();

        if (this.draft.length === 0) {
            this.listEl.createDiv({
                text: t('category.empty'),
                cls: 'tbcat-empty',
            });
            return;
        }

        this.draft.forEach((cat, index) => {
            const row = this.listEl.createDiv({ cls: 'tbcat-row' });

            // 色块
            const color = row.createEl('input', {
                type: 'color',
                cls: 'tbcat-color',
            });
            color.value = cat.color ?? '#888888';
            color.addEventListener('input', () => {
                cat.color = color.value;
            });

            // 名称
            const name = row.createEl('input', {
                type: 'text',
                placeholder: t('category.namePlaceholder'),
                cls: 'tbcat-name',
            });
            name.value = cat.label;
            name.addEventListener('input', () => {
                cat.label = name.value;
            });

            // 删除（「未分类」不可删除）
            if (cat.id === UNCATEGORIZED_CATEGORY_ID) {
                const lock = row.createSpan({
                    text: '🔒',
                    cls: 'tbcat-lock',
                });
                lock.setAttribute('aria-label', t('category.uncategorizedLocked'));
            } else {
                const del = row.createEl('button', {
                    text: '✕',
                    cls: 'tbcat-del-btn',
                });
                del.addEventListener('click', () => {
                    this.draft.splice(index, 1);
                    this.renderList();
                });
            }
        });
    }

    /** 确认：写回分类数据并持久化 */
    private applyDraft(): void {
        if (this.panelOptions.categoryRepo) {
            this.panelOptions.categoryRepo.replaceAll(this.draft);
            this.panelOptions.categoryRepo.ensureUncategorized();
        } else {
            this.panelOptions.categoryData.categories = this.draft;
            ensureUncategorizedCategory(this.panelOptions.categoryData);
        }
        void this.panelOptions.save();
        this.panelOptions.onChange?.();
        this.close();
    }
}
