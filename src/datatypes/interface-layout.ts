// 界面视图卡片布局：记录编辑模式下被移除的卡片与拖动后的位置，默认全部显示且靠左上。

/** 卡片位置（相对界面主区域的像素坐标） */
export interface InterfaceCardPosition {
    left: number;
    top: number;
}

export interface InterfaceLayoutData {
    /** 被移除的卡片 id 列表（如 ['today-clock']） */
    hiddenCards: string[];
    /** 卡片拖动后的位置，键为卡片 id */
    cardPositions: Record<string, InterfaceCardPosition>;
    /** 通过「添加」面板加入的可选卡片 id 列表（默认不显示） */
    addedCards: string[];
}
