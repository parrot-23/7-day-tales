// 界面视图：新一级视图「界面」下的二级落地页。
// 布局：左侧日期 / 任务 / OKR 三张小卡片，右侧计划 / 检查 / 收集 / 画廊 / 成就榜单 / 数据六张卡片，底部一个方框。
import { Menu, setIcon } from 'obsidian';
import type { App, Plugin, TFile } from 'obsidian';

import { TodayCard } from '../../cards/task/today-card';
import type { PrototypeTask, PrototypeTaskType } from '../../datatypes/prototype-task';
import { t } from '../../i18n';
import { AchievementPanel } from '../../panel/achievement-panel';
import { CardPickerPanel } from '../../panel/card-picker-panel';
import { CheckPanel } from '../../panel/check-panel';
import { CollectPanel } from '../../panel/collect-panel';
import { DataPanel } from '../../panel/data-panel';
import { GalleryPanel } from '../../panel/gallery-panel';
import { PlanPanel } from '../../panel/plan-panel';
import { TaskDetailPanel } from '../../panel/task-detail-panel';
import { TaskPanel } from '../../panel/task-panel';
import { TimeBoxPanel } from '../../panel/time-box-panel';
import { WeekCalendarPanel } from '../../panel/week-calendar-panel';
import type { BaseRepo } from '../../repos/base-repo';
import type { CategoryRepo } from '../../repos/category-repo';
import type { PrototypeTaskRepo } from '../../repos/prototype-task-repo';
import type { TaskExecutionRepo } from '../../repos/task-execution-repo';
import type { PlanCategoryData } from '../../shared/plan-category-manager';

/** 右侧入口卡片：文案 key 与图标 */
const ENTRY_CARDS: { label: Parameters<typeof t>[0]; icon: string }[] = [
    { label: 'interface.plan', icon: 'calendar-days' },
    { label: 'interface.check', icon: 'clipboard-check' },
    { label: 'interface.collect', icon: 'inbox' },
    { label: 'interface.gallery', icon: 'image' },
    { label: 'achievement.title', icon: 'trophy' },
];

/** 综合方框选项卡 */
type BottomTabKey = 'basket' | 'todo' | 'file';

/** 综合方框选项卡：顺序与文案 */
const BOTTOM_TABS: { key: BottomTabKey; labelKey: Parameters<typeof t>[0] }[] = [
    { key: 'basket', labelKey: 'interface.bottomTabBasket' },
    { key: 'todo', labelKey: 'interface.bottomTabTodo' },
    { key: 'file', labelKey: 'interface.bottomTabFile' },
];

/**
 * 界面视图：与其它二级视图一致，通过 renderInto 渲染到指定容器。
 */
export class InterfaceView {
    private app: App;
    private plugin: Plugin;
    /** 日期卡片对应的周历面板（懒创建，复用同一个实例） */
    private datePanel: WeekCalendarPanel | null = null;
    /** 任务卡片对应的任务面板 */
    private taskPanel: TaskPanel | null = null;
    /** 任务详情面板（按任务 id 复用） */
    private detailPanels = new Map<string, TaskDetailPanel>();
    /** 时间盒卡片对应的面板 */
    private timeBoxPanel: TimeBoxPanel | null = null;
    /** 今日任务方框组件 */
    private todayCard: TodayCard | null = null;
    /** 综合方框当前选项卡：收集篮子 / 待办改进 / 文件目录 */
    private bottomTab: BottomTabKey = 'basket';
    /** 综合方框选项卡内容容器 */
    private bottomBodyEl: HTMLElement | null = null;
    /** 视图根容器（控制编辑态网点背景） */
    private viewEl: HTMLElement | null = null;
    /** 是否处于编辑模式（仅背景提示，暂不提供拖拽） */
    private editMode = false;
    /** 左下角编辑 / 完成按钮 */
    private editButtonEl: HTMLButtonElement | null = null;
    /** 左下角「添加卡片」按钮（仅编辑模式显示） */
    private addCardButtonEl: HTMLButtonElement | null = null;
    /** 卡片选择面板 */
    private cardPickerPanel: CardPickerPanel | null = null;
    /** 计划卡片对应的面板 */
    private planPanel: PlanPanel | null = null;
    /** 检查卡片对应的面板 */
    private checkPanel: CheckPanel | null = null;
    /** 收集卡片对应的面板 */
    private collectPanel: CollectPanel | null = null;
    /** 画廊卡片对应的面板 */
    private galleryPanel: GalleryPanel | null = null;
    /** 成就榜单卡片对应的面板 */
    private achievementPanel: AchievementPanel | null = null;
    /** 数据卡片对应的面板 */
    private dataPanel: DataPanel | null = null;
    /** 分类数据（与周计划视图共享同一份） */
    private categoryData: PlanCategoryData;

    constructor(app: App, plugin: Plugin, categoryData: PlanCategoryData) {
        this.app = app;
        this.plugin = plugin;
        this.categoryData = categoryData;
    }

    /** 原型任务仓库 */
    private get prototypeTaskRepo(): PrototypeTaskRepo {
        return (this.plugin as Plugin & { prototypeTaskRepo: PrototypeTaskRepo }).prototypeTaskRepo;
    }

    /** 任务执行记录仓库 */
    private get taskExecutionRepo(): TaskExecutionRepo {
        return (this.plugin as Plugin & { taskExecutionRepo: TaskExecutionRepo }).taskExecutionRepo;
    }

    /** 基础仓库（读取界面布局等全量数据） */
    private get baseRepo(): BaseRepo {
        return (this.plugin as Plugin & { repo: BaseRepo }).repo;
    }

    /** 点击日期卡片：打开周历面板 */
    private openDatePanel(): void {
        this.datePanel ??= new WeekCalendarPanel();
        this.datePanel.open();
    }

    /** 点击任务卡片：打开任务面板 */
    private openTaskPanel(): void {
        if (!this.taskPanel) {
            this.taskPanel = new TaskPanel({
                tasks: this.rootPrototypeTasks(),
                onSubmit: (payload) => this.addPrototypeTask(payload.name, payload.type),
                onTaskClick: (task) => this.openTaskDetail(task),
            });
        } else {
            this.taskPanel.setTasks(this.rootPrototypeTasks());
        }
        this.taskPanel.open();
    }

    /** 点击时间盒卡片：打开时间盒面板 */
    private openTimeBoxPanel(): void {
        if (!this.timeBoxPanel) {
            const holder = this.plugin as Plugin & {
                timeBoxRepo: ConstructorParameters<typeof TimeBoxPanel>[0]['timeBoxRepo'];
                saveAll: () => Promise<void>;
            };
            this.timeBoxPanel = new TimeBoxPanel({
                app: this.app,
                categoryData: this.categoryData,
                categoryRepo: (this.plugin as Plugin & { categoryRepo: CategoryRepo }).categoryRepo,
                timeBoxRepo: holder.timeBoxRepo,
                save: () => holder.saveAll(),
            });
        }
        this.timeBoxPanel.open();
    }

    /** 点击计划卡片：打开计划面板 */
    private openPlanPanel(): void {
        if (!this.planPanel) {
            const holder = this.plugin as Plugin & {
                planAssignmentRepo: ConstructorParameters<typeof PlanPanel>[0]['planAssignmentRepo'];
                saveAll: () => Promise<void>;
            };
            this.planPanel = new PlanPanel({
                getTasks: () => this.prototypeTaskRepo.tasks,
                getCategories: () => this.categoryData.categories,
                planAssignmentRepo: holder.planAssignmentRepo,
                save: () => holder.saveAll(),
                onChanged: () => this.todayCard?.refreshTasks(),
            });
        }
        this.planPanel.open();
    }

    /** 点击检查卡片：打开检查面板 */
    private openCheckPanel(): void {
        if (!this.checkPanel) {
            const holder = this.plugin as Plugin & {
                timeBoxRepo: ConstructorParameters<typeof CheckPanel>[0]['timeBoxRepo'];
            };
            this.checkPanel = new CheckPanel({
                app: this.app,
                categoryData: this.categoryData,
                timeBoxRepo: holder.timeBoxRepo,
                taskExecutionRepo: this.taskExecutionRepo,
                getTasks: () => this.prototypeTaskRepo.tasks,
                onOpenData: () => this.openDataPanel(),
            });
        }
        this.checkPanel.open();
    }

    /** 点击收集卡片：打开收集面板（内容复用 GTD 收集视图） */
    private openCollectPanel(): void {
        const holder = this.plugin as Plugin & {
            gtdRepo: ConstructorParameters<typeof CollectPanel>[0]['gtdRepo'];
            saveAll: () => Promise<void>;
        };
        this.collectPanel ??= new CollectPanel({
            gtdRepo: holder.gtdRepo,
            save: () => holder.saveAll(),
            getTasks: () => this.prototypeTaskRepo.tasks,
        });
        this.collectPanel.open();
    }

    /** 点击画廊卡片：打开画廊面板 */
    private openGalleryPanel(): void {
        this.galleryPanel ??= new GalleryPanel();
        this.galleryPanel.open();
    }

    /** 点击成就榜单卡片：打开成就榜单面板 */
    private openAchievementPanel(): void {
        this.achievementPanel ??= new AchievementPanel();
        this.achievementPanel.open();
    }

    /** 打开数据面板（由检查面板顶部的「数据」按钮触发） */
    private openDataPanel(): void {
        this.dataPanel ??= new DataPanel();
        this.dataPanel.open();
    }

    /** 打开任务详情面板（同一任务复用实例） */
    private openTaskDetail(task: PrototypeTask): void {
        let panel = this.detailPanels.get(task.id);
        if (!panel) {
            panel = new TaskDetailPanel({
                task,
                tasks: this.prototypeTaskRepo.tasks,
                categoryData: this.categoryData,
                app: this.app,
                save: () => (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll(),
                onAddChild: (name, parentId) => this.addPrototypeTask(name, task.type, parentId),
                onUpdateTask: (taskId, patch) => this.updatePrototypeTask(taskId, patch),
                onTasksChanged: () => {
                    this.taskPanel?.setTasks(this.rootPrototypeTasks());
                    this.detailPanels.forEach((item) => item.setTasks(this.prototypeTaskRepo.tasks));
                    this.todayCard?.refreshTasks();
                },
            });
            this.detailPanels.set(task.id, panel);
        } else {
            panel.setTasks(this.prototypeTaskRepo.tasks);
        }
        panel.open();
    }

    /** 根原型任务（不含子任务） */
    private rootPrototypeTasks(): PrototypeTask[] {
        return this.prototypeTaskRepo.tasks.filter((task) => !task.parentId);
    }

    /** 新增原型任务：写仓库 + 持久化 + 刷新面板列表与详情树 */
    private addPrototypeTask(name: string, type: PrototypeTaskType, parentId?: string): void {
        this.prototypeTaskRepo.add(name, type, parentId);
        void (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
        this.taskPanel?.setTasks(this.rootPrototypeTasks());
        this.detailPanels.forEach((panel) => panel.setTasks(this.prototypeTaskRepo.tasks));
        this.todayCard?.refreshTasks();
    }

    /** 更新原型任务的名称 / 描述 / 分类：写仓库 + 持久化 */
    private updatePrototypeTask(taskId: string, patch: { name?: string; description?: string; categoryId?: string }): void {
        this.prototypeTaskRepo.update(taskId, patch);
        void (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
    }

    async renderInto(container: HTMLElement): Promise<void> {
        container.empty();
        container.addClass('interface-view');
        container.toggleClass('is-editing', this.editMode);
        this.viewEl = container;

        const main = container.createDiv({ cls: 'interface-main' });

        // 左侧：日期
        const left = main.createDiv({ cls: 'interface-col is-left' });

        const dateCard = left.createDiv({ cls: 'interface-card interface-date-card' });
        const now = new Date();
        dateCard.createDiv({
            cls: 'interface-date-month',
            text: t('interface.monthTitle', { month: String(now.getMonth() + 1) }),
        });
        dateCard.createDiv({ cls: 'interface-date-day', text: String(now.getDate()) });
        dateCard.addEventListener('click', () => this.openDatePanel());

        // 中间：今日任务方框（编辑模式下可移除，隐藏状态随布局持久化）
        if (!this.isCardHidden('today-clock')) {
            this.todayCard ??= new TodayCard({
                app: this.app,
                plugin: this.plugin,
                categoryData: this.categoryData,
                onRunningTaskChanged: () => this.renderBottomContent(),
            });
            this.todayCard.render(main);
            const todayEl = main.querySelector<HTMLElement>('.interface-today');
            if (todayEl) {
                this.applyCardPosition(todayEl, 'today-clock');
                if (this.editMode) this.addTodayEditControls(todayEl, main);
            }
        }

        // 右侧：任务 / 时间盒（置顶）
        const right = main.createDiv({ cls: 'interface-col is-right' });
        const taskCard = right.createDiv({ cls: 'interface-card interface-metric-card' });
        setIcon(taskCard.createSpan({ cls: 'interface-entry-card-icon' }), 'list-todo');
        taskCard.createSpan({ cls: 'interface-metric-label', text: t('interface.task') });
        taskCard.addEventListener('click', () => this.openTaskPanel());

        const timeBoxCard = right.createDiv({ cls: 'interface-card interface-entry-card' });
        setIcon(timeBoxCard.createSpan({ cls: 'interface-entry-card-icon' }), 'calendar-clock');
        timeBoxCard.createSpan({ cls: 'interface-entry-card-text', text: t('interface.timeBox') });
        timeBoxCard.addEventListener('click', () => this.openTimeBoxPanel());

        // 右侧：计划 / 检查 / 收集 / 画廊 / 成就榜单（图标 + 文字）
        for (const { label, icon } of ENTRY_CARDS) {
            const card = right.createDiv({ cls: 'interface-card interface-entry-card' });
            const iconEl = card.createSpan({ cls: 'interface-entry-card-icon' });
            setIcon(iconEl, icon);
            card.createSpan({ cls: 'interface-entry-card-text', text: t(label) });
            if (label === 'interface.plan') card.addEventListener('click', () => this.openPlanPanel());
            if (label === 'interface.check') card.addEventListener('click', () => this.openCheckPanel());
            if (label === 'interface.collect') card.addEventListener('click', () => this.openCollectPanel());
            if (label === 'interface.gallery') card.addEventListener('click', () => this.openGalleryPanel());
            if (label === 'achievement.title') card.addEventListener('click', () => this.openAchievementPanel());
        }

        // 综合方框：标题 + 右上角 + 号（操作台）+ 选项卡（收集篮子 / 待办改进 / 文件目录）+ 内容区
        const bottom = container.createDiv({ cls: 'interface-bottom' });
        const bottomHeader = bottom.createDiv({ cls: 'interface-bottom-header' });
        bottomHeader.createDiv({ cls: 'interface-bottom-title', text: t('interface.bottomTitle') });
        const bottomAddBtn = bottomHeader.createEl('button', {
            cls: 'interface-today-add',
            attr: { 'aria-label': t('interface.bottomAdd') },
        });
        setIcon(bottomAddBtn, 'plus');
        bottomAddBtn.addEventListener('click', (evt) => this.openBottomAddMenu(evt));

        const bottomTabsEl = bottom.createDiv({ cls: 'interface-bottom-tabs' });
        for (const tab of BOTTOM_TABS) {
            const tabBtn = bottomTabsEl.createEl('button', { cls: 'interface-bottom-tab', text: t(tab.labelKey) });
            tabBtn.dataset.tab = tab.key;
            tabBtn.addEventListener('click', () => {
                this.bottomTab = tab.key;
                this.renderBottomContent();
            });
        }
        this.bottomBodyEl = bottom.createDiv({ cls: 'interface-bottom-body' });
        this.renderBottomContent();

        // 左下角悬浮：编辑 / 完成（编辑态仅显示网点背景，暂不提供拖拽）
        this.editButtonEl = container.createEl('button', { cls: 'interface-edit-btn' });
        setIcon(this.editButtonEl.createSpan({ cls: 'interface-edit-icon' }), 'pencil');
        this.editButtonEl.createSpan({ cls: 'interface-edit-text' });
        this.editButtonEl.addEventListener('click', () => this.toggleEditMode());

        // 编辑按钮上方的「添加卡片」按钮：点击打开卡片选择面板（仅编辑模式显示）
        this.addCardButtonEl = container.createEl('button', { cls: 'interface-add-card-btn' });
        setIcon(this.addCardButtonEl.createSpan({ cls: 'interface-add-card-icon' }), 'plus');
        this.addCardButtonEl.createSpan({ cls: 'interface-add-card-text', text: t('interface.addCard') });
        this.addCardButtonEl.addEventListener('click', () => this.openCardPicker());
        this.updateEditButton();
    }

    /** 打开卡片选择面板 */
    private openCardPicker(): void {
        this.cardPickerPanel ??= new CardPickerPanel(() => this.showTodayCard());
        this.cardPickerPanel.open();
    }

    /** 确保今日任务方框显示（取消布局中的隐藏标记） */
    private showTodayCard(): void {
        if (!this.isCardHidden('today-clock')) return;
        this.setCardHidden('today-clock', false);
    }

    /** 编辑模式下给今日任务方框加顶部拖动方块与右上角 X 按钮 */
    private addTodayEditControls(todayEl: HTMLElement, main: HTMLElement): void {
        // 顶部中间的拖动方块：按住拖动整张卡片
        const handle = todayEl.createDiv({ cls: 'interface-card-drag' });
        this.enableCardDrag(todayEl, main, handle);

        const removeBtn = todayEl.createEl('button', {
            cls: 'interface-card-remove',
            text: '×',
            attr: { 'aria-label': t('interface.removeCard') },
        });
        removeBtn.addEventListener('click', (evt) => {
            evt.stopPropagation();
            this.setCardHidden('today-clock', true);
        });
    }

    /** 应用保存的卡片位置，无保存值时使用 CSS 默认位置（靠左上） */
    private applyCardPosition(el: HTMLElement, cardId: string): void {
        const position = this.baseRepo.data?.interfaceLayoutData.cardPositions[cardId];
        if (!position) return;
        el.style.left = `${position.left}px`;
        el.style.top = `${position.top}px`;
    }

    /** 按住顶部方块拖动卡片，松手后保存像素坐标 */
    private enableCardDrag(todayEl: HTMLElement, main: HTMLElement, handle: HTMLElement): void {
        handle.addEventListener('pointerdown', (evt) => {
            if (evt.button !== 0) return;
            evt.preventDefault();
            const mainRect = main.getBoundingClientRect();
            const cardRect = todayEl.getBoundingClientRect();
            const offsetX = evt.clientX - cardRect.left;
            const offsetY = evt.clientY - cardRect.top;

            const onMove = (moveEvt: PointerEvent) => {
                const left = Math.max(0, Math.min(
                    moveEvt.clientX - mainRect.left - offsetX,
                    mainRect.width - cardRect.width,
                ));
                const top = Math.max(0, Math.min(
                    moveEvt.clientY - mainRect.top - offsetY,
                    mainRect.height - cardRect.height,
                ));
                todayEl.style.left = `${left}px`;
                todayEl.style.top = `${top}px`;
            };
            const onUp = () => {
                handle.removeEventListener('pointermove', onMove);
                todayEl.removeClass('is-dragging');
                this.saveCardPosition('today-clock', {
                    left: parseFloat(todayEl.style.left) || 0,
                    top: parseFloat(todayEl.style.top) || 0,
                });
            };

            todayEl.addClass('is-dragging');
            handle.setPointerCapture(evt.pointerId);
            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', onUp, { once: true });
        });
    }

    /** 保存卡片位置到布局并持久化 */
    private saveCardPosition(cardId: string, position: { left: number; top: number }): void {
        const data = this.baseRepo.data;
        if (!data) return;
        data.interfaceLayoutData.cardPositions[cardId] = position;
        void (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
    }

    /** 卡片是否已被编辑模式移除 */
    private isCardHidden(cardId: string): boolean {
        return this.baseRepo.data?.interfaceLayoutData.hiddenCards.includes(cardId) ?? false;
    }

    /** 设置卡片隐藏状态：写布局并持久化，随后重绘视图 */
    private setCardHidden(cardId: string, hidden: boolean): void {
        const data = this.baseRepo.data;
        if (!data) return;
        const cards = data.interfaceLayoutData.hiddenCards;
        const index = cards.indexOf(cardId);
        if (hidden && index < 0) cards.push(cardId);
        if (!hidden && index >= 0) cards.splice(index, 1);
        void (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
        if (this.viewEl) void this.renderInto(this.viewEl);
    }

    /** 切换编辑模式：重绘视图以同步网点背景、按钮文案与卡片 X 按钮 */
    private toggleEditMode(): void {
        this.editMode = !this.editMode;
        if (!this.editMode) this.cardPickerPanel?.close();
        if (this.viewEl) void this.renderInto(this.viewEl);
    }

    /** 刷新左下角按钮的文案、激活态与添加按钮显隐 */
    private updateEditButton(): void {
        if (!this.editButtonEl) return;
        this.editButtonEl.toggleClass('is-active', this.editMode);
        const textEl = this.editButtonEl.querySelector('.interface-edit-text');
        if (textEl) {
            textEl.textContent = this.editMode ? t('interface.editModeDone') : t('interface.editMode');
        }
        this.addCardButtonEl?.toggleClass('is-hidden', !this.editMode);
    }

    /** 综合方框「+」：下拉菜单（当前仅「操作台」，点击行为暂未实现） */
    private openBottomAddMenu(evt: MouseEvent): void {
        const menu = new Menu();
        menu.addItem((item) => item
            .setTitle(t('interface.bottomConsole'))
            .setIcon('gauge'));
        menu.showAtMouseEvent(evt);
    }

    /** 综合方框：刷新选项卡选中态并渲染内容（数据源为当前进行中的任务） */
    private renderBottomContent(): void {
        const bodyEl = this.bottomBodyEl;
        if (!bodyEl) return;
        bodyEl.parentElement?.querySelectorAll('.interface-bottom-tab').forEach((el) => {
            el.toggleClass('is-active', (el as HTMLElement).dataset.tab === this.bottomTab);
        });
        bodyEl.empty();

        const runningTaskId = this.todayCard?.runningTaskId;
        const task = runningTaskId
            ? this.prototypeTaskRepo.tasks.find((item) => item.id === runningTaskId)
            : undefined;
        if (!task) {
            bodyEl.createDiv({ cls: 'interface-today-empty', text: t('interface.bottomNoRunning') });
            return;
        }

        if (this.bottomTab === 'basket') {
            const items = task.basket ?? [];
            if (items.length === 0) {
                bodyEl.createDiv({ cls: 'interface-today-empty', text: t('interface.bottomEmpty') });
                return;
            }
            for (const item of items) this.createBottomItemRow(bodyEl, 'inbox', item.text);
            return;
        }

        if (this.bottomTab === 'todo') {
            const items = task.improvements ?? [];
            if (items.length === 0) {
                bodyEl.createDiv({ cls: 'interface-today-empty', text: t('interface.bottomEmpty') });
                return;
            }
            for (const item of items) {
                const row = this.createBottomItemRow(bodyEl, item.done ? 'check-circle' : 'circle', item.text);
                if (item.done) row.addClass('is-done');
            }
            return;
        }

        if (!task.fileDir) {
            bodyEl.createDiv({ cls: 'interface-today-empty', text: t('interface.bottomNoFolder') });
            return;
        }
        const files = this.listRunningTaskFiles(task.fileDir);
        if (files.length === 0) {
            bodyEl.createDiv({ cls: 'interface-today-empty', text: t('interface.bottomEmpty') });
            return;
        }
        for (const file of files) {
            const row = this.createBottomItemRow(bodyEl, 'file-text', file.name);
            row.title = file.path;
        }
    }

    /** 综合方框条目行：图标 + 文本 */
    private createBottomItemRow(parentEl: HTMLElement, icon: string, text: string): HTMLElement {
        const row = parentEl.createDiv({ cls: 'interface-bottom-item' });
        setIcon(row.createSpan({ cls: 'interface-bottom-item-icon' }), icon);
        row.createSpan({ cls: 'interface-bottom-item-text', text });
        return row;
    }

    /** 进行中任务的文件目录下的一级文件（按修改时间倒序） */
    private listRunningTaskFiles(dir: string | undefined): TFile[] {
        if (!dir) return [];
        return this.app.vault.getFiles()
            .filter((file) => file.parent?.path === dir)
            .sort((a, b) => b.stat.mtime - a.stat.mtime);
    }
}