// 轻量 toast 工具 — 与 Toast 组件解耦，避免组件文件同时导出函数（fast-refresh 提示）
export type ToastType = 'error' | 'success'

type ToastHandler = (message: string, type: ToastType) => void

let _handler: ToastHandler | null = null

/** 注册/注销 Toast 处理函数（由 Toast 组件在挂载/卸载时调用） */
export function setToastHandler(handler: ToastHandler | null): void {
  _handler = handler
}

/** 全局弹窗提示，Toast 组件挂载后调用有效 */
export function toast(message: string, type: ToastType = 'error'): void {
  _handler?.(message, type)
}
