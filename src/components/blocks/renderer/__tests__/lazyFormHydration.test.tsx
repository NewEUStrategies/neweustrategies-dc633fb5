import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { renderToPipeableStream } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { ContactFormView } from "../lazyBlockViews";
import { BlocksRenderer } from "../../BlocksRenderer";
import type { BlocksDoc } from "@/lib/blocks/types";

// Only the server/network boundary is replaced. The lazy loader and the
// extracted contact form, its fields and its handlers are real.
const submit = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/lib/contact.functions", () => ({ submitContactMessage: submit }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => submit,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("lazy form SSR and hydration", () => {
  it("includes the real form in completed SSR and hydrates the existing DOM", async () => {
    const view = (
      <div>
        <h1>Article remains readable</h1>
        <ContactFormView lang="en" title="Contact our team" requireConsent={false} />
        <p>Content after the form</p>
      </div>
    );
    const errors: unknown[] = [];
    const sink = new PassThrough();
    let html = "";
    sink.on("data", (chunk: Buffer) => {
      html += chunk.toString();
    });
    const complete = new Promise<void>((resolve, reject) => {
      sink.on("end", resolve);
      sink.on("error", reject);
    });
    const stream = renderToPipeableStream(view, {
      onAllReady() {
        stream.pipe(sink);
      },
      onError(error) {
        errors.push(error);
      },
      onShellError(error) {
        sink.destroy(error instanceof Error ? error : new Error(String(error)));
      },
    });
    await complete;
    expect(errors).toEqual([]);
    expect(html).toContain("Article remains readable");
    expect(html).toContain("Contact our team");
    expect(html).toContain("<form");
    expect(html).toContain("Content after the form");

    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    const originalForm = host.querySelector("form");
    const originalHeading = host.querySelector("h1");
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(host, view, { onRecoverableError: (error) => errors.push(error) });
      });
      expect(errors).toEqual([]);
      expect(host.querySelector("form")).toBe(originalForm);
      expect(host.querySelector("h1")).toBe(originalHeading);
      const name = host.querySelector<HTMLInputElement>('input[autocomplete="name"]');
      const email = host.querySelector<HTMLInputElement>('input[type="email"]');
      const message = host.querySelector("textarea");
      if (!name || !email || !message || !originalForm) throw new Error("SSR form missing fields");
      fireEvent.change(name, { target: { value: "Reader" } });
      fireEvent.change(email, { target: { value: "reader@example.org" } });
      fireEvent.change(message, { target: { value: "A hydrated message" } });
      fireEvent.submit(originalForm);
      await waitFor(() => expect(submit).toHaveBeenCalledOnce());
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Reader",
            email: "reader@example.org",
            message: "A hydrated message",
            lang: "en",
          }),
        }),
      );
    } finally {
      await act(async () => root?.unmount());
      host.remove();
    }
  });

  it("renders a contact block inside a nested group alongside article text", async () => {
    const doc: BlocksDoc = {
      version: 1,
      blocks: [
        {
          id: "group",
          type: "group",
          data: {
            children: [
              { id: "before", type: "paragraph", data: { html: "Visible article" } },
              { id: "contact", type: "contact-form", data: { title: "Nested contact" } },
            ],
          },
        },
      ],
    };
    const { container } = render(<BlocksRenderer doc={doc} lang="en" />);
    expect(container.textContent).toContain("Visible article");
    await waitFor(() => expect(container.querySelector("form")).not.toBeNull());
    expect(container.textContent).toContain("Nested contact");
  });
});
