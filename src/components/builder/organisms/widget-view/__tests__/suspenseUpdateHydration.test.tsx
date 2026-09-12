import { lazy, useEffect, useState, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "@testing-library/react";
import { expect, it } from "vitest";
import { withSuspense } from "../lazySuspense";

it("unrelated parent updates retain the pending SSR form with unchanged props", async () => {
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
        <Widget title="Contact" />
      </main>
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
    host.remove();
  }
});
