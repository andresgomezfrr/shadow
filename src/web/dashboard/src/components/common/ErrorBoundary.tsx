import { Component, type ReactNode, type ErrorInfo } from 'react';

type Props = { children: ReactNode };
type State = { hasError: boolean; error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
          <div className="text-4xl">{'{ x_x }'}</div>
          <h2 className="text-lg font-semibold text-zinc-200">Something went wrong</h2>
          <p className="text-sm text-zinc-400 max-w-md">{this.state.error?.message}</p>
          <button
            className="px-4 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 rounded-md text-zinc-200"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
