// Ziarnista granica renderu dla treści składanej z wielu niezależnie
// redagowanych węzłów - używana przez OBA silniki treści (sekcje i widgety
// buildera, bloki edytora bloków, sekcje strumieniowane w SSR). Globalny
// ErrorBoundary z `__root.tsx` łapie wywrotkę gdziekolwiek w drzewie i
// podmienia CAŁĄ stronę na fallback - stanowczo za grubo dla strony złożonej
// z kilkudziesięciu węzłów. Owinięcie każdego węzła tą granicą izoluje
// wywrotkę do winowajcy: reszta strony renderuje się dalej, błąd jest
// raportowany, a zepsuty węzeł degraduje do niczego na produkcji (albo do
// zwięzłej diagnostyki inline w dev).
//
// Moduł mieszka w `components/error`, a nie pod builderem, bo `components/blocks`
// też go potrzebuje - trzymanie go w drzewie buildera było jedną z krawędzi
// cyklu `bloki <-> builder` (patrz `src/lib/content-model/README.md`).
// Etykieta raportu (`boundary: "builder_render_boundary"`) zostaje bez zmian
// świadomie: to nazwa istniejącego sygnału telemetrycznego, a ciągłość serii
// pomiarowej jest warta więcej niż zgodność nazwy z nową ścieżką pliku.
//
// It is SSR-safe: React renders the fallback when a boundary catches during
// server rendering, so a single malformed widget can no longer 500 the page.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportPlatformError } from "@/lib/platform-error-reporting";

interface Props {
  children: ReactNode;
  /** Human label for diagnostics + error reports, e.g. "section:s1" or "widget:heading:w3". */
  label: string;
  /** Override the rendered fallback. Default: a compact diagnostic in dev, nothing in prod. */
  fallback?: ReactNode;
  /** Force dev/prod fallback behavior. Defaults to import.meta.env.DEV. */
  dev?: boolean;
  /** Error sink. Defaults to the platform error reporting bridge. */
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

  // A transient render throw (e.g. a bad value mid-edit in the builder) must
  // not hide the node forever: retry whenever the parent re-renders us with
  // fresh children (doc mutation, undo, fixed content). If the error persists
  // the boundary simply catches again — no retry loop.
  componentDidUpdate(prevProps: Props): void {
    if (this.state.error && prevProps.children !== this.props.children) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (this.props.onError) {
      this.props.onError(error, info);
      return;
    }
    reportPlatformError(error, {
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
