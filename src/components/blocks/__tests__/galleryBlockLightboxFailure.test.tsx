// Leniwy lightbox galerii (`GalleryBlock`): nieudane pobranie chunku nie zabiera miniatur,
// oddaje błąd siatce cache-bustingu, a następne kliknięcie ponawia import.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ fail: true, attempts: 0, reported: [] as unknown[] }));

vi.mock("@/components/Lightbox", () => {
  state.attempts += 1;
  if (state.fail) {
    throw new TypeError("Failed to fetch dynamically imported module: /assets/Lightbox-old.js");
  }
  return {
    ImageLightbox: ({ open }: { open: boolean }) =>
      open ? <div role="dialog" aria-label="lightbox" /> : null,
  };
});

vi.mock("@/lib/cacheBusting", () => ({
  handleChunkLoadFailure: (reason: unknown) => void state.reported.push(reason),
}));

vi.mock("@/components/atoms/OptimizedImage", () => ({
  OptimizedImage: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

const { GalleryBlock } = await import("../GalleryBlock");

const IMAGES = [
  { url: "https://cdn.example.com/a.jpg", alt: "Pierwsze" },
  { url: "https://cdn.example.com/b.jpg", alt: "Drugie" },
];

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

afterEach(() => cleanup());

it("porażka chunku: miniatury zostają, błąd idzie do cache-bustingu, ponowienie działa", async () => {
  render(<GalleryBlock images={IMAGES} />);
  fireEvent.click(screen.getByRole("button", { name: "Drugie" }));
  await flush();

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getAllByRole("button")).toHaveLength(2);
  // Vitest owija błąd fabryki atrapy własnym komunikatem - liczy się, że błąd dotarł do siatki.
  await vi.waitFor(() => expect(state.reported).toHaveLength(1));

  state.fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Pierwsze" }));
  await flush();
  expect(await screen.findByRole("dialog", { name: "lightbox" })).toBeTruthy();
  expect(state.attempts).toBeGreaterThanOrEqual(2);
});
