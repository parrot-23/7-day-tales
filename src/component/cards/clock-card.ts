// 时钟卡片：把「今日时钟任务」中的 24 小时时钟单独绘制为一张卡片。
// 仅展示今天：夜间扇区、24 刻度、中心时间盒饼图、外环执行记录、时针；弧段仅悬停放大，不可点击。
import type { Plugin } from 'obsidian';

import type { PrototypeTask } from '../../datatypes/prototype-task';
import type { PdcaRepo } from '../../repos/pdca-repo';
import type { PrototypeTaskRepo } from '../../repos/prototype-task-repo';
import type { TaskExecutionRepo } from '../../repos/task-execution-repo';
import type { TimeBoxRepo } from '../../repos/timebox-repo';
import type { PlanCategoryData } from '../../shared/plan-category-manager';
import { getISOWeek, makeWeekKey } from '../../shared/plan-data';

/** 时钟卡片配置 */
export interface ClockCardOptions {
    plugin: Plugin;
    categoryData: PlanCategoryData;
}

/** 当天 0 点 */
function startOfToday(): Date {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
}

export class ClockCard {
    private readonly options: ClockCardOptions;
    /** 卡片内容容器 */
    private containerEl: HTMLElement | null = null;
    /** 时钟绘制容器 */
    private clockEl: HTMLElement | null = null;
    /** 分钟级刷新句柄 */
    private tickHandle: number | null = null;

    constructor(options: ClockCardOptions) {
        this.options = options;
    }

    private get plugin(): Plugin {
        return this.options.plugin;
    }

    private get prototypeTaskRepo(): PrototypeTaskRepo {
        return (this.plugin as Plugin & { prototypeTaskRepo: PrototypeTaskRepo }).prototypeTaskRepo;
    }

    private get taskExecutionRepo(): TaskExecutionRepo {
        return (this.plugin as Plugin & { taskExecutionRepo: TaskExecutionRepo }).taskExecutionRepo;
    }

    private get pdcaRepo(): PdcaRepo {
        return (this.plugin as Plugin & { pdcaRepo: PdcaRepo }).pdcaRepo;
    }

    /** 在指定容器内渲染时钟卡片 */
    render(parentEl: HTMLElement): void {
        this.stopTicker();
        this.containerEl = parentEl.createDiv({ cls: 'interface-clock-card' });
        this.clockEl = this.containerEl.createDiv({ cls: 'interface-clock-card-canvas' });
        this.renderClock(this.clockEl);
        this.startTicker();
    }

    /** 外部数据变化（记录 / 进行中任务 / 任务分类）后重绘 */
    refresh(): void {
        if (!this.clockEl?.isConnected) return;
        this.renderClock(this.clockEl);
    }

    /** 每分钟重绘一次，让时针随时间走动 */
    private startTicker(): void {
        this.stopTicker();
        this.tickHandle = window.setInterval(() => {
            if (!this.clockEl?.isConnected) {
                this.stopTicker();
                return;
            }
            this.renderClock(this.clockEl);
        }, 60000);
    }

    private stopTicker(): void {
        if (this.tickHandle !== null) {
            window.clearInterval(this.tickHandle);
            this.tickHandle = null;
        }
    }

    /** 渲染 24 小时时钟（只绘制今天） */
    private renderClock(container: HTMLElement): void {
        container.empty();
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 220 220');
        container.appendChild(svg);

        const selectedDate = startOfToday();
        const weekKey = makeWeekKey(selectedDate.getFullYear(), getISOWeek(selectedDate));
        const weekday = selectedDate.getDay() === 0 ? 7 : selectedDate.getDay();

        const cx = 110;
        const cy = 110;
        const radius = 88;
        /** 外环弧线半径 */
        const ringRadius = 99;
        const point = (hour: number, r: number): [number, number] => {
            // 整体旋转 180°：12 点朝上、0 点朝下（数字仍正向显示）
            const angle = ((hour * 15 + 180) * Math.PI) / 180;
            return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
        };
        const add = (tag: string, attrs: Record<string, string>): SVGElement => {
            const node = document.createElementNS(ns, tag);
            for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
            svg.appendChild(node);
            return node;
        };

        // 夜间扇区：18 点 → 24 点 → 6 点（顺时针经过顶部）
        const [nightStartX, nightStartY] = point(18, radius);
        const [nightEndX, nightEndY] = point(6, radius);
        add('path', {
            d: `M ${cx} ${cy} L ${nightStartX} ${nightStartY} A ${radius} ${radius} 0 0 1 ${nightEndX} ${nightEndY} Z`,
        }).style.fill = 'rgba(128, 128, 128, 0.18)';

        add('circle', { cx: String(cx), cy: String(cy), r: String(radius), fill: 'none' })
            .style.stroke = 'var(--background-modifier-border)';

        // 中心饼图：今天的时间盒涂色分布，每个已涂色小时占 15°
        const pieRadius = 25;
        const timeBoxRepo = (this.plugin as Plugin & { timeBoxRepo?: TimeBoxRepo }).timeBoxRepo;
        const pieHours = new Map<number, string>();
        for (const cell of timeBoxRepo?.weekCells(weekKey) ?? []) {
            if (cell.weekday === weekday) pieHours.set(cell.hour, cell.categoryId);
        }
        const categoryColor = (categoryId: string): string =>
            this.options.categoryData.categories.find((category) => category.id === categoryId)?.color
            ?? 'var(--text-muted)';
        if (pieHours.size > 0) {
            const drawWedge = (startHour: number, endHour: number, color: string): void => {
                if (startHour <= 0 && endHour >= 24) {
                    add('circle', { cx: String(cx), cy: String(cy), r: String(pieRadius) })
                        .style.fill = color;
                    return;
                }
                const [sx, sy] = point(startHour, pieRadius);
                const [ex, ey] = point(endHour, pieRadius);
                const largeArc = endHour - startHour > 12 ? 1 : 0;
                add('path', {
                    d: `M ${cx} ${cy} L ${sx} ${sy} A ${pieRadius} ${pieRadius} 0 ${largeArc} 1 ${ex} ${ey} Z`,
                }).style.fill = color;
            };
            // 相邻且分类相同的小时合并成一个扇区，避免同色出现接缝
            const paintedHours = Array.from(pieHours.keys()).sort((a, b) => a - b);
            let startHour = paintedHours[0];
            let prevHour = paintedHours[0];
            for (let i = 1; i <= paintedHours.length; i++) {
                const hour = paintedHours[i];
                if (hour === prevHour + 1 && pieHours.get(hour) === pieHours.get(prevHour)) {
                    prevHour = hour;
                    continue;
                }
                drawWedge(startHour, prevHour + 1, categoryColor(pieHours.get(prevHour)!));
                if (hour === undefined) break;
                startHour = hour;
                prevHour = hour;
            }
        }

        // 24 条刻度与小时数字
        for (let hour = 0; hour < 24; hour++) {
            const [x1, y1] = point(hour, radius);
            const [x2, y2] = point(hour, radius - 6);
            add('line', { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2) })
                .style.stroke = 'var(--background-modifier-border)';

            const [labelX, labelY] = point(hour, radius - 20);
            const isMajorHour = hour % 6 === 0;
            const label = add('text', {
                x: String(labelX),
                y: String(labelY),
                'text-anchor': 'middle',
                'dominant-baseline': 'middle',
                'font-size': isMajorHour ? '14' : '9',
                'font-weight': isMajorHour ? '700' : '400',
            });
            label.style.fill = 'var(--text-muted)';
            label.textContent = String(hour);
        }

        // 背景半区图标：夜间放月亮，白昼放太阳
        const [moonX, moonY] = point(0, 50);
        const moon = add('text', {
            x: String(moonX),
            y: String(moonY),
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            'font-size': '18',
        });
        moon.textContent = '🌛';
        moon.style.opacity = '0.85';
        const [sunX, sunY] = point(12, 50);
        const sun = add('text', {
            x: String(sunX),
            y: String(sunY),
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
            'font-size': '18',
        });
        sun.textContent = '🌞';
        sun.style.opacity = '0.85';

        // 时针：指向当前时:分（1 小时 = 15°）
        const now = new Date();
        const handHour = now.getHours() + now.getMinutes() / 60;
        const [tipX, tipY] = point(handHour, radius - 12);
        const [tailX, tailY] = point(handHour, -8);
        const currentHour = Math.floor(handHour);
        const handColor = pieHours.has(currentHour)
            ? categoryColor(pieHours.get(currentHour)!)
            : 'var(--interactive-accent)';
        const hand = add('line', {
            x1: String(tailX),
            y1: String(tailY),
            x2: String(tipX),
            y2: String(tipY),
        });
        hand.style.stroke = handColor;
        hand.style.strokeWidth = '3.5';
        hand.style.strokeLinecap = 'round';
        hand.style.opacity = '0.8';
        const hub = add('circle', { cx: String(cx), cy: String(cy), r: '4' });
        hub.style.fill = handColor;
        hub.style.opacity = '0.8';

        // 外环：今天已保存的执行记录（按时长占比绘制弧段）
        const dayStartMs = selectedDate.getTime();
        const dayEndMs = dayStartMs + 24 * 3600000;

        /** 生成 [startHour, endHour] 的弧线路径（指定半径） */
        const arcPath = (start: number, end: number, r: number): string => {
            const [sx, sy] = point(start, r);
            const [ex, ey] = point(end, r);
            const largeArc = end - start > 12 ? 1 : 0;
            return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`;
        };

        const drawArc = (startHour: number, endHour: number, color: string, opacity = 1): SVGElement | null => {
            const start = Math.max(0, Math.min(24, startHour));
            const end = Math.max(0, Math.min(24, endHour));
            if (end - start <= 0.0001) return null;
            const node: SVGElement = start === 0 && end === 24
                ? add('circle', { cx: String(cx), cy: String(cy), r: String(ringRadius), fill: 'none' })
                : add('path', { d: arcPath(start, end, ringRadius), fill: 'none' });
            node.style.stroke = color;
            node.style.strokeWidth = '10';
            node.style.strokeLinecap = 'butt';
            if (opacity !== 1) {
                node.style.opacity = String(opacity);
                node.style.pointerEvents = 'none';
            }
            return node;
        };

        // 整块时钟悬浮：所有弧段一起外扩；移出后恢复
        const ringEntries: { applyActive: () => void; applyNormal: () => void }[] = [];
        const attachArcHover = (node: SVGElement, startHour: number, endHour: number, isCircle: boolean): void => {
            let halo: SVGElement | null = null;
            if (!isCircle) {
                halo = add('path', { d: arcPath(startHour, endHour, ringRadius + 3), fill: 'none' });
                halo.style.stroke = 'var(--interactive-accent)';
                halo.style.strokeWidth = '18';
                halo.style.strokeLinecap = 'butt';
                halo.style.opacity = '0';
                halo.style.pointerEvents = 'none';
                // 光晕置于弧段下方，悬浮时表现为边框高亮
                node.parentNode?.insertBefore(halo, node);
            }
            const applyActive = (): void => {
                if (isCircle) node.setAttribute('r', String(ringRadius + 3));
                else node.setAttribute('d', arcPath(startHour, endHour, ringRadius + 3));
                node.style.strokeWidth = '14';
                if (halo) halo.style.opacity = '1';
            };
            const applyNormal = (): void => {
                if (isCircle) node.setAttribute('r', String(ringRadius));
                else node.setAttribute('d', arcPath(startHour, endHour, ringRadius));
                node.style.strokeWidth = '10';
                if (halo) halo.style.opacity = '0';
            };
            ringEntries.push({ applyActive, applyNormal });
        };

        const todayRecords = this.taskExecutionRepo.records
            .filter((record) => record.endAt > dayStartMs && record.startAt < dayEndMs)
            .sort((a, b) => a.startAt - b.startAt);
        for (const record of todayRecords) {
            const start = Math.max(dayStartMs, record.startAt);
            const end = Math.min(dayEndMs, record.endAt);
            const startHour = (start - dayStartMs) / 3600000;
            const endHour = (end - dayStartMs) / 3600000;
            const arc = drawArc(startHour, endHour, this.categoryColorOf(record.taskId));
            if (arc) attachArcHover(arc, startHour, endHour, startHour === 0 && endHour === 24);
        }

        // 进行中的计时：半透明追加弧段
        const running = this.pdcaRepo.runningTask;
        if (running?.source === 'prototype' && typeof running.startedAt === 'number') {
            const nowMs = Date.now();
            const start = Math.max(dayStartMs, running.startedAt);
            const end = Math.min(dayEndMs, nowMs);
            if (end > start) {
                const startHour = (start - dayStartMs) / 3600000;
                const endHour = (end - dayStartMs) / 3600000;
                const runningArc = drawArc(startHour, endHour, this.categoryColorOf(running.inboxId), 0.5);
                // 进行中弧段同样随整钟悬浮加宽，但不叠加光晕
                if (runningArc) {
                    const entryNode = runningArc;
                    ringEntries.push({
                        applyActive: () => entryNode.setAttribute('d', arcPath(startHour, endHour, ringRadius + 3)),
                        applyNormal: () => entryNode.setAttribute('d', arcPath(startHour, endHour, ringRadius)),
                    });
                }
            }
        }

        svg.addEventListener('mouseenter', () => {
            for (const entry of ringEntries) entry.applyActive();
        });
        svg.addEventListener('mouseleave', () => {
            for (const entry of ringEntries) entry.applyNormal();
        });
    }

    /** 任务分类颜色（无分类 / 分类已删除时使用未分类灰色） */
    private categoryColorOf(taskId: string): string {
        const task = this.prototypeTaskRepo.tasks.find((item): item is PrototypeTask => item.id === taskId);
        const category = task?.categoryId
            ? this.options.categoryData.categories.find((item) => item.id === task.categoryId)
            : undefined;
        return category?.color ?? '#888888';
    }
}
