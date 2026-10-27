// 界面视图：新一级视图「界面」下的二级落地页。
// 布局：日期 / 今日时钟 / 今日任务 / 时钟等浮动卡片，右侧垂直功能栏；任务板块内容改为面板（点击任务条目打开）。
import { setIcon } from 'obsidian';
import type { App, Plugin } from 'obsidian';

import { DateCard } from '../../cards/date-card';
import { createInterfaceCardShell } from '../../cards/interface-card-shell';
import { NavCard } from '../../cards/nav-card';
import { TodayCard } from '../../cards/task/today-card';
import { TodayTasksCard } from '../../cards/task/today-tasks-card';
import { ClockCard } from '../../cards/clock-card';
import type { PrototypeTask, PrototypeTaskType } from '../../datatypes/prototype-task';
import { t } from '../../i18n';
import { AchievementPanel } from '../../panel/achievement-panel';
import { CardPickerPanel } from '../../panel/card-picker-panel';
import { CheckPanel } from '../../panel/check-panel';
import { CollectPanel } from '../../panel/collect-panel';
import { DataPanel } from '../../panel/data-panel';
import { GalleryPanel } from '../../panel/gallery-panel';
import { PlanPanel } from '../../panel/plan-panel';
import { TaskSectionsPanel } from '../../panel/task-sections-panel';
import { TaskDetailPanel } from '../../panel/task-detail-panel';
import { TaskPanel } from '../../panel/task-panel';
import { TimeBoxPanel } from '../../panel/time-box-panel';
import { WeekCalendarPanel } from '../../panel/week-calendar-panel';
import { ThemePanel } from '../../panel/theme-panel';
import type { BaseRepo } from '../../repos/base-repo';
import type { CategoryRepo } from '../../repos/category-repo';
import type { PrototypeTaskRepo } from '../../repos/prototype-task-repo';
import type { TaskExecutionRepo } from '../../repos/task-execution-repo';
import type { ThemeRepo } from '../../repos/theme-repo';
import { THEME_DEFINITIONS, getThemeDefinition } from '../../themes/registry';
import type { PlanCategoryData } from '../../shared/plan-category-manager';

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
    /** 今日任务（折叠列表）卡片组件 */
    private todayTasksCard: TodayTasksCard | null = null;
    /** 独立时钟卡片组件 */
    private clockCard: ClockCard | null = null;
    /** 垂直功能栏卡片组件 */
    private navCard: NavCard | null = null;
    /** 任务板块信息面板（复用同一实例） */
    private taskSectionsPanel: TaskSectionsPanel | null = null;
    /** 视图根容器（控制编辑态网点背景） */
    private viewEl: HTMLElement | null = null;
    /** 是否处于编辑模式（仅背景提示，暂不提供拖拽） */
    private editMode = false;
    /** 左下角编辑 / 完成按钮 */
    private editButtonEl: HTMLButtonElement | null = null;
    /** 左下角「添加卡片」按钮（仅编辑模式显示） */
    private addCardButtonEl: HTMLButtonElement | null = null;
    /** 左下角「主题」按钮（仅编辑模式显示，位于添加按钮上方） */
    private themeButtonEl: HTMLButtonElement | null = null;
    /** 卡片选择面板 */
    private cardPickerPanel: CardPickerPanel | null = null;
    /** 主题管理面板 */
    private themePanel: ThemePanel | null = null;
    /** 当前主题的动画清理函数（重绘前调用，停止 Canvas 动画） */
    private themeDispose: (() => void) | null = null;
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

    /** 主题仓库（读取当前主题） */
    private get themeRepo(): ThemeRepo {
        return (this.plugin as Plugin & { themeRepo: ThemeRepo }).themeRepo;
    }

    /** 插件目录（vault 相对路径，用于读取主题图片素材） */
    private get pluginDir(): string {
        const manifest = this.plugin.manifest;
        return manifest.dir ?? `.obsidian/plugins/${manifest.id}`;
    }

    /** 点击日期卡片：打开周历面板（已创建时刷新周目标数据） */
    private openDatePanel(): void {
        if (!this.datePanel) {
            this.datePanel = new WeekCalendarPanel({
                getTasks: () => this.prototypeTaskRepo.tasks,
                onOpenTask: (task) => this.openTaskDetail(task),
            });
        } else {
            this.datePanel.refresh();
        }
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
                onChanged: () => {
                    this.todayCard?.refreshTasks();
                    this.todayTasksCard?.refresh();
                    this.clockCard?.refresh();
                    this.datePanel?.refresh();
                },
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
                onArchiveTask: (taskId) => this.archivePrototypeTask(taskId),
                onDeleteTask: (taskId) => this.deletePrototypeTask(taskId),
                onReorderTasks: (ordered) => this.reorderPrototypeTasks(ordered),
                onTasksChanged: () => {
                    this.taskPanel?.setTasks(this.rootPrototypeTasks());
                    this.detailPanels.forEach((item) => item.setTasks(this.prototypeTaskRepo.tasks));
                    this.todayCard?.refreshTasks();
                    this.todayTasksCard?.refresh();
                    this.clockCard?.refresh();
                    this.datePanel?.refresh();
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

    /** 归档任务：隐藏但保留数据，销毁对应详情面板并刷新列表 */
    private archivePrototypeTask(taskId: string): void {
        this.prototypeTaskRepo.archive(taskId);
        this.destroyTaskDetail(taskId);
        void (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
        this.refreshTaskConsumers();
    }

    /** 删除任务：仅删当前任务（子任务提升为根任务），销毁对应详情面板并刷新列表 */
    private deletePrototypeTask(taskId: string): void {
        this.prototypeTaskRepo.remove(taskId);
        this.destroyTaskDetail(taskId);
        void (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
        this.refreshTaskConsumers();
    }

    /** 销毁任务详情面板实例（归档 / 删除后不再复用） */
    private destroyTaskDetail(taskId: string): void {
        this.detailPanels.get(taskId)?.destroy();
        this.detailPanels.delete(taskId);
    }

    /** 按任务树拖拽结果重排仓库顺序（归档任务保留在末尾） */
    private reorderPrototypeTasks(ordered: PrototypeTask[]): void {
        const all = this.prototypeTaskRepo.allTasks;
        const orderedIds = new Set(ordered.map((task) => task.id));
        const hidden = all.filter((task) => !orderedIds.has(task.id));
        all.splice(0, all.length, ...ordered, ...hidden);
        this.detailPanels.forEach((panel) => panel.setTasks(this.prototypeTaskRepo.tasks));
    }

    /** 任务集合变化后刷新所有读取任务列表的界面 */
    private refreshTaskConsumers(): void {
        this.taskPanel?.setTasks(this.rootPrototypeTasks());
        this.detailPanels.forEach((panel) => panel.setTasks(this.prototypeTaskRepo.tasks));
        this.todayCard?.refreshTasks();
        this.todayTasksCard?.refresh();
        this.clockCard?.refresh();
        this.datePanel?.refresh();
    }

    /** 新增原型任务：写仓库 + 持久化 + 刷新面板列表与详情树 */
    private addPrototypeTask(name: string, type: PrototypeTaskType, parentId?: string): void {
        this.prototypeTaskRepo.add(name, type, parentId);
        void (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
        this.taskPanel?.setTasks(this.rootPrototypeTasks());
        this.detailPanels.forEach((panel) => panel.setTasks(this.prototypeTaskRepo.tasks));
        this.todayCard?.refreshTasks();
        this.todayTasksCard?.refresh();
    }

    /** 更新原型任务的名称 / 描述 / 分类：写仓库 + 持久化 */
    private updatePrototypeTask(taskId: string, patch: { name?: string; description?: string; categoryId?: string }): void {
        this.prototypeTaskRepo.update(taskId, patch);
        void (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
    }

    async renderInto(container: HTMLElement): Promise<void> {
        // 先停止上一轮主题的动画，避免重绘后仍残留 RAF 循环
        this.themeDispose?.();
        this.themeDispose = null;
        container.empty();
        container.addClass('interface-view');
        container.toggleClass('is-editing', this.editMode);
        this.viewEl = container;
        this.applyTheme(container);

        const main = container.createDiv({ cls: 'interface-main' });

        // 今日日期卡片：默认不显示，由编辑模式的「添加」面板加入
        if (this.isCardAdded('date')) {
            const dateBody = this.mountCard(main, 'date', 'card-date', () => this.setCardAdded('date', false));
            new DateCard({ onClick: () => this.openDatePanel() }).render(dateBody);
        }

        // 中间：今日任务方框（编辑模式下可移除，隐藏状态随布局持久化）
        if (!this.isCardHidden('today-clock')) {
            this.todayCard ??= new TodayCard({
                app: this.app,
                plugin: this.plugin,
                categoryData: this.categoryData,
                onRunningTaskChanged: () => {
                    this.todayTasksCard?.refresh();
                    this.clockCard?.refresh();
                },
            });
            const todayBody = this.mountCard(main, 'today-clock', 'card-today-clock', () => this.setCardHidden('today-clock', true));
            this.todayCard.render(todayBody);
        }

        // 今日任务（折叠列表）卡片：默认不显示，由编辑模式的「添加」面板加入
        if (this.isCardAdded('today-tasks')) {
            this.todayTasksCard ??= new TodayTasksCard({
                plugin: this.plugin,
                onRunningTaskChanged: () => {
                    this.todayCard?.reloadRunningState();
                    this.clockCard?.refresh();
                },
                onExecutionChanged: () => {
                    this.todayCard?.refreshClockDisplay();
                    this.clockCard?.refresh();
                },
                onTasksChanged: () => {
                    this.todayCard?.refreshTasks();
                },
                onOpenTaskBoard: (taskId) => this.openTaskBoard(taskId),
            });
            const tasksBody = this.mountCard(main, 'today-tasks', 'card-today-tasks', () => this.setCardAdded('today-tasks', false));
            this.todayTasksCard.render(tasksBody);
        }

        // 时钟卡片（24 小时时钟单独绘制）：默认不显示，由编辑模式的「添加」面板加入
        if (this.isCardAdded('clock')) {
            this.clockCard ??= new ClockCard({ plugin: this.plugin, categoryData: this.categoryData });
            const clockBody = this.mountCard(main, 'clock', 'card-clock', () => this.setCardAdded('clock', false));
            this.clockCard.render(clockBody);
        }

        // 右侧：垂直功能栏（默认显示，编辑模式下可移除）
        if (!this.isCardHidden('nav')) {
            this.navCard ??= new NavCard({
                items: [
                    { labelKey: 'interface.timeBox', icon: 'calendar-clock', onClick: () => this.openTimeBoxPanel() },
                    { labelKey: 'interface.task', icon: 'list-todo', onClick: () => this.openTaskPanel() },
                    { labelKey: 'interface.plan', icon: 'calendar-days', onClick: () => this.openPlanPanel() },
                    { labelKey: 'interface.check', icon: 'clipboard-check', onClick: () => this.openCheckPanel() },
                    { labelKey: 'interface.collect', icon: 'inbox', onClick: () => this.openCollectPanel() },
                    { labelKey: 'interface.gallery', icon: 'image', onClick: () => this.openGalleryPanel() },
                    { labelKey: 'achievement.title', icon: 'trophy', onClick: () => this.openAchievementPanel() },
                ],
            });
            const navBody = this.mountCard(main, 'nav', 'card-nav', () => this.setCardHidden('nav', true));
            this.navCard.render(navBody);
        }

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

        // 「添加卡片」按钮上方的「主题」按钮：点击打开主题管理面板（仅编辑模式显示）
        this.themeButtonEl = container.createEl('button', { cls: 'interface-theme-btn' });
        setIcon(this.themeButtonEl.createSpan({ cls: 'interface-theme-icon' }), 'palette');
        this.themeButtonEl.createSpan({ cls: 'interface-theme-text', text: t('interface.theme') });
        this.themeButtonEl.addEventListener('click', () => this.openThemePanel());

        this.updateEditButton();
    }

    /** 应用当前主题：仅作用于界面视图背景（图片素材 + 代码绘制层） */
    private applyTheme(container: HTMLElement): void {
        // 清理上一次可能残留的主题类
        for (const definition of THEME_DEFINITIONS) container.removeClass(`is-theme-${definition.id}`);
        const theme = getThemeDefinition(this.themeRepo.currentThemeId);
        if (!theme) return;
        container.addClass(`is-theme-${theme.id}`);
        const dispose = theme.mount(container, { app: this.app, pluginDir: this.pluginDir });
        this.themeDispose = typeof dispose === 'function' ? dispose : null;
    }

    /** 打开卡片选择面板 */
    private openCardPicker(): void {
        this.cardPickerPanel ??= new CardPickerPanel((cardId) => this.showPickedCard(cardId));
        this.cardPickerPanel.open();
    }

    /** 打开主题管理面板 */
    private openThemePanel(): void {
        if (!this.themePanel) {
            this.themePanel = new ThemePanel({
                app: this.app,
                pluginDir: this.pluginDir,
                getCurrentThemeId: () => this.themeRepo.currentThemeId,
                onApply: (themeId) => {
                    this.themeRepo.setCurrentTheme(themeId);
                    void (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
                    if (this.viewEl) void this.renderInto(this.viewEl);
                },
            });
        }
        this.themePanel.refresh();
        this.themePanel.open();
    }

    /** 从卡片选择面板选中卡片后加入界面 */
    private showPickedCard(cardId: string): void {
        // 今日时钟 / 垂直功能栏默认显示：可能被编辑模式移除，重新加入时清除隐藏标记
        if (cardId === 'today-clock' || cardId === 'nav') {
            this.setCardHidden(cardId, false);
            return;
        }
        this.setCardAdded(cardId, true);
    }

    /** 挂载浮动卡片外壳：统一定位、边框、拖动、移除与编辑模式点击拦截 */
    private mountCard(
        parentEl: HTMLElement,
        cardId: string,
        cardClass: string,
        onRemove: () => void,
    ): HTMLElement {
        return createInterfaceCardShell(parentEl, {
            cardId,
            cardClass,
            editMode: this.editMode,
            position: this.baseRepo.data?.interfaceLayoutData.cardPositions[cardId],
            onMove: (position) => this.saveCardPosition(cardId, position),
            onRemove,
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

    /** 可选卡片是否已通过「添加」面板加入界面 */
    private isCardAdded(cardId: string): boolean {
        return this.baseRepo.data?.interfaceLayoutData.addedCards.includes(cardId) ?? false;
    }

    /** 设置可选卡片的加入状态：写布局并持久化，随后重绘视图 */
    private setCardAdded(cardId: string, added: boolean): void {
        const data = this.baseRepo.data;
        if (!data) return;
        const cards = data.interfaceLayoutData.addedCards;
        const index = cards.indexOf(cardId);
        if (added && index < 0) cards.push(cardId);
        if (!added && index >= 0) cards.splice(index, 1);
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
        this.themeButtonEl?.toggleClass('is-hidden', !this.editMode);
    }

    /** 打开任务板块信息面板：展示指定任务的收集篮子 / 待办改进 / 文件目录 */
    private openTaskBoard(taskId: string): void {
        this.taskSectionsPanel ??= new TaskSectionsPanel({
            app: this.app,
            getTask: (id) => this.prototypeTaskRepo.tasks.find((item) => item.id === id),
            categories: this.categoryData.categories,
        });
        this.taskSectionsPanel.openForTask(taskId);
    }
}