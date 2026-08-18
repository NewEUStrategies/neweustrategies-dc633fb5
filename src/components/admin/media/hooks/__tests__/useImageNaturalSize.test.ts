// Pomiar rzeczywistych wymiarów podglądanego pliku. Do 18.08.2026: 0%.
//
// Hook ładuje obraz w oderwanym <img>, więc niesie klasyczny wyścig: jeśli
// użytkownik przeklika podgląd szybciej, niż wraca `onload`, odpowiedź na
// PORZUCONE żądanie może osadzić wymiary poprzedniego pliku pod nazwą nowego.
// Strażnik `cancelled` jest tu regułą, nie ozdobą - i ma tu swój test.
import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useImageNaturalSize } from "../useImageNaturalSize";
import type { MediaRow } from "../../types";

interface Pending {
  src: string;
  fire: (w: number, h: number) => void;
}

let pending: Pending[] = [];

/** Atrapa <img>, która NIE ładuje sama - test decyduje, kiedy wraca odpowiedź. */
class ManualImage {
  onload: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  #src = "";

  set src(value: string) {
    this.#src = value;
    pending.push({
      src: value,
      fire: (w, h) => {
        this.naturalWidth = w;
        this.naturalHeight = h;
        this.onload?.();
      },
    });
  }

  get src(): string {
    return this.#src;
  }
}

function row(overrides: Partial<MediaRow> = {}): MediaRow {
  return {
    id: "m1",
    tenant_id: "t1",
    storage_path: "t1/u/a.png",
    public_url: "https://cdn.example/a.png",
    filename: "a.png",
    mime_type: "image/png",
    size_bytes: 100,
    uploader_id: "u",
    created_at: "2026-01-01T00:00:00.000Z",
    folder_path: "/",
    alt_text: null,
    ...overrides,
  };
}

function useManualImage() {
  pending = [];
  vi.stubGlobal("Image", ManualImage);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useImageNaturalSize", () => {
  it("zwraca null, dopóki obraz się nie wczyta", () => {
    useManualImage();
    const { result } = renderHook(() => useImageNaturalSize(row()));
    expect(result.current).toBeNull();
  });

  it("osadza wymiary NATURALNE po wczytaniu", async () => {
    useManualImage();
    const { result } = renderHook(() => useImageNaturalSize(row()));
    pending[0].fire(4000, 3000);
    await waitFor(() => expect(result.current).toEqual({ w: 4000, h: 3000 }));
  });

  it("nie mierzy niczego dla braku pliku", () => {
    useManualImage();
    const { result } = renderHook(() => useImageNaturalSize(null));
    expect(result.current).toBeNull();
    expect(pending).toHaveLength(0);
  });

  it("nie mierzy pliku, który nie jest obrazem", () => {
    // PDF, audio i wideo nie mają wymiarów do pokazania w panelu informacji.
    useManualImage();
    renderHook(() => useImageNaturalSize(row({ mime_type: "application/pdf" })));
    expect(pending).toHaveLength(0);
  });

  it("nie mierzy pliku o nieznanym typie", () => {
    useManualImage();
    renderHook(() => useImageNaturalSize(row({ mime_type: null })));
    expect(pending).toHaveLength(0);
  });

  it("nie mierzy pliku bez adresu publicznego", () => {
    useManualImage();
    renderHook(() => useImageNaturalSize(row({ public_url: "" })));
    expect(pending).toHaveLength(0);
  });

  it("ZERUJE wynik natychmiast po zmianie pliku", async () => {
    // Inaczej panel informacji pokazywałby przez chwilę wymiary POPRZEDNIEGO
    // zdjęcia pod nazwą nowego.
    useManualImage();
    const { result, rerender } = renderHook(({ target }) => useImageNaturalSize(target), {
      initialProps: { target: row() },
    });
    pending[0].fire(4000, 3000);
    await waitFor(() => expect(result.current).toEqual({ w: 4000, h: 3000 }));

    rerender({ target: row({ id: "m2", public_url: "https://cdn.example/b.png" }) });
    expect(result.current).toBeNull();
  });

  it("mierzy ponownie, gdy zmieni się sam adres pliku", async () => {
    useManualImage();
    const { result, rerender } = renderHook(({ target }) => useImageNaturalSize(target), {
      initialProps: { target: row() },
    });
    pending[0].fire(100, 100);
    await waitFor(() => expect(result.current).toEqual({ w: 100, h: 100 }));

    rerender({ target: row({ public_url: "https://cdn.example/b.png" }) });
    expect(pending).toHaveLength(2);
    pending[1].fire(800, 600);
    await waitFor(() => expect(result.current).toEqual({ w: 800, h: 600 }));
  });

  it("PORZUCONA odpowiedź nie nadpisuje wymiarów bieżącego pliku", async () => {
    // Wyścig: użytkownik przeklikuje podgląd szybciej niż wraca `onload`
    // pierwszego obrazu. Spóźniona odpowiedź musi zostać zignorowana.
    useManualImage();
    const { result, rerender } = renderHook(({ target }) => useImageNaturalSize(target), {
      initialProps: { target: row() },
    });
    rerender({ target: row({ id: "m2", public_url: "https://cdn.example/b.png" }) });

    pending[1].fire(800, 600);
    await waitFor(() => expect(result.current).toEqual({ w: 800, h: 600 }));

    pending[0].fire(4000, 3000); // spóźniona odpowiedź porzuconego żądania
    expect(result.current).toEqual({ w: 800, h: 600 });
  });

  it("odpowiedź po odmontowaniu nie próbuje ustawiać stanu", async () => {
    useManualImage();
    const { unmount } = renderHook(() => useImageNaturalSize(row()));
    unmount();
    expect(() => pending[0].fire(100, 100)).not.toThrow();
  });
});
