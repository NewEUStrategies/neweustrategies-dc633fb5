// Granular render boundary for the builder. The global ErrorBoundary in
// __root.tsx catches a crash anywhere in the tree and replaces the *entire*
// page with a fallback - far too blunt for a page composed of dozens of
// independently-authored sections and widgets. Wrapping each section and each
// widget in this boundary isolates a render crash to the offending node: the
// rest of the page keeps rendering, the error is reported, and the broken node
// degrades to nothing in production (or a compact inline diagnostic in dev).
//
// It is SSR-safe: React renders the fallback when a boundary catches during
// server rendering, so a single malformed widget can no longer 500 the page.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportLovableError } from "@/lib/lovable-error-reporting";

interface Props {
  children: ReactNode;
  /** Human label for diagnostics + error reports, e.g. "section:s1" or "widget:heading:w3". */
  label: string;
  /** Override the rendered fallback. Default: a compact diagnostic in dev, nothing in prod. */
  fallback?: ReactNode;
  /** Force dev/prod fallback behavior. Defaults to import.meta.env.DEV. */
  dev?: boolean;
  /** Error sink. Defaults to Lovable error reporting. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export function isDevEnv(): boolean {
  try {
    return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
  } catch {
    return false;
  }
}

export class RenderErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (this.props.onError) {
      this.props.onError(error, info);
      return;
    }
    reportLovableError(error, {
      boundary: "builder_render_boundary",
      label: this.props.label,
      componentStack: info.componentStack ?? undefined,
    });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    const dev = this.props.dev ?? isDevEnv();
    // Production: keep the page visually clean (no broken box), but DO leave a
    // hidden, zero-layout DOM breadcrumb so a crashed widget is detectable by
    // QA / automated checks / support instead of vanishing without a trace.
    // The error itself is already reported in componentDidCatch.
    if (!dev) {
      return (
        <span
          hidden
          aria-hidden="true"
          data-render-error={this.props.label}
          data-render-error-message={error.message}
        />
      );
    }
    return (
      <div
        data-render-error={this.props.label}
        role="alert"
        style={{
          border: "1px dashed rgba(239,68,68,.6)",
          background: "rgba(239,68,68,.06)",
          color: "#b91c1c",
          font: "500 12px/1.4 ui-monospace, monospace",
          padding: "6px 10px",
          borderRadius: 6,
          margin: "4px 0",
          maxWidth: "100%",
          overflowWrap: "anywhere",
        }}
      >
        <strong>Render error</strong> · {this.props.label}: {error.message}
      </div>
    );
  }
}
