import { Component, type ErrorInfo, type ReactNode } from 'react';

import { FullScreenMessage } from '@/shared/components/feedback/FullScreenMessage';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

/** Catches render-time errors and shows a recoverable fallback. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Hook into a crash-reporting service here once one is approved.
    if (__DEV__) {
      console.error('ErrorBoundary caught an error:', error, info.componentStack);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <FullScreenMessage
          title="Something went wrong"
          description="An unexpected error occurred. You can try again."
          actionLabel="Try again"
          onAction={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}
