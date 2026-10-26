// 任务记录面板：基于 FloatingPanel，用于手动填写一次任务的执行记录。
// 结构：开始时间（小时/分钟双输入框 + 下拉候选） + 结束时间 + 时长（可输入并联动结束时间） + 确认按钮。
import { setIcon } from 'obsidian';
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

/** 时间字段：小时 + 分钟两个输入框 */
interface TimeField {
    wrapper: HTMLElement;
    hourInput: HTMLInputElement;
    minuteInput: HTMLInputElement;
}

/** 下拉候选项 */
interface DropdownItem {
    value: number;
    label: string;
}

/** 分钟候选：00、05 … 55 */
const MINUTE_ITEMS = Array.from({ length: 12 }, (_, index) => index * 5);
/** 小时候选：0 … 23 */
const HOUR_ITEMS = Array.from({ length: 24 }, (_, index) => index);
/** 时长候选（分钟）：常用时长 */
const DURATION_ITEMS = [5, 10, 15, 20, 25, 30, 45, 60, 75, 90, 120, 150, 180];

/** 任务记录面板 */
export class TaskRecordPanel extends FloatingPanel {
    private readonly panelOptions: TaskRecordPanelOptions;
    private startField!: TimeField;
    private endField!: TimeField;
    /** 结束时间行末尾的「次日」标签（跨天时显示） */
    private endNextDayTag!: HTMLElement;
    private durationInput!: HTMLInputElement;
    private confirmBtn!: HTMLButtonElement;

    /** 「现在开始」/「截止现在」按钮及其对勾图标 */
    private startNowBtn!: HTMLButtonElement;
    private startNowIcon!: HTMLElement;
    private endNowBtn!: HTMLButtonElement;
    private endNowIcon!: HTMLElement;

    /** 当前打开的下拉浮层 */
    private dropdownEl: HTMLElement | null = null;
    /** 下拉浮层对应的输入框（用于避免重复打开） */
    private dropdownAnchor: HTMLElement | null = null;
    /** 下拉选中回调 */
    private dropdownPick: ((value: number) => void) | null = null;
    /** 移除文档级关闭监听 */
    private removeOutsideListener: (() => void) | null = null;

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

    /** 关闭面板时同时关闭下拉浮层 */
    close(): void {
        this.closeDropdown();
        super.close();
    }

    /** 渲染表单 */
    private renderForm(): void {
        const form = this.body.createDiv({ cls: 'task-record-form' });

        this.startField = this.createTimeRow(form, t('panel.recordStartTime'), 'start', this.panelOptions.startTime);
        this.endField = this.createTimeRow(form, t('panel.recordEndTime'), 'end', this.panelOptions.endTime);

        // 时长：可直接输入分钟数，修改后联动结束时间
        const durationRow = form.createDiv({ cls: 'task-record-row' });
        durationRow.createSpan({ cls: 'task-record-label', text: t('panel.recordDuration') });
        const durationField = durationRow.createDiv({ cls: 'task-record-duration-field' });
        this.durationInput = durationField.createEl('input', {
            cls: 'task-record-duration-input',
            attr: { inputmode: 'numeric', maxlength: '4' },
        });
        durationField.createSpan({ cls: 'task-record-duration-unit', text: t('panel.recordDurationUnit') });
        this.bindDurationInput(this.durationInput);

        const actions = form.createDiv({ cls: 'task-record-actions' });
        this.confirmBtn = actions.createEl('button', { cls: 'mod-cta', text: t('common.confirm') });
        this.confirmBtn.addEventListener('click', () => {
            const range = this.computeRange();
            if (!range) return;
            this.panelOptions.onConfirm(range.startAt, range.endAt);
            this.close();
        });

        this.refresh();
    }

    /** 创建一行「标签 + 小时:分钟 双输入框」 */
    private createTimeRow(
        container: HTMLElement,
        label: string,
        role: 'start' | 'end',
        value?: string,
    ): TimeField {
        const row = container.createDiv({ cls: 'task-record-row' });
        row.createSpan({ cls: 'task-record-label', text: label });

        const wrapper = row.createDiv({ cls: 'task-record-time-field' });
        const hourInput = wrapper.createEl('input', {
            cls: 'task-record-time-part',
            attr: { inputmode: 'numeric', maxlength: '2', 'aria-label': `${label} 小时` },
        });
        wrapper.createSpan({ cls: 'task-record-time-colon', text: ':' });
        const minuteInput = wrapper.createEl('input', {
            cls: 'task-record-time-part',
            attr: { inputmode: 'numeric', maxlength: '2', 'aria-label': `${label} 分钟` },
        });

        const field: TimeField = { wrapper, hourInput, minuteInput };
        const parsed = this.parseInitialTime(value);
        if (parsed) {
            hourInput.value = String(parsed.hour).padStart(2, '0');
            minuteInput.value = String(parsed.minute).padStart(2, '0');
        }

        // 结束时间跨天时在分钟输入框后 32px 处显示「次日」标签
        if (role === 'end') {
            this.endNextDayTag = wrapper.createSpan({ cls: 'task-record-next-day', text: t('panel.recordNextDay') });
        }

        // 行末快捷按钮：开始时间「现在开始」、结束时间「截止现在」
        const nowBtn = row.createEl('button', {
            cls: 'task-record-now-btn',
            attr: { type: 'button' },
        });
        const nowIcon = nowBtn.createSpan({ cls: 'task-record-now-icon' });
        nowBtn.createSpan({ text: role === 'start' ? t('panel.recordNowStart') : t('panel.recordNowEnd') });
        if (role === 'start') {
            this.startNowBtn = nowBtn;
            this.startNowIcon = nowIcon;
        } else {
            this.endNowBtn = nowBtn;
            this.endNowIcon = nowIcon;
        }
        nowBtn.addEventListener('click', () => this.applyNow(role));

        this.bindTimePart(hourInput, 'hour', role);
        this.bindTimePart(minuteInput, 'minute', role);
        return field;
    }

    /** 绑定小时/分钟输入框的输入、聚焦下拉与键盘操作 */
    private bindTimePart(input: HTMLInputElement, part: 'hour' | 'minute', role: 'start' | 'end'): void {
        input.addEventListener('input', () => {
            input.value = input.value.replace(/\D/g, '').slice(0, 2);
            // 手动修改后取消该行「现在」按钮的激活态
            this.setNowActive(role, false);
            // 开始时间变化：按当前时长顺延结束时间；结束时间变化：按起止时间重算时长
            if (role === 'start') this.syncEndFromDuration();
            else this.refresh();
        });
        input.addEventListener('focus', () => {
            input.select();
            this.openPartDropdown(input, part, role);
        });
        input.addEventListener('click', () => this.openPartDropdown(input, part, role));
        input.addEventListener('blur', () => {
            this.normalizePart(input, part === 'hour' ? 23 : 59);
            this.refresh();
        });
        input.addEventListener('keydown', (evt) => this.onTimeKeydown(evt, input, part, role));
    }

    /** 绑定时长输入框：输入即联动结束时间，聚焦弹出常用时长 */
    private bindDurationInput(input: HTMLInputElement): void {
        input.addEventListener('input', () => {
            input.value = input.value.replace(/\D/g, '').slice(0, 4);
            this.applyDurationToEnd();
        });
        input.addEventListener('focus', () => {
            input.select();
            this.openDropdown(
                input,
                DURATION_ITEMS.map((minutes) => ({
                    value: minutes,
                    label: t('panel.recordMinutes', { minutes: String(minutes) }),
                })),
                this.readDuration(),
                (minutes) => {
                    input.value = String(minutes);
                    this.applyDurationToEnd();
                },
            );
        });
        input.addEventListener('blur', () => this.refresh());
        input.addEventListener('keydown', (evt) => this.onDropdownKeydown(evt));
    }

    /** 时间输入框键盘操作：上下键打开/移动候选，回车选中，Esc 关闭 */
    private onTimeKeydown(
        evt: KeyboardEvent,
        input: HTMLInputElement,
        part: 'hour' | 'minute',
        role: 'start' | 'end',
    ): void {
        if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
            evt.preventDefault();
            if (!this.dropdownEl || this.dropdownAnchor !== input) {
                this.openPartDropdown(input, part, role);
                return;
            }
            this.moveHighlight(evt.key === 'ArrowDown' ? 1 : -1);
            return;
        }
        this.onDropdownKeydown(evt);
    }

    /** 下拉通用键盘操作 */
    private onDropdownKeydown(evt: KeyboardEvent): void {
        if (!this.dropdownEl) return;
        if (evt.key === 'Enter') {
            evt.preventDefault();
            const active = this.dropdownEl.querySelector<HTMLElement>('.task-record-dropdown-item.is-active');
            if (active) this.pickDropdownItem(Number(active.dataset.value));
        } else if (evt.key === 'Escape') {
            evt.preventDefault();
            this.closeDropdown();
        }
    }

    /** 打开小时或分钟候选下拉 */
    private openPartDropdown(input: HTMLInputElement, part: 'hour' | 'minute', role: 'start' | 'end'): void {
        const current = input.value.trim() === '' ? null : Number(input.value);
        const items = (part === 'hour' ? HOUR_ITEMS : MINUTE_ITEMS).map((value) => ({
            value,
            label: String(value).padStart(2, '0'),
        }));
        this.openDropdown(input, items, current, (value) => {
            input.value = String(value).padStart(2, '0');
            this.setNowActive(role, false);
            // 选中开始时间后按当前时长顺延结束时间，选中结束时间后重算时长
            if (role === 'start') this.syncEndFromDuration();
            else this.refresh();
        });
    }

    /** 在输入框下方打开自定义候选浮层（固定定位，避免被面板裁切） */
    private openDropdown(
        anchor: HTMLElement,
        items: DropdownItem[],
        current: number | null,
        onPick: (value: number) => void,
    ): void {
        if (this.dropdownEl && this.dropdownAnchor === anchor) return;
        this.closeDropdown();

        const dropdown = document.body.createDiv({ cls: 'task-record-dropdown' });
        for (const item of items) {
            const option = dropdown.createEl('button', {
                cls: 'task-record-dropdown-item',
                text: item.label,
                attr: { 'data-value': String(item.value) },
            });
            if (item.value === current) option.addClass('is-selected');
            option.addEventListener('mousedown', (evt) => {
                // 阻止输入框失焦，保证点击候选后仍能继续操作
                evt.preventDefault();
                evt.stopPropagation();
            });
            option.addEventListener('click', () => this.pickDropdownItem(item.value));
        }

        // 定位：默认在输入框下方，空间不足时翻到上方
        const rect = anchor.getBoundingClientRect();
        const width = Math.max(rect.width, 72);
        const height = dropdown.offsetHeight;
        const spaceBelow = window.innerHeight - rect.bottom;
        const top = spaceBelow >= height + 8 ? rect.bottom + 4 : Math.max(4, rect.top - height - 4);
        dropdown.style.left = `${Math.min(rect.left, window.innerWidth - width - 8)}px`;
        dropdown.style.top = `${top}px`;
        dropdown.style.width = `${width}px`;

        const active = dropdown.querySelector<HTMLElement>('.is-selected')
            ?? dropdown.querySelector<HTMLElement>('.task-record-dropdown-item');
        active?.addClass('is-active');
        active?.scrollIntoView({ block: 'nearest' });

        this.dropdownEl = dropdown;
        this.dropdownAnchor = anchor;
        this.dropdownPick = onPick;

        const onOutsideDown = (evt: PointerEvent) => {
            const target = evt.target as Node | null;
            if (!target) return;
            if (dropdown.contains(target) || anchor.contains(target)) return;
            this.closeDropdown();
        };
        // 延迟注册，避免本次点击立即触发关闭
        const timer = window.setTimeout(() => {
            document.addEventListener('pointerdown', onOutsideDown, true);
        }, 0);
        this.removeOutsideListener = () => {
            window.clearTimeout(timer);
            document.removeEventListener('pointerdown', onOutsideDown, true);
        };
    }

    /** 选中下拉项 */
    private pickDropdownItem(value: number): void {
        const pick = this.dropdownPick;
        this.closeDropdown();
        pick?.(value);
    }

    /** 在下拉项间移动高亮 */
    private moveHighlight(delta: number): void {
        if (!this.dropdownEl) return;
        const options = Array.from(this.dropdownEl.querySelectorAll<HTMLElement>('.task-record-dropdown-item'));
        if (options.length === 0) return;
        const currentIndex = options.findIndex((option) => option.hasClass('is-active'));
        const nextIndex = Math.max(0, Math.min(options.length - 1, currentIndex + delta));
        options.forEach((option) => option.removeClass('is-active'));
        options[nextIndex].addClass('is-active');
        options[nextIndex].scrollIntoView({ block: 'nearest' });
    }

    /** 关闭候选浮层 */
    private closeDropdown(): void {
        this.removeOutsideListener?.();
        this.removeOutsideListener = null;
        this.dropdownEl?.remove();
        this.dropdownEl = null;
        this.dropdownAnchor = null;
        this.dropdownPick = null;
    }

    /** 开始时间变化后：按当前时长把结束时间顺延为「开始 + 时长」，跨天时取次日时间点 */
    private syncEndFromDuration(): void {
        const start = this.readTime(this.startField);
        const minutes = this.readDuration();
        if (start === null || minutes === null || minutes <= 0 || minutes >= 24 * 60) {
            this.refresh(false);
            return;
        }
        this.setTime(this.endField, (start + minutes) % (24 * 60));
        this.refresh(false);
    }

    /** 时长输入后把结束时间设为开始时间 + 时长 */
    private applyDurationToEnd(): void {
        // 「截止现在」激活时反向更新开始时间：开始 = 结束 - 时长
        if (this.endNowBtn.hasClass('is-active')) {
            this.syncStartFromDuration();
            return;
        }
        const start = this.readTime(this.startField);
        const minutes = this.readDuration();
        if (start === null || minutes === null || minutes <= 0 || minutes >= 24 * 60) {
            this.refresh(false);
            return;
        }
        this.setTime(this.endField, (start + minutes) % (24 * 60));
        this.refresh(false);
    }

    /** 刷新时长展示、跨天标签与确认按钮可用状态 */
    private refresh(syncDuration = true): void {
        const start = this.readTime(this.startField);
        const end = this.readTime(this.endField);
        const crossesDay = start !== null && end !== null && end < start;
        if (syncDuration) {
            let minutes: number | null = null;
            if (start !== null && end !== null && end !== start) {
                minutes = end > start ? end - start : end + 24 * 60 - start;
            }
            this.durationInput.value = minutes === null ? '' : String(minutes);
        }
        this.endNextDayTag.toggleClass('is-visible', crossesDay);
        const range = this.computeRange();
        this.durationInput.toggleClass('is-invalid', !range);
        this.confirmBtn.disabled = !range;
    }

    /** 解析表单为归属日期的起止时间戳（结束早于开始时视为次日；相等视为无效） */
    private computeRange(): { startAt: number; endAt: number } | null {
        const startMinutes = this.readTime(this.startField);
        const endMinutes = this.readTime(this.endField);
        if (startMinutes === null || endMinutes === null) return null;
        if (endMinutes === startMinutes) return null;
        const base = new Date(this.panelOptions.date ?? new Date());
        base.setHours(0, 0, 0, 0);
        const baseMs = base.getTime();
        const startAt = baseMs + startMinutes * 60000;
        const endAt = baseMs + (endMinutes < startMinutes ? endMinutes + 24 * 60 : endMinutes) * 60000;
        return { startAt, endAt };
    }

    /** 点击「现在开始」/「截止现在」：两者互斥激活，并按当前时长更新另一端时间 */
    private applyNow(role: 'start' | 'end'): void {
        const now = new Date();
        const minutes = now.getHours() * 60 + now.getMinutes();
        if (role === 'start') {
            this.setTime(this.startField, minutes);
            this.setNowActive('end', false);
            this.setNowActive('start', true);
            // 开始 = 现在，结束 = 开始 + 时长
            this.syncEndFromDuration();
            return;
        }
        this.setTime(this.endField, minutes);
        this.setNowActive('start', false);
        this.setNowActive('end', true);
        // 结束 = 现在，开始 = 结束 - 时长
        this.syncStartFromDuration();
    }

    /** 按当前时长把开始时间前推为「结束 - 时长」（配合「截止现在」） */
    private syncStartFromDuration(): void {
        const end = this.readTime(this.endField);
        const minutes = this.readDuration();
        if (end === null || minutes === null || minutes <= 0 || minutes >= 24 * 60) {
            this.refresh(false);
            return;
        }
        let start = end - minutes;
        if (start < 0) start += 24 * 60;
        this.setTime(this.startField, start);
        this.refresh(false);
    }

    /** 切换「现在」按钮的激活态：激活后显示打勾图标 + 文字 */
    private setNowActive(role: 'start' | 'end', active: boolean): void {
        const button = role === 'start' ? this.startNowBtn : this.endNowBtn;
        const icon = role === 'start' ? this.startNowIcon : this.endNowIcon;
        if (!button || !icon) return;
        button.toggleClass('is-active', active);
        icon.toggleClass('is-visible', active);
        icon.empty();
        if (active) setIcon(icon, 'check');
    }

    /** 读取时间字段为当天分钟数 */
    private readTime(field: TimeField): number | null {
        const hourText = field.hourInput.value.trim();
        const minuteText = field.minuteInput.value.trim();
        if (!/^\d{1,2}$/.test(hourText) || !/^\d{1,2}$/.test(minuteText)) return null;
        const hour = Number(hourText);
        const minute = Number(minuteText);
        if (hour > 23 || minute > 59) return null;
        return hour * 60 + minute;
    }

    /** 写入时间字段（分钟数 → 补零的小时/分钟） */
    private setTime(field: TimeField, totalMinutes: number): void {
        field.hourInput.value = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
        field.minuteInput.value = String(totalMinutes % 60).padStart(2, '0');
        // 程序写入时间后，取消对应行的「现在」激活态（随后可再显式激活）
        if (field === this.startField) this.setNowActive('start', false);
        else if (field === this.endField) this.setNowActive('end', false);
    }

    /** 读取时长输入框为分钟数 */
    private readDuration(): number | null {
        const text = this.durationInput.value.trim();
        if (!/^\d{1,4}$/.test(text)) return null;
        return Number(text);
    }

    /** 失焦时补零并限制在合法范围内 */
    private normalizePart(input: HTMLInputElement, max: number): void {
        if (input.value.trim() === '') return;
        const value = Math.max(0, Math.min(Number(input.value), max));
        input.value = String(value).padStart(2, '0');
    }

    /** 解析初始 HH:MM 文本 */
    private parseInitialTime(value?: string): { hour: number; minute: number } | null {
        if (!value) return null;
        const match = /^(\d{1,2}):(\d{1,2})$/.exec(value.trim());
        if (!match) return null;
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        if (hour > 23 || minute > 59) return null;
        return { hour, minute };
    }
}
