import { Modal, type App } from 'obsidian';

import { t } from '../i18n';

/** 通用确认弹窗 */
export class ConfirmModal extends Modal {
    private message: string;
    private detail: string;
    private onConfirm: () => void | Promise<void>;

    constructor(app: App, message: string, detail: string, onConfirm: () => void | Promise<void>) {
        super(app);
        this.message = message;
        this.detail = detail;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        // 悬浮面板 z-index 为 900，弹窗默认层级更低会被遮挡，这里显式提到面板之上
        this.containerEl.style.zIndex = '1000';

        const { contentEl } = this;
        contentEl.createEl('h3', { text: this.message });
        contentEl.createEl('p', { text: this.detail });

        const btnRow = contentEl.createDiv({ cls: 'modal-button-container' });
        btnRow.createEl('button', { text: t('settings.cancel') }).onclick = () => this.close();
        const confirmBtn = btnRow.createEl('button', {
            text: t('settings.confirm'),
            cls: 'mod-warning',
        });
        confirmBtn.onclick = () => {
            void (async () => {
                await this.onConfirm();
                this.close();
            })();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}
