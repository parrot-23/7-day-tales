// 时空之旅主题的代码绘制部分：Canvas 星点，缓慢向观察者迎面移动（从中心向外扩散）。
// 返回清理函数，视图重绘时需调用以停止动画与监听。

/** 单个星点：三维位置（x / y 为归一化偏移，z 为深度） */
interface Star {
    /** 归一化横向偏移（-1 ~ 1） */
    x: number;
    /** 归一化纵向偏移（-1 ~ 1） */
    y: number;
    /** 深度：1 为最远，越小越近 */
    z: number;
    /** 基础亮度 */
    alpha: number;
}

/** 设备像素比上限（避免高分屏绘制压力过大） */
const MAX_DPR = 2;
/** 迎面移动速度：每秒减少的深度（越小越慢） */
const APPROACH_SPEED = 0.04;
/** 最近处深度，到达后重新回到最远处 */
const NEAREST_Z = 0.06;
/** 星点数量上限 */
const MAX_STARS = 240;
/** 平均多少画布像素分布一颗星 */
const PIXELS_PER_STAR = 12000;
/** 星点出场后越过画布边界的额外余量（像素） */
const EDGE_MARGIN = 60;

function randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

/**
 * 在 canvas 上绘制迎面移动的星点。
 * @param canvas 画布元素
 * @param host 尺寸参照容器
 * @returns 清理函数
 */
export function createStarfield(canvas: HTMLCanvasElement, host: HTMLElement): () => void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => undefined;

    let width = 1;
    let height = 1;
    let stars: Star[] = [];
    let rafId = 0;
    let lastTime = 0;
    let disposed = false;

    const spawn = (far: boolean): Star => ({
        x: randomBetween(-1, 1),
        y: randomBetween(-1, 1),
        z: far ? randomBetween(0.72, 1) : randomBetween(NEAREST_Z, 1),
        alpha: randomBetween(0.35, 1),
    });

    const buildStars = (): void => {
        const count = Math.round(Math.min(MAX_STARS, Math.max(90, (width * height) / PIXELS_PER_STAR)));
        stars = Array.from({ length: count }, () => spawn(false));
    };

    const resize = (): void => {
        const rect = host.getBoundingClientRect();
        width = Math.max(1, Math.floor(rect.width));
        height = Math.max(1, Math.floor(rect.height));
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        buildStars();
    };

    const drawStars = (delta: number): void => {
        const centerX = width / 2;
        const centerY = height / 2;
        // 最远处（z=1）的归一化偏移映射到的像素半径
        const spread = Math.min(width, height) * 0.42;

        for (const star of stars) {
            star.z -= APPROACH_SPEED * delta;
            if (star.z <= NEAREST_Z) Object.assign(star, spawn(true));

            const scale = spread / star.z;
            const x = centerX + star.x * scale;
            const y = centerY + star.y * scale;

            // 已越过画布边界的星点回到最远处，保持视野内始终有星
            if (x < -EDGE_MARGIN || x > width + EDGE_MARGIN
                || y < -EDGE_MARGIN || y > height + EDGE_MARGIN) {
                Object.assign(star, spawn(true));
                continue;
            }

            // 越近越大、越亮
            const radius = Math.max(0.3, (1 - star.z) * 1.8);
            const alpha = star.alpha * Math.min(1, 1.15 - star.z);
            ctx.fillStyle = `rgba(232, 242, 255, ${alpha})`;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
    };

    const render = (now: number): void => {
        if (disposed) return;
        const delta = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
        lastTime = now;

        ctx.clearRect(0, 0, width, height);
        drawStars(delta);

        rafId = requestAnimationFrame(render);
    };

    const observer = new ResizeObserver(() => resize());
    observer.observe(host);
    resize();
    rafId = requestAnimationFrame(render);

    return () => {
        disposed = true;
        cancelAnimationFrame(rafId);
        observer.disconnect();
        ctx.clearRect(0, 0, width, height);
    };
}
