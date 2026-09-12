import { lazy, Suspense, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import "@/test/i18nReal";
import { BuilderRenderer } from "../BuilderRenderer";
import { doc, simpleSection, setWindowWidth, stubObservers } from "./builderRendererFixtures";

const leaf = vi.hoisted(() => ({ current: null as ComponentType<{ device: string }> | null }));
vi.mock("../WidgetView", async () => ({
  ...(await import("../widget-view/frame")),
  WidgetView: ({ device }: { device: string }) => {
    const Form = leaf.current!;
    return (
      <Suspense fallback={null}>
        <Form device={device} />
      </Suspense>
    );
  },
}));
vi.mock("../widget-view/warmWidgetChunks", () => ({ warmCommonWidgetChunks: () => {} }));

it.each([1280, 390])(
  "retains a pending SSR widget through the initial %i px viewport update",
  async (width) => {
    const oldWidth = window.innerWidth;
    const observers = stubObservers();
    setWindowWidth(width);
    const queryClient = new QueryClient();
    const document = doc([simpleSection("form")]);
    function Form({ device }: { device: string }) {
      return (
        <form data-form-device={device}>
          <input aria-label="Message" />
        </form>
      );
    }
    const view = () => (
      <QueryClientProvider client={queryClient}>
        <BuilderRenderer doc={document} lang="pl" />
      </QueryClientProvider>
    );
    leaf.current = Form;
    const host = window.document.createElement("div");
    host.innerHTML = renderToString(view());
    window.document.body.append(host);
    const original = host.querySelector("form");
    let release!: (module: { default: typeof Form }) => void;
    const pending = new Promise<{ default: typeof Form }>((resolve) => {
      release = resolve;
    });
    leaf.current = lazy(() => pending);
    const errors: unknown[] = [];
    const root = hydrateRoot(host, view(), { onRecoverableError: (error) => errors.push(error) });
    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 350));
      });
      expect(original?.isConnected).toBe(true);
      await act(async () => {
        release({ default: Form });
        await pending;
      });
      expect(host.querySelector("form")).toBe(original);
      expect(errors).toEqual([]);
      expect(original?.getAttribute("data-form-device")).toBe(width < 768 ? "mobile" : "desktop");
    } finally {
      release({ default: Form });
      await act(async () => root.unmount());
      queryClient.clear();
      host.remove();
      leaf.current = null;
      observers.restore();
      setWindowWidth(oldWidth);
    }
  },
);
