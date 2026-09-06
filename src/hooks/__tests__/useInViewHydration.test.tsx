import { lazy, Suspense, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useInView } from "../use-in-view";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "keeps the SSR widget when the animation ref is absent (enabled=%s)",
  async (enabled) => {
    function Content() {
      return <article>Server article</article>;
    }
    function Frame({ Widget }: { Widget: ComponentType }) {
      // WidgetView leaves the ref detached when this widget has no animation.
      useInView({ enabled });
      return (
        <Suspense fallback={null}>
          <Widget />
        </Suspense>
      );
    }
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Frame Widget={Content} />);
    document.body.append(container);
    const original = container.querySelector("article");
    let release!: (module: { default: ComponentType }) => void;
    const pending = new Promise<{ default: ComponentType }>((resolve) => {
      release = resolve;
    });
    const Widget = lazy(() => pending);
    const errors: unknown[] = [];
    const root = hydrateRoot(container, <Frame Widget={Widget} />, {
      onRecoverableError: (e) => errors.push(e),
    });
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
      container.remove();
    }
  },
);

it.each([false, true])("observes visibility, honors once=%s and disconnects on unmount", (once) => {
  let notify!: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  function Probe() {
    const { ref, inView } = useInView<HTMLDivElement>({ once });
    return (
      <div ref={ref} data-testid="visibility">
        {String(inView)}
      </div>
    );
  }
  const rendered = render(<Probe />);
  const intersect = (isIntersecting: boolean) =>
    act(() =>
      notify([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver),
    );
  expect(screen.getByTestId("visibility")).toHaveTextContent("false");
  intersect(true);
  expect(screen.getByTestId("visibility")).toHaveTextContent("true");
  intersect(false);
  expect(screen.getByTestId("visibility")).toHaveTextContent(String(once));
  rendered.unmount();
  expect(disconnect).toHaveBeenCalled();
});
