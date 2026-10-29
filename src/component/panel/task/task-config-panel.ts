// 任务配置面板：从任务面板类型胶囊左侧的配置按钮打开。
// 内容：任务名称 / 任务描述 / 任务类型（胶囊下拉）/ 任务所在目录路径 + 保存。
import { setIcon } from 'obsidian';

import type { PrototypeTask, PrototypeTaskType } from '../../../datatypes/prototype-task';
import { t } from '../../../i18n';
import { FloatingPanel, type FloatingPanelOptions } from '../basic/floating-panel';

/** 保存数据 */
export interface TaskConfigSavePayload {
    name: string;
    description?: string;
    type: PrototypeTaskType;
}

/** 任务配置面板配置 */
export interface TaskConfigPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 当前编辑的任务 */
    task: PrototypeTask;
    /** 任务所在目录路径（未配置任务库时返回空串） */
    getTaskDir: () => string;
    /** 保存回调（父面板负责写仓库并持久化） */
    onSave?: (payload: TaskConfigSavePayload) => void;
}

/** 任务配置面板 */
export class TaskConfigPanel extends FloatingPanel {
    private readonly panelOptions: TaskConfigPanelOptions;
    private nameInputEl!: HTMLInputElement;
    private descInputEl!: HTMLTextAreaElement;
    private typeCapsuleEl!: HTMLElement;
    /** 当前选中的任务类型 */
    private typeValue: PrototypeTaskType;
    /** 类型切换下拉（挂在 body 上，保证层级高于悬浮面板） */
    private typeMenuEl: HTMLElement | null = null;
    private typeMenuCleanup: (() => void) | null = null;

    constructor(options: TaskConfigPanelOptions) {
        super({
            width: 420,
            // 失去焦点（点击面板外）时自动关闭
            closeOnBlur: true,
            ...options,
            title: t('panel.taskConfigTitle'),
            onClose: () => {
                this.closeTypeMenu();
                options.onClose?.();
            },
        });
        this.panelOptions = options;
        this.typeValue = options.task.type;
        this.renderContent();
    }

    /** 渲染表单内容 */
    private renderContent(): void {
        const body = this.body;
        body.addClass('task-config-panel');

        // 任务名称
        const nameField = body.createDiv({ cls: 'task-config-field' });
        nameField.createDiv({ cls: 'task-config-label', text: t('panel.taskConfigName') });
        this.nameInputEl = nameField.createEl('input', { cls: 'task-config-input' });
        this.nameInputEl.type = 'text';
        this.nameInputEl.value = this.panelOptions.task.name;
        this.nameInputEl.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') this.submit();
        });

        // 任务描述
        const descField = body.createDiv({ cls: 'task-config-field' });
        descField.createDiv({ cls: 'task-config-label', text: t('panel.taskConfigDescription') });
        this.descInputEl = descField.createEl('textarea', { cls: 'task-config-textarea' });
        this.descInputEl.placeholder = t('panel.taskConfigDescriptionPlaceholder');
        this.descInputEl.value = this.panelOptions.task.description ?? '';

        // 任务类型：胶囊下拉选择
        const typeField = body.createDiv({ cls: 'task-config-field' });
        typeField.createDiv({ cls: 'task-config-label', text: t('panel.taskConfigType') });
        this.typeCapsuleEl = typeField.createDiv({ cls: 'task-config-type-capsule' });
        this.syncTypeCapsule();
        this.typeCapsuleEl.addEventListener('click', (evt) => {
            evt.stopPropagation();
            this.openTypeMenu();
        });

        // 任务所在目录路径（只读展示）
        const dirField = body.createDiv({ cls: 'task-config-field' });
        dirField.createDiv({ cls: 'task-config-label', text: t('panel.taskConfigDir') });
        const dir = this.panelOptions.getTaskDir();
        const dirEl = dirField.createDiv({ cls: `task-config-dir${dir ? '' : ' is-empty'}` });
        dirEl.setText(dir || t('panel.taskConfigDirEmpty'));
        if (dir) dirEl.title = dir;

        // 保存
        const footer = body.createDiv({ cls: 'task-config-footer' });
        const saveBtn = footer.createEl('button', { cls: 'mod-cta', text: t('common.save') });
        saveBtn.addEventListener('click', () => this.submit());
    }

    /** 同步胶囊文案与配色 */
    private syncTypeCapsule(): void {
        this.typeCapsuleEl.empty();
        this.typeCapsuleEl.toggleClass('is-main', this.typeValue === 'main');
        this.typeCapsuleEl.toggleClass('is-side', this.typeValue === 'side');
        this.typeCapsuleEl.createSpan({
            text: t(this.typeValue === 'main' ? 'panel.mainTaskBadge' : 'panel.sideTaskBadge'),
        });
        setIcon(this.typeCapsuleEl.createSpan({ cls: 'task-config-type-caret' }), 'chevron-down');
    }

    /** 在胶囊下方弹出类型选择菜单（复用任务面板的下拉样式） */
    private openTypeMenu(): void {
        this.closeTypeMenu();
        const menu = document.body.createDiv({ cls: 'task-panel-type-menu' });
        const renderOption = (type: PrototypeTaskType, labelKey: 'panel.mainTaskBadge' | 'panel.sideTaskBadge') => {
            const isActive = this.typeValue === type;
            const item = menu.createDiv({ cls: `task-panel-type-menu-item${isActive ? ' is-active' : ''}` });
            item.createSpan({ text: t(labelKey) });
            if (isActive) setIcon(item.createSpan({ cls: 'task-panel-type-menu-check' }), 'check');
            item.addEventListener('click', (evt) => {
                evt.stopPropagation();
                this.closeTypeMenu();
                if (isActive) return;
                this.typeValue = type;
                this.syncTypeCapsule();
            });
        };
        renderOption('main', 'panel.mainTaskBadge');
        renderOption('side', 'panel.sideTaskBadge');

        // 对齐到胶囊左下角
        const rect = this.typeCapsuleEl.getBoundingClientRect();
        menu.style.top = `${Math.round(rect.bottom + 4)}px`;
        menu.style.left = `${Math.round(rect.left)}px`;

        // 点击菜单外、按 Esc、面板滚动时关闭
        const onPointerDown = (downEvt: PointerEvent) => {
            const target = downEvt.target as Node | null;
            if (target && menu.contains(target)) return;
            this.closeTypeMenu();
        };
        const onKeyDown = (keyEvt: KeyboardEvent) => {
            if (keyEvt.key === 'Escape') this.closeTypeMenu();
        };
        const onScroll = () => this.closeTypeMenu();
        window.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('scroll', onScroll, true);
        this.typeMenuCleanup = () => {
            window.removeEventListener('pointerdown', onPointerDown, true);
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('scroll', onScroll, true);
        };
        this.typeMenuEl = menu;
        // 下拉菜单挂在 body 上，登记为面板内部元素，避免点击菜单时触发失焦关闭
        this.addIgnoreElement(menu);
    }

    /** 关闭类型切换下拉 */
    private closeTypeMenu(): void {
        this.typeMenuCleanup?.();
        this.typeMenuCleanup = null;
        this.typeMenuEl?.remove();
        this.typeMenuEl = null;
    }

    /** 保存并关闭 */
    private submit(): void {
        const name = this.nameInputEl.value.trim();
        if (!name) {
            this.nameInputEl.focus();
            return;
        }
        const description = this.descInputEl.value.trim();
        this.panelOptions.onSave?.({
            name,
            description: description || undefined,
            type: this.typeValue,
        });
        this.close();
    }
}
