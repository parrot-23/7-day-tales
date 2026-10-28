// 界面视图浮动卡片外壳：统一卡片外观与编辑模式交互。
// 今日日期 / 今日时钟 / 今日任务三种卡片只负责渲染内部内容，
// 定位、边框、背景、拖动条、右上角 X 与编辑模式下的点击拦截都由此外壳提供。
import type { InterfaceCardPosition } from '../../datatypes/interface-layout';
import { t } from '../../i18n';

/** 拖动判定阈值（像素）：移动超过该距离才视为拖动 */
const DRAG_THRESHOLD = 3;

export interface InterfaceCardShellOptions {
    /** 卡片 id：用于布局持久化 */
    cardId: string;
    /** 卡片专属修饰类：负责默认位置与尺寸（如 card-date） */
    cardClass: string;
    /** 是否处于编辑模式 */
    editMode: boolean;
    /** 已保存的位置；为空时使用 CSS 默认位置 */
    position?: InterfaceCardPosition;
    /** 拖动结束：保存新位置 */
    onMove: (position: InterfaceCardPosition) => void;
    /** 点击右上角 X：移除卡片 */
    onRemove: () => void;
}

/**
 * 创建卡片外壳并返回内容容器：调用方把卡片渲染进返回的容器即可。
 * 编辑模式下：内容区在捕获阶段截断点击，避免拖动时误触卡片内部行为。
 */
export function createInterfaceCardShell(
    parentEl: HTMLElement,
    options: InterfaceCardShellOptions,
): HTMLElement {
    const shellEl = parentEl.createDiv({ cls: `interface-card-shell ${options.cardClass}` });
    shellEl.dataset.cardId = options.cardId;
    if (options.position) {
        shellEl.style.left = `${options.position.left}px`;
        shellEl.style.top = `${options.position.top}px`;
    }

    if (options.editMode) {
        shellEl.addClass('is-editing');
        mountDragHandle(shellEl, parentEl, options);
        mountRemoveButton(shellEl, options);
    }

    const bodyEl = shellEl.createDiv({ cls: 'interface-card-shell-body' });
    if (options.editMode) {
        // 编辑模式整卡禁点：捕获阶段拦截，阻止内部按钮 / 折叠 / 打开面板等行为
        bodyEl.addEventListener('click', (evt) => {
            evt.stopPropagation();
        }, true);
    }
    return bodyEl;
}

/** 顶部拖动横条：按住拖动整张卡片，移动超过阈值才进入拖动状态 */
function mountDragHandle(
    shellEl: HTMLElement,
    parentEl: HTMLElement,
    options: InterfaceCardShellOptions,
): void {
    const handleEl = shellEl.createDiv({ cls: 'interface-card-drag' });
    handleEl.addEventListener('pointerdown', (evt) => {
        if (evt.button !== 0) return;
        evt.preventDefault();
        const mainRect = parentEl.getBoundingClientRect();
        const shellRect = shellEl.getBoundingClientRect();
        const offsetX = evt.clientX - shellRect.left;
        const offsetY = evt.clientY - shellRect.top;
        const startX = evt.clientX;
        const startY = evt.clientY;
        let dragging = false;

        const onMove = (moveEvt: PointerEvent) => {
            if (!dragging) {
                if (Math.hypot(moveEvt.clientX - startX, moveEvt.clientY - startY) < DRAG_THRESHOLD) return;
                dragging = true;
                shellEl.addClass('is-dragging');
            }
            const left = Math.max(0, Math.min(
                moveEvt.clientX - mainRect.left - offsetX,
                mainRect.width - shellRect.width,
            ));
            const top = Math.max(0, Math.min(
                moveEvt.clientY - mainRect.top - offsetY,
                mainRect.height - shellRect.height,
            ));
            shellEl.style.left = `${left}px`;
            shellEl.style.top = `${top}px`;
        };
        const onUp = () => {
            handleEl.removeEventListener('pointermove', onMove);
            shellEl.removeClass('is-dragging');
            if (!dragging) return;
            options.onMove({
                left: parseFloat(shellEl.style.left) || 0,
                top: parseFloat(shellEl.style.top) || 0,
            });
        };

        handleEl.setPointerCapture(evt.pointerId);
        handleEl.addEventListener('pointermove', onMove);
        handleEl.addEventListener('pointerup', onUp, { once: true });
    });
}

/** 右上角移除按钮：点击后由调用方决定是「隐藏」还是「从添加列表移除」 */
function mountRemoveButton(shellEl: HTMLElement, options: InterfaceCardShellOptions): void {
    const removeBtn = shellEl.createEl('button', {
        cls: 'interface-card-remove',
        text: '×',
        attr: { type: 'button', 'aria-label': t('interface.removeCard') },
    });
    removeBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        options.onRemove();
    });
}
