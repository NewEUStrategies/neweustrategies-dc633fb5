import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PUBLIC_MEDIA_ORIGIN,
  brandedMediaUrl,
  mediaRenderUrl,
  mediaStoragePath,
  parseMediaOrigin,
  resolvePublicMediaOrigin,
  resolveRecognizedMediaOrigins,
} from "@/lib/media/publicUrl";

describe("publiczny adres mediów marki", () => {
  it("ukrywa techniczny host magazynu", () => {
    expect(
      brandedMediaUrl(
        "https://project.supabase.co/storage/v1/object/public/media/tenant/user/hero.png",
      ),
    ).toBe("https://neweuropeanstrategies.com/media/tenant/user/hero.png");
  });

  it("zachowuje i koduje bezpieczną ścieżkę pliku", () => {
    expect(mediaStoragePath("https://neweuropeanstrategies.com/media/a/b/hero%20image.png")).toBe(
      "a/b/hero image.png",
    );
    expect(brandedMediaUrl("https://neweuropeanstrategies.com/media/a/b/hero%20image.png")).toBe(
      "https://neweuropeanstrategies.com/media/a/b/hero%20image.png",
    );
  });

  it("renderuje markowe media przez bieżące środowisko aplikacji", () => {
    expect(
      mediaRenderUrl("https://neweuropeanstrategies.com/media/tenant/user/hero%20image.png"),
    ).toBe("/media/tenant/user/hero%20image.png");
    expect(mediaRenderUrl("https://cdn.example.org/hero.png")).toBe(
      "https://cdn.example.org/hero.png",
    );
  });

  it("nie przepisuje obcych adresów ani niebezpiecznych ścieżek", () => {
    expect(brandedMediaUrl("https://cdn.example.org/hero.png")).toBe(
      "https://cdn.example.org/hero.png",
    );
    expect(mediaStoragePath("/media/a/../secret.png")).toBeNull();
  });
});

// DOMENA MEDIÓW Z KONFIGURACJI (wydanie 11 -> 12). Origin był stałą w kodzie
// i trafiał do danych WSZYSTKICH najemców. Teraz jest konfiguracją wdrożenia,
// a dane zapisane pod domeną domyślną nadal są rozpoznawane.
describe("parseMediaOrigin - walidacja originu z konfiguracji", () => {
  it.each([
    ["https://media.example.eu", "https://media.example.eu"],
    ["  https://media.example.eu/  ", "https://media.example.eu"],
    ["https://MEDIA.Example.EU", "https://media.example.eu"],
    ["http://localhost:5173", "http://localhost:5173"],
  ])("przyjmuje %s", (raw, expected) => {
    expect(parseMediaOrigin(raw)).toBe(expected);
  });

  it.each([
    ["http://media.example.eu", "zwykłe http poza localhost"],
    ["https://media.example.eu/media", "origin ze ścieżką"],
    ["https://media.example.eu?x=1", "origin z zapytaniem"],
    ["https://user:pass@media.example.eu", "dane logowania"],
    ["media.example.eu", "brak schematu"],
    ["javascript:alert(1)", "obcy schemat"],
    ["", "pusta wartość"],
    [undefined, "brak zmiennej"],
    [42, "nie-napis"],
  ])("odrzuca %s (%s)", (raw: unknown, _powod: string) => {
    expect(parseMediaOrigin(raw)).toBeNull();
  });
});

describe("resolvePublicMediaOrigin / resolveRecognizedMediaOrigins", () => {
  it("bez konfiguracji zostaje domena domyślna - zachowanie sprzed zmiany", () => {
    expect(resolvePublicMediaOrigin(undefined)).toBe(DEFAULT_PUBLIC_MEDIA_ORIGIN);
    expect(resolvePublicMediaOrigin("nie-origin")).toBe(DEFAULT_PUBLIC_MEDIA_ORIGIN);
  });

  it("rozpoznaje kanoniczny, domyślny i poprawne pozycje listy - bez duplikatów", () => {
    expect(
      resolveRecognizedMediaOrigins(
        "https://media.tenant-b.eu",
        "https://tenant-c.eu, zly-wpis, https://media.tenant-b.eu",
      ),
    ).toEqual(["https://media.tenant-b.eu", DEFAULT_PUBLIC_MEDIA_ORIGIN, "https://tenant-c.eu"]);
  });
});

describe("publicUrl z originem z konfiguracji wdrożenia", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function load(env: Record<string, string>) {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.resetModules();
    return {
      url: await import("@/lib/media/publicUrl"),
      crop: await import("@/lib/cropSizes"),
    };
  }

  it("nowe adresy dostają origin KANONICZNY z konfiguracji", async () => {
    const { url } = await load({ VITE_PUBLIC_MEDIA_ORIGIN: "https://media.tenant-b.eu" });
    expect(
      url.brandedMediaUrl("https://p.supabase.co/storage/v1/object/public/media/t/u/a.png"),
    ).toBe("https://media.tenant-b.eu/media/t/u/a.png");
  });

  it("adres zapisany pod domeną DOMYŚLNĄ jest rozpoznany i przemarkowany", async () => {
    // Bez tego zmiana domeny osierociłaby wszystkie istniejące `public_url`.
    const { url, crop } = await load({ VITE_PUBLIC_MEDIA_ORIGIN: "https://media.tenant-b.eu" });
    const legacy = `${DEFAULT_PUBLIC_MEDIA_ORIGIN}/media/t/u/a.png`;
    expect(url.mediaStoragePath(legacy)).toBe("t/u/a.png");
    expect(url.brandedMediaUrl(legacy)).toBe("https://media.tenant-b.eu/media/t/u/a.png");
    expect(url.mediaRenderUrl(legacy)).toBe("/media/t/u/a.png");
    expect(crop.isSupabaseStorageUrl(legacy)).toBe(true);
  });

  it("dodatkowy origin z listy jest rozpoznawany, obcy `/media/` - nie", async () => {
    const { url, crop } = await load({ VITE_PUBLIC_MEDIA_ORIGINS: "https://tenant-c.eu" });
    expect(url.mediaStoragePath("https://tenant-c.eu/media/t/u/a.png")).toBe("t/u/a.png");
    expect(crop.isSupabaseStorageUrl("https://tenant-c.eu/media/t/u/a.png")).toBe(true);
    expect(url.mediaStoragePath("https://obcy.example/media/t/u/a.png")).toBeNull();
    expect(crop.isSupabaseStorageUrl("https://obcy.example/media/t/u/a.png")).toBe(false);
  });

  it("niepoprawna konfiguracja NIE stempluje adresów obcym hostem", async () => {
    const { url } = await load({ VITE_PUBLIC_MEDIA_ORIGIN: "http://media.tenant-b.eu/sciezka" });
    expect(url.PUBLIC_MEDIA_ORIGIN).toBe(DEFAULT_PUBLIC_MEDIA_ORIGIN);
  });
});
