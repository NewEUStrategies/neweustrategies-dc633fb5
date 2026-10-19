import { describe, expect, it, vi } from "vitest";
import { persistDataUrlImages, type DecodedDataUrl } from "@/lib/blocks/persistImages";
import type { Json } from "@/lib/blocks/types";

// Zapis wpisu z wklejonymi grafikami NIE może się wywrócić przez jedną
// grafikę, ale też nie może udawać sukcesu: dokument dostaje publiczny URL
// wyłącznie dla grafiki, którą upload realnie przyjął, licznik `failed`
// mówi edytorowi, ile data-URL-i zostało (hook pokazuje wtedy ostrzeżenie),
// a cache nie zapamiętuje porażek - kolejny autosave ma spróbować ponownie.
// Sąsiedni `persistImages.test.ts` dowodzi ścieżki szczęśliwej i wyjątku;
// tu - wyników pośrednich: uszkodzony base64, upload bez adresu, mieszanka.
// Granica: funkcja `upload` (w produkcji storage + rejestracja mediów).

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const GIF = "data:image/gif;base64,R0lGODlh";
const BROKEN = "data:image/png;base64,@@@nie-base64@@@";

const doc = (...urls: string[]): Json => ({
  blocks: urls.map((url, i) => ({ id: `b${i}`, type: "image", data: { url, alt: "" } })),
});

describe("persistDataUrlImages - wyniki pośrednie uploadu", () => {
  it("uszkodzony base64 liczy się jako porażka BEZ wołania uploadu i zostaje w dokumencie", async () => {
    const upload = vi.fn<(d: DecodedDataUrl) => Promise<string>>();
    const input = doc(BROKEN);
    const out = await persistDataUrlImages(input, upload);
    expect(upload).not.toHaveBeenCalled();
    expect(out).toMatchObject({ uploaded: 0, failed: 1, changed: false });
    expect(out.doc).toBe(input);
  });

  it("upload bez publicznego adresu to porażka, a cache NIE zapamiętuje pustego wyniku", async () => {
    const cache = new Map<string, string>();
    const upload = vi.fn(async () => "");
    const out = await persistDataUrlImages(doc(PNG), upload, cache);
    expect(out).toMatchObject({ uploaded: 0, failed: 1, changed: false });
    expect(cache.size).toBe(0);
  });

  it("mieszanka: podmienia tylko przyjętą grafikę, liczy obie strony i cache'uje sukces", async () => {
    const cache = new Map<string, string>();
    const upload = vi.fn(async (d: DecodedDataUrl) => {
      if (d.mime === "image/gif") throw new Error("storage 500");
      return "https://cdn.test/media/a.png";
    });
    const out = await persistDataUrlImages(doc(PNG, GIF, BROKEN), upload, cache);

    expect(out).toMatchObject({ uploaded: 1, failed: 2, changed: true });
    expect(out.doc).toEqual(doc("https://cdn.test/media/a.png", GIF, BROKEN));
    expect([...cache]).toEqual([[PNG, "https://cdn.test/media/a.png"]]);
    expect([...out.replacements]).toEqual([[PNG, "https://cdn.test/media/a.png"]]);
  });

  it("upload dostaje zdekodowane bajty, typ i nazwę pliku zgodną z kolejnością grafik", async () => {
    const seen: Array<{ mime: string; filename: string; bytes: number[] }> = [];
    await persistDataUrlImages(doc(PNG, GIF), async (d) => {
      seen.push({ mime: d.mime, filename: d.filename, bytes: Array.from(d.bytes.slice(0, 4)) });
      return `https://cdn.test/${d.filename}`;
    });
    expect(seen).toEqual([
      // Nagłówki plików: PNG = 89 50 4E 47, GIF = "GIF8".
      { mime: "image/png", filename: "wklejony-obraz-1.png", bytes: [0x89, 0x50, 0x4e, 0x47] },
      { mime: "image/gif", filename: "wklejony-obraz-2.gif", bytes: [0x47, 0x49, 0x46, 0x38] },
    ]);
  });
});
