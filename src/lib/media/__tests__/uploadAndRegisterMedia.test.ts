// ORKIESTRACJA WGRYWANIA: walidacja -> upload -> rejestracja -> sprzątanie.
// Do 19.08.2026 cała ta funkcja (linie 147-212) stała na zerze - pokryte były
// wyłącznie czyste reguły z góry pliku.
//
// To najgorsze możliwe miejsce na dziurę w pokryciu, bo ten moduł powstał
// DOKŁADNIE po to, żeby zamknąć defekt opisany w jego nagłówku: upload jest
// dwufazowy (bajty lecą prosto do publicznego bucketu, serwer waliduje dopiero
// wiersz w tabeli `media`), a dwie z trzech historycznych implementacji przy
// ODRZUCONEJ rejestracji zostawiały plik żywy pod publicznym URL-em. Redaktor
// widział czerwony toast i mimo to dostawał serwowany adres - czyli stored XSS
// dla SVG.
//
// Reguła, której pilnują te testy, brzmi więc: nieudana rejestracja MUSI
// skończyć się usunięciem obiektu ze storage. Awaria jest cicha - użytkownik i
// tak zobaczy błąd, a plik po prostu zostanie.
import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  uploadResult: { error: null as { message: string } | null },
  publicUrl: "https://cdn.example/storage/v1/object/public/media/x.png" as string | null,
  publicUrlData: true,
  removeImpl: vi.fn(async (_paths: string[]) => ({ data: null, error: null })),
  calls: {
    bucket: [] as string[],
    upload: [] as { path: string; options: Record<string, unknown> }[],
    remove: [] as string[][],
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from(bucket: string) {
        h.calls.bucket.push(bucket);
        return {
          upload: async (path: string, _file: unknown, options: Record<string, unknown>) => {
            h.calls.upload.push({ path, options });
            return h.uploadResult;
          },
          getPublicUrl: (_path: string) =>
            h.publicUrlData ? { data: { publicUrl: h.publicUrl } } : { data: null },
          remove: (paths: string[]) => {
            h.calls.remove.push(paths);
            return h.removeImpl(paths);
          },
        };
      },
    },
  },
}));

import { uploadAndRegisterMedia, IMAGE_MIME, type RegisterMediaFn } from "@/lib/media/upload";

/** Plik o zadanym typie i rozmiarze - `new File` przelicza rozmiar z treści. */
function file(name: string, type: string, sizeBytes = 16): File {
  return new File([new Blob([new Uint8Array(sizeBytes)])], name, { type });
}

/** Atrapa serwerowej rejestracji; jawnie otypowana, żeby test czytał argumenty. */
function register(result: { id: string } | Error = { id: "media-1" }) {
  return vi.fn(async (_args: Parameters<RegisterMediaFn>[0]) => {
    if (result instanceof Error) throw result;
    return result;
  });
}

function run(overrides: Partial<Parameters<typeof uploadAndRegisterMedia>[0]> = {}) {
  const registerMedia = overrides.registerMedia ?? register();
  return {
    registerMedia,
    promise: uploadAndRegisterMedia({
      file: file("zdjecie.PNG", "image/png"),
      tenantId: "tenant-a",
      userId: "user-b",
      ...overrides,
      registerMedia,
    }),
  };
}

beforeEach(() => {
  h.uploadResult = { error: null };
  h.publicUrl = "https://cdn.example/storage/v1/object/public/media/x.png";
  h.publicUrlData = true;
  h.removeImpl = vi.fn(async () => ({ data: null, error: null }));
  h.calls.bucket.length = 0;
  h.calls.upload.length = 0;
  h.calls.remove.length = 0;
});

describe("uploadAndRegisterMedia - odrzucenie PRZED wysłaniem bajtów", () => {
  it("nie wysyła pliku o niedozwolonym typie", async () => {
    // Sedno: bajty NIE mogą trafić do publicznego bucketu, bo tam już zostaną.
    const { registerMedia, promise } = run({ file: file("zlo.svg", "image/svg+xml") });

    await expect(promise).rejects.toThrow(/Disallowed mime type/);
    expect(h.calls.upload).toHaveLength(0);
    expect(registerMedia).not.toHaveBeenCalled();
  });

  it("nazywa typ w komunikacie, także gdy przeglądarka go nie rozpoznała", async () => {
    const { promise } = run({ file: file("cos", "") });
    await expect(promise).rejects.toThrow(/Disallowed mime type: unknown/);
  });

  it("nie wysyła pliku ponad limit rozmiaru dla jego typu", async () => {
    const { promise } = run({ file: file("duze.png", "image/png", 11 * 1024 * 1024) });

    await expect(promise).rejects.toThrow(/File too large/);
    expect(h.calls.upload).toHaveLength(0);
  });

  it("ZAWĘŻONA allowlista odrzuca typ dozwolony globalnie", async () => {
    // Picker okładki przyjmuje wyłącznie obrazy - plik audio ma odpaść mimo
    // tego, że biblioteka mediów jako całość audio przyjmuje.
    const { promise } = run({ file: file("odcinek.mp3", "audio/mpeg"), allowedMime: IMAGE_MIME });

    await expect(promise).rejects.toThrow(/Disallowed mime type: audio\/mpeg/);
    expect(h.calls.upload).toHaveLength(0);
  });
});

describe("uploadAndRegisterMedia - ścieżka udana", () => {
  it("wgrywa do bucketu `media` pod klucz z tenantem i użytkownikiem", async () => {
    // Prefiks tenanta to granica izolacji - bez niego pliki dwóch redakcji
    // lądują w jednej przestrzeni nazw.
    await run().promise;

    expect(h.calls.bucket).toContain("media");
    expect(h.calls.upload[0]?.path).toMatch(/^tenant-a\/user-b\/[^/]+\.png$/);
  });

  it("dokłada podfolder jako osobny segment ścieżki", async () => {
    await run({ subfolder: "widgets" }).promise;
    expect(h.calls.upload[0]?.path).toMatch(/^tenant-a\/user-b\/widgets\/[^/]+\.png$/);
  });

  it("nie nadpisuje istniejącego obiektu i deklaruje typ treści", async () => {
    // `upsert: false` chroni przed podmianą cudzego pliku pod tym samym kluczem.
    await run().promise;

    expect(h.calls.upload[0]?.options).toMatchObject({ upsert: false, contentType: "image/png" });
  });

  it("zwraca identyfikator wiersza, klucz obiektu i publiczny adres", async () => {
    const result = await run().promise;

    expect(result.mediaId).toBe("media-1");
    expect(result.storagePath).toBe(h.calls.upload[0]?.path);
    expect(result.publicUrl).toBe(h.publicUrl);
  });

  it("przekazuje do rejestracji metadane pliku, nie zgadywane wartości", async () => {
    const registerMedia = register();
    await run({ file: file("raport.pdf", "application/pdf", 2048), registerMedia }).promise;

    expect(registerMedia).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filename: "raport.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
        publicUrl: h.publicUrl,
      }),
    });
  });

  it("pomija tekst alternatywny, gdy go nie podano", async () => {
    // Pusty klucz `altText` nadpisałby w bazie opis ustawiony wcześniej.
    const registerMedia = register();
    await run({ registerMedia }).promise;

    expect(Object.keys(registerMedia.mock.calls[0]?.[0].data ?? {})).not.toContain("altText");
    expect(registerMedia).toHaveBeenCalledTimes(1);
  });

  it("przekazuje tekst alternatywny, gdy go podano", async () => {
    const registerMedia = register();
    await run({ registerMedia, altText: "Sala plenarna" }).promise;

    expect(registerMedia).toHaveBeenCalledWith({
      data: expect.objectContaining({ altText: "Sala plenarna" }),
    });
  });

  it("nie sprząta po udanej rejestracji", async () => {
    await run().promise;
    expect(h.calls.remove).toHaveLength(0);
  });
});

describe("uploadAndRegisterMedia - sprzątanie po odrzuconej rejestracji", () => {
  it("USUWA obiekt ze storage, gdy rejestracja odrzuci plik", async () => {
    // TO JEST POWÓD ISTNIENIA TEJ FUNKCJI. Bez tego kroku odrzucony plik
    // zostaje żywy pod publicznym URL-em, który wgrywający już zna.
    const registerMedia = register(new Error("Disallowed mime type"));
    const { promise } = run({ registerMedia });

    await expect(promise).rejects.toThrow("Disallowed mime type");
    expect(h.calls.remove).toEqual([[h.calls.upload[0]?.path]]);
  });

  it("przepuszcza ORYGINALNY błąd rejestracji, nie własny", async () => {
    // Użytkownik ma zobaczyć powód odrzucenia z serwera, nie „nie udało się".
    const registerMedia = register(new Error("File too large: 40000000 > 10485760"));

    await expect(run({ registerMedia }).promise).rejects.toThrow(/File too large/);
  });

  it("sprząta także wtedy, gdy storage nie zwrócił publicznego adresu", async () => {
    // Bez publicznego URL-a nie ma czego zapisać w bazie, a obiekt już leży.
    h.publicUrl = "";
    const { registerMedia, promise } = run();

    await expect(promise).rejects.toThrow("storage_public_url_missing");
    expect(registerMedia).not.toHaveBeenCalled();
    expect(h.calls.remove).toHaveLength(1);
  });

  it("sprząta także wtedy, gdy storage w ogóle nie odpowiedział adresem", async () => {
    // Brak całego obiektu `data`, nie tylko pustego pola - obie ścieżki muszą
    // skończyć się usunięciem obiektu.
    h.publicUrlData = false;
    const { promise } = run();

    await expect(promise).rejects.toThrow("storage_public_url_missing");
    expect(h.calls.remove).toHaveLength(1);
  });

  it("nieudane sprzątanie NIE zasłania błędu rejestracji", async () => {
    // Gdyby błąd `remove` wypływał na wierzch, użytkownik zobaczyłby komunikat
    // o storage zamiast prawdziwego powodu odrzucenia.
    h.removeImpl = vi.fn(async () => {
      throw new Error("storage unreachable");
    });
    const registerMedia = register(new Error("Disallowed mime type"));

    await expect(run({ registerMedia }).promise).rejects.toThrow("Disallowed mime type");
  });
});

describe("uploadAndRegisterMedia - błąd samego uploadu", () => {
  it("przerywa przed rejestracją i nie próbuje sprzątać", async () => {
    // Nie ma czego usuwać - obiekt nie powstał.
    h.uploadResult = { error: { message: "Payload too large" } };
    const { registerMedia, promise } = run();

    await expect(promise).rejects.toMatchObject({ message: "Payload too large" });
    expect(registerMedia).not.toHaveBeenCalled();
    expect(h.calls.remove).toHaveLength(0);
  });
});
