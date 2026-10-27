// 公共悬浮面板：页面中一张可拖动的大卡片（非弹窗），右上角 X 按钮关闭。
// 与视图解耦，可挂在任意容器（默认 document.body）上复用。
import { applyThemeColors, getCurrentThemeColors, registerThemeColorsConsumer, unregisterThemeColorsConsumer } from '../themes/theme-colors';
import type { ThemeColors } from '../themes/theme-definition';

/** 悬浮面板配置 */
export interface FloatingPanelOptions {
    /** 面板标题（可选） */
    title?: string;
    /** 挂载容器，默认 document.body（挂到 body 时用 fixed 定位，否则用 absolute） */
    container?: HTMLElement;
    /** 面板宽度（px），默认 480 */
    width?: number;
    /** 是否可拖动，默认 true */
    draggable?: boolean;
    /** 是否在失去焦点时自动关闭（点击面板外任意位置），默认 false */
    closeOnBlur?: boolean;
    /** 关闭回调 */
    onClose?: () => void;
}

/**
 * 悬浮面板组件：本质是一张可拖动的卡片，首次打开居中，之后保留拖动位置。
 * 用法：
 * ```ts
 * const panel = new FloatingPanel({ title: '标题' });
 * panel.setContent((body) => body.createDiv({ text: '内容' }));
 * panel.open();
 * ```
 */
export class FloatingPanel {
    private host: HTMLElement;
    private hostIsBody: boolean;
    private root: HTMLElement;
    private headerEl: HTMLElement;
    private titleEl: HTMLElement;
    private bodyEl: HTMLElement;
    private options: FloatingPanelOptions;
    private opened = false;
    /** 当前左上角位置（相对挂载容器），null 表示尚未定位 */
    private left: number | null = null;
    private top: number | null = null;

    // 拖动状态
    private dragging = false;
    private dragStartX = 0;
    private dragStartY = 0;
    private dragStartLeft = 0;
    private dragStartTop = 0;

    private onKeyDown = (evt: KeyboardEvent) => {
        if (evt.key === 'Escape') this.close();
    };

    /** 点击面板外时关闭（仅在关闭面板失去焦点行为时绑定） */
    private onOutsidePointerDown = (evt: MouseEvent) => {
        if (!this.opened) return;
        const target = evt.target as Node | null;
        if (target && this.root.contains(target)) return;
        this.close();
    };

    constructor(options: FloatingPanelOptions = {}) {
        this.options = options;
        this.host = options.container ?? document.body;
        this.hostIsBody = this.host === document.body;

        this.root = this.host.createDiv({ cls: 'floating-panel' });
        if (!this.hostIsBody) {
            this.root.addClass('is-absolute');
            // absolute 定位需要容器本身可作为定位参照
            if (getComputedStyle(this.host).position === 'static') {
                this.host.style.position = 'relative';
            }
        }
        this.root.style.display = 'none';
        if (options.width) this.root.style.width = `${options.width}px`;

        this.headerEl = this.root.createDiv({ cls: 'floating-panel-header' });
        this.titleEl = this.headerEl.createDiv({ cls: 'floating-panel-title' });
        if (options.title) this.titleEl.setText(options.title);

        const closeBtn = this.headerEl.createDiv({ cls: 'floating-panel-close', text: '×' });
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.addEventListener('click', () => this.close());

        this.bodyEl = this.root.createDiv({ cls: 'floating-panel-body' });

        // 拖动：按住标题栏移动
        this.headerEl.addEventListener('pointerdown', this.handlePointerDown);
        this.headerEl.addEventListener('pointermove', this.handlePointerMove);
        this.headerEl.addEventListener('pointerup', this.handlePointerUp);
        this.headerEl.addEventListener('pointercancel', this.handlePointerUp);

        // 注册主题颜色消费者：构造时应用当前主题，主题切换时自动刷新
        registerThemeColorsConsumer(this);
        applyThemeColors(this.root, getCurrentThemeColors());
    }

    /** 面板内容容器（可直接追加内容） */
    get body(): HTMLElement {
        return this.bodyEl;
    }

    /** 是否处于打开状态 */
    get isOpen(): boolean {
        return this.opened;
    }

    /** 设置标题 */
    setTitle(title: string): void {
        this.titleEl.setText(title);
    }

    /** 设置内容：清空后由回调渲染，或直接传入元素 */
    setContent(content: HTMLElement | ((body: HTMLElement) => void)): void {
        this.bodyEl.empty();
        if (typeof content === 'function') {
            content(this.bodyEl);
        } else {
            this.bodyEl.appendChild(content);
        }
    }

    /** 打开面板（首次打开时居中，之后保留上次拖动位置） */
    open(): void {
        if (this.opened) return;
        this.opened = true;
        this.root.style.display = 'flex';
        if (this.left === null || this.top === null) {
            this.center();
        }
        document.addEventListener('keydown', this.onKeyDown);
        if (this.options.closeOnBlur) {
            // 用捕获阶段监听，避免被面板内元素的 stopPropagation 影响
            document.addEventListener('mousedown', this.onOutsidePointerDown, true);
        }
    }

    /** 关闭面板 */
    close(): void {
        if (!this.opened) return;
        this.opened = false;
        this.root.style.display = 'none';
        this.dragging = false;
        this.root.removeClass('is-dragging');
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('mousedown', this.onOutsidePointerDown, true);
        this.options.onClose?.();
    }

    /** 销毁面板（从 DOM 移除，不再触发关闭回调） */
    destroy(): void {
        unregisterThemeColorsConsumer(this);
        document.removeEventListener('keydown', this.onKeyDown);
        document.removeEventListener('mousedown', this.onOutsidePointerDown, true);
        this.opened = false;
        this.root.remove();
    }

    /** 应用主题颜色变量到面板根节点（供主题系统调用） */
    applyThemeColors(colors?: ThemeColors): void {
        applyThemeColors(this.root, colors);
    }

    /** 初始居中 */
    private center(): void {
        const hostSize = this.hostSize();
        const w = this.root.offsetWidth;
        const h = this.root.offsetHeight;
        this.setPosition((hostSize.width - w) / 2, (hostSize.height - h) / 2);
    }

    /** 挂载容器的可视尺寸（body 用视口尺寸） */
    private hostSize(): { width: number; height: number } {
        if (this.hostIsBody) {
            return { width: window.innerWidth, height: window.innerHeight };
        }
        return { width: this.host.clientWidth, height: this.host.clientHeight };
    }

    /** 设置位置，限制在挂载容器范围内 */
    private setPosition(left: number, top: number): void {
        const hostSize = this.hostSize();
        const maxLeft = Math.max(0, hostSize.width - this.root.offsetWidth);
        const maxTop = Math.max(0, hostSize.height - this.root.offsetHeight);
        this.left = Math.max(0, Math.min(left, maxLeft));
        this.top = Math.max(0, Math.min(top, maxTop));
        this.root.style.left = `${this.left}px`;
        this.root.style.top = `${this.top}px`;
    }

    private handlePointerDown = (evt: PointerEvent): void => {
        if (this.options.draggable === false || evt.button !== 0) return;
        // 关闭按钮不触发拖动
        if ((evt.target as HTMLElement).closest('.floating-panel-close')) return;
        this.dragging = true;
        this.dragStartX = evt.clientX;
        this.dragStartY = evt.clientY;
        this.dragStartLeft = this.left ?? 0;
        this.dragStartTop = this.top ?? 0;
        this.headerEl.setPointerCapture(evt.pointerId);
        this.root.addClass('is-dragging');
        evt.preventDefault();
    };

    private handlePointerMove = (evt: PointerEvent): void => {
        if (!this.dragging) return;
        this.setPosition(
            this.dragStartLeft + (evt.clientX - this.dragStartX),
            this.dragStartTop + (evt.clientY - this.dragStartY),
        );
    };

    private handlePointerUp = (): void => {
        if (!this.dragging) return;
        this.dragging = false;
        this.root.removeClass('is-dragging');
    };
}

/** 便捷创建并打开一个悬浮面板 */
export function showFloatingPanel(options: FloatingPanelOptions): FloatingPanel {
    const panel = new FloatingPanel(options);
    panel.open();
    return panel;
}