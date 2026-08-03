import { Component, type ReactNode } from 'react'
import { ErrorBlock } from './ErrorBlock'

interface State { hasError: boolean; error: string }

export class ChatErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false, error: '' }
  static getDerivedStateFromError(e: Error) { return { hasError: true, error: e.message } }
  render() {
    if (this.state.hasError) return <ErrorBlock message={`界面出错了: ${this.state.error}`} onRetry={() => this.setState({ hasError: false })} />
    return this.props.children
  }
}
