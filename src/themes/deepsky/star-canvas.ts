// 深空主题的代码绘制部分：Canvas 动态星空。
// 包含星点闪烁、缓慢漂移与偶发流星；返回清理函数，视图重绘时需调用以停止动画与监听。

/** 单个星点（位置用 0~1 比例表示，便于随容器尺寸缩放） */
interface Star {
    /** 横向位置比例 */
    x: number;
    /** 纵向位置比例 */
    y: number;
    /** 半径（像素） */
    radius: number;
    /** 基础亮度 */
    alpha: number;
    /** 闪烁速度 */
    twinkleSpeed: number;
    /** 闪烁相位 */
    phase: number;
    /** 每秒向下漂移的像素 */
    drift: number;
}

/** 流星 */
interface Meteor {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    length: number;
}

/** 设备像素比上限（避免高分屏绘制压力过大） */
const MAX_DPR = 2;

function randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

/**
 * 在 canvas 上绘制动态星空。
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
    let meteors: Meteor[] = [];
    let rafId = 0;
    let lastTime = 0;
    let elapsed = 0;
    let nextMeteorAt = randomBetween(3500, 7500);
    let disposed = false;

    const buildStars = () => {
        const count = Math.round(Math.min(220, Math.max(90, (width * height) / 9000)));
        stars = Array.from({ length: count }, () => ({
            x: Math.random(),
            y: Math.random(),
            // 少量较大的「亮星」，其余为细碎星点
            radius: Math.random() < 0.12 ? randomBetween(1.8, 2.6) : randomBetween(0.5, 1.6),
            alpha: randomBetween(0.45, 1),
            twinkleSpeed: randomBetween(0.4, 1.6),
            phase: Math.random() * Math.PI * 2,
            drift: randomBetween(0.8, 3.2),
        }));
    };

    const resize = () => {
        const rect = host.getBoundingClientRect();
        width = Math.max(1, Math.floor(rect.width));
        height = Math.max(1, Math.floor(rect.height));
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        buildStars();
    };

    const spawnMeteor = () => {
        const speed = randomBetween(420, 720);
        const angle = Math.PI * randomBetween(0.16, 0.24);
        meteors.push({
            x: randomBetween(0.1, 0.75) * width,
            y: randomBetween(0.02, 0.3) * height,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 0,
            maxLife: randomBetween(0.7, 1.2),
            length: randomBetween(70, 150),
        });
    };

    const drawStars = (delta: number) => {
        for (const star of stars) {
            star.y = (star.y + (star.drift * delta) / height) % 1;
            const twinkle = 0.55 + 0.45 * Math.sin((elapsed / 1000) * star.twinkleSpeed * Math.PI * 2 + star.phase);
            const alpha = Math.max(0, Math.min(1, star.alpha * twinkle));
            const x = star.x * width;
            const y = star.y * height;

            if (star.radius > 1.8) {
                const glow = ctx.createRadialGradient(x, y, 0, x, y, star.radius * 5);
                glow.addColorStop(0, `rgba(198, 224, 255, ${alpha})`);
                glow.addColorStop(1, 'rgba(198, 224, 255, 0)');
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(x, y, star.radius * 5, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.fillStyle = `rgba(236, 246, 255, ${alpha})`;
            ctx.beginPath();
            ctx.arc(x, y, star.radius, 0, Math.PI * 2);
            ctx.fill();
        }
    };

    const drawMeteors = (delta: number) => {
        if (elapsed > nextMeteorAt) {
            spawnMeteor();
            nextMeteorAt = elapsed + randomBetween(5000, 11000);
        }
        meteors = meteors.filter((meteor) => {
            meteor.life += delta;
            meteor.x += meteor.vx * delta;
            meteor.y += meteor.vy * delta;
            if (meteor.life >= meteor.maxLife) return false;

            const speed = Math.hypot(meteor.vx, meteor.vy) || 1;
            const tailX = meteor.x - (meteor.vx / speed) * meteor.length;
            const tailY = meteor.y - (meteor.vy / speed) * meteor.length;
            const fade = Math.sin((meteor.life / meteor.maxLife) * Math.PI);
            const gradient = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
            gradient.addColorStop(0, `rgba(214, 236, 255, ${0.9 * fade})`);
            gradient.addColorStop(1, 'rgba(214, 236, 255, 0)');
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(meteor.x, meteor.y);
            ctx.lineTo(tailX, tailY);
            ctx.stroke();
            return true;
        });
    };

    const render = (now: number) => {
        if (disposed) return;
        const delta = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
        lastTime = now;
        elapsed += delta * 1000;

        ctx.clearRect(0, 0, width, height);
        drawStars(delta);
        drawMeteors(delta);

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
