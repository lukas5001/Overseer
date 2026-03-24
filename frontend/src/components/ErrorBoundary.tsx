import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-950 text-gray-300 p-8">
          <h1 className="text-2xl font-bold text-red-400 mb-4">Ein Fehler ist aufgetreten</h1>
          <p className="text-gray-400 mb-2 font-mono text-sm max-w-xl text-center">
            {this.state.error?.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded"
          >
            Seite neu laden
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
