// Podgląd pliku w panelu mediów. Do 18.08.2026: 0% ze 161 linii.
//
// Dwie rzeczy, których nie widać nigdzie indziej:
//   1. WYBÓR PRZEGLĄDARKI per typ pliku. Obraz w <img>, wideo w <video>, PDF
//      w ramce, dokument biurowy w ramce ZEWNĘTRZNEJ usługi - i to ostatnie
//      jest decyzją o wysłaniu adresu pliku na obcy serwer, więc musi być
//      ograniczone do dokumentów biurowych i mieć poprawnie zakodowany adres.
//   2. KLUCZ ZAPYTANIA o użycia jest namespace'owany tenantem, a samo zapytanie
//      startuje DOPIERO po otwarciu panelu - bez tego każde otwarcie podglądu
//      uruchamiałoby skan wszystkich wpisów i stron tenanta.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  tenantId: "tenant-1",
  fetchUsage: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useRequiredTenant: () => h.tenantId }));
// Podmieniamy WYŁĄCZNIE `useServerFn` - reszta modułu (m.in.
// `createIsomorphicFn`) jest potrzebna warstwie i18n wciąganej niżej.
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => h.fetchUsage,
}));
vi.mock("@/lib/media.functions", () => ({ getMediaUsage: {} }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import "@/lib/i18n-admin-media";
import { MediaPreviewDialog } from "../MediaPreviewDialog";
import type { MediaRow } from "../../types";

function file(overrides: Partial<MediaRow> = {}): MediaRow {
  return {
    id: "m1",
    tenant_id: "tenant-1",
    storage_path: "t1/u/a.png",
    public_url: "https://cdn.example/a.png",
    filename: "okladka.png",
    mime_type: "image/png",
    size_bytes: 2048,
    uploader_id: "u",
    created_at: "2026-01-15T10:00:00.000Z",
    folder_path: "/",
    alt_text: null,
    ...overrides,
  };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function setup(target: MediaRow | null) {
  const onClose = vi.fn();
  const view = render(<MediaPreviewDialog file={target} onClose={onClose} />, { wrapper });
  return { onClose, view };
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.fetchUsage.mockReset().mockResolvedValue({ items: [] });
  h.tenantId = "tenant-1";
});

describe("MediaPreviewDialog - otwarcie", () => {
  it("bez pliku nie renderuje okna", () => {
    setup(null);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("z plikiem pokazuje jego nazwę w tytule", () => {
    setup(file());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("okladka.png")).toBeInTheDocument();
  });

  it("przycisk zamknięcia zgłasza zamknięcie", () => {
    const { onClose } = setup(file());
    // Radix dokłada własny krzyżyk do nagłówka okna, więc bierzemy przycisk
    // ze stopki - ten, który panel renderuje sam.
    const buttons = screen.getAllByRole("button", { name: "Zamknij" });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("MediaPreviewDialog - przeglądarka per typ pliku", () => {
  it("OBRAZ trafia do znacznika obrazu z opisem alternatywnym", () => {
    setup(file({ alt_text: "Wykres inflacji" }));
    const img = screen.getByAltText("Wykres inflacji");
    expect(img).toHaveAttribute("src", "https://cdn.example/a.png");
  });

  it("obraz bez opisu spada na nazwę pliku", () => {
    setup(file({ alt_text: null }));
    expect(screen.getByAltText("okladka.png")).toBeInTheDocument();
  });

  it("WIDEO dostaje odtwarzacz ze sterowaniem", () => {
    setup(file({ mime_type: "video/mp4", filename: "klip.mp4" }));
    const video = document.querySelector("video");
    expect(video).toBeTruthy();
    expect(video?.hasAttribute("controls")).toBe(true);
  });

  it("AUDIO dostaje odtwarzacz dźwięku, nie obrazu", () => {
    setup(file({ mime_type: "audio/mpeg", filename: "odcinek.mp3" }));
    expect(document.querySelector("audio")).toBeTruthy();
    expect(document.querySelector("video")).toBeNull();
  });

  it("PDF trafia do ramki z włączonym paskiem narzędzi", () => {
    setup(file({ mime_type: "application/pdf", filename: "raport.pdf" }));
    const frame = document.querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("https://cdn.example/a.png#toolbar=1");
  });

  it("DOKUMENT BIUROWY idzie przez ZEWNĘTRZNĄ przeglądarkę z zakodowanym adresem", () => {
    // To jedyny przypadek, w którym adres pliku opuszcza naszą domenę - dlatego
    // musi być poprawnie zakodowany jako parametr, a nie doklejony surowo.
    setup(
      file({
        mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename: "umowa.docx",
        public_url: "https://cdn.example/plik z spacja.docx?v=1",
      }),
    );
    const src = document.querySelector("iframe")?.getAttribute("src") ?? "";
    expect(src.startsWith("https://view.officeapps.live.com/op/embed.aspx?src=")).toBe(true);
    expect(src).toContain(encodeURIComponent("https://cdn.example/plik z spacja.docx?v=1"));
  });

  it("TYP NIEOBSŁUGIWANY mówi wprost, że podglądu nie ma", () => {
    // Pusty obszar wyglądałby jak błąd ładowania; komunikat plus typ pliku
    // mówi użytkownikowi, czego się spodziewać.
    setup(file({ mime_type: "application/x-tar", filename: "paczka.tar" }));
    expect(screen.getByText(/podgląd|preview/i)).toBeInTheDocument();
    expect(screen.getByText("application/x-tar")).toBeInTheDocument();
  });

  it("plik bez typu pokazuje ROZSZERZENIE wielkimi literami", () => {
    setup(file({ mime_type: null, filename: "dane.bin" }));
    expect(screen.getByText("BIN")).toBeInTheDocument();
  });
});

describe("MediaPreviewDialog - panel użyć", () => {
  it("panel startuje ZAMKNIĘTY i NIE odpala zapytania", () => {
    // Skan użyć przechodzi po wszystkich wpisach i stronach tenanta - nie może
    // ruszać przy każdym otwarciu podglądu.
    setup(file());
    expect(h.fetchUsage).not.toHaveBeenCalled();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("otwarcie panelu URUCHAMIA zapytanie dla tego pliku", async () => {
    setup(file());
    fireEvent.click(screen.getByRole("button", { name: "Gdzie wykorzystywane" }));
    await waitFor(() => expect(h.fetchUsage).toHaveBeenCalledWith({ data: { mediaId: "m1" } }));
  });

  it("klucz cache jest namespace'owany TENANTEM i plikiem", async () => {
    // Wspólny klucz pokazałby wyniki skanu jednej przestrzeni roboczej
    // w drugiej - z cache'u, bez żadnego żądania.
    setup(file());
    fireEvent.click(screen.getByRole("button", { name: "Gdzie wykorzystywane" }));
    await waitFor(() =>
      expect(queryClient.getQueryData(["media-usage", "tenant-1", "m1"])).toBeDefined(),
    );
    expect(queryClient.getQueryData(["media-usage", "tenant-2", "m1"])).toBeUndefined();
  });

  it("przycisk panelu ma stan wciśnięcia dla czytnika ekranu", () => {
    setup(file());
    const toggle = screen.getByRole("button", { name: "Gdzie wykorzystywane" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("panel da się zamknąć własnym krzyżykiem", () => {
    setup(file());
    fireEvent.click(screen.getByRole("button", { name: "Gdzie wykorzystywane" }));
    expect(screen.getByRole("complementary")).toBeInTheDocument();

    const close = screen.getAllByRole("button", { name: "Zamknij" })[0];
    fireEvent.click(close);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("panel ZAMYKA SIĘ po zamknięciu podglądu - nie zostaje otwarty na następny plik", () => {
    const { view } = setup(file());
    fireEvent.click(screen.getByRole("button", { name: "Gdzie wykorzystywane" }));
    expect(screen.getByRole("complementary")).toBeInTheDocument();

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <MediaPreviewDialog file={null} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <MediaPreviewDialog file={file({ id: "m2" })} onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

describe("MediaPreviewDialog - akcje na pliku", () => {
  it("odnośnik do nowej karty jest zabezpieczony przed przejęciem okna", () => {
    setup(file());
    const external = screen.getAllByRole("link").find((a) => a.getAttribute("target") === "_blank");
    expect(external).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("pobieranie proponuje ORYGINALNĄ nazwę pliku, nie klucz w buckecie", () => {
    // Bez atrybutu `download` przeglądarka zapisałaby plik pod nazwą z adresu,
    // czyli pod losowym kluczem storage.
    setup(file());
    const download = screen.getAllByRole("link").find((a) => a.hasAttribute("download"));
    expect(download).toHaveAttribute("download", "okladka.png");
    expect(download).toHaveAttribute("href", "https://cdn.example/a.png");
  });
});
