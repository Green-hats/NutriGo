import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  message: string
  onRetry?: () => void
}

export function ErrorBlock({ message, onRetry }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-gray-400">
      <AlertTriangle size={40} className="text-red-400" />
      <p className="text-sm text-center">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="flex items-center gap-2 text-green-600 text-sm font-medium">
          <RefreshCw size={16} /> 重试
        </button>
      )}
    </div>
  )
}
