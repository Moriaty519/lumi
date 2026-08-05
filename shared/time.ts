/** 全站展示时间统一用北京时间（Asia/Shanghai） */

export const BEIJING_TZ = 'Asia/Shanghai';

/** 聊天气泡用：HH:mm */
export function formatBeijingClock(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** 历史记录 / 报告标题用：YYYY/MM/DD HH:mm:ss */
export function formatBeijingDateTime(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}
