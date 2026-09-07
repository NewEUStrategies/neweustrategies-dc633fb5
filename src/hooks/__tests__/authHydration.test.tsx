import { lazy, Suspense, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  },
}));
vi.mock("@/lib/personalization/anonMerge", () => ({
  hasAnonPersonalization: () => false,
  mergeAnonPersonalization: async () => {},
}));

import { AuthProvider, useAuth } from "../useAuth";

it("retains server content when the initial anonymous session settles before a widget chunk", async () => {
  function Content() {
    useAuth();
    return <article>Server article</article>;
  }
  function Frame({ Widget }: { Widget: ComponentType }) {
    useAuth();
    return (
      <Suspense fallback={null}>
        <Widget />
      </Suspense>
    );
  }
  const queryClient = new QueryClient();
  const view = (Widget: ComponentType) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Frame Widget={Widget} />
      </AuthProvider>
    </QueryClientProvider>
  );
  const container = document.createElement("div");
  container.innerHTML = renderToString(view(Content));
  document.body.append(container);
  const original = container.querySelector("article");
  let release!: (module: { default: ComponentType }) => void;
  const pending = new Promise<{ default: ComponentType }>((resolve) => {
    release = resolve;
  });
  const Widget = lazy(() => pending);
  const errors: unknown[] = [];
  const root = hydrateRoot(container, view(Widget), { onRecoverableError: (e) => errors.push(e) });
  try {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(original?.isConnected).toBe(true);
    await act(async () => {
      release({ default: Content });
      await pending;
    });
    expect(container.querySelector("article")).toBe(original);
    expect(errors).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  }
});
