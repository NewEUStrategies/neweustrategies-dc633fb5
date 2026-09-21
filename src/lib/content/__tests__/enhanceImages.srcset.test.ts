// Gałąź "adres JEST supabase'owy, ale generator kandydatów nic nie zwrócił".
//
// DLACZEGO OSOBNY PLIK. Ta gałąź (`if (srcSet)` w `enhanceImgTag`) jest
// nieosiągalna przez publiczne API: dla każdego adresu przechodzącego
// `isSupabaseStorageUrl` funkcja `buildImageSrcSet` skleja listę z niepustej
// tablicy szerokości (`src/lib/cropSizes.ts:147-154`), więc nigdy nie oddaje
// pustego napisu. Osiągalna jest wyłącznie przez podmianę modułu
// `@/lib/cropSizes`, a `vi.mock` działa na cały plik testowy - dlatego reszta
// przypadków została w `enhanceImages.test.ts`, gdzie potrzebny jest PRAWDZIWY
// generator adresów.
//
// CO TO CHRONI. Gdyby `buildImageSrcSet` kiedykolwiek zaczął oddawać pustkę
// (zmiana listy szerokości, wyłączenie transformacji obrazów po stronie
// Supabase), `<img>` musi zostać BEZ `srcset` i BEZ `sizes`. Sam `sizes` bez
// `srcset` to atrybut, który nic nie opisuje, a w połączeniu z autorskim
// `srcset` z importu potrafi wybrać kandydata mniejszego niż układ.
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  isSupabaseStorageUrl: vi.fn(),
  buildImageSrcSet: vi.fn(),
}));

vi.mock("@/lib/cropSizes", () => ({
  isSupabaseStorageUrl: h.isSupabaseStorageUrl,
  buildImageSrcSet: h.buildImageSrcSet,
}));

import { enhanceContentImages } from "@/lib/content/enhanceImages";

const SUPA = "https://storage.example.com/storage/v1/object/public/media/covers/a.jpg";

describe("enhanceContentImages - pusty zestaw kandydatów", () => {
  it("adres supabase bez kandydatów NIE dostaje ani srcset, ani sizes", () => {
    h.isSupabaseStorageUrl.mockReturnValue(true);
    h.buildImageSrcSet.mockReturnValue("");

    const out = enhanceContentImages(`<img src="${SUPA}" alt="okładka">`);

    expect(h.buildImageSrcSet).toHaveBeenCalledWith(SUPA, expect.any(Array));
    expect(out).not.toContain("srcset=");
    expect(out).not.toContain("sizes=");
    // ...a pozostałe usprawnienia nadal wchodzą - odmowa dotyczy TYLKO srcset.
    expect(out).toContain('loading="lazy"');
    expect(out).toContain('decoding="async"');
  });

  it("niepusty zestaw kandydatów daje srcset RAZEM z sizes", () => {
    // Kontrpróbka: gałąź prawdziwa tego samego warunku, przy tym samym mocku -
    // dowodzi, że powyższa asercja mierzy pustkę, a nie zepsuty mock.
    h.isSupabaseStorageUrl.mockReturnValue(true);
    h.buildImageSrcSet.mockReturnValue(`${SUPA}?width=320 320w`);

    const out = enhanceContentImages(`<img src="${SUPA}">`);

    expect(out).toContain("srcset=");
    expect(out).toContain("sizes=");
  });
});
