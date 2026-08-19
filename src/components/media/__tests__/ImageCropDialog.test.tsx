// Modalny kadrownik zdjęć (awatar / okładka). Do 18.08.2026: 0%.
//
// Reguły tego okna, których nie widać w `cropGeometry` ani w `imageCrop`:
//   * OSTRZEŻENIE O PROPORCJI liczy się na wymiarach NATURALNYCH wgranego
//     pliku, a nie na kadrze - i musi zniknąć po zamknięciu okna, żeby nie
//     wisiało nad kolejnym, poprawnym zdjęciem,
//   * ZATWIERDZENIE jest zablokowane, dopóki kadrownik nie odda pierwszego
//     obszaru; bez tego strażnika klik w „Zastosuj" nie robiłby NIC i wyglądał
//     na zawieszony,
//   * blokada w trakcie kodowania blobu musi znikać także po PORAŻCE,
//   * zamknięcie okna RESETUJE zoom, obrót i kadr - inaczej następne zdjęcie
//     otwiera się w ustawieniach poprzedniego.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  readFileAsDataUrl: vi.fn(),
  getImageDimensions: vi.fn(),
  getCroppedBlob: vi.fn(),
  /** Ostatnie właściwości przekazane do kadrownika. */
  cropperProps: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/media/imageCrop", () => ({
  readFileAsDataUrl: h.readFileAsDataUrl,
  getImageDimensions: h.getImageDimensions,
  getCroppedBlob: h.getCroppedBlob,
}));

// Kadrownik jest cudzą biblioteką operującą na wskaźniku i canvasie - atrapa
// wystawia jego kontrakt (obszar w pikselach) jako przycisk.
vi.mock("react-easy-crop", () => ({
  default: (props: Record<string, unknown>) => {
    h.cropperProps = props;
    return (
      <button
        type="button"
        data-testid="kadrownik"
        onClick={() =>
          (props.onCropComplete as (a: unknown, b: unknown) => void)?.(
            {},
            { x: 10, y: 20, width: 300, height: 300 },
          )
        }
      >
        kadrownik
      </button>
    );
  },
}));

import { ImageCropDialog, CROP_PRESETS } from "@/components/media/ImageCropDialog";

function imageFile(name = "zdjecie.png"): File {
  return new File(["x"], name, { type: "image/png" });
}

function setup(
  opts: {
    open?: boolean;
    file?: File | null;
    preset?: (typeof CROP_PRESETS)["avatar"];
    kind?: "avatar" | "cover";
  } = {},
) {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  const view = render(
    <ImageCropDialog
      open={opts.open ?? true}
      file={opts.file === undefined ? imageFile() : opts.file}
      preset={opts.preset ?? CROP_PRESETS.avatar}
      kind={opts.kind ?? "avatar"}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
    />,
  );
  return { onOpenChange, onConfirm, view };
}

/** Odda pierwszy obszar kadru - odblokowuje przycisk zatwierdzenia. */
async function reportCropArea() {
  await waitFor(() => expect(screen.getByTestId("kadrownik")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("kadrownik"));
}

beforeEach(() => {
  h.cropperProps = null;
  h.readFileAsDataUrl.mockReset().mockResolvedValue("data:image/png;base64,x");
  h.getImageDimensions.mockReset().mockResolvedValue({ width: 800, height: 800 });
  h.getCroppedBlob.mockReset().mockResolvedValue(new Blob(["x"], { type: "image/jpeg" }));
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:podglad",
    revokeObjectURL: () => undefined,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ImageCropDialog - otwarcie i wczytanie", () => {
  it("zamknięte okno NIE czyta pliku", () => {
    setup({ open: false });
    expect(h.readFileAsDataUrl).not.toHaveBeenCalled();
  });

  it("bez pliku okno się otwiera, ale nic nie wczytuje", () => {
    setup({ file: null });
    expect(h.readFileAsDataUrl).not.toHaveBeenCalled();
  });

  it("wczytuje plik jako data URL, nie jako adres obiektowy", async () => {
    // Data URL omija CORS przy kadrowaniu na canvasie - adres `blob:` z pliku
    // lokalnego działa, ale ta sama ścieżka bywa używana dla zdalnych źródeł.
    setup();
    await waitFor(() => expect(h.readFileAsDataUrl).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(h.cropperProps?.image).toBe("data:image/png;base64,x"));
  });

  it("podaje kadrownikowi PROPORCJĘ z presetu i zakres zoomu", () => {
    setup({ preset: CROP_PRESETS.cover, kind: "cover" });
    return waitFor(() => {
      expect(h.cropperProps?.aspect).toBe(CROP_PRESETS.cover.aspect);
      expect(h.cropperProps?.minZoom).toBe(1);
      expect(h.cropperProps?.maxZoom).toBe(6);
    });
  });

  it("awatar dostaje OKRĄGŁY kadr, okładka prostokątny", async () => {
    const { view } = setup({ kind: "avatar" });
    await waitFor(() => expect(h.cropperProps?.cropShape).toBe("round"));
    view.unmount();

    setup({ kind: "cover", preset: CROP_PRESETS.cover });
    await waitFor(() => expect(h.cropperProps?.cropShape).toBe("rect"));
  });

  it("kadr jest OGRANICZONY do obrazu przez samą bibliotekę", () => {
    // `restrictPosition` jest jedyną rzeczą, która trzyma kadr w granicach
    // zdjęcia - `getCroppedBlob` sam tego nie klamruje.
    setup();
    return waitFor(() => expect(h.cropperProps?.restrictPosition).toBe(true));
  });

  it("pokazuje wymagany format i docelowy rozmiar zapisu", () => {
    setup({ preset: CROP_PRESETS.cover, kind: "cover" });
    expect(screen.getByText("8:3")).toBeInTheDocument();
    expect(screen.getByText("1600×600 px")).toBeInTheDocument();
  });
});

describe("ImageCropDialog - ostrzeżenie o proporcji", () => {
  it("MILCZY dla zdjęcia o zgodnej proporcji", async () => {
    h.getImageDimensions.mockResolvedValue({ width: 800, height: 800 });
    setup();
    await waitFor(() => expect(h.getImageDimensions).toHaveBeenCalled());
    expect(screen.queryByText(/proporcje/i)).toBeNull();
  });

  it("OSTRZEGA przy skrajnie niezgodnej proporcji", async () => {
    // Panorama 4000×500 jako awatar 1:1 - wynik będzie mocno przycięty i lepiej
    // powiedzieć to przed kadrowaniem niż po zapisie.
    h.getImageDimensions.mockResolvedValue({ width: 4000, height: 500 });
    setup();
    await waitFor(() => expect(screen.getByText(/proporcje/i)).toBeInTheDocument());
  });

  it("NIE ostrzega, gdy wymiarów nie da się odczytać", async () => {
    // Fail-open: nieudany odczyt wymiarów to nie powód, by straszyć redaktora
    // komunikatem o proporcjach, których nie znamy.
    h.getImageDimensions.mockRejectedValue(new Error("brak wymiarów"));
    setup();
    await waitFor(() => expect(h.getImageDimensions).toHaveBeenCalled());
    expect(screen.queryByText(/proporcje/i)).toBeNull();
  });

  it("ostrzeżenie ZNIKA po zamknięciu okna", async () => {
    // Inaczej wisi nad kolejnym, poprawnym zdjęciem.
    h.getImageDimensions.mockResolvedValue({ width: 4000, height: 500 });
    const { view } = setup();
    await waitFor(() => expect(screen.getByText(/proporcje/i)).toBeInTheDocument());

    view.rerender(
      <ImageCropDialog
        open={false}
        file={null}
        preset={CROP_PRESETS.avatar}
        kind="avatar"
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByText(/proporcje/i)).toBeNull();
  });
});

describe("ImageCropDialog - zatwierdzenie", () => {
  const applyButton = () => screen.getByRole("button", { name: /zastosuj|apply/i });

  it("jest ZABLOKOWANE, dopóki kadrownik nie odda obszaru", async () => {
    // Bez tego strażnika kliknięcie nic nie robi i okno wygląda na zawieszone.
    setup();
    await waitFor(() => expect(screen.getByTestId("kadrownik")).toBeInTheDocument());
    expect(applyButton()).toBeDisabled();
  });

  it("odblokowuje się po pierwszym obszarze i tnie DOKŁADNIE ten kadr", async () => {
    const { onConfirm } = setup();
    await reportCropArea();
    expect(applyButton()).toBeEnabled();

    fireEvent.click(applyButton());
    await waitFor(() => expect(h.getCroppedBlob).toHaveBeenCalled());

    const [src, crop, rotation, width, height, mime, quality] = h.getCroppedBlob.mock.calls[0];
    expect(src).toBe("data:image/png;base64,x");
    expect(crop).toEqual({ x: 10, y: 20, width: 300, height: 300 });
    expect(rotation).toBe(0);
    expect(width).toBe(CROP_PRESETS.avatar.targetWidth);
    expect(height).toBe(CROP_PRESETS.avatar.targetHeight);
    expect(mime).toBe("image/jpeg");
    expect(quality).toBe(0.92);

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.any(Blob), "blob:podglad"));
  });

  it("po zatwierdzeniu ZAMYKA okno", async () => {
    const { onOpenChange } = setup();
    await reportCropArea();
    fireEvent.click(applyButton());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("blokada znika także po PORAŻCE kadrowania", async () => {
    // Bez `finally` jeden błąd blokuje przycisk do końca życia okna.
    h.getCroppedBlob.mockRejectedValue(new Error("no 2d ctx"));
    const { onConfirm, onOpenChange } = setup();
    await reportCropArea();
    fireEvent.click(applyButton());

    await waitFor(() => expect(applyButton()).toBeEnabled());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("PORAŻKA kadrowania jest widoczna, nie tylko cicho zdejmuje blokadę", async () => {
    // Kadrowanie idzie przez canvas i potrafi się nie udać (brak kontekstu 2d,
    // obraz „skażony" CORS-em). Sam odblokowany przycisk niczego nie mówi -
    // użytkownik klika drugi raz i znowu nic.
    h.getCroppedBlob.mockRejectedValue(new Error("no 2d ctx"));
    setup();
    await reportCropArea();
    fireEvent.click(applyButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/nie udało się przygotować kadru/i);
  });

  it("komunikat porażki znika przy KOLEJNEJ próbie", async () => {
    // Zostawiony komunikat kłamałby po udanym kadrze.
    h.getCroppedBlob.mockRejectedValue(new Error("no 2d ctx"));
    const { onConfirm } = setup();
    await reportCropArea();
    fireEvent.click(applyButton());
    await screen.findByRole("alert");

    h.getCroppedBlob.mockResolvedValue(new Blob(["ok"], { type: "image/jpeg" }));
    fireEvent.click(applyButton());

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("anulowanie zamyka okno BEZ kadrowania", async () => {
    const { onOpenChange, onConfirm } = setup();
    await reportCropArea();
    fireEvent.click(screen.getByRole("button", { name: /anuluj|cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.getCroppedBlob).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("ImageCropDialog - obrót i reset", () => {
  it("przyciski ±90° zmieniają kąt przekazywany kadrownikowi", async () => {
    setup();
    await waitFor(() => expect(h.cropperProps).not.toBeNull());
    expect(h.cropperProps?.rotation).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /w prawo|rotate right/i }));
    await waitFor(() => expect(h.cropperProps?.rotation).toBe(90));

    fireEvent.click(screen.getByRole("button", { name: /w lewo|rotate left/i }));
    await waitFor(() => expect(h.cropperProps?.rotation).toBe(0));
  });

  it("DEFEKT (zapinany): przyciski ±90° NIE są klamrowane do zakresu suwaka", async () => {
    // Suwak obrotu ma zakres ±180°, ale przyciski liczą bez klamry: trzy
    // kliknięcia w prawo dają 270°, czego suwak nie potrafi pokazać.
    // Pin na stan dzisiejszy; naprawa to osobna decyzja i osobny commit.
    setup();
    await waitFor(() => expect(h.cropperProps).not.toBeNull());
    const right = screen.getByRole("button", { name: /w prawo|rotate right/i });
    fireEvent.click(right);
    fireEvent.click(right);
    fireEvent.click(right);
    await waitFor(() => expect(h.cropperProps?.rotation).toBe(270));
  });

  it("RESET przywraca zoom i obrót do wartości wyjściowych", async () => {
    setup();
    await waitFor(() => expect(h.cropperProps).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /w prawo|rotate right/i }));
    await waitFor(() => expect(h.cropperProps?.rotation).toBe(90));

    fireEvent.click(screen.getByRole("button", { name: /resetuj|reset/i }));
    await waitFor(() => {
      expect(h.cropperProps?.rotation).toBe(0);
      expect(h.cropperProps?.zoom).toBe(1);
    });
  });

  it("kadrowanie tnie z AKTUALNYM kątem obrotu", async () => {
    setup();
    await reportCropArea();
    fireEvent.click(screen.getByRole("button", { name: /w prawo|rotate right/i }));
    fireEvent.click(screen.getByRole("button", { name: /zastosuj|apply/i }));

    await waitFor(() => expect(h.getCroppedBlob.mock.calls[0][2]).toBe(90));
  });
});

describe("CROP_PRESETS - niezmienniki katalogu", () => {
  it("zadeklarowana proporcja ZGADZA SIĘ z docelowymi wymiarami", () => {
    // Rozjazd oznacza kadrowanie do jednej proporcji i zapis w innej: obraz
    // zostaje rozciągnięty albo ścieśniony przy zapisie.
    for (const [name, preset] of Object.entries(CROP_PRESETS)) {
      expect(preset.targetWidth / preset.targetHeight, name).toBeCloseTo(preset.aspect, 6);
    }
  });

  it("każdy preset ma dodatnie wymiary i tolerancję w rozsądnym zakresie", () => {
    for (const [name, preset] of Object.entries(CROP_PRESETS)) {
      expect(preset.targetWidth, name).toBeGreaterThan(0);
      expect(preset.targetHeight, name).toBeGreaterThan(0);
      expect(preset.tolerance ?? 0, name).toBeGreaterThan(0);
      expect(preset.tolerance ?? 0, name).toBeLessThan(1);
    }
  });
});
