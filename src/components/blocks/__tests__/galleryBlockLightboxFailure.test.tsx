// Leniwy lightbox galerii (`GalleryBlock`): nieudane pobranie chunku nie zabiera miniatur,
// zamyka lightbox (kolejne kliknięcie - także w tę samą miniaturę - ponawia import), oddaje
// chunk-load error siatce cache-bustingu, a inny błąd raportowi platformy. Porażka rozgrzania
// (najechanie) trafia do pierwszego otwarcia, zamiast montować lightbox bez arkusza.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fail: true,
  chunkError: true,
  attempts: 0,
  reloads: [] as unknown[],
  reports: [] as unknown[],
}));

// Vitest owija błąd fabryki atrapy własnym komunikatem, więc klasyfikację błędu steruje test.
vi.mock("@/lib/cacheBusting", () => ({
  looksLikeChunkLoadError: () => state.chunkError,
  handleChunkLoadFailure: (reason: unknown) => void state.reloads.push(reason),
}));

vi.mock("@/lib/platform-error-reporting", () => ({
  reportPlatformError: (_error: unknown, context: unknown) => void state.reports.push(context),
}));

vi.mock("@/components/atoms/OptimizedImage", () => ({
  OptimizedImage: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

const IMAGES = [
  { url: "https://cdn.example.com/a.jpg", alt: "Pierwsze" },
  { url: "https://cdn.example.com/b.jpg", alt: "Drugie" },
];

/** Atrapa chunku lightboxa: rzuca, dopóki `state.fail`, jak `import()` brakującego pliku. */
function lightboxModule() {
  state.attempts += 1;
  if (state.fail) {
    throw new TypeError("Failed to fetch dynamically imported module: /assets/Lightbox-old.js");
  }
  return {
    ImageLightbox: ({ open }: { open: boolean }) =>
      open ? <div role="dialog" aria-label="lightbox" /> : null,
  };
}

/**
 * Świeży moduł galerii i świeża atrapa lightboxa na test: `lazy`, porażka rozgrzania i znacznik
 * wczytania żyją na poziomie modułu, a udany import atrapy zostałby w rejestrze między testami.
 */
async function gallery() {
  vi.resetModules();
  vi.doMock("@/components/Lightbox", lightboxModule);
  return (await import("../GalleryBlock")).GalleryBlock;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  state.fail = true;
  state.chunkError = true;
  state.attempts = 0;
  state.reloads = [];
  state.reports = [];
});

afterEach(() => cleanup());

it("porażka chunku: miniatury zostają, siatka dostaje błąd, ponowny klik w TĘ SAMĄ miniaturę otwiera", async () => {
  const GalleryBlock = await gallery();
  render(<GalleryBlock images={IMAGES} />);
  fireEvent.click(screen.getByRole("button", { name: "Drugie" }));
  await flush();

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getAllByRole("button")).toHaveLength(2);
  await vi.waitFor(() => expect(state.reloads).toHaveLength(1));
  expect(state.reports).toEqual([]);

  state.fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Drugie" }));
  expect(await screen.findByRole("dialog", { name: "lightbox" })).toBeTruthy();
});

it("po porażce ponowny render rodzica NIE otwiera lightboxa sam z siebie", async () => {
  const GalleryBlock = await gallery();
  const view = render(<GalleryBlock images={IMAGES} />);
  fireEvent.click(screen.getByRole("button", { name: "Pierwsze" }));
  await flush();
  await vi.waitFor(() => expect(state.reloads).toHaveLength(1));

  // Bez ponowienia w tle: zamknięty, niewczytany lightbox nie jest renderowany - jedna próba
  // na kliknięcie, więc i jeden raport.
  state.fail = false;
  view.rerender(<GalleryBlock images={[...IMAGES]} />);
  await flush();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(state.attempts).toBe(1);
  expect(state.reloads).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: "Pierwsze" }));
  expect(await screen.findByRole("dialog", { name: "lightbox" })).toBeTruthy();
});

it("błąd spoza ładowania chunku idzie do raportu platformy, nie do przeładowania", async () => {
  state.chunkError = false;
  const GalleryBlock = await gallery();
  render(<GalleryBlock images={IMAGES} />);
  fireEvent.click(screen.getByRole("button", { name: "Pierwsze" }));
  await flush();

  await vi.waitFor(() => expect(state.reports).toEqual([{ label: "block:gallery:lightbox" }]));
  expect(state.reloads).toEqual([]);
  expect(screen.getAllByRole("button")).toHaveLength(2);
});

it("porażka rozgrzania trafia do kliknięcia - bez montażu lightboxa bez arkusza", async () => {
  const GalleryBlock = await gallery();
  render(<GalleryBlock images={IMAGES} />);
  fireEvent.pointerEnter(screen.getByRole("button", { name: "Drugie" }));
  await flush();
  expect(state.reloads).toEqual([]);

  // Sieć wróciła, ale pomocnik Vite nie ponowiłby arkusza: kliknięcie ma dostać błąd rozgrzania.
  state.fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Drugie" }));
  await flush();
  expect(screen.queryByRole("dialog")).toBeNull();
  await vi.waitFor(() => expect(state.reloads).toHaveLength(1));

  fireEvent.click(screen.getByRole("button", { name: "Drugie" }));
  expect(await screen.findByRole("dialog", { name: "lightbox" })).toBeTruthy();
});
