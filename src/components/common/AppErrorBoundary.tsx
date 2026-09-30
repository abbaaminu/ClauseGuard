import { Component, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application render failed:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main role="alert" className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="text-xl font-semibold">The application encountered an error.</h1>
          <p className="max-w-md text-sm text-muted-foreground">Reload the page to try again.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            Reload
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}