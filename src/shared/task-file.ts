// 任务文件工具：绑定目录下的文件列表、文件名生成（供任务详情面板与任务板块面板共用）。
import type { App, TFile } from 'obsidian';

/** 文件名的日期时间戳前缀（YYYY-MM-DD） */
export function formatFileStamp(ts: number): string {
    const d = new Date(ts);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
}

/** 绑定目录下的一级文件（按最近编辑时间倒序） */
export function listTaskFiles(app: App, dir: string | undefined): TFile[] {
    if (!dir) return [];
    return app.vault.getFiles()
        .filter((file) => file.parent?.path === dir)
        .sort((a, b) => b.stat.mtime - a.stat.mtime);
}

/** 文件路径相对绑定目录的展示文本（含子目录，如 子目录/文件.md）；不在该目录下时回退完整路径 */
export function relativeToDir(path: string, dir: string | undefined): string {
    if (!dir) return path;
    const prefix = `${dir}/`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** 生成任务文件名：清洗非法字符、补 .md 后缀，按需加时间戳前缀；名称为空时返回空串 */
export function buildTaskFileName(name: string, withStamp: boolean): string {
    const safe = name.replace(/[\\/:*?"<>|]/g, '').trim();
    if (!safe) return '';
    const stamp = withStamp ? `${formatFileStamp(Date.now())}_` : '';
    return safe.toLowerCase().endsWith('.md') ? `${stamp}${safe}` : `${stamp}${safe}.md`;
}
