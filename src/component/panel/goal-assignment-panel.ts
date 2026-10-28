// 周目标选择面板：从计划面板「目标」面板的「分配」按钮打开。
// 候选目标按任务分组（当前任务 + 各父级任务），点击条目即绑定（或取消绑定）到当前周。
import type { TaskGoalEntry, WeekGoalRef } from '../../datatypes/prototype-task';
import { t } from '../../i18n';
import { FloatingPanel } from './floating-panel';

/** 候选目标分组（一个任务一组） */
export interface GoalCandidateGroup {
    taskId: string;
    taskName: string;
    /** 该任务下的目标条目 */
    goals: TaskGoalEntry[];
}

/** 周目标选择面板配置 */
export interface GoalAssignmentPanelOptions {
    /** 当前任务名称 */
    taskName: string;
    /** 当前周文案，如「第43周」 */
    weekLabel: string;
    /** 候选目标分组：当前任务在前，父级依次在后 */
    groups: GoalCandidateGroup[];
    /** 已绑定到本周的目标引用 */
    selectedRefs: WeekGoalRef[];
    /** 绑定 / 取消绑定回调（父面板负责写入并持久化） */
    onToggle: (ref: WeekGoalRef, selected: boolean) => void;
    /** 关闭回调 */
    onClose?: () => void;
}

/** 目标引用唯一键 */
function refKey(ref: WeekGoalRef): string {
    return `${ref.taskId}:${ref.goalId}`;
}

/** 周目标选择面板 */
export class GoalAssignmentPanel extends FloatingPanel {
    /** 当前已绑定的目标引用 */
    private selectedKeys: Set<string>;

    constructor(options: GoalAssignmentPanelOptions) {
        super({
            title: t('panel.planGoalPickerTitle'),
            width: 420,
            closeOnBlur: true,
            onClose: options.onClose,
        });
        this.selectedKeys = new Set(options.selectedRefs.map(refKey));
        this.setContent((body) => this.renderContent(body, options));
    }

    private renderContent(body: HTMLElement, options: GoalAssignmentPanelOptions): void {
        // 首行：任务名称 + 周标签
        const head = body.createDiv({ cls: 'plan-goal-picker-head' });
        head.createSpan({ cls: 'plan-goal-picker-task', text: options.taskName });
        head.createSpan({ cls: 'plan-goal-week-badge', text: options.weekLabel });

        const list = body.createDiv({ cls: 'plan-goal-picker-list' });
        const groups = options.groups.filter((group) => group.goals.length > 0);
        if (groups.length === 0) {
            list.createDiv({ cls: 'plan-goal-picker-empty', text: t('panel.planGoalPickerEmpty') });
            return;
        }
        for (const group of groups) {
            // 分组小标题：目标所属任务
            list.createDiv({ cls: 'plan-goal-picker-group', text: group.taskName });
            for (const goal of group.goals) {
                this.renderGoalRow(list, goal, group, options);
            }
        }
    }

    /** 渲染单个候选目标：文本 + 已分配标签，点击切换绑定 */
    private renderGoalRow(
        list: HTMLElement,
        goal: TaskGoalEntry,
        group: GoalCandidateGroup,
        options: GoalAssignmentPanelOptions,
    ): void {
        const key = `${group.taskId}:${goal.id}`;
        const row = list.createDiv({ cls: 'plan-goal-picker-item' });
        const selected = this.selectedKeys.has(key);
        row.toggleClass('is-selected', selected);
        row.createSpan({ cls: 'plan-goal-picker-text', text: goal.text });
        const tagEl = row.createSpan({
            cls: 'plan-goal-assigned-tag',
            text: t('panel.planGoalAssigned'),
        });
        tagEl.toggleClass('is-hidden', !selected);
        row.addEventListener('click', () => {
            const next = !this.selectedKeys.has(key);
            if (next) {
                this.selectedKeys.add(key);
            } else {
                this.selectedKeys.delete(key);
            }
            row.toggleClass('is-selected', next);
            tagEl.toggleClass('is-hidden', !next);
            options.onToggle({ taskId: group.taskId, goalId: goal.id }, next);
        });
    }
}
