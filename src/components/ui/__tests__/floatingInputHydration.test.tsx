import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { FloatingInput, FloatingTextarea } from "../floating-input";

it("keeps generated labels and error references stable across requests and hydration", async () => {
  const form = (
    <form>
      <FloatingInput label="Name" error="Required" />
      <FloatingTextarea label="Message" error="Too short" />
      <FloatingInput id="email" label="Email" />
    </form>
  );
  const html = renderToString(form);
  // Another server request must not advance a process-wide ID counter.
  expect(renderToString(form)).toBe(html);
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  const fields = [
    ...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
  ];
  const ids = fields.map((field) => field.id);
  expect(new Set(ids).size).toBe(3);
  const errors: unknown[] = [];
  const consoleError = vi.spyOn(console, "error").mockImplementation((error) => errors.push(error));
  const root = hydrateRoot(host, form, { onRecoverableError: (error) => errors.push(error) });
  try {
    await act(async () => {});
    expect(errors).toEqual([]);
    expect([...host.querySelectorAll("input, textarea")]).toEqual(fields);
    expect(fields.map((field) => field.id)).toEqual(ids);
    for (const field of fields) {
      expect(field.labels?.[0]?.htmlFor).toBe(field.id);
      const errorId = field.getAttribute("aria-describedby");
      if (errorId) expect(document.getElementById(errorId)?.getAttribute("role")).toBe("alert");
    }
    expect(fields[2].id).toBe("email");
  } finally {
    await act(async () => root.unmount());
    consoleError.mockRestore();
    host.remove();
  }
});
