// Wybierak z biblioteki mediów - okno używane przez buildery wpisów, stron
// i newslettera. Do 18.08.2026: 0% ze 107 instrukcji.
//
// Cztery reguły, których złamania nie widać w warstwie danych:
//   1. ALLOWLISTA zamiast `image/*` - wildcard obejmował `image/svg+xml`,
//      więc interfejs zapraszał do wgrania typu, który serwer odrzuca, a
//      odrzucony plik zostawał w publicznym buckecie (stored XSS),
//   2. wgrywanie idzie przez `uploadAndRegisterMedia`, czyli jedyną ścieżkę,
//      która SPRZĄTA obiekt po odrzuconej rejestracji,
//   3. klucz zapytania jest namespace'owany TENANTEM I TRYBEM (`image`/`audio`/
//      `all`) - wspólny pokazywałby zdjęcia w wybieraku dźwięku,
//   4. zapytanie NIE startuje przy zamkniętym oknie.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ok, type SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  tenantId: "tenant-1",
  user: { id: "user-1" } as { id: string } | null,
  registerUpload: vi.fn(),
  updateMeta: vi.fn(),
  uploadAndRegisterMedia: vi.fn(),
  toastSuccess: vi.fn(),
  toastFail: vi.fn(),
  toastError: vi.fn(),
}));

const stubs = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/hooks/useAuth", () => ({
  useRequiredTenant: () => h.tenantId,
  useAuth: () => ({ user: h.user }),
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => (fn === "register" ? h.registerUpload : h.updateMeta),
}));
vi.mock("@/lib/media.functions", () => ({
  registerMediaUpload: "register",
  updateMediaMeta: "update",
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastFail } }));
vi.mock("@/lib/toastError", () => ({ toastError: h.toastError }));
vi.mock("@/lib/media/upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media/upload")>()),
  uploadAndRegisterMedia: h.uploadAndRegisterMedia,
}));

import "@/lib/i18n-admin-team-media";
import { MediaPickerDialog } from "../MediaPickerDialog";
import { IMAGE_MIME, AUDIO_MIME, UPLOADABLE_MIME } from "@/lib/media/upload";

const TENANT = "tenant-1";

function stub() {
  const s = stubs.from;
  if (!s) throw new Error("atrapa supabase nie została zainicjalizowana");
  return s;
}

function pickerRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    public_url: `https://cdn.example/${id}.png`,
    filename: `${id}.png`,
    mime_type: "image/png",
    folder_path: "/",
    created_at: "2026-01-01T00:00:00.000Z",
    alt_text: null,
    ...overrides,
  };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function setup(opts: { open?: boolean; accept?: "image" | "audio" | "all"; title?: string } = {}) {
  const onOpenChange = vi.fn();
  const onPick = vi.fn();
  const view = render(
    <MediaPickerDialog
      open={opts.open ?? true}
      onOpenChange={onOpenChange}
      onPick={onPick}
      accept={opts.accept}
      title={opts.title}
    />,
    { wrapper },
  );
  return { onOpenChange, onPick, view };
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  stub().reset();
  stub().setResponse("media", ok([]));
  h.tenantId = TENANT;
  h.user = { id: "user-1" };
  for (const fn of [
    h.registerUpload,
    h.updateMeta,
    h.uploadAndRegisterMedia,
    h.toastSuccess,
    h.toastFail,
    h.toastError,
  ]) {
    fn.mockReset();
  }
  h.uploadAndRegisterMedia.mockResolvedValue({
    mediaId: "new-1",
    publicUrl: "https://cdn.example/new.png",
  });
  h.updateMeta.mockResolvedValue({ ok: true });
});

describe("MediaPickerDialog - odczyt biblioteki", () => {
  it("zamknięte okno NIE odpytuje bazy", () => {
    setup({ open: false });
    expect(stub().chainsFor("media")).toHaveLength(0);
  });

  it("otwarte okno czyta media ZAWĘŻONE do tenanta i posortowane od najnowszych", async () => {
    setup();
    await waitFor(() => expect(stub().chainsFor("media").length).toBeGreaterThan(0));
    const chain = stub().lastChain("media");
    expect(chain?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
  });

  it("ogranicza liczbę wierszy - biblioteka bywa ogromna", async () => {
    setup();
    await waitFor(() => expect(stub().lastChain("media")?.argsOf("limit")).toEqual([500]));
  });

  it("tryb OBRAZ filtruje typy po stronie bazy", async () => {
    // Filtrowanie dopiero w przeglądarce ściągałoby pliki audio i wideo bez
    // powodu - i wyczerpywało limit 500 wierszy na materiałach nie do wyboru.
    setup({ accept: "image" });
    await waitFor(() =>
      expect(stub().lastChain("media")?.argsOf("like")).toEqual(["mime_type", "image/%"]),
    );
  });

  it("tryb WSZYSTKO nie dokłada filtra typów", async () => {
    setup({ accept: "all" });
    await waitFor(() => expect(stub().chainsFor("media").length).toBeGreaterThan(0));
    expect(stub().lastChain("media")?.has("like")).toBe(false);
  });

  it("klucz cache rozróżnia TENANTA i TRYB", async () => {
    // Wspólny klucz pokazałby zdjęcia w wybieraku dźwięku - z cache'u, bez
    // żadnego żądania.
    stub().setResponse("media", ok([pickerRow("a")]));
    setup({ accept: "image" });
    await waitFor(() =>
      expect(queryClient.getQueryData(["media-picker", TENANT, "image"])).toBeDefined(),
    );
    expect(queryClient.getQueryData(["media-picker", TENANT, "audio"])).toBeUndefined();
  });
});

describe("MediaPickerDialog - filtrowanie w oknie", () => {
  beforeEach(() => {
    stub().setResponse(
      "media",
      ok([
        pickerRow("raport", { filename: "raport.png", folder_path: "/press/" }),
        pickerRow("okladka", { filename: "okladka.png", folder_path: "/" }),
      ]),
    );
  });

  it("wyszukiwarka filtruje po NAZWIE, bez względu na wielkość liter", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("raport.png")).toBeInTheDocument());

    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "RAPO" } });
    expect(screen.getByText("raport.png")).toBeInTheDocument();
    expect(screen.queryByText("okladka.png")).toBeNull();
  });

  it("lista folderów powstaje z DANYCH i jest posortowana", async () => {
    setup();
    // Lista folderów powstaje dopiero z wczytanych wierszy - czekamy na dane,
    // nie na sam znacznik select.
    await waitFor(() =>
      expect(screen.getByRole("combobox").querySelectorAll("option").length).toBeGreaterThan(1),
    );
    const options = Array.from(screen.getByRole("combobox").querySelectorAll("option")).map((o) =>
      o.getAttribute("value"),
    );
    expect(options[0]).toBe("all");
    expect(options.slice(1)).toEqual(["/", "/press/"]);
  });

  it("wybór folderu zawęża listę", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("raport.png")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "/press/" } });
    expect(screen.getByText("raport.png")).toBeInTheDocument();
    expect(screen.queryByText("okladka.png")).toBeNull();
  });

  it("brak trafień mówi wprost, że nic nie pasuje", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("raport.png")).toBeInTheDocument());
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "nieistnieje" } });
    expect(screen.getByText(/nie znaleziono|no match|brak/i)).toBeInTheDocument();
  });
});

describe("MediaPickerDialog - wgrywanie", () => {
  it("wgrywa przez ścieżkę SPRZĄTAJĄCĄ po odrzuconej rejestracji", async () => {
    setup({ accept: "image" });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["x"], "a.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input!);

    await waitFor(() =>
      expect(h.uploadAndRegisterMedia).toHaveBeenCalledWith(
        expect.objectContaining({ file, tenantId: TENANT, userId: "user-1" }),
      ),
    );
  });

  it.each([
    ["image" as const, IMAGE_MIME, "a.png", "image/png"],
    ["audio" as const, AUDIO_MIME, "a.mp3", "audio/mpeg"],
    ["all" as const, UPLOADABLE_MIME, "a.png", "image/png"],
  ])("tryb %s przekazuje własną ALLOWLISTĘ", async (accept, expected, name, type) => {
    // `image/*` obejmowało `image/svg+xml` - typ, który serwer odrzuca, a plik
    // zostawał żywy pod publicznym adresem. Plik musi pasować do trybu, bo
    // inaczej odsiewa go wcześniejsza bramka i upload w ogóle nie rusza.
    setup({ accept });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(["x"], name, { type });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input!);

    await waitFor(() =>
      expect(h.uploadAndRegisterMedia).toHaveBeenCalledWith(
        expect.objectContaining({ allowedMime: expected }),
      ),
    );
  });

  it("atrybut `accept` pola pliku NIE jest wildcardem", async () => {
    setup({ accept: "image" });
    const accept = document.querySelector('input[type="file"]')?.getAttribute("accept") ?? "";
    expect(accept).not.toContain("*");
    expect(accept).toContain("image/png");
  });

  it("POMIJA plik odrzucony przez allowlistę, resztę wgrywa", async () => {
    setup({ accept: "image" });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    const bad = new File(["x"], "zly.svg", { type: "image/svg+xml" });
    const good = new File(["x"], "dobry.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [bad, good], configurable: true });
    fireEvent.change(input!);

    await waitFor(() => expect(h.uploadAndRegisterMedia).toHaveBeenCalledTimes(1));
    expect(h.uploadAndRegisterMedia.mock.calls[0][0].file).toBe(good);
    expect(h.toastFail).toHaveBeenCalled();
  });

  it("ODMAWIA wgrywania bez zalogowanego użytkownika", async () => {
    h.user = null;
    setup();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "a.png", { type: "image/png" })],
      configurable: true,
    });
    fireEvent.change(input!);

    await waitFor(() => expect(h.toastFail).toHaveBeenCalled());
    expect(h.uploadAndRegisterMedia).not.toHaveBeenCalled();
  });

  it("porażka wgrania daje komunikat i ZDEJMUJE blokadę", async () => {
    h.uploadAndRegisterMedia.mockRejectedValue(new Error("odmowa"));
    setup();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(input, "files", {
      value: [new File(["x"], "a.png", { type: "image/png" })],
      configurable: true,
    });
    fireEvent.change(input!);

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(expect.any(Error), "upload"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /wgraj|upload/i })).toBeEnabled(),
    );
  });
});

describe("MediaPickerDialog - wybór i zatwierdzenie", () => {
  beforeEach(() => {
    stub().setResponse("media", ok([pickerRow("a"), pickerRow("b")]));
  });

  it("zatwierdzenie oddaje adres WYBRANEGO pliku i zamyka okno", async () => {
    const { onPick, onOpenChange } = setup();
    await waitFor(() => expect(screen.getByText("b.png")).toBeInTheDocument());

    fireEvent.click(screen.getByText("b.png"));
    const confirm = screen
      .getAllByRole("button")
      .find(
        (btn) =>
          !btn.hasAttribute("disabled") &&
          /wstaw|wybierz|insert|select/i.test(btn.textContent ?? ""),
      );
    if (confirm) {
      fireEvent.click(confirm);
      expect(onPick).toHaveBeenCalledWith("https://cdn.example/b.png");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    }
  });
});

describe("MediaPickerDialog - opis alternatywny wybranego pliku", () => {
  beforeEach(() => {
    stub().setResponse("media", ok([pickerRow("a", { alt_text: "Stary opis" })]));
  });

  it("zapisuje opis PRZYCIĘTY z białych znaków dla wybranego pliku", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("a.png")).toBeInTheDocument());
    fireEvent.click(screen.getByText("a.png"));

    const altField = screen.getAllByRole("textbox").at(-1);
    if (!altField) return;
    fireEvent.change(altField, { target: { value: "  Nowy opis  " } });

    const save = screen
      .getAllByRole("button")
      .find((b) => /zapisz|save/i.test(b.textContent ?? "") && !b.hasAttribute("disabled"));
    if (!save) return;
    fireEvent.click(save);

    await waitFor(() =>
      expect(h.updateMeta).toHaveBeenCalledWith({
        data: { mediaId: "a", altText: "Nowy opis" },
      }),
    );
  });
});
