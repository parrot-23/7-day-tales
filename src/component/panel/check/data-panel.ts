// 数据面板：基于 FloatingPanel，顶部选项卡切换「记录卡 / 执行记录」两张表。
// 当前内容为纯文字占位，暂不接入真实数据。
import { t } from '../../i18n';
import { FloatingPanel, type FloatingPanelOptions } from './floating-panel';

/** 数据面板配置 */
export interface DataPanelOptions extends Omit<FloatingPanelOptions, 'title'> {
    /** 面板标题，默认「数据」 */
    title?: string;
}

/** 选项卡标识 */
type DataTab = 'recordCard' | 'executionRecords';

/** 数据面板 */
export class DataPanel extends FloatingPanel {
    private tabsEl!: HTMLElement;
    private paneEl!: HTMLElement;
    /** 当前激活的选项卡（默认记录卡） */
    private tab: DataTab = 'recordCard';

    constructor(options: DataPanelOptions = {}) {
        super({
            width: 720,
            title: options.title ?? t('nav.data'),
            ...options,
        });
        this.body.addClass('data-panel');
        this.renderLayout();
    }

    private renderLayout(): void {
        this.tabsEl = this.body.createDiv({ cls: 'plan-tabs' });

        const recordTab = this.tabsEl.createDiv({ cls: 'plan-tab', text: t('data.tabRecordCard') });
        recordTab.dataset.tab = 'recordCard';
        recordTab.addEventListener('click', () => this.switchTab('recordCard'));

        const execTab = this.tabsEl.createDiv({ cls: 'plan-tab', text: t('data.tabExecutionRecords') });
        execTab.dataset.tab = 'executionRecords';
        execTab.addEventListener('click', () => this.switchTab('executionRecords'));

        this.paneEl = this.body.createDiv({ cls: 'data-panel-pane' });
        this.switchTab(this.tab);
    }

    private switchTab(tab: DataTab): void {
        this.tab = tab;
        this.tabsEl.querySelectorAll<HTMLElement>('[data-tab]').forEach((el) => {
            el.toggleClass('is-active', el.dataset.tab === tab);
        });
        this.renderPane();
    }

    /** 渲染占位表格：表头 + 一行占位文字 */
    private renderPane(): void {
        this.paneEl.empty();
        const placeholder = this.tab === 'recordCard'
            ? t('okr.recordNoData')
            : t('data.executionNoData');

        const table = this.paneEl.createEl('table', { cls: 'okr-record-table' });
        const headRow = table.createEl('thead').createEl('tr');
        headRow.createEl('th', { cls: 'okr-record-th-date', text: t('okr.recordDate') });
        headRow.createEl('th', { text: t('data.tableContent') });

        const row = table.createEl('tbody').createEl('tr');
        row.createEl('td', { cls: 'data-panel-empty', text: placeholder, attr: { colspan: '2' } });
    }
}
