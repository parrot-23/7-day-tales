// 状态栏「进行中任务」：显示「任务名称：已用时长」，每分钟刷新一次
import { setIcon, type Plugin } from 'obsidian';

import { t } from '../i18n';
import { VIEW_TYPE_MAIN } from '../main-view';
import type { RunningTask } from '../datatypes/domain';

/**
 * 状态栏「进行中任务」：显示「任务名称：已用时长」，每分钟刷新一次。
 * 状态栏元素由插件创建（插件加载即存在，不依赖主视图是否打开）；
 * 点击可打开主视图并跳转到「界面」一级视图首页。
 */
export class RunningTaskStatusBar {
    /** 状态栏元素（由插件创建，随插件卸载自动清理） */
    private el?: HTMLElement;
    /** 已用时长刷新定时器（每分钟更新） */
    private timer?: number;

    constructor(
        private plugin: Plugin,
        /** 读取当前进行中任务 */
        private getRunningTask: () => RunningTask | undefined,
        /** 按进行中任务解析任务名称（支持收集盒任务与原型任务） */
        private findTaskName: (running: RunningTask) => string | undefined,
    ) {}

    /** 创建状态栏元素，并开始每分钟刷新已用时长 */
    init(): void {
        this.el = this.plugin.addStatusBarItem();
        this.el.addClass('parrot-plan-status-running');
        this.render();
        this.timer = window.setInterval(() => this.render(), 60 * 1000);
    }

    /**
     * 渲染状态栏：无进行中任务时显示「图标 + 日程」，
     * 有进行中任务时显示「图标 + 任务名：时长」。
     */
    render(): void {
        const el = this.el;
        if (!el) return;
        el.empty();

        // 统一的日历图标，始终显示
        const icon = el.createSpan({ cls: 'parrot-plan-status-icon' });
        setIcon(icon, 'calendar-clock');

        const running = this.getRunningTask();
        const name = running ? this.findTaskName(running) : undefined;

        if (!running || !name) {
            // 无进行中任务（或任务已被移除）
            el.createSpan({ text: t('nav.statusBarIdle') });
            el.setAttribute('aria-label', t('nav.statusBarIdle'));
            el.onclick = () => {
                void this.openMainView();
            };
            return;
        }

        const elapsed = typeof running.startedAt === 'number'
            ? Math.max(0, Math.floor((Date.now() - running.startedAt) / 60000))
            : Math.max(0, new Date().getHours() * 60 + new Date().getMinutes() - running.start);
        el.createSpan({
            text: t('nav.runningStatusBar', {
                name,
                duration: this.formatDuration(elapsed),
            }),
        });
        el.setAttribute('aria-label', t('nav.runningLabel'));
        el.onclick = () => {
            void this.openMainView();
        };
    }

    /** 把已用分钟数格式化为「x小时x分钟」/「x小时」/「x分钟」 */
    private formatDuration(minutes: number): string {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        if (hours > 0 && mins > 0) {
            return t('nav.statusBarDurationHm', { hours: String(hours), minutes: String(mins) });
        }
        if (hours > 0) return t('nav.statusBarDurationH', { hours: String(hours) });
        return t('nav.statusBarDurationM', { minutes: String(mins) });
    }

    /** 清理定时器与状态栏元素（插件卸载时调用） */
    destroy(): void {
        if (this.timer !== undefined) {
            window.clearInterval(this.timer);
            this.timer = undefined;
        }
        this.el?.remove();
        this.el = undefined;
    }

    /** 打开 / 聚焦主视图（状态栏点击用） */
    private async openMainView(): Promise<void> {
        const { workspace } = this.plugin.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_MAIN)[0];
        if (!leaf) {
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({ type: VIEW_TYPE_MAIN });
        }
        await workspace.revealLeaf(leaf);
    }
}
