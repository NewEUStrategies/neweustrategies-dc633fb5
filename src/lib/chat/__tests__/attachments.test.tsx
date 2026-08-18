// Załączniki czatu: lustro kontraktu prywatnego bucketa po stronie klienta.
// Audyt nazwał tę część „jak z podręcznika" - prywatny bucket, podpisy
// 15-minutowe, batch, kwota sprawdzana PRZED podpisaniem, trigger czyszczący
// storage. Pokrycie było 9%, więc podręcznikowość nie miała żadnej ochrony.
//
// Testujemy to, co widzi użytkownik i to, co chroni serwer:
//   - allowlista MIME BEZ SVG (aktywna treść) i limit 30 MB,
//   - formatowanie rozmiaru z przecinkiem w PL i kropką w EN,
//   - ścieżka `<tenant>/<conversation>/<uid>/<uuid>-<nazwa>` wymagana przez RLS,
//   - kolejność: kwota (RPC) PRZED podpisem uploadu,
//   - batch podpisów zamiast N round-tripów, z progiem opłacalności.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CHAT_IDS, storageStub } from "@/test/chat/fixtures";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
const stubs = vi.hoisted(() => ({ storage: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const fixtures = await import("@/test/chat/fixtures");
  const storage = fixtures.storageStub();
  stubs.storage = storage;
  return {
    supabase: {
      storage: { from: storage.from },
      rpc: (fn: string) => h.rpc(fn),
      from: () => ({}),
    },
  };
});

import {
  ATTACHMENT_ACCEPT,
  attachmentKindForMime,
  AUDIO_MIME_TYPES,
  formatBytes,
  IMAGE_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_VOICE_SECONDS,
  useAttachmentUrl,
  usePrefetchAttachmentUrls,
  uploadChatAttachment,
  validateAttachment,
} from "../attachments";
import { chatKeys } from "../keys";

type StorageStub = ReturnType<typeof storageStub>;
const storage = () => stubs.storage as StorageStub;

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** Plik testowy o zadanym typie i rozmiarze (bez alokowania bajtów). */
function fakeFile(name: string, type: string, size: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: null, error: null });
  storage().reset();
});

describe("allowlista MIME", () => {
  it("rozpoznaje obrazy, pliki i audio - i odrzuca resztę", () => {
    expect(attachmentKindForMime("image/png")).toBe("image");
    expect(attachmentKindForMime("application/pdf")).toBe("file");
    expect(attachmentKindForMime("audio/webm")).toBe("audio");
    expect(attachmentKindForMime("application/x-msdownload")).toBeNull();
    expect(attachmentKindForMime("")).toBeNull();
  });

  it("NIE dopuszcza SVG - aktywna treść, bucket i tak by odrzucił", () => {
    expect(IMAGE_MIME_TYPES.has("image/svg+xml")).toBe(false);
    expect(attachmentKindForMime("image/svg+xml")).toBeNull();
    expect(ATTACHMENT_ACCEPT).not.toContain("svg");
  });

  it("audio jest poza `accept` pickera - notatki nagrywa się w aplikacji", () => {
    for (const mime of AUDIO_MIME_TYPES) {
      expect(ATTACHMENT_ACCEPT).not.toContain(mime);
    }
  });

  it("`accept` niesie każdy dozwolony obraz i plik", () => {
    expect(ATTACHMENT_ACCEPT.split(",")).toContain("image/png");
    expect(ATTACHMENT_ACCEPT.split(",")).toContain("application/pdf");
  });
});

describe("validateAttachment", () => {
  it("przepuszcza plik w allowliście i poniżej limitu", () => {
    expect(validateAttachment(fakeFile("a.png", "image/png", 1024))).toBeNull();
  });

  it("odrzuca zły typ PRZED sprawdzeniem rozmiaru", () => {
    expect(validateAttachment(fakeFile("a.exe", "application/x-msdownload", 10))).toBe("type");
  });

  it("odrzuca plik pusty i przekraczający 30 MB, ale dopuszcza dokładnie limit", () => {
    expect(validateAttachment(fakeFile("a.png", "image/png", 0))).toBe("size");
    expect(validateAttachment(fakeFile("a.png", "image/png", MAX_ATTACHMENT_BYTES + 1))).toBe(
      "size",
    );
    expect(validateAttachment(fakeFile("a.png", "image/png", MAX_ATTACHMENT_BYTES))).toBeNull();
  });

  it("limit to dokładnie 30 MB, a notatka głosowa najwyżej 10 minut", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(30 * 1024 * 1024);
    expect(MAX_VOICE_SECONDS).toBe(600);
  });
});

describe("formatBytes", () => {
  it("bajty pokazuje bez zaokrąglenia, większe jednostki z jednym miejscem", () => {
    expect(formatBytes(512, "en")).toBe("512 B");
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
  });

  it("PL używa przecinka dziesiętnego, EN kropki", () => {
    expect(formatBytes(1536, "pl")).toBe("1,5 KB");
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
  });

  it("od 10 jednostek w górę rezygnuje z części dziesiętnej", () => {
    expect(formatBytes(10 * 1024, "en")).toBe("10 KB");
    expect(formatBytes(15.7 * 1024, "en")).toBe("16 KB");
  });

  it("skaluje do GB i nie idzie wyżej niż największa jednostka", () => {
    expect(formatBytes(2 * 1024 ** 3, "en")).toBe("2.0 GB");
    expect(formatBytes(3 * 1024 ** 4, "en")).toContain("GB");
  });
});

describe("uploadChatAttachment", () => {
  it("odrzuca niedozwolony plik PRZED jakimkolwiek round-tripem", async () => {
    await expect(
      uploadChatAttachment({
        file: fakeFile("a.exe", "application/x-msdownload", 10),
        tenantId: CHAT_IDS.tenant,
        conversationId: CHAT_IDS.conversation,
        userId: CHAT_IDS.me,
      }),
    ).rejects.toThrow("chat-attachment:type");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(storage().createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("sprawdza kwotę uploadów PRZED podpisaniem URL-a", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "chat: upload rate limited" } });
    await expect(
      uploadChatAttachment({
        file: fakeFile("a.png", "image/png", 1024),
        tenantId: CHAT_IDS.tenant,
        conversationId: CHAT_IDS.conversation,
        userId: CHAT_IDS.me,
      }),
    ).rejects.toThrow("chat-attachment:rate-limited");
    expect(h.rpc).toHaveBeenCalledWith("chat_check_upload_quota");
    // Kluczowe: kwota to jedyna bariera przed nadużyciem storage, bo obiekt
    // ląduje w buckecie PRZED wierszem wiadomości (trigger limitu tempa
    // wiadomości nie ma czego bramkować).
    expect(storage().createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("buduje ścieżkę wymaganą przez storage RLS i sanityzuje nazwę pliku", async () => {
    // XHR jest jedyną drogą do realnego postępu wysyłki - podmieniamy go atrapą.
    class FakeXhr {
      status = 200;
      upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send() {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent);
        this.onload?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const progress: number[] = [];

    const result = await uploadChatAttachment({
      file: fakeFile("moja umowa (final)!.pdf", "application/pdf", 2048),
      tenantId: CHAT_IDS.tenant,
      conversationId: CHAT_IDS.conversation,
      userId: CHAT_IDS.me,
      onProgress: (percent) => progress.push(percent),
    });

    const signedPath = storage().createSignedUploadUrl.mock.calls[0]?.[0] as string;
    expect(
      signedPath.startsWith(`${CHAT_IDS.tenant}/${CHAT_IDS.conversation}/${CHAT_IDS.me}/`),
    ).toBe(true);
    // Znaki poza literami/cyframi/._- lecą na podkreślenie: nazwa pliku trafia
    // do klucza obiektu, a klucz jest częścią polityki RLS.
    expect(signedPath).toMatch(/moja_umowa_final_\.pdf$/);
    // Nazwa POKAZYWANA użytkownikowi zostaje oryginalna.
    expect(result.name).toBe("moja umowa (final)!.pdf");
    expect(result.mime).toBe("application/pdf");
    expect(result.size).toBe(2048);
    expect(progress).toEqual([50]);
    vi.unstubAllGlobals();
  });

  it("błąd sieci w trakcie wysyłki propaguje się jako awaria załącznika", async () => {
    class FailingXhr {
      status = 0;
      upload = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send() {
        this.onerror?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", FailingXhr);
    await expect(
      uploadChatAttachment({
        file: fakeFile("a.png", "image/png", 10),
        tenantId: CHAT_IDS.tenant,
        conversationId: CHAT_IDS.conversation,
        userId: CHAT_IDS.me,
      }),
    ).rejects.toThrow("chat-attachment:network");
    vi.unstubAllGlobals();
  });

  it("odpowiedź HTTP poza 2xx kończy się błędem, nie cichym sukcesem", async () => {
    class ForbiddenXhr {
      status = 403;
      upload = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send() {
        this.onload?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", ForbiddenXhr);
    await expect(
      uploadChatAttachment({
        file: fakeFile("a.png", "image/png", 10),
        tenantId: CHAT_IDS.tenant,
        conversationId: CHAT_IDS.conversation,
        userId: CHAT_IDS.me,
      }),
    ).rejects.toThrow("HTTP 403");
    vi.unstubAllGlobals();
  });
});

describe("useAttachmentUrl", () => {
  it("podpisuje ścieżkę w prywatnym buckecie", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useAttachmentUrl("t/c/u/a.png"), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe("https://signed.test/t/c/u/a.png");
    // TTL 15 minut: krótkie okno dla wyciekniętego URL-a, z odświeżeniem
    // ~5 minut przed wygaśnięciem, żeby podgląd nie padał w trakcie sesji.
    expect(storage().createSignedUrl).toHaveBeenCalledWith("t/c/u/a.png", 900);
  });

  it("zwraca gotowe URL-e wprost - podgląd lokalny (demo bot, wersja robocza)", async () => {
    const client = makeClient();
    for (const local of ["blob:abc", "data:image/png;base64,AA", "https://cdn.test/a.png"]) {
      const { result } = renderHook(() => useAttachmentUrl(local), {
        wrapper: wrapperFor(client),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBe(local);
    }
    expect(storage().createSignedUrl).not.toHaveBeenCalled();
  });

  it("nie strzela do storage dla braku ścieżki", async () => {
    const client = makeClient();
    renderHook(() => useAttachmentUrl(null), { wrapper: wrapperFor(client) });
    await Promise.resolve();
    expect(storage().createSignedUrl).not.toHaveBeenCalled();
  });
});

describe("usePrefetchAttachmentUrls", () => {
  it("podpisuje batchem i zasiewa cache per ścieżka", async () => {
    const client = makeClient();
    renderHook(() => usePrefetchAttachmentUrls(["t/c/u/a.png", "t/c/u/b.pdf"]), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() =>
      expect(client.getQueryData(chatKeys.attachmentUrl("t/c/u/a.png"))).toBe(
        "https://signed.test/t/c/u/a.png",
      ),
    );
    expect(client.getQueryData(chatKeys.attachmentUrl("t/c/u/b.pdf"))).toBe(
      "https://signed.test/t/c/u/b.pdf",
    );
    expect(storage().createSignedUrls).toHaveBeenCalledTimes(1);
  });

  it("pojedynczy brak NIE uruchamia batcha - taniej przez zapytanie per element", async () => {
    const client = makeClient();
    renderHook(() => usePrefetchAttachmentUrls(["t/c/u/a.png"]), { wrapper: wrapperFor(client) });
    await Promise.resolve();
    expect(storage().createSignedUrls).not.toHaveBeenCalled();
  });

  it("pomija ścieżki JUŻ w cache i nie strzela, gdy nic nie brakuje", async () => {
    const client = makeClient();
    client.setQueryData(chatKeys.attachmentUrl("t/c/u/a.png"), "https://cached/a");
    client.setQueryData(chatKeys.attachmentUrl("t/c/u/b.pdf"), "https://cached/b");
    renderHook(() => usePrefetchAttachmentUrls(["t/c/u/a.png", "t/c/u/b.pdf"]), {
      wrapper: wrapperFor(client),
    });
    await Promise.resolve();
    expect(storage().createSignedUrls).not.toHaveBeenCalled();
  });

  it("KOLEJNOŚĆ ścieżek nie retriggeruje batcha (prepend przy paginacji)", async () => {
    const client = makeClient();
    const { rerender } = renderHook(
      ({ paths }: { paths: string[] }) => usePrefetchAttachmentUrls(paths),
      {
        wrapper: wrapperFor(client),
        initialProps: { paths: ["t/c/u/a.png", "t/c/u/b.pdf"] },
      },
    );
    await waitFor(() => expect(storage().createSignedUrls).toHaveBeenCalledTimes(1));

    rerender({ paths: ["t/c/u/b.pdf", "t/c/u/a.png"] });
    await Promise.resolve();
    expect(storage().createSignedUrls).toHaveBeenCalledTimes(1);
  });

  it("nie wywraca się, gdy batch odmówi", async () => {
    storage().createSignedUrls.mockRejectedValueOnce(new Error("storage down"));
    const client = makeClient();
    renderHook(() => usePrefetchAttachmentUrls(["t/c/u/a.png", "t/c/u/b.pdf"]), {
      wrapper: wrapperFor(client),
    });
    await Promise.resolve();
    expect(client.getQueryData(chatKeys.attachmentUrl("t/c/u/a.png"))).toBeUndefined();
  });

  it("pomija pozycje batcha z błędem, zasiewając tylko udane", async () => {
    storage().createSignedUrls.mockResolvedValueOnce({
      data: [
        { path: "t/c/u/a.png", signedUrl: "https://signed.test/ok", error: null },
        { path: "t/c/u/b.pdf", signedUrl: "", error: "not found" },
      ],
      error: null,
    });
    const client = makeClient();
    renderHook(() => usePrefetchAttachmentUrls(["t/c/u/a.png", "t/c/u/b.pdf"]), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() =>
      expect(client.getQueryData(chatKeys.attachmentUrl("t/c/u/a.png"))).toBe(
        "https://signed.test/ok",
      ),
    );
    expect(client.getQueryData(chatKeys.attachmentUrl("t/c/u/b.pdf"))).toBeUndefined();
  });
});
