import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { Plugin } from 'obsidian';

import type { PlanCategoryData } from './shared/plan-category-manager';
import type { InboxData } from './datatypes/domain';
import type { EventBlock, ExecutionRecord } from './datatypes/domain';
import { WorkbenchView } from './views/workbench/workbench-view';
import { OkrTaskPlanView } from './views/task/okr-task-plan-view';
import { ScriptManageView } from './views/task/script-manage-view';
import { SceneView } from './views/task/scene-view';
import { InterfaceView } from './views/interface/interface-view';
import type { WorkbenchData } from './datatypes/card';
import type { GtdRepo } from './repos/gtd-repo';
import type { PdcaRepo } from './repos/pdca-repo';
import type { WorkbenchRepo } from './repos/workbench-repo';
import type { InboxRepo } from './repos/inbox-repo';
import type { CategoryRepo } from './repos/category-repo';
import type { TemplateRepo } from './repos/template-repo';
import type { PlanSchemeRepo } from './repos/plan-scheme-repo';
import type { PrototypeTaskRepo } from './repos/prototype-task-repo';
import { t } from './i18n';
import { log } from './shared/logger';
import { HelpModal } from './helper/help-modal';

export const VIEW_TYPE_MAIN = 'parrot-plan-main-view';

/** 一级视图标识 */
type PrimaryView = 'interface' | 'task' | 'workbench';

/** 二级视图（tab）标识 */
type NavTab = 'interfaceHome' | 'taskPlan' | 'swimlane' | 'workbench' | 'okrHome' | 'okrTaskPlan' | 'scene' | 'scriptManage';

/** 一级视图定义（顶部第一行） */
const PRIMARY_VIEWS: { id: PrimaryView; labelKey: 'nav.interface' | 'nav.task' | 'nav.workbench' }[] = [
    { id: 'interface', labelKey: 'nav.interface' },
    { id: 'workbench', labelKey: 'nav.workbench' },
    { id: 'task', labelKey: 'nav.task' },
];

/** 二级视图定义（顶部第二行，按一级视图分组；label 存 i18n key，渲染时再求值） */
const SECONDARY_TABS: Record<PrimaryView, { id: NavTab; labelKey: 'nav.interfaceHome' | 'nav.year' | 'nav.taskPlan' | 'nav.projectPicture' | 'nav.workbench' | 'nav.task' | 'nav.scene' | 'nav.scriptManage' }[]> = {
    interface: [
        { id: 'interfaceHome', labelKey: 'nav.interfaceHome' },
    ],
    task: [
        { id: 'okrTaskPlan', labelKey: 'nav.taskPlan' },
        { id: 'scene', labelKey: 'nav.scene' },
        { id: 'scriptManage', labelKey: 'nav.scriptManage' },
    ],
    workbench: [
        { id: 'workbench', labelKey: 'nav.workbench' },
    ],
};

/** 各一级视图的默认二级视图（切换一级视图时激活） */
const DEFAULT_TAB: Record<PrimaryView, NavTab> = {
    interface: 'interfaceHome',
    task: 'okrTaskPlan',
    workbench: 'workbench',
};

/**
 * 主视图：作为顶层 tab 容器，左上角按钮组切换不同页面。
 */
export class MainView extends ItemView {
    plugin: Plugin;
    /** 计划事件数据（从插件数据层读取，供任务 / 工作台 / 成就等页面共用） */
    private events: EventBlock[];
    /** 执行记录数据 */
    private executions: ExecutionRecord[];
    /** 收集盒数据 */
    private inboxData: InboxData;
    /** 分类数据 */
    private planCategoryData: PlanCategoryData;
    /** 已制定周计划的周键列表 */
    private plannedWeeks: string[];
    private workbenchView: WorkbenchView;
    private okrTaskPlanView: OkrTaskPlanView;
    private scriptManageView: ScriptManageView;
    private sceneView: SceneView;
    private interfaceView: InterfaceView;
    /** 当前一级视图 */
    private activePrimary: PrimaryView = 'interface';
    /** 当前二级视图（tab） */
    private activeTab: NavTab = 'interfaceHome';
    /** 记录每个一级视图上次打开的二级视图（切换一级视图时恢复） */
    private lastTabByPrimary: Partial<Record<PrimaryView, NavTab>> = {};
    private contentRoot!: HTMLElement;
    /** 二级视图 tab 行容器（切换一级视图时重建） */
    private secondaryRow?: HTMLElement;
    /** 导航栏容器（用于二级标签行对齐与悬停还原） */
    private navEl?: HTMLElement;
    /** 当前「预览」的一级视图：悬停时展示其二级标签，但不改变内容 */
    private previewPrimary: PrimaryView = 'interface';
    /** 一级按钮元素映射（用于将二级标签行对齐到所属一级按钮左侧） */
    private primaryBtnEls: Partial<Record<PrimaryView, HTMLElement>> = {};
    /** 一级标签行右侧的「当前二级视图」标题 */
    private secondaryTitleEl?: HTMLElement;
    /** 缓存目录名称（用于帮助弹窗引用缓存图片） */
    private cacheDirName: string;
    /** 一级标签行中的「进行中任务」卡片容器 */
    private runningCardEl?: HTMLElement;
    /** 进行中任务卡片已用时长的刷新定时器（每分钟更新） */
    private runningCardTimer?: number;

    constructor(
        leaf: WorkspaceLeaf,
        plugin: Plugin,
        categoryData: PlanCategoryData,
        events: EventBlock[],
        executions: ExecutionRecord[],
        inboxData: InboxData,
        plannedWeeks: string[],
        workbenchData: WorkbenchData,
        cacheDirName: string,
    ) {
        super(leaf);
        this.plugin = plugin;
        this.cacheDirName = cacheDirName;
        log('MainView 构造', {
            events: events.length,
            executions: executions.length,
        });
        this.events = events;
        this.executions = executions;
        this.inboxData = inboxData;
        this.planCategoryData = categoryData;
        this.plannedWeeks = plannedWeeks;
        this.workbenchView = new WorkbenchView(
            this.app,
            workbenchData,
            this.workbenchRepo(),
            () => this.save(),
            () => this.events,
            () => this.executions,
            () => this.inboxData.items,
            async (content: string) => {
                this.gtdRepo().addItem(content);
                await this.save();
            },
            this.gtdRepo(),
        );
        this.okrTaskPlanView = new OkrTaskPlanView(
            this.app,
            this.inboxData,
            this.planCategoryData,
            () => this.save(),
            this.inboxRepo(),
            () => this.executions,
        );
        this.scriptManageView = new ScriptManageView(this.app);
        this.sceneView = new SceneView(
            this.app,
            this.planCategoryData,
            () => this.events,
        );
        this.interfaceView = new InterfaceView(this.app, this.plugin, this.planCategoryData);
    }

    /** 从插件实例获取 GTD 领域仓库 */
    private gtdRepo(): GtdRepo {
        return (this.plugin as Plugin & { gtdRepo: GtdRepo }).gtdRepo;
    }

    /** 从插件实例获取 PDCA 领域仓库 */
    private pdcaRepo(): PdcaRepo {
        return (this.plugin as Plugin & { pdcaRepo: PdcaRepo }).pdcaRepo;
    }

    /** 从插件实例获取原型任务仓库（界面视图进行中任务用） */
    private prototypeTaskRepo(): PrototypeTaskRepo {
        return (this.plugin as Plugin & { prototypeTaskRepo: PrototypeTaskRepo }).prototypeTaskRepo;
    }

    /** 从插件实例获取工作台领域仓库 */
    private workbenchRepo(): WorkbenchRepo {
        return (this.plugin as Plugin & { workbenchRepo: WorkbenchRepo }).workbenchRepo;
    }

    /** 从插件实例获取收集盒领域仓库 */
    private inboxRepo(): InboxRepo {
        return (this.plugin as Plugin & { inboxRepo: InboxRepo }).inboxRepo;
    }

    /** 从插件实例获取分类领域仓库 */
    private categoryRepo(): CategoryRepo {
        return (this.plugin as Plugin & { categoryRepo: CategoryRepo }).categoryRepo;
    }

    /** 从插件实例获取日模板领域仓库 */
    private templateRepo(): TemplateRepo {
        return (this.plugin as Plugin & { templateRepo: TemplateRepo }).templateRepo;
    }

    /** 从插件实例获取时间计划方案领域仓库 */
    private planSchemeRepo(): PlanSchemeRepo {
        return (this.plugin as Plugin & { planSchemeRepo: PlanSchemeRepo }).planSchemeRepo;
    }

    /** 是否启用剧本模式（关闭时隐藏「剧本场景」「剧本管理」二级视图） */
    private isScriptModeEnabled(): boolean {
        return (this.plugin as Plugin & { scriptModeEnabled?: boolean }).scriptModeEnabled === true;
    }

    /** 剧本模式关闭时需要隐藏的二级视图 */
    private static readonly SCRIPT_MODE_TABS: NavTab[] = ['scene', 'scriptManage'];

    /** 指定一级视图下应展示的二级视图（按剧本模式开关过滤），默认取当前「预览」的一级视图 */
    private visibleSecondaryTabs(primary: PrimaryView = this.previewPrimary): { id: NavTab; labelKey: Parameters<typeof t>[0] }[] {
        const tabs = SECONDARY_TABS[primary];
        if (this.isScriptModeEnabled()) return tabs;
        return tabs.filter(tab => !MainView.SCRIPT_MODE_TABS.includes(tab.id));
    }

    getViewType(): string {
        return VIEW_TYPE_MAIN;
    }

    getDisplayText(): string {
        return t('view.title');
    }

    /** 保存数据（统一委托给插件层 saveAll） */
    async save() {
        await (this.plugin as Plugin & { saveAll: () => Promise<void> }).saveAll();
    }

    /** 外部数据变更后重新渲染当前视图（如 vault 文件移动导致路径更新） */
    async refresh() {
        await this.renderContent();
    }

    /** 清空数据后重置视图与默认分类 / 模板 / 方案 */
    async resetData() {
        this.templateRepo().clear();
        this.categoryRepo().replaceAll([
            { id: 'uncategorized', label: t('defaultCategory.uncategorized'), color: '#888888' },
            { id: 'work', label: t('defaultCategory.work'), color: '#4c8dff' },
            { id: 'rest', label: t('defaultCategory.rest'), color: '#43b581' },
            { id: 'play', label: t('defaultCategory.play'), color: '#f2a65a' },
        ]);
        this.planSchemeRepo().resetToDefault(t('planScheme.defaultName'));
        this.pdcaRepo().clearEvents();
        this.pdcaRepo().clearExecutions();
        this.inboxRepo().clear();
        await this.renderContent();
    }

    async onOpen() {
        const root = this.containerEl.children[1] as HTMLElement;
        root.empty();
        root.addClass('parrot-plan-main');

        // 顶部导航栏：第一行一级视图，第二行二级视图
        const nav = root.createDiv({ cls: 'parrot-plan-nav' });
        this.navEl = nav;
        // 悬停预览一级视图：展示其二级标签，但内容不变；移出导航栏后还原
        this.previewPrimary = this.activePrimary;

        // 第一行：一级视图（工作台 / 任务 / 界面）
        const primaryRow = nav.createDiv({ cls: 'parrot-plan-nav-primary-row' });
        for (const pv of PRIMARY_VIEWS) {
            const btn = primaryRow.createEl('button', {
                text: t(pv.labelKey),
                cls: 'parrot-plan-nav-primary-btn',
            });
            if (pv.id === this.activePrimary) btn.addClass('is-active');
            this.primaryBtnEls[pv.id] = btn;
            const show = () => {
                this.previewPrimary = pv.id;
                this.applyPrimaryHoverState(pv.id);
                this.setSecondaryVisible(true);
            };
            btn.onmouseenter = show;
            btn.onclick = show;
        }

        // 移出导航栏时，二级标签行完全隐藏，并清除一级按钮悬浮边框
        nav.onmouseleave = () => {
            this.applyPrimaryHoverState(null);
            this.setSecondaryVisible(false);
        };

        // 当前二级视图标题（紧贴一级标签行右侧）
        this.secondaryTitleEl = primaryRow.createDiv({ cls: 'parrot-plan-nav-secondary-title' });

        // 进行中任务卡片（一级标签行右侧，紧邻帮助按钮左侧；无进行中任务时隐藏）
        this.runningCardEl = primaryRow.createDiv({ cls: 'parrot-plan-running-card-wrap' });
        this.renderRunningTaskCard();

        // 帮助按钮（第一行最右侧）
        const helpBtn = primaryRow.createEl('button', {
            text: '?',
            cls: 'parrot-plan-nav-help-btn',
            attr: { 'aria-label': t('help.title') },
        });
        helpBtn.onclick = () => {
            const plugin = this.plugin as Plugin & {
                saveHelpDismissed?: (dismissed: boolean) => Promise<void>;
            };
            new HelpModal(this.app, this.cacheDirName, (dismissed) => {
                void plugin.saveHelpDismissed?.(dismissed);
            }).open();
        };

        // 第二行：当前一级视图下的二级视图（默认隐藏，悬停一级标签时显示）
        this.secondaryRow = nav.createDiv({ cls: 'parrot-plan-nav-secondary-row is-hidden' });
        this.renderSecondaryTabs();

        // 内容区
        this.contentRoot = root.createDiv({ cls: 'parrot-plan-content' });
        await this.renderContent();
    }

    /** 高亮「预览中」的一级按钮：仅加蓝色边框（不改文字/背景） */
    private applyPrimaryHoverState(hovered: PrimaryView | null) {
        for (const pv of PRIMARY_VIEWS) {
            const btn = this.primaryBtnEls[pv.id];
            if (btn) btn.toggleClass('is-hovered', pv.id === hovered);
        }
    }

    /** 显示 / 隐藏二级标签行（显示时重新填充并对齐） */
    private setSecondaryVisible(visible: boolean) {
        if (!this.secondaryRow) return;
        if (visible) {
            this.secondaryRow.removeClass('is-hidden');
            this.renderSecondaryTabs();
        } else {
            this.secondaryRow.addClass('is-hidden');
        }
    }

    /** 重建二级视图 tab 行（切换预览一级视图时调用） */
    private renderSecondaryTabs() {
        if (!this.secondaryRow) return;
        this.secondaryRow.empty();
        for (const tab of this.visibleSecondaryTabs()) {
            // 工作台二级视图：标签显示当前激活布局的名称（与布局管理保持一致）
            const label = tab.id === 'workbench'
                ? this.workbenchView.getActiveLayoutName()
                : t(tab.labelKey);
            const btn = this.secondaryRow.createEl('button', {
                text: label,
                cls: 'parrot-plan-nav-btn',
                attr: { 'data-tab': tab.id },
            });
            if (tab.id === this.activeTab) btn.addClass('is-active');
            btn.onclick = () => {
                // 点击二级标签才切换内容，并让内容归属到当前预览的一级视图
                this.activePrimary = this.previewPrimary;
                this.activeTab = tab.id;
                this.lastTabByPrimary[this.activePrimary] = tab.id;
                this.previewPrimary = this.activePrimary;
                this.renderSecondaryTabs();
                void this.renderContent();
            };
        }

        // 面板左边缘对齐第一个一级按钮，按钮缩进到所属一级按钮左侧，中间留白
        const owner = this.primaryBtnEls[this.previewPrimary];
        const first = this.primaryBtnEls[PRIMARY_VIEWS[0].id];
        if (owner && first && this.navEl) {
            const navLeft = this.navEl.getBoundingClientRect().left;
            const panelLeft = first.getBoundingClientRect().left;
            const ownerLeft = owner.getBoundingClientRect().left;
            this.secondaryRow.style.left = `${Math.max(0, panelLeft - navLeft)}px`;
            this.secondaryRow.style.paddingLeft = `${Math.max(0, ownerLeft - panelLeft)}px`;
        }
    }

    /**
     * 渲染一级标签行右侧的「进行中任务」卡片。
     * 无进行中任务时清空并隐藏；有则显示任务名与已用时长，点击跳转到「界面」一级视图首页。
     * 同时启动每分钟刷新已用时长的定时器。
     */
    renderRunningTaskCard(): void {
        const wrap = this.runningCardEl;
        if (!wrap) return;
        wrap.empty();

        // 清理上一次的定时器，避免累积
        if (this.runningCardTimer !== undefined) {
            window.clearInterval(this.runningCardTimer);
            this.runningCardTimer = undefined;
        }

        const running = this.pdcaRepo().runningTask;
        if (!running) {
            wrap.addClass('is-hidden');
            this.renderStatusBarRunningTask();
            return;
        }
        // 界面视图写入的是原型任务，日执行视图写入的是收集盒任务
        const name = running.source === 'prototype'
            ? this.prototypeTaskRepo().tasks.find(task => task.id === running.inboxId)?.name
            : this.inboxData.items.find(i => i.id === running.inboxId && !i.removed)?.title;
        if (!name) {
            wrap.addClass('is-hidden');
            this.renderStatusBarRunningTask();
            return;
        }
        wrap.removeClass('is-hidden');

        const card = wrap.createDiv({ cls: 'parrot-plan-running-card' });
        card.createSpan({ cls: 'parrot-plan-running-card-label', text: t('nav.runningLabel') });
        card.createSpan({ cls: 'parrot-plan-running-card-name', text: name });
        const timeEl = card.createSpan({ cls: 'parrot-plan-running-card-time' });

        const updateTime = () => {
            const elapsed = typeof running.startedAt === 'number'
                ? Math.max(0, Math.floor((Date.now() - running.startedAt) / 60000))
                : Math.max(0, new Date().getHours() * 60 + new Date().getMinutes() - running.start);
            timeEl.setText(t('nav.runningElapsed', { minutes: String(elapsed) }));
            // 状态栏与卡片同步刷新已用时长
            this.renderStatusBarRunningTask();
        };
        updateTime();
        this.runningCardTimer = window.setInterval(updateTime, 60 * 1000);

        card.onclick = () => {
            // 跳转到「界面」一级视图的首页
            this.lastTabByPrimary[this.activePrimary] = this.activeTab;
            this.activePrimary = 'interface';
            this.activeTab = 'interfaceHome';
            this.previewPrimary = 'interface';
            this.lastTabByPrimary['interface'] = 'interfaceHome';
            this.renderSecondaryTabs();
            void this.renderContent();
        };
    }

    /**
     * 渲染状态栏中的「进行中任务」：显示「任务名称：时长」。
     * 状态栏元素由插件创建（插件加载即存在，不依赖本视图是否打开），这里只触发插件刷新。
     */
    private renderStatusBarRunningTask(): void {
        (this.plugin as Plugin & { renderStatusBarRunningTask?: () => void })
            .renderStatusBarRunningTask?.();
    }

    /** 打开主视图并切换到「界面」一级视图首页（状态栏点击用） */
    async openInterfaceHome(): Promise<void> {
        this.lastTabByPrimary[this.activePrimary] = this.activeTab;
        this.activePrimary = 'interface';
        this.activeTab = 'interfaceHome';
        this.previewPrimary = 'interface';
        this.lastTabByPrimary['interface'] = 'interfaceHome';
        this.renderSecondaryTabs();
        await this.renderContent();
    }

    /**
     * 更新一级标签行右侧的二级视图标题：
     * 列出当前一级视图下的全部二级视图名称，当前页面加粗显示，其余缩小且不加粗。
     */
    private renderSecondaryTitle() {
        const el = this.secondaryTitleEl;
        if (!el) return;
        el.empty();

        // 工作台：二级视图名称即当前激活布局的名称
        if (this.activePrimary === 'workbench') {
            el.createSpan({
                cls: 'parrot-plan-nav-secondary-title-item is-current',
                text: this.workbenchView.getActiveLayoutName(),
            });
            return;
        }

        for (const tab of this.visibleSecondaryTabs(this.activePrimary)) {
            const isCurrent = tab.id === this.activeTab;
            const item = el.createSpan({
                cls: `parrot-plan-nav-secondary-title-item${isCurrent ? ' is-current' : ' is-clickable'}`,
                text: t(tab.labelKey),
            });
            // 非当前页面的二级视图名称可点击，点击后切换到对应二级视图
            if (!isCurrent) {
                item.onclick = () => {
                    this.activeTab = tab.id;
                    this.lastTabByPrimary[this.activePrimary] = tab.id;
                    this.previewPrimary = this.activePrimary;
                    this.renderSecondaryTabs();
                    void this.renderContent();
                };
            }
        }
    }

    /** 根据当前 tab 渲染内容区 */
    private async renderContent() {
        // 剧本模式关闭时，若当前停留在被隐藏的二级视图，回退到默认二级视图
        if (!this.isScriptModeEnabled() && MainView.SCRIPT_MODE_TABS.includes(this.activeTab)) {
            this.activeTab = DEFAULT_TAB[this.activePrimary];
            this.lastTabByPrimary[this.activePrimary] = this.activeTab;
            this.renderSecondaryTabs();
        }
        log('MainView.renderContent', {
            tab: this.activeTab,
            events: this.events.length,
            executions: this.executions.length,
        });
        // 刷新导航高亮：一级视图
        const primaryBtns = this.containerEl.querySelectorAll('.parrot-plan-nav-primary-btn');
        primaryBtns.forEach((btn, i) => {
            btn.toggleClass('is-active', PRIMARY_VIEWS[i].id === this.activePrimary);
        });
        // 刷新导航高亮：二级视图
        const secondaryBtns = this.containerEl.querySelectorAll('.parrot-plan-nav-btn');
        secondaryBtns.forEach((btn) => {
            const tabId = btn.getAttribute('data-tab');
            btn.toggleClass('is-active', tabId === this.activeTab);
        });
        this.renderSecondaryTitle();

        this.contentRoot.empty();
        // 清除上一次视图残留在共享容器上的视图类，避免多个视图样式叠加导致布局错乱
        this.contentRoot.removeClass('interface-view', 'task-plan-view', 'swimlane-view', 'workbench-view', 'script-manage-view', 'scene-view');

        if (this.activeTab === 'interfaceHome') {
            await this.interfaceView.renderInto(this.contentRoot);
            return;
        }

        if (this.activeTab === 'okrTaskPlan') {
            await this.okrTaskPlanView.renderInto(this.contentRoot);
            return;
        }

        if (this.activeTab === 'workbench') {
            await this.workbenchView.renderInto(this.contentRoot);
            return;
        }

        if (this.activeTab === 'scriptManage') {
            await this.scriptManageView.renderInto(this.contentRoot);
            return;
        }

        if (this.activeTab === 'scene') {
            await this.sceneView.renderInto(this.contentRoot);
            return;
        }

        // 其余页面：占位
        const tab = SECONDARY_TABS[this.activePrimary].find(t => t.id === this.activeTab);
        const placeholder = this.contentRoot.createDiv({ cls: 'parrot-plan-placeholder' });
        placeholder.setText(t('nav.placeholder', { name: tab ? t(tab.labelKey) : '' }));
    }

    async onClose() {
        // 清理进行中任务卡片的刷新定时器
        if (this.runningCardTimer !== undefined) {
            window.clearInterval(this.runningCardTimer);
            this.runningCardTimer = undefined;
        }
        // 状态栏元素由插件持有（关闭视图不销毁），无需在此处理
        this.containerEl.empty();
    }
}
