// 日期选择浮层：贴着触发元素弹出的月历，用于「目标条目」设置截止日期等场景。
// 自绘实现（不依赖第三方库），挂到 body 上并用 fixed 定位；主题色在构造时注入。
import { setIcon } from 'obsidian';

import { getLang, getWeekDays } from '../../../i18n';
import { applyThemeColors, getCurrentThemeColors } from '../../../themestory/theme-colors';

/** 日期选择浮层配置 */
export interface DatePickerPopoverOptions {
    /** 触发元素，弹层贴着它下方显示 */
    anchor: HTMLElement;
    /** 初始选中日期（YYYY-MM-DD） */
    value?: string;
    /** 选择日期后的回调（YYYY-MM-DD） */
    onSelect: (value: string) => void;
    /** 关闭回调（选中 / 点击外部 / Esc 都会触发） */
    onClose?: () => void;
}

/** 日期选择浮层 */
export class DatePickerPopover {
    private readonly options: DatePickerPopoverOptions;
    private readonly root: HTMLElement;
    /** 当前展示的月份（该月 1 号） */
    private viewDate: Date;
    /** 当前选中日期（YYYY-MM-DD） */
    private readonly selectedDate: string | undefined;
    private opened = false;

    private onOutsidePointerDown = (evt: MouseEvent): void => {
        if (!this.opened) return;
        const target = evt.target as Node | null;
        if (target && this.root.contains(target)) return;
        this.close();
    };

    private onKeyDown = (evt: KeyboardEvent): void => {
        if (evt.key === 'Escape') this.close();
    };

    constructor(options: DatePickerPopoverOptions) {
        this.options = options;
        this.selectedDate = options.value;
        const base = options.value ? parseDateKey(options.value) : new Date();
        this.viewDate = new Date(base.getFullYear(), base.getMonth(), 1);

        this.root = document.body.createDiv({ cls: 'date-picker-popover' });
        this.root.style.display = 'none';
        applyThemeColors(this.root, getCurrentThemeColors());
        this.render();

        document.addEventListener('mousedown', this.onOutsidePointerDown, true);
        document.addEventListener('keydown', this.onKeyDown);
    }

    /** 打开浮层（贴着触发元素下方，超出视口时自动翻转 / 收敛） */
    open(): void {
        if (this.opened) return;
        this.opened = true;
        this.root.style.display = 'flex';
        this.place();
    }

    /** 关闭浮层（触发关闭回调） */
    close(): void {
        if (!this.opened) return;
        this.opened = false;
        this.root.style.display = 'none';
        this.detach();
        this.options.onClose?.();
    }

    /** 销毁浮层（从 DOM 移除，不再触发关闭回调） */
    destroy(): void {
        this.opened = false;
        this.detach();
        this.root.remove();
    }

    private detach(): void {
        document.removeEventListener('mousedown', this.onOutsidePointerDown, true);
        document.removeEventListener('keydown', this.onKeyDown);
    }

    /** 贴着触发元素定位 */
    private place(): void {
        const rect = this.options.anchor.getBoundingClientRect();
        const width = this.root.offsetWidth;
        const height = this.root.offsetHeight;
        let left = rect.left;
        let top = rect.bottom + 4;
        if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
        if (top + height > window.innerHeight - 8) top = rect.top - height - 4;
        this.root.style.left = `${Math.max(8, left)}px`;
        this.root.style.top = `${Math.max(8, top)}px`;
    }

    /** 重绘整个浮层（切换月份时调用） */
    private render(): void {
        this.root.empty();

        // 头部：上个月 / 年月标题 / 下个月
        const header = this.root.createDiv({ cls: 'date-picker-header' });
        this.createNavButton(header, 'chevron-left', -1);
        header.createSpan({ cls: 'date-picker-title', text: this.formatTitle() });
        this.createNavButton(header, 'chevron-right', 1);

        // 星期表头（周一开头，与计划面板一致）
        const weekdays = this.root.createDiv({ cls: 'date-picker-weekdays' });
        for (const label of getWeekDays()) {
            weekdays.createSpan({ cls: 'date-picker-weekday', text: label });
        }

        // 固定 6 行日期格子，避免切换月份时高度跳动
        const grid = this.root.createDiv({ cls: 'date-picker-grid' });
        const todayKey = toDateKey(new Date());
        const first = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth(), 1);
        // 周一为一周第一列：周日（0）需要偏移到第 7 列
        const offset = (first.getDay() + 6) % 7;
        const start = new Date(first);
        start.setDate(1 - offset);
        for (let i = 0; i < 42; i += 1) {
            const date = new Date(start);
            date.setDate(start.getDate() + i);
            const key = toDateKey(date);
            const cell = grid.createEl('button', {
                cls: 'date-picker-day',
                text: String(date.getDate()),
                attr: { type: 'button' },
            });
            cell.toggleClass('is-outside', date.getMonth() !== this.viewDate.getMonth());
            cell.toggleClass('is-today', key === todayKey);
            cell.toggleClass('is-selected', key === this.selectedDate);
            cell.addEventListener('click', () => this.selectDate(key));
        }
    }

    /** 头部年月标题（跟随界面语言） */
    private formatTitle(): string {
        return new Intl.DateTimeFormat(getLang() === 'zh' ? 'zh-CN' : 'en-US', {
            year: 'numeric',
            month: 'long',
        }).format(this.viewDate);
    }

    private createNavButton(parentEl: HTMLElement, icon: string, delta: number): void {
        const button = parentEl.createEl('button', {
            cls: 'date-picker-nav',
            attr: { type: 'button', 'aria-label': delta < 0 ? 'Previous month' : 'Next month' },
        });
        setIcon(button, icon);
        button.addEventListener('click', () => {
            this.viewDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() + delta, 1);
            this.render();
        });
    }

    /** 选中日期：回传后关闭 */
    private selectDate(key: string): void {
        this.options.onSelect(key);
        this.close();
    }
}

/** 日期格式化为 YYYY-MM-DD（本地时区，避免 toISOString 的时区偏移） */
function toDateKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

/** 解析 YYYY-MM-DD 为本地日期 */
function parseDateKey(key: string): Date {
    const [year, month, day] = key.split('-').map((value) => Number(value));
    return new Date(year, (month || 1) - 1, day || 1);
}
