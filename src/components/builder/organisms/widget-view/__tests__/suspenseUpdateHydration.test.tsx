import { lazy, useEffect, useState, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { withSuspense } from "../lazySuspense";
import { ThemeProvider, useTheme } from "@/components/ThemeProvider";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

it.each(["none", "theme", "auth"])(
  "unrelated parent updates retain the pending SSR form (provider=%s)",
  async (provider) => {
    const queryClient = new QueryClient();
    function Form({ title }: { title: string }) {
      return (
        <form aria-label={title}>
          <input />
        </form>
      );
    }
    function Page({ Widget }: { Widget: ComponentType<{ title: string }> }) {
      const [ready, setReady] = useState(false);
      useEffect(() => {
        setReady(true);
      }, []);
      return (
        <main data-ready={ready}>
          {provider === "theme" ? (
            <ThemeProvider>
              <ThemedWidget Widget={Widget} />
            </ThemeProvider>
          ) : provider === "auth" ? (
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <AuthWidget Widget={Widget} />
              </AuthProvider>
            </QueryClientProvider>
          ) : (
            <Widget title="Contact" />
          )}
        </main>
      );
    }
    function ThemedWidget({ Widget }: { Widget: ComponentType<{ title: string }> }) {
      const { theme } = useTheme();
      return (
        <div data-theme={theme}>
          <Widget title="Contact" />
        </div>
      );
    }
    function AuthWidget({ Widget }: { Widget: ComponentType<{ title: string }> }) {
      const { loading } = useAuth();
      return (
        <div data-loading={loading}>
          <Widget title="Contact" />
        </div>
      );
    }
    const host = document.createElement("div");
    host.innerHTML = renderToString(<Page Widget={withSuspense(Form)} />);
    document.body.append(host);
    const original = host.querySelector("form");
    let release!: (module: { default: typeof Form }) => void;
    const pending = new Promise<{ default: typeof Form }>((resolve) => {
      release = resolve;
    });
    const Widget = withSuspense(lazy(() => pending));
    const errors: unknown[] = [];
    const root = hydrateRoot(host, <Page Widget={Widget} />, {
      onRecoverableError: (error) => errors.push(error),
    });
    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350));
      });
      expect(host.querySelector("main")?.dataset.ready).toBe("true");
      expect(original?.isConnected).toBe(true);
      await act(async () => {
        release({ default: Form });
        await pending;
      });
      expect(host.querySelector("form")).toBe(original);
      expect(errors).toEqual([]);
    } finally {
      release({ default: Form });
      await act(async () => root.unmount());
      queryClient.clear();
      host.remove();
    }
  },
);
