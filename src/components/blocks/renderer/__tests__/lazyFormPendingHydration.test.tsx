import { Suspense, useEffect, useState, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ContactFormView } from "../lazyBlockViews";

const load = vi.hoisted(() => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pending, release };
});
vi.mock("../../MarketingContactFormView", async () => {
  await load.pending;
  return {
    ContactFormView: ({ title }: { title?: string }) => (
      <form aria-label={title}>
        <input />
      </form>
    ),
  };
});

it("an unrelated parent update retains a Gutenberg form while its import is pending", async () => {
  function Page({ Widget }: { Widget: ComponentType<{ title: string; lang: "en" }> }) {
    const [ready, setReady] = useState(false);
    useEffect(() => {
      setReady(true);
    }, []);
    return (
      <main data-ready={ready}>
        <Widget title="Contact" lang="en" />
      </main>
    );
  }
  function ServerForm({ title }: { title: string }) {
    return (
      <Suspense fallback={null}>
        <form aria-label={title}>
          <input />
        </form>
      </Suspense>
    );
  }
  const host = document.createElement("div");
  host.innerHTML = renderToString(<Page Widget={ServerForm} />);
  document.body.append(host);
  const original = host.querySelector("form");
  const errors: unknown[] = [];
  const root = hydrateRoot(host, <Page Widget={ContactFormView} />, {
    onRecoverableError: (error) => errors.push(error),
  });
  try {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(host.querySelector("main")?.dataset.ready).toBe("true");
    expect(original?.isConnected).toBe(true);
    await act(async () => {
      load.release();
      await load.pending;
    });
    expect(host.querySelector("form")).toBe(original);
    expect(errors).toEqual([]);
  } finally {
    load.release();
    await act(async () => root.unmount());
    host.remove();
  }
});
