import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-xl rounded-lg border border-error/30 bg-white p-6 shadow-[var(--shadow-medium)]">
          <h1 className="mb-3 text-2xl font-bold text-gray-900">Something went wrong</h1>
          <p className="mb-6 text-sm text-gray-600">
            Fantasy AI hit an unexpected UI error. The technical details were logged locally.
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-md bg-primary px-4 py-2 font-semibold text-white transition-colors duration-[var(--transition-fast)] hover:bg-primary-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
