// 深空主题的代码绘制部分：星云与极光。
// 由大尺度径向渐变与锥形渐变叠加而成，配合 CSS 动画缓慢漂移，形成明显的星云层次。

/**
 * 生成星云 / 极光背景。
 * 返回可用于 background-image 的多层渐变字符串。
 */
export function buildNebula(): string {
    return [
        // 左上冷蓝星云
        'radial-gradient(55% 45% at 16% 10%, rgba(59, 130, 246, 0.34), rgba(59, 130, 246, 0) 70%)',
        // 右上紫罗兰星云
        'radial-gradient(48% 42% at 82% 20%, rgba(168, 85, 247, 0.26), rgba(168, 85, 247, 0) 70%)',
        // 右下青色星云
        'radial-gradient(60% 55% at 72% 88%, rgba(14, 165, 233, 0.22), rgba(14, 165, 233, 0) 72%)',
        // 极光弧带
        'conic-gradient(from 210deg at 32% 68%, rgba(45, 212, 191, 0.18), rgba(45, 212, 191, 0) 30%, rgba(99, 102, 241, 0.2) 62%, rgba(99, 102, 241, 0) 78%)',
    ].join(', ');
}
