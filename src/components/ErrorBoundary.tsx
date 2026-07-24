// Global render-error boundary. Route-level errorComponent handles loader
// errors; this catches synchronous render crashes inside the tree (e.g. a
// nested component throwing on bad data) so the whole app never goes blank.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportLovableError } from "@/lib/lovable-error-reporting";
import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Reporting tag - lets nested boundaries (e.g. the chat surface) be told apart. */
  name?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportLovableError(error, {
      boundary: this.props.name ?? "global_error_boundary",
      componentStack: info.componentStack ?? undefined,
    });
  }

  private reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return <FriendlyErrorPage error={this.state.error} reset={this.reset} />;
    }
    return this.props.children;
  }
}
