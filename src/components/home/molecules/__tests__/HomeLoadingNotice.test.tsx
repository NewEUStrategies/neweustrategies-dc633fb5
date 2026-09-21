import { act, fireEvent } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { HomeLoadingNotice } from "../HomeLoadingNotice";

const locale = vi.hoisted(() => ({ lang: "pl" as "pl" | "en" }));
vi.mock("@/lib/i18n/localeRuntime", () => ({ currentLang: () => locale.lang }));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
});

it.each([
  ["pl", "Wczytujemy stronę główną", "Spróbuj ponownie"],
  ["en", "Loading the homepage", "Try again"],
] as const)(
  "hydrates the query-free %s fallback without replacing the SSR element",
  async (lang, title, retry) => {
    locale.lang = lang;
    const onRetry = vi.fn();
    const errors: unknown[] = [];
    // Deliberately no QueryClientProvider or router: the shell has no fetch path.
    const view = <HomeLoadingNotice onRetry={onRetry} />;
    container = document.createElement("div");
    container.innerHTML = renderToString(view);
    document.body.appendChild(container);
    const serverElement = container.firstElementChild;
    expect(container.textContent).toContain(title);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    await act(async () => {
      if (!container) throw new Error("missing fixture container");
      root = hydrateRoot(container, view, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    expect(container.firstElementChild).toBe(serverElement);
    const button = container.querySelector("button");
    if (!button) throw new Error("missing retry action");
    expect(button.textContent).toBe(retry);
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledOnce();
  },
);
