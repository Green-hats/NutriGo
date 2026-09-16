import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Alert, Button } from '@mui/material'
import WifiOffRounded from '@mui/icons-material/WifiOffRounded'
import { isOffline } from '../../lib/connection'
import { isPreviewBuild, usePreviewStore } from '../../lib/preview'
import { toast } from '../../lib/toast'

function subscribe(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

export function ConnectionNotice() {
  const offline = useSyncExternalStore(subscribe, isOffline, () => false)
  const wasOffline = useRef(offline)
  const active = usePreviewStore((s) => s.active)
  const exit = usePreviewStore((s) => s.exit)
  useEffect(() => {
    if (wasOffline.current && !offline && !isPreviewBuild())
      toast('网络已恢复，请重试刚才的操作。', 'success')
    wasOffline.current = offline
  }, [offline])
  if (isPreviewBuild())
    return (
      <Alert
        severity="info"
        sx={{ borderRadius: 0, flexShrink: 0 }}
        action={
          active ? (
            <Button color="inherit" size="small" onClick={exit} sx={{ whiteSpace: 'nowrap', px: 1, minWidth: 76 }}>
              退出体验
            </Button>
          ) : undefined
        }
      >
        {offline && '当前没有网络。'}
        {active
          ? '离线界面体验 · 示例数据，不会上传或保存'
          : '体验包尚未连接云端，可免登录浏览示例界面。'}
      </Alert>
    )
  if (!offline) return null
  return (
    <Alert
      icon={<WifiOffRounded />}
      severity="warning"
      sx={{ borderRadius: 0, flexShrink: 0 }}
    >
      当前没有网络。恢复连接后请手动重试，不会自动重发。
    </Alert>
  )
}
