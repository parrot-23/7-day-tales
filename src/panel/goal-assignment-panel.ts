// 周目标分配面板：从计划面板「目标」面板的「分配」按钮打开。
// 列出当前任务的全部待办条目，点击条目即分配（或取消分配）到当前周，由父面板实时持久化。
import type { ImprovementEntry } from '../datatypes/domain';
import { t } from '../i18n';
import { FloatingPanel } from './floating-panel';

/** 周目标分配面板配置 */
export interface GoalAssignmentPanelOptions {
    /** 当前任务名称 */
    taskName: string;
    /** 当前周文案，如「第43周」 */
    weekLabel: string;
    /** 当前任务的全部待办条目 */
    items: ImprovementEntry[];
    /** 已选为本周目标的条目 id */
    selectedIds: string[];
    /** 勾选 / 取消勾选回调（父面板负责写入并持久化） */
    onToggle: (improvementId: string, selected: boolean) => void;
    /** 关闭回调 */
    onClose?: () => void;
}

/** 周目标分配面板 */
export class GoalAssignmentPanel extends FloatingPanel {
    /** 当前勾选的待办条目 id */
    private selectedIds: Set<string>;

    constructor(options: GoalAssignmentPanelOptions) {
        super({
            title: t('panel.planGoalPickerTitle'),
            width: 420,
            closeOnBlur: true,
            onClose: options.onClose,
        });
        this.selectedIds = new Set(options.selectedIds);
        this.setContent((body) => this.renderContent(body, options));
    }

    private renderContent(body: HTMLElement, options: GoalAssignmentPanelOptions): void {
        // 首行：任务名称 + 周标签
        const head = body.createDiv({ cls: 'plan-goal-picker-head' });
        head.createSpan({ cls: 'plan-goal-picker-task', text: options.taskName });
        head.createSpan({ cls: 'plan-goal-week-badge', text: options.weekLabel });

        const list = body.createDiv({ cls: 'plan-goal-picker-list' });
        if (options.items.length === 0) {
            list.createDiv({ cls: 'plan-goal-picker-empty', text: t('panel.planGoalPickerEmpty') });
            return;
        }
        for (const item of options.items) {
            const row = list.createDiv({ cls: 'plan-goal-picker-item' });
            const selected = this.selectedIds.has(item.id);
            row.toggleClass('is-selected', selected);
            row.toggleClass('is-done', item.done === true);
            row.createSpan({ cls: 'plan-goal-picker-text', text: item.text });
            // 已分配到该周时，条目末尾显示「已分配」标签
            const tagEl = row.createSpan({
                cls: 'plan-goal-assigned-tag',
                text: t('panel.planGoalAssigned'),
            });
            tagEl.toggleClass('is-hidden', !selected);
            row.addEventListener('click', () => {
                const next = !this.selectedIds.has(item.id);
                if (next) {
                    this.selectedIds.add(item.id);
                } else {
                    this.selectedIds.delete(item.id);
                }
                row.toggleClass('is-selected', next);
                tagEl.toggleClass('is-hidden', !next);
                options.onToggle(item.id, next);
            });
        }
    }
}
