// 任务详情面板：基于 FloatingPanel，展示单个原型任务的详情。
// 左侧：类型标题行（主线任务 / 支线任务）+ 添加按钮，下方为后代任务树；
// 右侧：内容区（暂为空）。
import { setIcon } from 'obsidian';

import type { PrototypeTask } from '../datatypes/prototype-task';
import { t } from '../i18n';
import type { PlanCategoryData } from '../shared/plan-category-manager';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';

/** 任务详情面板配置 */
export interface TaskDetailPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 当前展示的任务 */
    task: PrototypeTask;
    /** 全量原型任务（用于构建后代任务树） */
    tasks?: PrototypeTask[];
    /** 新增子任务回调（父面板负责写仓库并刷新），parentId 为当前选中的任务 */
    onAddChild?: (name: string, parentId: string) => void;
    /** 分类数据（图例分类，供右侧详情页的分类下拉框使用） */
    categoryData?: PlanCategoryData;
    /** 更新任务描述 / 分类的回调（父面板负责写仓库并持久化） */
    onUpdateTask?: (taskId: string, patch: { description?: string; categoryId?: string }) => void;
}

/** 右侧分区：与左侧归属方块一一对应 */
const SECTIONS: { labelKey: Parameters<typeof t>[0] }[] = [
    { labelKey: 'panel.sectionTaskDetail' },
    { labelKey: 'panel.targetInbox' },
    { labelKey: 'panel.targetTodo' },
    { labelKey: 'panel.targetFormCheck' },
    { labelKey: 'panel.targetOkr' },
    { labelKey: 'panel.targetFile' },
];

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

    constructor(options: TaskDetailPanelOptions) {
        super({
            width: 760,
            title: options.task.name,
            container: options.container,
            draggable: options.draggable,
            onClose: options.onClose,
        });
        this.panelOptions = options;
        this.task = options.task;
        this.tasks = options.tasks ?? [];
        this.selectedTaskId = options.task.id;
        this.renderContent();
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
            const row = (evt.target as HTMLElement).closest('.task-detail-tree-row') as HTMLElement | null;
            const taskId = row?.dataset.taskId;
            if (taskId) this.selectTask(taskId);
        });
        this.renderTree();

        // 右侧：顶部选项卡 + 单页内容（同一时刻只显示一个分区）
        const right = body.createDiv({ cls: 'task-detail-right' });
        const tabsEl = right.createDiv({ cls: 'task-detail-tabs' });
        this.sectionsEl = right.createDiv({ cls: 'task-detail-sections' });

        for (const section of SECTIONS) {
            const index = this.tabs.length;
            const tab = tabsEl.createDiv({ cls: 'task-detail-tab', text: t(section.labelKey) });
            tab.addEventListener('click', () => this.switchSection(index));
            this.tabs.push(tab);

            const sectionEl = this.sectionsEl.createDiv({ cls: 'task-detail-section' });
            sectionEl.createDiv({ cls: 'task-detail-section-title', text: t(section.labelKey) });
            const bodyEl = sectionEl.createDiv({ cls: 'task-detail-section-body' });
            // 首个分区（任务详情）放置描述与分类编辑
            if (index === 0) this.renderTaskMeta(bodyEl);
        }

        this.switchSection(0);
        // 滚轮切换：在右侧内容区滚动时左右切换选项卡
        this.sectionsEl.addEventListener('wheel', (evt) => this.handleWheel(evt), { passive: false });
    }

    /** 右侧「任务详情」分区：分类下拉框 + 描述输入 */
    private renderTaskMeta(container: HTMLElement): void {
        const form = container.createDiv({ cls: 'task-detail-meta' });

        // 分类：选项取自图例分类（含「未分类」）
        const categoryRow = form.createDiv({ cls: 'task-detail-meta-row' });
        categoryRow.createSpan({ cls: 'task-detail-meta-label', text: t('panel.taskCategory') });
        const select = categoryRow.createEl('select', { cls: 'dropdown task-detail-category' });
        const categories = this.panelOptions.categoryData?.categories ?? [];
        for (const category of categories) {
            const option = select.createEl('option', { text: category.label });
            option.value = category.id;
        }
        select.value = this.task.categoryId && categories.some((c) => c.id === this.task.categoryId)
            ? this.task.categoryId
            : (categories[0]?.id ?? '');
        select.addEventListener('change', () => {
            this.task.categoryId = select.value;
            this.panelOptions.onUpdateTask?.(this.task.id, { categoryId: select.value });
        });

        // 描述
        const descRow = form.createDiv({ cls: 'task-detail-meta-col' });
        descRow.createSpan({ cls: 'task-detail-meta-label', text: t('panel.taskDescription') });
        const textarea = descRow.createEl('textarea', { cls: 'task-detail-description' });
        textarea.placeholder = t('panel.taskDescriptionPlaceholder');
        textarea.value = this.task.description ?? '';
        textarea.addEventListener('change', () => {
            this.task.description = textarea.value;
            this.panelOptions.onUpdateTask?.(this.task.id, { description: textarea.value });
        });
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
        const sections = Array.from(this.sectionsEl.children) as HTMLElement[];
        this.tabs.forEach((tab, i) => tab.toggleClass('is-active', i === index));
        sections.forEach((section, i) => section.toggleClass('is-active', i === index));
    }

    /** 渲染后代任务树 */
    private renderTree(): void {
        this.treeEl.empty();
        const hasChild = this.tasks.some((task) => task.parentId === this.task.id);
        if (!hasChild) {
            this.treeEl.createDiv({ cls: 'task-detail-tree-empty', text: t('panel.noSubTask') });
            return;
        }
        this.renderTreeNodes(this.treeEl, this.task.id, 0);
    }

    /** 递归渲染某一层的子任务 */
    private renderTreeNodes(parentEl: HTMLElement, parentId: string, depth: number): void {
        const children = this.tasks.filter((task) => task.parentId === parentId);
        for (const child of children) {
            const row = parentEl.createDiv({ cls: 'task-detail-tree-row' });
            row.style.marginLeft = `${depth * 14}px`;
            row.dataset.taskId = child.id;
            const iconEl = row.createSpan({ cls: 'task-detail-tree-icon' });
            setIcon(iconEl, 'git-branch');
            row.createSpan({ cls: 'task-detail-tree-label', text: child.name });
            row.toggleClass('is-selected', child.id === this.selectedTaskId);
            this.renderTreeNodes(parentEl, child.id, depth + 1);
        }
    }

    /** 选中某个任务条目（决定 + 新增子任务挂到哪个任务下） */
    private selectTask(taskId: string): void {
        this.selectedTaskId = taskId;
        this.treeEl.querySelectorAll('.task-detail-tree-row').forEach((el) => {
            const row = el as HTMLElement;
            row.toggleClass('is-selected', row.dataset.taskId === taskId);
        });
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