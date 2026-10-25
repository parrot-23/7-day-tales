// 任务记录面板：基于 FloatingPanel，用于手动填写一次任务的执行记录。
// 结构：开始时间 + 结束时间 + 时长（由起止时间自动计算） + 确认按钮。
import { t } from '../i18n';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';

/** 任务记录面板配置 */
export interface TaskRecordPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「记录任务」 */
    title?: string;
    /** 初始开始时间（HH:MM） */
    startTime?: string;
    /** 初始结束时间（HH:MM） */
    endTime?: string;
    /** 记录归属日期（默认今天；查看过去日期时传入该日期） */
    date?: Date;
    /** 确认回调：起止时间均为 date 指定那天的时间戳（毫秒） */
    onConfirm: (startAt: number, endAt: number) => void;
}

/** 任务记录面板 */
export class TaskRecordPanel extends FloatingPanel {
    private readonly panelOptions: TaskRecordPanelOptions;
    private startInput!: HTMLInputElement;
    private endInput!: HTMLInputElement;
    private durationEl!: HTMLElement;
    private confirmBtn!: HTMLButtonElement;

    constructor(options: TaskRecordPanelOptions) {
        super({
            width: 420,
            title: options.title ?? t('panel.taskRecordTitle'),
            ...options,
        });
        this.panelOptions = options;
        this.body.addClass('task-record-panel');
        this.renderForm();
    }

    /** 渲染表单 */
    private renderForm(): void {
        const form = this.body.createDiv({ cls: 'task-record-form' });

        this.startInput = this.createTimeRow(form, t('panel.recordStartTime'), this.panelOptions.startTime);
        this.endInput = this.createTimeRow(form, t('panel.recordEndTime'), this.panelOptions.endTime);

        // 时长：只读，随起止时间自动计算
        const durationRow = form.createDiv({ cls: 'task-record-row' });
        durationRow.createSpan({ cls: 'task-record-label', text: t('panel.recordDuration') });
        this.durationEl = durationRow.createSpan({ cls: 'task-record-duration' });

        const actions = form.createDiv({ cls: 'task-record-actions' });
        this.confirmBtn = actions.createEl('button', { cls: 'mod-cta', text: t('common.confirm') });
        this.confirmBtn.addEventListener('click', () => {
            const range = this.computeRange();
            if (!range) return;
            this.panelOptions.onConfirm(range.startAt, range.endAt);
            this.close();
        });

        for (const input of [this.startInput, this.endInput]) {
            input.addEventListener('input', () => this.refresh());
            input.addEventListener('change', () => this.refresh());
        }
        this.refresh();
    }

    /** 创建一行「标签 + 时间输入框」 */
    private createTimeRow(container: HTMLElement, label: string, value?: string): HTMLInputElement {
        const row = container.createDiv({ cls: 'task-record-row' });
        row.createSpan({ cls: 'task-record-label', text: label });
        const input = row.createEl('input', { cls: 'task-record-time' });
        input.type = 'time';
        if (value) input.value = value;
        return input;
    }

    /** 刷新时长展示与确认按钮可用状态 */
    private refresh(): void {
        const range = this.computeRange();
        this.durationEl.textContent = range
            ? t('panel.recordMinutes', { minutes: String(Math.round((range.endAt - range.startAt) / 60000)) })
            : t('panel.recordInvalidRange');
        this.durationEl.toggleClass('is-invalid', !range);
        this.confirmBtn.disabled = !range;
    }

    /** 解析表单为归属日期的起止时间戳（结束不晚于开始时返回 null） */
    private computeRange(): { startAt: number; endAt: number } | null {
        const startMinutes = this.parseTime(this.startInput.value);
        const endMinutes = this.parseTime(this.endInput.value);
        if (startMinutes === null || endMinutes === null) return null;
        const base = new Date(this.panelOptions.date ?? new Date());
        base.setHours(0, 0, 0, 0);
        const baseMs = base.getTime();
        const startAt = baseMs + startMinutes * 60000;
        const endAt = baseMs + endMinutes * 60000;
        if (endAt <= startAt) return null;
        return { startAt, endAt };
    }

    /** HH:MM → 当天分钟数 */
    private parseTime(value: string): number | null {
        const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
        if (!match) return null;
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (hour > 23 || minute > 59) return null;
        return hour * 60 + minute;
    }
}
