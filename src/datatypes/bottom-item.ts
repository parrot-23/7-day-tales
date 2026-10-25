// 界面视图底部方框的条目（当前仅支持文件夹）。

/** 底部方框条目：文件夹 */
export interface BottomFolderItem {
    id: string;
    type: 'folder';
    /** vault 相对路径 */
    path: string;
    /** 展示名称（默认取文件夹名） */
    name: string;
}

/** 底部方框条目（联合类型，后续可扩展其他类型） */
export type BottomItem = BottomFolderItem;
