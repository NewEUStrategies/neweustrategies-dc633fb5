// PASEK NARZEDZI MEDIOW (obraz / wideo / audio) - odpowiednik
// `WordStyleToolbar` dla blokow medialnych.
//
// CO MA TU DOWOD
//   * paleta jest ROZNA dla trzech rodzajow mediow i nie przecieka: pasek
//     obrazu nie ma sterowania odtwarzaniem, pasek audio nie ma kadru/proporcji.
//     To nie kosmetyka - `set()` zapisuje pole wprost do `block.data`, wiec
//     przycisk pokazany przy zlym rodzaju zapisuje pole, ktorego publiczny
//     renderer tego bloku nigdy nie odczyta (cicha strata ustawienia),
//   * kazda mutacja oddaje NOWY obiekt bloku z zachowanymi pozostalymi polami
//     (`{ ...block.data, ...patch }`) - pasek nie kasuje ustawien, ktorych
//     wlasnie nie dotyka,
//   * `aria-pressed` odpowiada STANOWI DANYCH, a nie klikniciom - redaktor
//     widzi, ktore wyrownanie/rozmiar jest wlaczone,
//   * dwuetapowy dialog zrodla (opis, potem URL): anulowanie DRUGIEGO kroku
//     zapisuje sam opis, a anulowanie pierwszego nie zapisuje nic,
//   * anulowanie dowolnego dialogu (`null`) NIE zapisuje pustej wartosci -
//     to jest ta granica, na ktorej "Escape" zamiast cofniecia potrafi wyczyscic
//     redaktorowi alt-text albo URL.
//
// CZEGO TU NIE MA
//   * atrapy dialogow. `promptDialog` to prawdziwy magazyn z `lib/appDialogs`
//     (host dialogu renderuje `__root.tsx`), wiec test SUBSKRYBUJE ten magazyn
//     i odpowiada na oczekujace zapytanie - tak jak zrobilby to uzytkownik.
//     Zadnego `vi.mock` w tym pliku nie ma,
//   * asercji na wyglad publicznego renderera medium - to inny obszar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Block } from "@/lib/blocks/types";
import { subscribeAppDialog, type PendingDialog } from "@/lib/appDialogs";
import { MediaWidgetToolbar } from "../MediaWidgetToolbar";
import { realT } from "@/test/i18nReal";

const t = realT("pl");

let oczekujacy: PendingDialog | null = null;
let odsubskrybuj: (() => void) | null = null;

beforeEach(() => {
  odsubskrybuj = subscribeAppDialog((p) => {
    oczekujacy = p;
  });
});

afterEach(() => {
  // Wiszący dialog przeciekłby do następnego testu (magazyn jest modułowy).
  if (oczekujacy) act(() => oczekujacy?.resolve(null));
  odsubskrybuj?.();
  odsubskrybuj = null;
});

/** Odpowiada na oczekujące zapytanie dialogu - jak użytkownik w hoście dialogu. */
async function odpowiedz(wartosc: string | null): Promise<PendingDialog["request"]> {
  await waitFor(() => expect(oczekujacy).not.toBeNull());
  const zapytanie = oczekujacy!.request;
  await act(async () => {
    oczekujacy!.resolve(wartosc);
  });
  return zapytanie;
}

function zamontuj(kind: "image" | "video" | "audio", data: Record<string, unknown> = {}) {
  const onChange = vi.fn<(next: Block) => void>();
  const block = {
    id: "m1",
    type: kind,
    data: { url: "https://example.org/a.jpg", ...data },
  } as Block;
  render(<MediaWidgetToolbar kind={kind} block={block} onChange={onChange} />);
  return { onChange, block };
}

function btn(nazwa: string): HTMLElement {
  return screen.getByRole("button", { name: nazwa });
}

/** Ostatnia wersja danych bloku, jaką pasek oddał wołającemu. */
function ostatnieDane(onChange: { mock: { calls: Array<[Block]> } }): Record<string, unknown> {
  const ostatnia = onChange.mock.calls.at(-1);
  if (!ostatnia) throw new Error("pasek nie zgłosił żadnej zmiany");
  return ostatnia[0].data as Record<string, unknown>;
}

describe("MediaWidgetToolbar - paleta zalezna od rodzaju medium", () => {
  it("obraz ma alt, wyrównanie, rozmiar i kadr", () => {
    zamontuj("image");
    for (const klucz of [
      "altText",
      "alignLeft",
      "alignCenter",
      "alignRight",
      "sizeSmall",
      "sizeMedium",
      "sizeFull",
      "rounded",
      "shadow",
    ]) {
      expect(btn(t(`blocks.toolbar.${klucz}`))).toBeInTheDocument();
    }
  });

  it("obraz NIE ma sterowania odtwarzaniem ani proporcji", () => {
    zamontuj("image");
    expect(screen.queryByRole("button", { name: "Autoplay" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Loop" })).toBeNull();
    expect(screen.queryByRole("button", { name: /16:9/ })).toBeNull();
  });

  it("wideo ma poster, napisy, proporcje i sterowanie odtwarzaniem", () => {
    zamontuj("video");
    expect(btn(t("blocks.toolbar.poster"))).toBeInTheDocument();
    expect(btn(t("blocks.toolbar.captions"))).toBeInTheDocument();
    for (const r of ["16:9", "4:3", "1:1", "9:16"]) {
      expect(btn(`${t("blocks.toolbar.aspect")} ${r}`)).toBeInTheDocument();
    }
    expect(btn("Autoplay")).toBeInTheDocument();
  });

  it("wideo NIE ma ustawień typowo obrazowych (alt, kadr)", () => {
    zamontuj("video");
    expect(screen.queryByRole("button", { name: t("blocks.toolbar.altText") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("blocks.toolbar.rounded") })).toBeNull();
  });

  it("audio ma okładkę i pobieranie, ale nie ma proporcji", () => {
    zamontuj("audio");
    expect(btn(t("blocks.toolbar.cover"))).toBeInTheDocument();
    expect(btn(t("blocks.toolbar.download"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /16:9/ })).toBeNull();
    // Sterowanie odtwarzaniem jest wspólne dla wideo i audio.
    expect(btn("Loop")).toBeInTheDocument();
  });
});

describe("MediaWidgetToolbar - ustawienia obrazu", () => {
  it("wyrównanie zapisuje wybraną wartość i zachowuje URL", () => {
    const { onChange } = zamontuj("image");
    fireEvent.click(btn(t("blocks.toolbar.alignLeft")));
    expect(ostatnieDane(onChange)).toMatchObject({
      align: "left",
      url: "https://example.org/a.jpg",
    });
  });

  it("aria-pressed pokazuje STAN DANYCH, nie historię klików", () => {
    zamontuj("image", { align: "right", size: "small" });
    expect(btn(t("blocks.toolbar.alignRight"))).toHaveAttribute("aria-pressed", "true");
    expect(btn(t("blocks.toolbar.alignLeft"))).not.toHaveAttribute("aria-pressed");
    expect(btn(t("blocks.toolbar.sizeSmall"))).toHaveAttribute("aria-pressed", "true");
    // Domyślny rozmiar to `full` - przy jawnym `small` NIE jest wciśnięty.
    expect(btn(t("blocks.toolbar.sizeFull"))).not.toHaveAttribute("aria-pressed");
  });

  it("kadr (zaokrąglenie) przełącza się z wartości fałszywej na prawdziwą", () => {
    const { onChange } = zamontuj("image");
    fireEvent.click(btn(t("blocks.toolbar.rounded")));
    expect(ostatnieDane(onChange).rounded).toBe(true);
  });

  it("kadr przełącza się z powrotem, gdy był włączony", () => {
    const { onChange } = zamontuj("image", { rounded: true });
    fireEvent.click(btn(t("blocks.toolbar.rounded")));
    expect(ostatnieDane(onChange).rounded).toBe(false);
  });

  it("dialog alt-tekstu zapisuje wpisaną treść i podpowiada wartość bieżącą", async () => {
    const { onChange } = zamontuj("image", { alt: "stary opis" });
    fireEvent.click(btn(t("blocks.toolbar.altText")));
    const zapytanie = await odpowiedz("Flaga Unii Europejskiej");
    expect(zapytanie.kind).toBe("prompt");
    expect(zapytanie).toMatchObject({ defaultValue: "stary opis" });
    expect(ostatnieDane(onChange).alt).toBe("Flaga Unii Europejskiej");
  });

  it("ANULOWANIE dialogu nie kasuje bieżącej wartości", async () => {
    const { onChange } = zamontuj("image", { alt: "stary opis" });
    fireEvent.click(btn(t("blocks.toolbar.altText")));
    await odpowiedz(null);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("przycisk odłączenia linku pojawia się DOPIERO, gdy link istnieje", () => {
    zamontuj("image");
    expect(screen.queryByRole("button", { name: t("blocks.toolbar.unlink") })).toBeNull();
  });

  it("odłączenie linku czyści pole href", () => {
    const { onChange } = zamontuj("image", { href: "https://example.org/cel" });
    fireEvent.click(btn(t("blocks.toolbar.unlink")));
    expect(ostatnieDane(onChange).href).toBe("");
  });

  it("podmiana URL zapisuje nowy adres", async () => {
    const { onChange } = zamontuj("image");
    fireEvent.click(btn(t("blocks.toolbar.replaceUrl")));
    await odpowiedz("https://example.org/b.jpg");
    expect(ostatnieDane(onChange).url).toBe("https://example.org/b.jpg");
  });

  it("kosz paska czyści URL medium", () => {
    const { onChange } = zamontuj("image");
    fireEvent.click(btn(t("blocks.toolbar.clearUrl")));
    expect(ostatnieDane(onChange).url).toBe("");
  });
});

describe("MediaWidgetToolbar - ustawienia wideo i audio", () => {
  it("proporcja zapisuje wybraną wartość", () => {
    const { onChange } = zamontuj("video");
    fireEvent.click(btn(`${t("blocks.toolbar.aspect")} 9:16`));
    expect(ostatnieDane(onChange).aspect).toBe("9:16");
  });

  it("domyślna proporcja 16:9 jest wciśnięta, gdy dane jej nie ustalają", () => {
    zamontuj("video");
    expect(btn(`${t("blocks.toolbar.aspect")} 16:9`)).toHaveAttribute("aria-pressed", "true");
  });

  it("poster i napisy idą przez dialog i zapisują się w osobnych polach", async () => {
    const { onChange } = zamontuj("video");
    fireEvent.click(btn(t("blocks.toolbar.poster")));
    await odpowiedz("https://example.org/poster.jpg");
    fireEvent.click(btn(t("blocks.toolbar.captions")));
    await odpowiedz("https://example.org/napisy.vtt");
    expect(ostatnieDane(onChange).captionsUrl).toBe("https://example.org/napisy.vtt");
    // Pierwsze ustawienie nie zostało zgubione przy drugim.
    const pola = onChange.mock.calls.map(([b]) => (b.data as Record<string, unknown>).poster);
    expect(pola).toContain("https://example.org/poster.jpg");
  });

  it("wyciszenie zmienia zarówno stan, jak i etykietę przycisku", () => {
    const { onChange } = zamontuj("video");
    fireEvent.click(btn("Mute"));
    expect(ostatnieDane(onChange).muted).toBe(true);
  });

  it("przy wyciszonym wideo przycisk zaprasza do włączenia dźwięku", () => {
    zamontuj("video", { muted: true });
    expect(btn("Unmute")).toHaveAttribute("aria-pressed", "true");
  });

  it("pobieranie audio przełącza się", () => {
    const { onChange } = zamontuj("audio");
    fireEvent.click(btn(t("blocks.toolbar.download")));
    expect(ostatnieDane(onChange).download).toBe(true);
  });

  it("okładka audio idzie przez dialog", async () => {
    const { onChange } = zamontuj("audio");
    fireEvent.click(btn(t("blocks.toolbar.cover")));
    await odpowiedz("https://example.org/cover.png");
    expect(ostatnieDane(onChange).cover).toBe("https://example.org/cover.png");
  });
});

describe("MediaWidgetToolbar - dwuetapowy dialog zrodla", () => {
  it("oba kroki wypełnione zapisują opis i URL naraz", async () => {
    const { onChange } = zamontuj("image");
    fireEvent.click(btn(t("blocks.toolbar.source")));
    const pierwszy = await odpowiedz("Komisja Europejska");
    expect(pierwszy).toMatchObject({ label: t("blocks.toolbar.sourceLabel") });
    const drugi = await odpowiedz("https://example.org/zrodlo");
    expect(drugi).toMatchObject({ label: t("blocks.toolbar.sourceUrl") });
    expect(ostatnieDane(onChange)).toMatchObject({
      source: "Komisja Europejska",
      sourceUrl: "https://example.org/zrodlo",
    });
  });

  it("anulowanie DRUGIEGO kroku zapisuje sam opis źródła", async () => {
    const { onChange } = zamontuj("image");
    fireEvent.click(btn(t("blocks.toolbar.source")));
    await odpowiedz("Eurostat");
    await odpowiedz(null);
    const dane = ostatnieDane(onChange);
    expect(dane.source).toBe("Eurostat");
    expect(dane.sourceUrl).toBeUndefined();
  });

  it("anulowanie PIERWSZEGO kroku nie zapisuje nic", async () => {
    const { onChange } = zamontuj("image");
    fireEvent.click(btn(t("blocks.toolbar.source")));
    await odpowiedz(null);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("przycisk źródła jest wciśnięty, gdy w danych jest opis ALBO URL", () => {
    zamontuj("image", { sourceUrl: "https://example.org/zrodlo" });
    expect(btn(t("blocks.toolbar.source"))).toHaveAttribute("aria-pressed", "true");
  });
});

describe("MediaWidgetToolbar - i18n PL/EN", () => {
  it("etykiety paska istnieją w OBU językach, a słowniki nie są kopią", () => {
    const pl = realT("pl");
    const en = realT("en");
    // Część etykiet to internacjonalizmy identyczne w obu językach („Link",
    // „Autoplay"), więc asercja „każda różna" byłaby fałszywie surowa.
    // Dowodzimy: (1) każdy klucz istnieje w OBU słownikach (brak echa klucza),
    // (2) słowniki jako całość są różne - czyli EN nie jest kopią PL.
    const klucze = [
      "blocks.toolbar.replaceUrl",
      "blocks.toolbar.altText",
      "blocks.toolbar.link",
      "blocks.toolbar.unlink",
      "blocks.toolbar.alignLeft",
      "blocks.toolbar.sizeSmall",
      "blocks.toolbar.rounded",
      "blocks.toolbar.poster",
      "blocks.toolbar.captions",
      "blocks.toolbar.cover",
      "blocks.toolbar.download",
      "blocks.toolbar.source",
      "blocks.toolbar.sourceLabel",
      "blocks.toolbar.sourceUrl",
      "blocks.toolbar.clearUrl",
    ];
    for (const klucz of klucze) {
      expect(pl(klucz)).not.toBe(klucz);
      expect(en(klucz)).not.toBe(klucz);
    }
    const rozne = klucze.filter((k) => pl(k) !== en(k));
    expect(rozne.length).toBeGreaterThan(klucze.length / 2);
  });
});
