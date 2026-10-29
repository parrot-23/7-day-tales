// 收集面板：基于 FloatingPanel，顶部输入框 + 未处理卡片列表。
// 标题旁提供「梳理」按钮：点击后面板变宽，右侧展开梳理区（顶部「任务」选项卡 + 任务树 + 确认按钮）。
import { setIcon } from 'obsidian';

import type { PrototypeTask } from '../../datatypes/prototype-task';
import { t } from '../../i18n';
import type { GtdRepo } from '../../repos/gtd-repo';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';

/** 时间戳格式化为 YYYY-MM-DD HH:MM */
function formatTime(ts: number): string {
    const d = new Date(ts);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${da} ${h}:${mi}`;
}

/** 收集面板配置 */
export interface CollectPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「收集」 */
    title?: string;
    gtdRepo: GtdRepo;
    /** 数据保存回调 */
    save: () => Promise<void>;
    /** 原型任务数据源（梳理区任务树的数据来源，与界面任务面板一致） */
    getTasks: () => PrototypeTask[];
}

/** 收起 / 展开时的面板宽度 */
const COLLAPSED_WIDTH = 720;
const EXPANDED_WIDTH = 1080;

/** 收集面板 */
export class CollectPanel extends FloatingPanel {
    private layoutEl!: HTMLElement;
    private mainEl!: HTMLElement;
    private clarifyEl!: HTMLElement;
    private treeEl!: HTMLElement;
    /** 梳理区是否展开 */
    private expanded = false;
    /** 梳理区当前选中的根任务 id */
    private rootTaskId: string | undefined;
    /** 梳理区任务树中选中的任务 id */
    private selectedTaskId: string | undefined;

    constructor(private readonly panelOptions: CollectPanelOptions) {
        super({
            width: COLLAPSED_WIDTH,
            title: panelOptions.title ?? t('panel.collectPanelTitle'),
            ...panelOptions,
        });
        this.body.addClass('collect-panel');
        this.rebuildLayout();
    }

    /** 每次打开时重新渲染，保证列表与仓库数据一致 */
    override open(): void {
        this.rebuildLayout();
        super.open();
    }

    /** 在输入行「添加」按钮之后添加「梳理」按钮（图标 + 文字） */
    private addClarifyButton(row: HTMLElement): void {
        const button = row.createEl('button', { cls: 'collect-clarify-toggle' });
        setIcon(button.createSpan({ cls: 'collect-clarify-toggle-icon' }), 'list-filter');
        button.createSpan({ text: t('panel.collectClarify') });
        button.addEventListener('click', () => this.toggleClarify());
    }

    /** 切换梳理区展开 / 收起 */
    private toggleClarify(): void {
        this.expanded = !this.expanded;
        this.setWidth(this.expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH);
        this.rebuildLayout();
    }

    /** 设置面板宽度（保持当前定位） */
    private setWidth(width: number): void {
        const root = this.body.closest('.floating-panel') as HTMLElement | null;
        if (root) root.style.width = `${width}px`;
    }

    /** 重建整体布局：左侧收集区 + 可选的右侧梳理区 */
    private rebuildLayout(): void {
        this.body.empty();
        this.layoutEl = this.body.createDiv({ cls: 'collect-panel-layout' });
        this.mainEl = this.layoutEl.createDiv({ cls: 'collect-panel-main' });
        this.renderCollect();
        if (this.expanded) {
            this.clarifyEl = this.layoutEl.createDiv({ cls: 'collect-panel-clarify' });
            this.renderClarify();
        }
    }

    /** 渲染收集区：顶部输入行（输入框 / 添加 / 梳理）+ 未处理卡片列表 */
    private renderCollect(): void {
        this.mainEl.empty();
        this.mainEl.addClass('gtd-collect-view');

        const inputRow = this.mainEl.createDiv({ cls: 'gtd-collect-input-row' });
        const input = inputRow.createEl('input', {
            cls: 'gtd-collect-input',
            attr: { type: 'text', placeholder: t('gtd.collectPlaceholder') },
        });
        const addBtn = inputRow.createEl('button', {
            cls: 'gtd-collect-add-btn',
            text: t('common.add'),
        });
        const submit = (): void => {
            const content = input.value.trim();
            if (!content) return;
            this.panelOptions.gtdRepo.addItem(content);
            void this.panelOptions.save().then(() => this.renderCollect());
        };
        addBtn.onclick = submit;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') submit();
        };
        this.addClarifyButton(inputRow);

        // 未处理卡片列表（外层固定高度，内层列表超出时出现滚动条）
        const list = this.mainEl.createDiv({ cls: 'gtd-collect-list' });
        const listInner = list.createDiv({ cls: 'gtd-collect-list-inner' });
        const pending = this.panelOptions.gtdRepo.getPendingItems();
        if (pending.length === 0) {
            listInner.createDiv({ cls: 'gtd-collect-empty', text: t('gtd.collectEmpty') });
            return;
        }
        for (const item of pending) {
            const card = listInner.createDiv({ cls: 'gtd-collect-card' });
            const meta = card.createDiv({ cls: 'gtd-collect-card-meta' });
            meta.createSpan({ cls: 'gtd-collect-card-time', text: formatTime(item.createdAt) });
            meta.createSpan({ cls: 'gtd-collect-card-status', text: t('gtd.statusInbox') });
            card.createDiv({ cls: 'gtd-collect-card-content', text: item.content });
            const delBtn = card.createEl('button', { cls: 'gtd-collect-card-delete', text: '×' });
            delBtn.onclick = () => {
                this.panelOptions.gtdRepo.removeItem(item.id);
                void this.panelOptions.save().then(() => this.renderCollect());
            };
        }
    }

    /** 梳理区：顶部「任务」选项卡 + 根任务下拉 + 任务树 + 底部确认按钮 */
    private renderClarify(): void {
        const tabs = this.clarifyEl.createDiv({ cls: 'gtd-clarify-source-tabs' });
        tabs.createEl('button', {
            cls: 'gtd-clarify-source-tab is-active',
            text: t('gtd.organizeTasks'),
        });

        // 根任务下拉：切换后重建下方任务树
        const tasks = this.panelOptions.getTasks();
        const roots = tasks.filter((task) => !task.parentId);
        if (!roots.some((task) => task.id === this.rootTaskId)) {
            this.rootTaskId = roots[0]?.id;
        }
        const select = this.clarifyEl.createEl('select', { cls: 'dropdown collect-clarify-root-select' });
        if (roots.length === 0) {
            const option = select.createEl('option', { text: t('panel.planNoTask') });
            option.value = '';
            this.rootTaskId = undefined;
        } else {
            for (const task of roots) {
                const option = select.createEl('option', { text: task.name });
                option.value = task.id;
            }
            select.value = this.rootTaskId ?? '';
        }
        select.addEventListener('change', () => {
            this.rootTaskId = select.value || undefined;
            this.selectedTaskId = undefined;
            this.renderClarifyTree();
        });

        this.treeEl = this.clarifyEl.createDiv({ cls: 'collect-clarify-tree' });
        this.renderClarifyTree();

        const footer = this.clarifyEl.createDiv({ cls: 'collect-clarify-footer' });
        const confirm = footer.createEl('button', { cls: 'collect-clarify-confirm' });
        setIcon(confirm.createSpan({ cls: 'collect-clarify-confirm-icon' }), 'check');
        confirm.createSpan({ text: t('gtd.clarifyConfirm') });
        confirm.addEventListener('click', () => {
            // 具体梳理行为待确认，当前仅保留按钮
        });
    }

    /** 重建选中根任务的任务树 */
    private renderClarifyTree(): void {
        this.treeEl.empty();
        if (!this.rootTaskId) {
            this.treeEl.createDiv({ cls: 'collect-clarify-empty', text: t('panel.planNoTask') });
            return;
        }
        const tasks = this.panelOptions.getTasks();
        this.renderTreeNodes(this.treeEl, this.rootTaskId, 0, tasks);
    }

    /** 递归渲染任务树（含子任务缩进） */
    private renderTreeNodes(
        parentEl: HTMLElement,
        parentId: string,
        depth: number,
        tasks: PrototypeTask[],
    ): void {
        for (const task of tasks.filter((item) => item.parentId === parentId)) {
            const row = parentEl.createDiv({ cls: 'collect-clarify-tree-row' });
            row.style.marginLeft = `${depth * 14}px`;
            row.dataset.taskId = task.id;
            row.toggleClass('is-selected', task.id === this.selectedTaskId);
            row.createSpan({ cls: 'collect-clarify-tree-label', text: task.name });
            row.addEventListener('click', () => this.selectTask(task.id));
            this.renderTreeNodes(parentEl, task.id, depth + 1, tasks);
        }
    }

    /** 选中任务树条目（仅高亮） */
    private selectTask(taskId: string): void {
        this.selectedTaskId = taskId;
        this.clarifyEl.querySelectorAll('.collect-clarify-tree-row').forEach((el) => {
            const row = el as HTMLElement;
            row.toggleClass('is-selected', row.dataset.taskId === taskId);
        });
    }
}
