// 任务详情面板：基于 FloatingPanel，展示单个原型任务的详情。
// 左侧：类型标题行（主线任务 / 支线任务）+ 添加按钮，下方为后代任务树；
// 右侧：任务名称 / 分类 / 描述 + 归属分区选项卡。
import { FuzzySuggestModal, Notice, setIcon, type App, type TFile } from 'obsidian';

import type { BasketItem, ImprovementEntry } from '../datatypes/domain';
import type { PrototypeTask } from '../datatypes/prototype-task';
import { getLang, t } from '../i18n';
import type { PlanCategoryData } from '../shared/plan-category-manager';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';
import { FolderPickerPanel } from './folder-picker-panel';

/** 任务详情面板配置 */
export interface TaskDetailPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 当前展示的任务 */
    task: PrototypeTask;
    /** 全量原型任务（用于构建后代任务树） */
    tasks?: PrototypeTask[];
    /** 新增子任务回调（父面板负责写仓库并刷新），parentId 为当前选中的任务 */
    onAddChild?: (name: string, parentId: string) => void;
    /** 分类数据（图例分类，供右侧详情页的分类展示使用） */
    categoryData?: PlanCategoryData;
    /** 更新任务名称 / 描述 / 分类的回调（父面板负责写仓库并持久化） */
    onUpdateTask?: (taskId: string, patch: { name?: string; description?: string; categoryId?: string }) => void;
    /** Obsidian App（收集篮子「整理到文件」使用） */
    app: App;
    /** 数据保存回调（收集篮子增删后持久化） */
    save: () => Promise<void>;
    /** 任务树拖动排序 / 调整层级后的回调（父面板刷新任务列表等） */
    onTasksChanged?: () => void;
}

/** 右侧归属分区：showCount 为 true 时在标签后显示条目数量占位 */
const SECTIONS: { labelKey: Parameters<typeof t>[0]; showCount?: boolean }[] = [
    { labelKey: 'panel.targetTodo', showCount: true },
    { labelKey: 'panel.targetInbox', showCount: true },
    { labelKey: 'panel.targetFile', showCount: true },
];

/** 任务树每层缩进像素（与行 marginLeft 一致） */
const TREE_DEPTH_INDENT = 14;
/** 长按进入拖动的等待时间（毫秒） */
const TREE_LONG_PRESS_MS = 300;

/** 任务详情面板 */
export class TaskDetailPanel extends FloatingPanel {
    private panelOptions: TaskDetailPanelOptions;
    private task: PrototypeTask;
    private tasks: PrototypeTask[];
    private treeEl!: HTMLElement;
    private addFormEl!: HTMLElement;
    private inputEl!: HTMLInputElement;
    /** 右侧分区滚动容器 */
    private sectionsEl!: HTMLElement;
    /** 顶部选项卡 */
    private tabs: HTMLElement[] = [];
    /** 滚轮切换节流锁 */
    private wheelLocked = false;
    /** 当前选中的任务 id（决定 + 按钮在哪个任务下新增子任务），默认根任务 */
    private selectedTaskId: string;
    /** 收集篮子内容容器 */
    private basketBodyEl: HTMLElement | null = null;
    /** 收集篮子选项卡的条目数量标签 */
    private basketCountEl: HTMLElement | null = null;
    /** 收集篮子是否处于多选（梳理）状态 */
    private basketSelectMode = false;
    /** 收集篮子中选中的条目 id */
    private selectedBasketIds = new Set<string>();
    /** 待办 / 改进清单内容容器 */
    private todoBodyEl: HTMLElement | null = null;
    /** 待办 / 改进清单选项卡的未完成数量标签 */
    private todoCountEl: HTMLElement | null = null;
    /** 待办清单排序方式：创建顺序 / 截止时间 */
    private todoSort: 'created' | 'due' = 'created';
    /** 待办清单中当前选中的条目 id（用于设置截止时间） */
    private selectedTodoId: string | null = null;
    /** 任务文件内容容器 */
    private filesBodyEl: HTMLElement | null = null;
    /** 任务文件选项卡的文件数量标签 */
    private fileCountEl: HTMLElement | null = null;
    /** 任务文件是否处于新建文件输入状态 */
    private fileCreateMode = false;
    /** 左侧底部工具栏：表单打卡按钮 */
    private formButtonEl!: HTMLButtonElement;
    /** 左侧底部工具栏：OKR 设置按钮 */
    private okrButtonEl!: HTMLButtonElement;
    /** 右侧底部设置面板（表单打卡 / OKR 设置） */
    private settingPanelEl!: HTMLElement;
    /** 当前激活的设置面板类型 */
    private settingActive: 'form' | 'okr' | null = null;
    /** 右侧容器（切换左侧选中任务时整体重建） */
    private rightEl!: HTMLElement;
    /** 当前选中的归属分区索引（切换任务后保持不变） */
    private currentSection = 0;
    /** 面板打开时的根任务 id（左侧任务树始终以它为根，不随右侧切换变化） */
    private rootTaskId: string;
    /** 当前进行中的内联编辑取消函数（切换任务时先调用以放弃编辑） */
    private activeInlineEditAbort: (() => void) | null = null;
    /** 拖动结束后抑制一次点击，避免误选中 */
    private suppressTreeClick = false;

    constructor(options: TaskDetailPanelOptions) {
        super({
            width: 860,
            title: options.task.name,
            container: options.container,
            draggable: options.draggable,
            onClose: options.onClose,
        });
        this.panelOptions = options;
        this.task = options.task;
        this.tasks = options.tasks ?? [];
        this.selectedTaskId = options.task.id;
        this.rootTaskId = options.task.id;
        this.renderContent();
    }

    /** 每次打开时刷新收集篮子 / 待办清单 / 任务文件（数据可能被其它入口改动） */
    override open(): void {
        if (this.basketBodyEl?.isConnected) this.renderBasket(this.basketBodyEl);
        if (this.todoBodyEl?.isConnected) this.renderTodo(this.todoBodyEl);
        if (this.filesBodyEl?.isConnected) this.renderFiles(this.filesBodyEl);
        this.renderSettingPanel();
        super.open();
    }

    /** 刷新全量任务并重绘任务树 */
    setTasks(tasks: PrototypeTask[]): void {
        this.tasks = tasks;
        this.renderTree();
    }

    /** 渲染左右结构 */
    private renderContent(): void {
        const body = this.body;
        body.addClass('task-detail');

        // 左侧
        const left = body.createDiv({ cls: 'task-detail-left' });
        const header = left.createDiv({ cls: 'task-detail-header' });
        header.createSpan({
            cls: 'task-detail-type',
            text: t(this.task.type === 'main' ? 'panel.mainTaskBadge' : 'panel.sideTaskBadge'),
        });

        // + 按钮 + 其右侧的小面板
        const addWrap = header.createDiv({ cls: 'task-detail-add-wrap' });
        const addBtn = addWrap.createDiv({ cls: 'task-detail-add-btn' });
        setIcon(addBtn, 'plus');
        addBtn.setAttribute('aria-label', 'Add');
        addBtn.addEventListener('click', () => this.toggleAddForm());

        this.addFormEl = addWrap.createDiv({ cls: 'task-detail-add-form' });
        this.addFormEl.style.display = 'none';
        this.inputEl = this.addFormEl.createEl('input', { cls: 'task-detail-add-input' });
        this.inputEl.type = 'text';
        this.inputEl.placeholder = t('panel.subTaskName');
        this.inputEl.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') this.submitAdd();
            if (evt.key === 'Escape') this.hideAddForm();
        });
        const confirmBtn = this.addFormEl.createEl('button', {
            cls: 'mod-cta',
            text: t('common.confirm'),
        });
        confirmBtn.addEventListener('click', () => this.submitAdd());

        // 后代任务树
        this.treeEl = left.createDiv({ cls: 'task-detail-tree' });
        // 事件委托：点击行即选中（避免每次重绘重新绑定）
        this.treeEl.addEventListener('click', (evt) => {
            // 长按拖动结束后抑制一次点击，避免把拖动误判为选中
            if (this.suppressTreeClick) {
                this.suppressTreeClick = false;
                return;
            }
            const row = (evt.target as HTMLElement).closest('.task-detail-tree-row') as HTMLElement | null;
            const taskId = row?.dataset.taskId;
            if (taskId) this.selectTask(taskId);
        });
        this.renderTree();

        // 左侧底部工具栏：表单打卡 / OKR 设置（互斥激活，右侧底部显示对应面板）
        const toolbar = left.createDiv({ cls: 'task-detail-toolbar' });
        this.formButtonEl = this.createToolbarButton(
            toolbar,
            'check-square',
            t('panel.formCheckSetting'),
            () => this.toggleSetting('form'),
        );
        this.okrButtonEl = this.createToolbarButton(
            toolbar,
            'target',
            t('panel.okrSetting'),
            () => this.toggleSetting('okr'),
        );

        // 右侧：任务信息（名称 / 分类 / 描述）+ 归属分区选项卡（切换左侧选中任务时整体重建）
        this.rightEl = body.createDiv({ cls: 'task-detail-right' });
        this.renderRightPane();
    }

    /** 重建右侧内容：任务信息行 + 归属分区选项卡 + 底部设置面板 */
    private renderRightPane(): void {
        const right = this.rightEl;
        right.empty();
        this.tabs = [];
        this.currentSection = Math.min(this.currentSection, SECTIONS.length - 1);

        // 第一行：任务名称 + 编辑图标，右侧颜色圆点 + 分类名称
        const head = right.createDiv({ cls: 'task-detail-head' });
        const nameEl = head.createSpan({ cls: 'task-detail-name', text: this.task.name });
        const nameEdit = head.createSpan({ cls: 'task-detail-edit-icon' });
        setIcon(nameEdit, 'pencil');
        nameEdit.setAttribute('aria-label', 'Edit');
        nameEdit.addEventListener('click', () => {
            this.startInlineEdit(nameEl, this.task.name, {
                allowEmpty: false,
                onCommit: (value) => {
                    this.task.name = value;
                    const target = this.tasks.find((item) => item.id === this.task.id);
                    if (target) target.name = value;
                    nameEl.setText(value);
                    this.setTitle(value);
                    this.panelOptions.onUpdateTask?.(this.task.id, { name: value });
                },
            });
        });

        // 第二行：颜色圆点 + 分类名称 + 编辑图标
        const categoryRow = right.createDiv({ cls: 'task-detail-category-row' });
        const category = this.panelOptions.categoryData?.categories
            .find((item) => item.id === this.task.categoryId);
        const dotEl = categoryRow.createSpan({ cls: 'task-detail-category-dot' });
        dotEl.style.background = category?.color ?? '#888888';
        const categoryNameEl = categoryRow.createSpan({
            cls: 'task-detail-category-name',
            text: category?.label ?? t('defaultCategory.uncategorized'),
        });
        const categoryEdit = categoryRow.createSpan({ cls: 'task-detail-edit-icon' });
        setIcon(categoryEdit, 'pencil');
        categoryEdit.setAttribute('aria-label', 'Edit');
        categoryEdit.addEventListener('click', () => this.startCategoryEdit(dotEl, categoryNameEl));

        // 第三行：任务描述 + 编辑图标（单行，溢出省略）
        const descRow = right.createDiv({ cls: 'task-detail-desc-row' });
        const descEl = descRow.createSpan({
            cls: 'task-detail-desc',
            text: this.task.description?.trim() || '—',
        });
        const descEdit = descRow.createSpan({ cls: 'task-detail-edit-icon' });
        setIcon(descEdit, 'pencil');
        descEdit.setAttribute('aria-label', 'Edit');
        descEdit.addEventListener('click', () => {
            this.startInlineEdit(descEl, this.task.description ?? '', {
                allowEmpty: true,
                displayWhenEmpty: '—',
                onCommit: (value) => {
                    this.task.description = value || undefined;
                    const target = this.tasks.find((item) => item.id === this.task.id);
                    if (target) target.description = this.task.description;
                    descEl.setText(value || '—');
                    this.panelOptions.onUpdateTask?.(this.task.id, { description: value });
                },
            });
        });

        // 第三行：归属分区选项卡
        const tabsEl = right.createDiv({ cls: 'task-detail-tabs' });
        this.sectionsEl = right.createDiv({ cls: 'task-detail-sections' });
        // 右侧底部：设置面板（默认隐藏，由左侧工具栏按钮控制）
        this.settingPanelEl = right.createDiv({ cls: 'task-detail-setting-panel is-hidden' });

        for (const section of SECTIONS) {
            const index = this.tabs.length;
            const label = t(section.labelKey);
            const tab = tabsEl.createDiv({ cls: 'task-detail-tab' });
            tab.createSpan({ text: section.showCount ? `${label} ` : label });
            if (section.showCount) {
                const countEl = tab.createSpan({
                    cls: 'task-detail-tab-count',
                    text: `(${this.sectionCount(index)})`,
                });
                if (section.labelKey === 'panel.targetInbox') this.basketCountEl = countEl;
                if (section.labelKey === 'panel.targetTodo') this.todoCountEl = countEl;
                if (section.labelKey === 'panel.targetFile') this.fileCountEl = countEl;
            }
            tab.addEventListener('click', () => this.switchSection(index));
            this.tabs.push(tab);

            const sectionEl = this.sectionsEl.createDiv({ cls: 'task-detail-section' });
            const sectionBody = sectionEl.createDiv({ cls: 'task-detail-section-body' });
            if (section.labelKey === 'panel.targetInbox') this.renderBasket(sectionBody);
            if (section.labelKey === 'panel.targetTodo') this.renderTodo(sectionBody);
            if (section.labelKey === 'panel.targetFile') this.renderFiles(sectionBody);
        }

        this.switchSection(this.currentSection);
        // 滚轮切换：在右侧内容区滚动时左右切换选项卡
        this.sectionsEl.addEventListener('wheel', (evt) => this.handleWheel(evt), { passive: false });
        this.renderSettingPanel();
    }

    /** 创建左侧工具栏按钮（图标 + 文字） */
    private createToolbarButton(
        parent: HTMLElement,
        icon: string,
        text: string,
        onClick: () => void,
    ): HTMLButtonElement {
        const button = parent.createEl('button', { cls: 'task-detail-toolbar-btn', attr: { type: 'button' } });
        const iconEl = button.createSpan({ cls: 'task-detail-toolbar-btn-icon' });
        setIcon(iconEl, icon);
        button.createSpan({ cls: 'task-detail-toolbar-btn-text', text });
        button.addEventListener('click', onClick);
        return button;
    }

    /** 切换设置面板（互斥单选：再次点击当前按钮则关闭） */
    private toggleSetting(kind: 'form' | 'okr'): void {
        this.settingActive = this.settingActive === kind ? null : kind;
        this.renderSettingPanel();
    }

    /** 渲染右侧底部设置面板（未激活时隐藏，内容暂为占位） */
    private renderSettingPanel(): void {
        this.formButtonEl.toggleClass('is-active', this.settingActive === 'form');
        this.okrButtonEl.toggleClass('is-active', this.settingActive === 'okr');
        this.settingPanelEl.empty();
        const visible = this.settingActive !== null;
        this.settingPanelEl.toggleClass('is-hidden', !visible);
        if (!visible) return;

        // 第一行：颜色圆点 + 任务名称 + 分类（与计划面板任务信息一致）
        const task = this.tasks.find((item) => item.id === this.selectedTaskId) ?? this.task;
        const head = this.settingPanelEl.createDiv({ cls: 'plan-info-head' });
        const category = this.panelOptions.categoryData?.categories
            .find((item) => item.id === task.categoryId);
        const dot = head.createSpan({ cls: 'plan-info-dot' });
        dot.style.background = category?.color ?? '#888888';
        head.createSpan({ cls: 'plan-info-name', text: task.name });
        head.createSpan({
            cls: 'plan-info-category',
            text: category?.label ?? t('defaultCategory.uncategorized'),
        });

        // 第二行：设置项占位
        const body = this.settingPanelEl.createDiv({ cls: 'task-detail-setting-body' });
        body.createDiv({
            cls: 'task-detail-setting-placeholder',
            text: this.settingActive === 'form' ? t('panel.formCheckPending') : t('panel.okrPending'),
        });
    }

    /** 就地编辑：把元素内容换成输入框，回车 / 失焦提交，Esc 取消 */
    private startInlineEdit(
        hostEl: HTMLElement,
        current: string,
        options: {
            allowEmpty: boolean;
            displayWhenEmpty?: string;
            onCommit: (value: string) => void;
        },
    ): void {
        const restore = (): void => {
            hostEl.setText(current || options.displayWhenEmpty || '');
        };
        hostEl.empty();
        hostEl.addClass('is-editing');
        const input = hostEl.createEl('input', { cls: 'task-detail-inline-input' });
        input.type = 'text';
        input.value = current;
        input.focus();
        input.select();

        let finished = false;
        const finish = (commit: boolean): void => {
            if (finished) return;
            finished = true;
            this.activeInlineEditAbort = null;
            hostEl.removeClass('is-editing');
            const next = input.value.trim();
            const accepted = commit && (next.length > 0 || options.allowEmpty);
            if (!accepted) {
                restore();
                return;
            }
            if (next === current) {
                restore();
                return;
            }
            options.onCommit(next);
        };

        input.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') finish(true);
            if (evt.key === 'Escape') finish(false);
        });
        input.addEventListener('blur', () => finish(true));
        this.activeInlineEditAbort = () => finish(false);
    }

    /** 就地编辑分类：分类名称位置换成下拉框，选择后保存；Esc 取消 */
    private startCategoryEdit(dotEl: HTMLElement, nameEl: HTMLElement): void {
        const categories = this.panelOptions.categoryData?.categories ?? [];
        if (categories.length === 0) return;
        const currentId = this.task.categoryId
            && categories.some((item) => item.id === this.task.categoryId)
            ? this.task.categoryId
            : '';
        const previousLabel = nameEl.textContent ?? '';

        nameEl.empty();
        const select = nameEl.createEl('select', { cls: 'dropdown task-detail-category-select' });
        for (const category of categories) {
            const option = select.createEl('option', { text: category.label });
            option.value = category.id;
        }
        select.value = currentId;
        select.focus();

        let finished = false;
        const finish = (commit: boolean): void => {
            if (finished) return;
            finished = true;
            this.activeInlineEditAbort = null;
            const value = select.value;
            const category = categories.find((item) => item.id === value);
            nameEl.empty();
            if (!commit || value === currentId) {
                nameEl.setText(previousLabel);
                return;
            }
            this.task.categoryId = value || undefined;
            const target = this.tasks.find((item) => item.id === this.task.id);
            if (target) target.categoryId = this.task.categoryId;
            dotEl.style.background = category?.color ?? '#888888';
            nameEl.setText(category?.label ?? t('defaultCategory.uncategorized'));
            this.panelOptions.onUpdateTask?.(this.task.id, { categoryId: value });
        };

        select.addEventListener('change', () => finish(true));
        select.addEventListener('blur', () => finish(true));
        select.addEventListener('keydown', (evt) => {
            if (evt.key === 'Escape') finish(false);
        });
        this.activeInlineEditAbort = () => finish(false);
    }

    /** 各分区条目数量（收集篮子为总数，待办清单为未完成数） */
    private sectionCount(index: number): number {
        const key = SECTIONS[index]?.labelKey;
        if (key === 'panel.targetInbox') return this.task.basket?.length ?? 0;
        if (key === 'panel.targetTodo') {
            return (this.task.improvements ?? []).filter((item) => !item.done).length;
        }
        if (key === 'panel.targetFile') return this.listTaskFiles().length;
        return 0;
    }

    /** 收集篮子：输入行（输入框 / 添加 / 梳理）+ 下方条目列表 */
    private renderBasket(container: HTMLElement): void {
        this.basketBodyEl = container;
        container.empty();
        const wrap = container.createDiv({ cls: 'task-detail-basket' });

        // 第一行：输入框 + 添加 + 梳理
        const row = wrap.createDiv({ cls: 'gtd-collect-input-row' });
        const input = row.createEl('input', { cls: 'gtd-collect-input' });
        input.type = 'text';
        input.placeholder = t('basket.addPlaceholder');
        const addBtn = row.createEl('button', { cls: 'gtd-collect-add-btn', text: t('basket.add') });
        const organizeBtn = row.createEl('button', {
            cls: 'task-detail-basket-organize',
            text: t('basket.clarify'),
        });
        organizeBtn.toggleClass('is-active', this.basketSelectMode);

        const submit = (): void => {
            const text = input.value.trim();
            if (!text) return;
            const entry: BasketItem = {
                id: `basket_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                text,
                createdAt: Date.now(),
            };
            this.task.basket = [...(this.task.basket ?? []), entry];
            this.syncBasketToTasks();
            input.value = '';
            void this.panelOptions.save().then(() => this.renderBasket(container));
        };
        addBtn.onclick = submit;
        input.onkeydown = (evt) => {
            if (evt.key === 'Enter') submit();
        };

        organizeBtn.onclick = () => {
            this.basketSelectMode = !this.basketSelectMode;
            this.selectedBasketIds.clear();
            this.renderBasket(container);
        };

        // 条目列表（与收集面板卡片一致：时间 + 状态 + 内容 + 删除）
        const listWrap = wrap.createDiv({ cls: 'gtd-collect-list task-detail-basket-list' });
        const listInner = listWrap.createDiv({ cls: 'gtd-collect-list-inner' });
        const entries = this.task.basket ?? [];
        this.basketCountEl?.setText(`(${entries.length})`);

        if (entries.length === 0) {
            listInner.createDiv({ cls: 'gtd-collect-empty', text: t('basket.empty') });
        } else {
            for (const entry of entries) {
                const card = listInner.createDiv({ cls: 'gtd-collect-card' });
                if (this.basketSelectMode) {
                    card.toggleClass('is-selected', this.selectedBasketIds.has(entry.id));
                    card.addEventListener('click', () => {
                        if (this.selectedBasketIds.has(entry.id)) this.selectedBasketIds.delete(entry.id);
                        else this.selectedBasketIds.add(entry.id);
                        this.renderBasket(container);
                    });
                }
                const meta = card.createDiv({ cls: 'gtd-collect-card-meta' });
                meta.createSpan({ cls: 'gtd-collect-card-time', text: formatDateTime(entry.createdAt) });
                meta.createSpan({ cls: 'gtd-collect-card-status', text: t('gtd.statusInbox') });
                card.createDiv({ cls: 'gtd-collect-card-content', text: entry.text });

                const delBtn = card.createEl('button', { cls: 'gtd-collect-card-delete', text: '×' });
                delBtn.onclick = (evt) => {
                    evt.stopPropagation();
                    this.task.basket = (this.task.basket ?? []).filter((item) => item.id !== entry.id);
                    this.selectedBasketIds.delete(entry.id);
                    this.syncBasketToTasks();
                    void this.panelOptions.save().then(() => this.renderBasket(container));
                };
            }
        }

        // 梳理态底部：提示 + 整理到文件 + 取消
        if (this.basketSelectMode) {
            const footer = wrap.createDiv({ cls: 'task-detail-basket-footer' });
            footer.createSpan({ cls: 'task-detail-basket-hint', text: t('basket.multiSelectHint') });
            const confirmBtn = footer.createEl('button', {
                cls: 'task-detail-basket-organize-confirm',
                text: t('basket.organizeSelected'),
            });
            confirmBtn.disabled = this.selectedBasketIds.size === 0;
            confirmBtn.addEventListener('click', () => this.openBasketFilePicker());
            const cancelBtn = footer.createEl('button', { text: t('common.cancel') });
            cancelBtn.addEventListener('click', () => {
                this.basketSelectMode = false;
                this.selectedBasketIds.clear();
                this.renderBasket(container);
            });
        }
    }

    /** 同步篮子到全量任务列表中的同一任务，保证其它视图读到最新数据 */
    private syncBasketToTasks(): void {
        const target = this.tasks.find((item) => item.id === this.task.id);
        if (target) target.basket = this.task.basket;
    }

    /** 打开文件选择器，把选中的篮子条目追加到目标文件末尾 */
    private openBasketFilePicker(): void {
        if (this.selectedBasketIds.size === 0) return;
        new BasketFilePickerModal(this.panelOptions.app, (file) => {
            void this.organizeBasketToFile(file);
        }).open();
    }

    /** 选中条目逐条追加到文件末尾，并从篮子移除 */
    private async organizeBasketToFile(file: TFile): Promise<void> {
        const selectedIds = this.selectedBasketIds;
        const entries = (this.task.basket ?? []).filter((entry) => selectedIds.has(entry.id));
        if (entries.length === 0) return;
        try {
            await this.panelOptions.app.vault.append(file, `\n${entries.map((entry) => entry.text).join('\n')}\n`);
        } catch {
            new Notice(t('basket.organizeFailed'));
            return;
        }
        this.task.basket = (this.task.basket ?? []).filter((entry) => !selectedIds.has(entry.id));
        this.syncBasketToTasks();
        this.selectedBasketIds.clear();
        this.basketSelectMode = false;
        await this.panelOptions.save();
        if (this.basketBodyEl) this.renderBasket(this.basketBodyEl);
        new Notice(t('basket.organizeDone'));
    }

    /** 待办 / 改进清单：顶部按钮组 + 输入行 + 可选中条目的卡片列表（已完成沉底） */
    private renderTodo(container: HTMLElement): void {
        this.todoBodyEl = container;
        container.empty();
        const wrap = container.createDiv({ cls: 'task-detail-basket task-detail-todo' });

        // 顶部按钮组：排序方式 / 设置截止时间（需先选中条目）
        const toolbar = wrap.createDiv({ cls: 'task-detail-todo-toolbar' });
        const sortBtn = toolbar.createEl('button', {
            cls: 'task-detail-todo-tool-btn',
            text: this.todoSort === 'due' ? t('panel.todoSortDue') : t('panel.todoSortCreated'),
        });
        sortBtn.onclick = () => {
            this.todoSort = this.todoSort === 'due' ? 'created' : 'due';
            this.renderTodo(container);
        };
        const dueBtn = toolbar.createEl('button', {
            cls: 'task-detail-todo-tool-btn',
            text: t('panel.todoSetDue'),
        });
        dueBtn.disabled = !this.selectedTodoId;
        dueBtn.onclick = () => this.openTodoDueEditor(wrap, container);

        const row = wrap.createDiv({ cls: 'gtd-collect-input-row' });
        const input = row.createEl('input', { cls: 'gtd-collect-input' });
        input.type = 'text';
        input.placeholder = t('panel.todoAddPlaceholder');
        const addBtn = row.createEl('button', { cls: 'gtd-collect-add-btn', text: t('basket.add') });

        const submit = (): void => {
            const text = input.value.trim();
            if (!text) return;
            const entry: ImprovementEntry = {
                id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                text,
                createdAt: Date.now(),
            };
            this.task.improvements = [...(this.task.improvements ?? []), entry];
            this.syncTodoToTasks();
            input.value = '';
            void this.panelOptions.save().then(() => this.renderTodo(container));
        };
        addBtn.onclick = submit;
        input.onkeydown = (evt) => {
            if (evt.key === 'Enter') submit();
        };

        const listWrap = wrap.createDiv({ cls: 'gtd-collect-list task-detail-basket-list' });
        const listInner = listWrap.createDiv({ cls: 'gtd-collect-list-inner' });
        const entries = this.task.improvements ?? [];
        this.todoCountEl?.setText(`(${entries.filter((item) => !item.done).length})`);

        if (entries.length === 0) {
            listInner.createDiv({ cls: 'gtd-collect-empty', text: t('panel.todoEmpty') });
            return;
        }

        // 未完成在前、已完成沉底；未完成可按截止时间排序（无截止时间排最后）
        const pending = entries.filter((entry) => !entry.done);
        if (this.todoSort === 'due') {
            pending.sort((a, b) => {
                const aDue = a.dueDate ? new Date(`${a.dueDate}T00:00:00`).getTime() : Number.POSITIVE_INFINITY;
                const bDue = b.dueDate ? new Date(`${b.dueDate}T00:00:00`).getTime() : Number.POSITIVE_INFINITY;
                if (aDue !== bDue) return aDue - bDue;
                return a.createdAt - b.createdAt;
            });
        }
        const ordered = [...pending, ...entries.filter((entry) => entry.done)];

        for (const entry of ordered) {
            const card = listInner.createDiv({ cls: 'gtd-collect-card task-detail-todo-card' });
            card.toggleClass('is-done', entry.done === true);
            card.toggleClass('is-selected', this.selectedTodoId === entry.id);
            // 点击条目切换选中态（供「设置截止时间」使用）
            card.addEventListener('click', () => {
                this.selectedTodoId = this.selectedTodoId === entry.id ? null : entry.id;
                this.renderTodo(container);
            });

            // 第一行：状态标签 + 截止日期相关标签（不再显示创建时间）
            const meta = card.createDiv({ cls: 'gtd-collect-card-meta' });
            meta.createSpan({
                cls: 'gtd-collect-card-status',
                text: t(entry.done ? 'panel.todoDone' : 'panel.todoPending'),
            });
            if (entry.dueDate) this.appendTodoDueTags(meta, entry.dueDate);

            const main = card.createDiv({ cls: 'task-detail-todo-main' });
            const checkbox = main.createEl('input', { cls: 'task-detail-todo-checkbox' });
            checkbox.type = 'checkbox';
            checkbox.checked = entry.done === true;
            checkbox.addEventListener('click', (evt) => evt.stopPropagation());
            checkbox.addEventListener('change', () => {
                entry.done = checkbox.checked;
                this.syncTodoToTasks();
                void this.panelOptions.save().then(() => this.renderTodo(container));
            });
            main.createSpan({ cls: 'gtd-collect-card-content task-detail-todo-text', text: entry.text });

            const delBtn = card.createEl('button', { cls: 'gtd-collect-card-delete', text: '×' });
            delBtn.onclick = (evt) => {
                evt.stopPropagation();
                this.task.improvements = (this.task.improvements ?? []).filter((item) => item.id !== entry.id);
                if (this.selectedTodoId === entry.id) this.selectedTodoId = null;
                this.syncTodoToTasks();
                void this.panelOptions.save().then(() => this.renderTodo(container));
            };
        }
    }

    /** 在状态标签后追加截止日期 / 剩余天数 / 已过期标签 */
    private appendTodoDueTags(meta: HTMLElement, dueDate: string): void {
        const due = new Date(`${dueDate}T00:00:00`);
        if (Number.isNaN(due.getTime())) return;
        const label = getLang() === 'zh'
            ? `${due.getMonth() + 1}月${due.getDate()}日`
            : `${due.getMonth() + 1}/${due.getDate()}`;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const days = Math.round((due.getTime() - today.getTime()) / 86400000);
        // 「几天后 / 已过期」标签在截止日期标签之前
        if (days < 0) {
            meta.createSpan({ cls: 'task-detail-todo-due-tag is-overdue', text: t('panel.todoOverdue') });
        } else {
            meta.createSpan({
                cls: 'task-detail-todo-due-tag',
                text: days === 0 ? t('panel.todoDueToday') : t('panel.todoDueInDays', { days }),
            });
        }
        meta.createSpan({ cls: 'task-detail-todo-due-tag', text: t('panel.todoDueDateTag', { date: label }) });
    }

    /** 选中条目的截止日期编辑行：日期输入框 + 确定 / 清除 / 取消 */
    private openTodoDueEditor(wrap: HTMLElement, container: HTMLElement): void {
        const entry = (this.task.improvements ?? []).find((item) => item.id === this.selectedTodoId);
        if (!entry) return;
        wrap.querySelector('.task-detail-todo-due-editor')?.remove();
        const editor = wrap.createDiv({ cls: 'task-detail-todo-due-editor' });
        const input = editor.createEl('input', { cls: 'task-detail-todo-due-input' });
        input.type = 'date';
        input.value = entry.dueDate ?? '';
        const saveEntry = (): void => {
            if (input.value) entry.dueDate = input.value;
            else delete entry.dueDate;
            this.syncTodoToTasks();
            void this.panelOptions.save().then(() => this.renderTodo(container));
        };
        const save = editor.createEl('button', { cls: 'task-detail-todo-tool-btn', text: t('panel.todoDueSave') });
        save.onclick = saveEntry;
        const clear = editor.createEl('button', { cls: 'task-detail-todo-tool-btn', text: t('panel.todoDueClear') });
        clear.onclick = () => {
            input.value = '';
            saveEntry();
        };
        const cancel = editor.createEl('button', { cls: 'task-detail-todo-tool-btn', text: t('panel.todoDueCancel') });
        cancel.onclick = () => editor.remove();
        wrap.insertBefore(editor, wrap.querySelector('.gtd-collect-input-row'));
        input.focus();
    }

    /** 同步待办清单到全量任务列表中的同一任务 */
    private syncTodoToTasks(): void {
        const target = this.tasks.find((item) => item.id === this.task.id);
        if (target) target.improvements = this.task.improvements;
    }

    /** 任务文件：操作卡片（时间戳开关 / 文件目录 / 添加）+ 文件列表卡片 */
    private renderFiles(container: HTMLElement): void {
        this.filesBodyEl = container;
        container.empty();
        const wrap = container.createDiv({ cls: 'task-detail-files' });

        // 卡片一：操作按钮组
        const card = wrap.createDiv({ cls: 'task-detail-files-card' });
        const toolbar = card.createDiv({ cls: 'task-detail-files-toolbar' });

        // 启用时间戳开关
        const switchWrap = toolbar.createDiv({ cls: 'task-detail-files-switch' });
        const switchContainer = switchWrap.createDiv({ cls: 'checkbox-container' });
        switchContainer.toggleClass('is-enabled', this.task.fileTimestamp === true);
        const checkbox = switchContainer.createEl('input');
        checkbox.type = 'checkbox';
        checkbox.checked = this.task.fileTimestamp === true;
        checkbox.addEventListener('change', () => {
            switchContainer.toggleClass('is-enabled', checkbox.checked);
            this.task.fileTimestamp = checkbox.checked;
            this.syncFilesToTasks();
            void this.panelOptions.save();
        });
        switchWrap.createSpan({ cls: 'task-detail-files-switch-label', text: t('panel.fileTimestamp') });

        // 绑定目录
        const dirBtn = toolbar.createEl('button', { cls: 'task-detail-files-btn' });
        setIcon(dirBtn.createSpan({ cls: 'task-detail-files-btn-icon' }), 'folder');
        dirBtn.createSpan({
            cls: 'task-detail-files-btn-text',
            text: this.task.fileDir || t('panel.fileDir'),
        });
        dirBtn.title = this.task.fileDir || t('panel.fileDir');
        dirBtn.addEventListener('click', () => this.openFileDirPicker(container));

        // 新建文件
        const addBtn = toolbar.createEl('button', { cls: 'task-detail-files-btn' });
        setIcon(addBtn.createSpan({ cls: 'task-detail-files-btn-icon' }), 'plus');
        addBtn.createSpan({ cls: 'task-detail-files-btn-text', text: t('panel.fileAdd') });
        addBtn.addEventListener('click', () => {
            if (!this.task.fileDir) {
                new Notice(t('panel.fileNoDir'));
                return;
            }
            this.fileCreateMode = true;
            this.renderFiles(container);
        });

        if (this.fileCreateMode) {
            const createRow = card.createDiv({ cls: 'task-detail-files-create' });
            const nameInput = createRow.createEl('input', { cls: 'task-detail-files-create-input' });
            nameInput.type = 'text';
            nameInput.placeholder = t('panel.fileCreatePlaceholder');
            const confirmBtn = createRow.createEl('button', { text: t('panel.fileCreate') });
            const cancelBtn = createRow.createEl('button', { text: t('common.cancel') });
            const submit = (): void => {
                const name = nameInput.value.trim();
                if (!name) return;
                void this.createTaskFile(name);
            };
            confirmBtn.addEventListener('click', submit);
            nameInput.addEventListener('keydown', (evt) => {
                if (evt.key === 'Enter') submit();
                if (evt.key === 'Escape') {
                    this.fileCreateMode = false;
                    this.renderFiles(container);
                }
            });
            cancelBtn.addEventListener('click', () => {
                this.fileCreateMode = false;
                this.renderFiles(container);
            });
            nameInput.focus();
        }

        // 卡片二：文件列表（文件名 + 最近编辑时间，点击打开）
        const listCard = wrap.createDiv({ cls: 'task-detail-files-card task-detail-files-list-card' });
        const files = this.listTaskFiles();
        this.fileCountEl?.setText(`(${files.length})`);

        if (!this.task.fileDir) {
            listCard.createDiv({ cls: 'gtd-collect-empty', text: t('panel.fileNoDir') });
            return;
        }
        if (files.length === 0) {
            listCard.createDiv({ cls: 'gtd-collect-empty', text: t('panel.fileEmpty') });
            return;
        }
        for (const file of files) {
            const row = listCard.createDiv({ cls: 'task-detail-file-row' });
            setIcon(row.createSpan({ cls: 'task-detail-file-icon' }), 'file-text');
            row.createSpan({ cls: 'task-detail-file-name', text: file.basename });
            row.createSpan({ cls: 'task-detail-file-time', text: formatDateTime(file.stat.mtime) });
            row.addEventListener('click', () => {
                void this.panelOptions.app.workspace.getLeaf(false).openFile(file);
            });
        }
    }

    /** 绑定目录下的全部文件（按最近编辑时间倒序） */
    private listTaskFiles(): TFile[] {
        const dir = this.task.fileDir;
        if (!dir) return [];
        return this.panelOptions.app.vault.getFiles()
            .filter((file) => file.parent?.path === dir)
            .sort((a, b) => b.stat.mtime - a.stat.mtime);
    }

    /** 打开目录选择面板，选定后作为任务文件目录 */
    private openFileDirPicker(container: HTMLElement): void {
        const picker = new FolderPickerPanel(this.panelOptions.app, {
            onConfirm: (result) => {
                this.task.fileDir = result.path;
                this.fileCreateMode = false;
                this.syncFilesToTasks();
                void this.panelOptions.save().then(() => this.renderFiles(container));
            },
        });
        picker.open();
    }

    /** 在绑定目录下新建 Markdown 文件（启用时间戳时加前缀） */
    private async createTaskFile(name: string): Promise<void> {
        const dir = this.task.fileDir;
        if (!dir) return;
        const safe = name.replace(/[\\/:*?"<>|]/g, '').trim();
        if (!safe) return;
        const stamp = this.task.fileTimestamp ? `${formatFileStamp(Date.now())}_` : '';
        const fileName = safe.toLowerCase().endsWith('.md') ? `${stamp}${safe}` : `${stamp}${safe}.md`;
        try {
            const file = await this.panelOptions.app.vault.create(`${dir}/${fileName}`, '');
            this.fileCreateMode = false;
            if (this.filesBodyEl) this.renderFiles(this.filesBodyEl);
            void this.panelOptions.app.workspace.getLeaf(false).openFile(file);
        } catch {
            new Notice(t('panel.fileCreateFailed'));
        }
    }

    /** 同步任务文件配置到全量任务列表中的同一任务 */
    private syncFilesToTasks(): void {
        const target = this.tasks.find((item) => item.id === this.task.id);
        if (!target) return;
        target.fileDir = this.task.fileDir;
        target.fileTimestamp = this.task.fileTimestamp;
    }

    /** 滚轮切换选项卡（带节流，避免一次滚动跳过多页） */
    private handleWheel(evt: WheelEvent): void {
        if (Math.abs(evt.deltaY) < 2) return;
        const current = this.tabs.findIndex((tab) => tab.hasClass('is-active'));
        const next = current + (evt.deltaY > 0 ? 1 : -1);
        // 已到首/尾时放行默认滚动（交给外层容器）
        if (next < 0 || next >= this.tabs.length) return;
        evt.preventDefault();
        if (this.wheelLocked) return;
        this.wheelLocked = true;
        this.switchSection(next);
        window.setTimeout(() => {
            this.wheelLocked = false;
        }, 260);
    }

    /** 切换选项卡：只显示对应分区 */
    private switchSection(index: number): void {
        this.currentSection = index;
        const sections = Array.from(this.sectionsEl.children) as HTMLElement[];
        this.tabs.forEach((tab, i) => tab.toggleClass('is-active', i === index));
        sections.forEach((section, i) => section.toggleClass('is-active', i === index));
    }

    /** 渲染后代任务树 */
    private renderTree(): void {
        this.treeEl.empty();
        const hasChild = this.tasks.some((task) => task.parentId === this.rootTaskId);
        if (!hasChild) {
            this.treeEl.createDiv({ cls: 'task-detail-tree-empty', text: t('panel.noSubTask') });
            return;
        }
        this.renderTreeNodes(this.treeEl, this.rootTaskId, 0);
    }

    /** 递归渲染某一层的子任务 */
    private renderTreeNodes(parentEl: HTMLElement, parentId: string, depth: number): void {
        const children = this.tasks.filter((task) => task.parentId === parentId);
        for (const child of children) {
            const row = parentEl.createDiv({ cls: 'task-detail-tree-row' });
            row.style.marginLeft = `${depth * TREE_DEPTH_INDENT}px`;
            row.dataset.taskId = child.id;
            row.dataset.depth = String(depth);
            const iconEl = row.createSpan({ cls: 'task-detail-tree-icon' });
            setIcon(iconEl, 'git-branch');
            row.createSpan({ cls: 'task-detail-tree-label', text: child.name });
            row.toggleClass('is-selected', child.id === this.selectedTaskId);
            row.addEventListener('mousedown', (evt) => this.startTreeLongPress(evt, child, row));
            this.renderTreeNodes(parentEl, child.id, depth + 1);
        }
    }

    /** 长按任务条目后进入拖动：按落点重排顺序并调整层级（限制在当前根任务子树内） */
    private startTreeLongPress(evt: MouseEvent, item: PrototypeTask, row: HTMLElement): void {
        if (evt.button !== 0) return;
        const startX = evt.clientX;
        const startY = evt.clientY;
        let timer: number | null = window.setTimeout(() => {
            timer = null;
            beginDrag();
        }, TREE_LONG_PRESS_MS);

        const cancelTimer = (): void => {
            if (timer !== null) {
                window.clearTimeout(timer);
                timer = null;
            }
            document.removeEventListener('mousemove', onPreMove);
            document.removeEventListener('mouseup', onPreUp);
        };

        // 长按期间移动超过阈值则视为普通点击 / 取消长按
        const onPreMove = (moveEvt: MouseEvent): void => {
            if (Math.abs(moveEvt.clientX - startX) > 5 || Math.abs(moveEvt.clientY - startY) > 5) {
                cancelTimer();
            }
        };
        const onPreUp = (): void => cancelTimer();
        document.addEventListener('mousemove', onPreMove);
        document.addEventListener('mouseup', onPreUp);

        const beginDrag = (): void => {
            document.removeEventListener('mousemove', onPreMove);
            document.removeEventListener('mouseup', onPreUp);

            // 被拖动任务及其后代（整体移动，且不能作为落点）
            const movingIds = this.collectSubtreeIds(item.id);
            const targets = Array.from(this.treeEl.querySelectorAll<HTMLElement>('.task-detail-tree-row'))
                .filter((el) => {
                    const id = el.dataset.taskId;
                    return id && !movingIds.has(id);
                });

            row.addClass('is-dragging');
            const indicator = this.treeEl.createDiv({ cls: 'task-detail-drag-indicator' });

            // 落点计算：{ beforeId, placeAfter, parentId, depth }
            const computeDrop = (clientX: number, clientY: number) => {
                if (targets.length === 0) {
                    return { beforeId: undefined as string | undefined, parentId: this.rootTaskId, depth: 0 };
                }
                let refEl: HTMLElement | undefined;
                let placeAfter = false;
                for (const el of targets) {
                    const rect = el.getBoundingClientRect();
                    if (clientY < rect.top) {
                        refEl = el;
                        placeAfter = false;
                        break;
                    }
                    if (clientY <= rect.bottom) {
                        refEl = el;
                        placeAfter = clientY > rect.top + rect.height / 2;
                        break;
                    }
                }
                if (!refEl) {
                    refEl = targets[targets.length - 1];
                    placeAfter = true;
                }

                const refId = refEl.dataset.taskId!;
                const refDepth = Number(refEl.dataset.depth ?? '0');
                // 层级：鼠标 X 相对目标行左边缘的偏移（每 14px 一层），最多比目标深一层
                const offset = clientX - refEl.getBoundingClientRect().left;
                let depth = Math.max(0, Math.min(Math.round(offset / TREE_DEPTH_INDENT), refDepth + 1));

                // 父级：目标行之前最近的 depth-1 层任务；找不到则挂回当前根任务
                let parentId = this.rootTaskId;
                if (depth > 0) {
                    const refIndex = targets.indexOf(refEl);
                    let found = false;
                    for (let i = refIndex; i >= 0; i--) {
                        const candId = targets[i].dataset.taskId!;
                        const candDepth = Number(targets[i].dataset.depth ?? '0');
                        if (candDepth === depth - 1) {
                            parentId = candId;
                            found = true;
                            break;
                        }
                    }
                    if (!found) depth = 0;
                }
                return { beforeId: refId, placeAfter, parentId, depth };
            };

            const updateIndicator = (clientX: number, clientY: number): void => {
                const drop = computeDrop(clientX, clientY);
                const refEl = targets.find((el) => el.dataset.taskId === drop.beforeId);
                if (!refEl) {
                    indicator.removeClass('is-visible');
                    return;
                }
                const rect = refEl.getBoundingClientRect();
                const listRect = this.treeEl.getBoundingClientRect();
                const top = (drop.placeAfter ? rect.bottom : rect.top) - listRect.top + this.treeEl.scrollTop;
                indicator.addClass('is-visible');
                indicator.setCssProps({
                    '--indicator-top': `${top}px`,
                    '--indicator-left': `${drop.depth * TREE_DEPTH_INDENT}px`,
                });
            };

            let hasMoved = false;
            const onMove = (moveEvt: MouseEvent): void => {
                // 长按触发后只要鼠标稍微移动即视为真实拖动
                if (!hasMoved) hasMoved = true;
                updateIndicator(moveEvt.clientX, moveEvt.clientY);
            };
            const onUp = (upEvt: MouseEvent): void => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                indicator.remove();
                row.removeClass('is-dragging');
                if (hasMoved) {
                    this.suppressTreeClick = true;
                    this.applyTreeDrop(item, computeDrop(upEvt.clientX, upEvt.clientY));
                }
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    }

    /** 应用落点：更新 parentId 并重排 tasks 数组，然后保存并刷新 */
    private applyTreeDrop(
        item: PrototypeTask,
        drop: { beforeId?: string; placeAfter?: boolean; parentId: string; depth: number },
    ): void {
        const target = this.tasks.find((task) => task.id === item.id);
        if (!target) return;
        target.parentId = drop.parentId;

        const movingIds = this.collectSubtreeIds(item.id);
        const moving = this.tasks.filter((task) => movingIds.has(task.id));
        const rest = this.tasks.filter((task) => !movingIds.has(task.id));
        let next: PrototypeTask[];
        if (!drop.beforeId) {
            next = [...rest, ...moving];
        } else {
            const refIndex = rest.findIndex((task) => task.id === drop.beforeId);
            const insertAt = refIndex < 0 ? rest.length : (drop.placeAfter ? refIndex + 1 : refIndex);
            next = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
        }
        // 原地替换数组内容，保持引用不变（其它面板持有同一数组）
        this.tasks.splice(0, this.tasks.length, ...next);

        this.renderTree();
        void this.panelOptions.save().then(() => this.panelOptions.onTasksChanged?.());
    }

    /** 某任务及其全部后代的 id 集合 */
    private collectSubtreeIds(id: string): Set<string> {
        const ids = new Set<string>([id]);
        const walk = (parentId: string): void => {
            for (const task of this.tasks) {
                if (task.parentId === parentId) {
                    ids.add(task.id);
                    walk(task.id);
                }
            }
        };
        walk(id);
        return ids;
    }

    /** 选中某个任务条目（决定 + 新增子任务挂到哪个任务下） */
    private selectTask(taskId: string): void {
        this.selectedTaskId = taskId;
        this.treeEl.querySelectorAll('.task-detail-tree-row').forEach((el) => {
            const row = el as HTMLElement;
            row.toggleClass('is-selected', row.dataset.taskId === taskId);
        });
        const next = this.tasks.find((item) => item.id === taskId);
        if (next && next.id !== this.task.id) {
            // 右侧整体切换为选中任务：名称 / 分类 / 描述 / 归属分区，未提交的内联编辑先行放弃
            this.activeInlineEditAbort?.();
            this.task = next;
            this.setTitle(next.name);
            this.basketSelectMode = false;
            this.selectedBasketIds.clear();
            this.selectedTodoId = null;
            this.fileCreateMode = false;
            this.renderRightPane();
            return;
        }
        this.renderSettingPanel();
    }

    /** 展开 / 收起新增子任务小面板 */
    private toggleAddForm(): void {
        const visible = this.addFormEl.style.display !== 'none';
        if (visible) {
            this.hideAddForm();
        } else {
            this.addFormEl.style.display = 'flex';
            this.inputEl.focus();
        }
    }

    private hideAddForm(): void {
        this.addFormEl.style.display = 'none';
        this.inputEl.value = '';
    }

    /** 确认新增子任务 */
    private submitAdd(): void {
        const name = this.inputEl.value.trim();
        if (!name) {
            this.inputEl.focus();
            return;
        }
        this.panelOptions.onAddChild?.(name, this.selectedTaskId);
        this.hideAddForm();
    }
}

/** 时间戳格式化为 YYYY-MM-DD HH:MM */
function formatDateTime(ts: number): string {
    const d = new Date(ts);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${da} ${h}:${mi}`;
}

/** 文件名的日期时间戳前缀（YYYY-MM-DD_HH-mm） */
function formatFileStamp(ts: number): string {
    const d = new Date(ts);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${da}_${h}-${mi}`;
}

/** 收集篮子「整理到文件」：选择一个 Markdown 文件作为追加目标 */
class BasketFilePickerModal extends FuzzySuggestModal<TFile> {
    private onPick: (file: TFile) => void;

    constructor(app: App, onPick: (file: TFile) => void) {
        super(app);
        this.onPick = onPick;
        this.setPlaceholder(t('basket.organizeToFile'));
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles();
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile): void {
        this.onPick(file);
    }
}