// Karta kanonicznego lektora AI wpisu: wybór głosu per język + stan nagrania
// w prywatnym cache.
//
// CO TU DOWODZIMY:
//   * wybór głosu trafia do rodzica z WŁAŚCIWYM językiem, a „dziedzicz" zgłasza
//     null (czyli brak nadpisania, nie pusty identyfikator głosu),
//   * wgrany ręcznie plik MP3 WYŁĄCZA wybór głosu dla tego języka i mówi wprost,
//     że lektor AI nie będzie wołany (koszt syntezy = 0),
//   * karta pokazuje konsekwencję kosztową: metryki istniejącego nagrania oraz
//     ostrzeżenie, że zmiana głosu wymusi kolejną (płatną) syntezę,
//   * ostrzeżenie o zmianie głosu pojawia się TYLKO przy jawnym nadpisaniu -
//     przy dziedziczeniu edytor nie zna głosu najemcy, więc nie ma czego porównać,
//   * liczby, rozmiary i daty są formatowane w języku panelu (pl-PL / en-GB),
//   * głos lub model spoza allowlisty pokazuje surowy identyfikator, a nie pustkę.
//
// DLACZEGO TO WAŻNE: każda synteza to realny koszt u dostawcy, a nagranie jest
// jedno na język. Karta jest jedynym miejscem, w którym redakcja widzi, że
// zmiana głosu skasuje pieniądze przy najbliższym odsłuchaniu. Brak tego sygnału
// zamienia „poprawię brzmienie" w niekontrolowany rachunek; nierozpoznany głos
// pokazany jako puste pole ukrywa nagranie zrobione głosem wycofanym z listy.
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { BASE_ISO } from "@/test/post-editor/fixtures";
import { TTS_VOICES } from "@/lib/audio/ttsCanonical";
import type { PostTtsRendition, PostTtsRenditionMap } from "@/lib/audio/ttsRenditions";

const h = vi.hoisted(() => ({
  lang: "pl",
  selectProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(() => h.lang),
);

// Atom wyboru głosu ma własną powierzchnię testową (i własną nakładkę i18n oraz
// Radiksa w środku). Tutaj interesuje nas KONTRAKT: z jakimi propsami karta go
// woła i co robi z jego odpowiedzią. Atrapa oddaje natywny <select> nazwany tak
// samo (`aria-label`), bo tak nazywa go produkcja.
vi.mock("@/components/admin/atoms/TtsVoiceSelect", async () => {
  const React = await import("react");
  return {
    TtsVoiceSelect: (props: {
      value: string | null;
      onChange: (voiceId: string | null) => void;
      inheritLabel?: string;
      ariaLabel: string;
      disabled?: boolean;
    }) => {
      h.selectProps.push(props as unknown as Record<string, unknown>);
      return React.createElement(
        "select",
        {
          value: props.value ?? "",
          disabled: props.disabled,
          "aria-label": props.ariaLabel,
          onChange: (e: { target: { value: string } }) =>
            props.onChange(e.target.value === "" ? null : e.target.value),
        },
        [
          React.createElement("option", { key: "inherit", value: "" }, props.inheritLabel ?? ""),
          // Treść opcji celowo NIE jest nazwą głosu: nazwa pojawia się też
          // w metrykach nagrania, a dwa takie same napisy uniemożliwiłyby
          // asercję „karta pokazuje głos nagrania".
          ...TTS_VOICES.map((v) =>
            React.createElement("option", { key: v.id, value: v.id }, `opcja-${v.id}`),
          ),
        ],
      );
    },
  };
});

import { TtsVoiceCard } from "../TtsVoiceCard";

const GEORGE = "JBFqnCBsd6RMkjVDRZzb";
const SARAH = "EXAVITQu4vr4xnSDxMaL";

function rendition(overrides: Partial<PostTtsRendition> = {}): PostTtsRendition {
  return {
    lang: "pl",
    voice_id: GEORGE,
    model: "eleven_multilingual_v2",
    content_hash: "abc123",
    byte_size: 3_670_016, // 3,5 MB
    char_count: 12_345,
    synth_count: 2,
    synthesized_at: BASE_ISO,
    ...overrides,
  };
}

interface Props {
  voicePl?: string | null;
  voiceEn?: string | null;
  renditions?: PostTtsRenditionMap | undefined;
  uploadedPl?: boolean;
  uploadedEn?: boolean;
  lang?: string;
}

function renderCard(props: Props = {}) {
  h.lang = props.lang ?? "pl";
  h.selectProps.length = 0;
  const onVoiceChange = vi.fn<(lang: "pl" | "en", voiceId: string | null) => void>();
  const view = render(
    <TtsVoiceCard
      voicePl={props.voicePl ?? null}
      voiceEn={props.voiceEn ?? null}
      onVoiceChange={onVoiceChange}
      renditions={props.renditions}
      uploadedPl={props.uploadedPl ?? false}
      uploadedEn={props.uploadedEn ?? false}
    />,
  );
  return { ...view, onVoiceChange };
}

/** Kolumna języka - wskazana po etykiecie, żeby asercje nie mieszały PL z EN. */
function column(labelKey: string): HTMLElement {
  return screen.getByText(`adminPostPanes.sections.${labelKey}`).parentElement as HTMLElement;
}
const plColumn = () => column("ttsVoicePlLabel");
const enColumn = () => column("ttsVoiceEnLabel");
const voiceSelect = (labelKey: string) =>
  screen.getByLabelText(`adminPostPanes.sections.${labelKey}`) as HTMLSelectElement;

/**
 * Formaty ICU wstawiają spacje niełamiące (U+00A0 / U+202F); RTL normalizuje
 * tekst z DOM do zwykłych spacji, więc oczekiwanie musi przejść tę samą
 * normalizację - inaczej test pękałby na niewidocznym znaku, a nie na regule.
 */
const norm = (text: string) => text.replace(/\s/g, " ");
const num = (value: number, locale: string, digits = 0) =>
  norm(new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value));
const when = (iso: string, locale: string) =>
  norm(
    new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
      new Date(iso),
    ),
  );

describe("TtsVoiceCard - budowa karty", () => {
  it("nazywa sekcję i oba języki kluczami i18n", () => {
    renderCard();

    expect(screen.getByText("adminPostPanes.sections.ttsVoiceTitle")).toBeInTheDocument();
    expect(screen.getByText("adminPostPanes.sections.ttsVoiceHint")).toBeInTheDocument();
    expect(screen.getByText("adminPostPanes.sections.ttsVoicePlLabel")).toBeInTheDocument();
    expect(screen.getByText("adminPostPanes.sections.ttsVoiceEnLabel")).toBeInTheDocument();
  });

  it("każda kolumna dostaje własną podpowiedź i opcję dziedziczenia głosu najemcy", () => {
    renderCard();

    expect(
      within(plColumn()).getByText("adminPostPanes.sections.ttsVoicePlHint"),
    ).toBeInTheDocument();
    expect(
      within(enColumn()).getByText("adminPostPanes.sections.ttsVoiceEnHint"),
    ).toBeInTheDocument();
    expect(h.selectProps.map((p) => p.inheritLabel)).toEqual([
      "adminPostPanes.sections.ttsVoiceInherit",
      "adminPostPanes.sections.ttsVoiceInherit",
    ]);
  });

  it("pokazuje aktualnie przypięte głosy per język", () => {
    renderCard({ voicePl: GEORGE, voiceEn: SARAH });

    expect(voiceSelect("ttsVoicePlLabel").value).toBe(GEORGE);
    expect(voiceSelect("ttsVoiceEnLabel").value).toBe(SARAH);
  });
});

describe("TtsVoiceCard - zmiana głosu", () => {
  it("wybór głosu w kolumnie polskiej zgłasza język pl", () => {
    const { onVoiceChange } = renderCard();

    fireEvent.change(voiceSelect("ttsVoicePlLabel"), { target: { value: SARAH } });

    expect(onVoiceChange).toHaveBeenCalledWith("pl", SARAH);
  });

  it("wybór głosu w kolumnie angielskiej zgłasza język en", () => {
    const { onVoiceChange } = renderCard();

    fireEvent.change(voiceSelect("ttsVoiceEnLabel"), { target: { value: GEORGE } });

    expect(onVoiceChange).toHaveBeenCalledWith("en", GEORGE);
  });

  it("powrót do dziedziczenia zgłasza null, a nie pusty identyfikator", () => {
    const { onVoiceChange } = renderCard({ voicePl: GEORGE });

    fireEvent.change(voiceSelect("ttsVoicePlLabel"), { target: { value: "" } });

    expect(onVoiceChange).toHaveBeenCalledWith("pl", null);
  });
});

describe("TtsVoiceCard - wgrany plik zamiast lektora AI", () => {
  it("wgrany MP3 blokuje wybór głosu w tym języku i tłumaczy dlaczego", () => {
    renderCard({ uploadedPl: true });

    expect(voiceSelect("ttsVoicePlLabel").disabled).toBe(true);
    expect(
      within(plColumn()).getByText("adminPostPanes.sections.ttsRenditionUploadedNote"),
    ).toBeInTheDocument();
    expect(
      within(plColumn()).queryByText("adminPostPanes.sections.ttsVoicePlHint"),
    ).not.toBeInTheDocument();
  });

  it("dla wgranego pliku nie ma sensu pokazywać stanu nagrania AI", () => {
    renderCard({ uploadedPl: true, renditions: { pl: rendition() } });

    expect(
      within(plColumn()).queryByText("adminPostPanes.sections.ttsRenditionTitle"),
    ).not.toBeInTheDocument();
    // Druga kolumna (bez wgranego pliku) stan nagrania nadal pokazuje.
    expect(
      within(enColumn()).getByText("adminPostPanes.sections.ttsRenditionTitle"),
    ).toBeInTheDocument();
  });

  it("blokada dotyczy tylko języka z wgranym plikiem", () => {
    renderCard({ uploadedEn: true });

    expect(voiceSelect("ttsVoiceEnLabel").disabled).toBe(true);
    expect(voiceSelect("ttsVoicePlLabel").disabled).toBe(false);
  });
});

describe("TtsVoiceCard - stan nagrania", () => {
  it("bez nagrania mówi wprost, że jeszcze nie syntezowano (w obu językach)", () => {
    renderCard({ renditions: undefined });

    expect(
      within(plColumn()).getByText("adminPostPanes.sections.ttsRenditionNone"),
    ).toBeInTheDocument();
    expect(
      within(enColumn()).getByText("adminPostPanes.sections.ttsRenditionNone"),
    ).toBeInTheDocument();
  });

  it("nagranie pokazuje głos, poziom modelu, rozmiar, znaki, liczbę syntez i datę", () => {
    renderCard({ voicePl: GEORGE, renditions: { pl: rendition() } });
    const col = within(plColumn());

    expect(col.getByText("George")).toBeInTheDocument();
    expect(col.getByText("admin.reading.ttsModelTier.quality")).toBeInTheDocument();
    expect(col.getByText(`${num(3.5, "pl-PL", 1)} MB`)).toBeInTheDocument();
    expect(col.getByText(num(12_345, "pl-PL"))).toBeInTheDocument();
    expect(col.getByText(num(2, "pl-PL"))).toBeInTheDocument();
    expect(col.getByText(when(BASE_ISO, "pl-PL"))).toBeInTheDocument();
    // Każda metryka ma podpis - inaczej liczby nic nie znaczą.
    for (const key of [
      "ttsRenditionVoice",
      "ttsRenditionModel",
      "ttsRenditionSize",
      "ttsRenditionChars",
      "ttsRenditionSynths",
      "ttsRenditionWhen",
    ]) {
      expect(col.getByText(`adminPostPanes.sections.${key}`)).toBeInTheDocument();
    }
  });

  it("nagranie zrobione głosem spoza allowlisty pokazuje surowy identyfikator", () => {
    renderCard({ renditions: { pl: rendition({ voice_id: "wycofany-glos-123" }) } });

    expect(within(plColumn()).getByText("wycofany-glos-123")).toBeInTheDocument();
  });

  it("model spoza allowlisty pokazuje swoją nazwę, a nie pusty poziom", () => {
    renderCard({ renditions: { pl: rendition({ model: "eleven_eksperymentalny" }) } });

    expect(within(plColumn()).getByText("eleven_eksperymentalny")).toBeInTheDocument();
  });

  it("nagrania są rozdzielone per język (metryki EN nie wyciekają do kolumny PL)", () => {
    renderCard({
      renditions: {
        pl: rendition({ char_count: 1000, byte_size: 2048 }),
        en: rendition({ lang: "en", voice_id: SARAH, char_count: 2000, byte_size: 4096 }),
      },
    });

    expect(within(plColumn()).getByText("George")).toBeInTheDocument();
    expect(within(enColumn()).getByText("Sarah")).toBeInTheDocument();
    expect(within(plColumn()).queryByText("Sarah")).not.toBeInTheDocument();
  });
});

describe("TtsVoiceCard - format rozmiaru nagrania", () => {
  it("nagranie poniżej megabajta jest podane w kilobajtach", () => {
    renderCard({ renditions: { pl: rendition({ byte_size: 512_000 }) } });

    expect(within(plColumn()).getByText(`${num(500, "pl-PL")} kB`)).toBeInTheDocument();
  });

  it("zerowy rozmiar to kreska, a nie 0 kB (nagrania jeszcze nie ma)", () => {
    renderCard({ renditions: { pl: rendition({ byte_size: 0 }) } });

    expect(within(plColumn()).getByText("-")).toBeInTheDocument();
  });

  it("rozmiar ujemny (uszkodzony wiersz) też daje kreskę, nie liczbę ujemną", () => {
    renderCard({ renditions: { pl: rendition({ byte_size: -5 }) } });

    expect(within(plColumn()).getByText("-")).toBeInTheDocument();
  });
});

describe("TtsVoiceCard - język panelu", () => {
  it("panel angielski formatuje liczby i datę po angielsku", () => {
    renderCard({ lang: "en", renditions: { pl: rendition() } });
    const col = within(plColumn());

    expect(col.getByText(num(12_345, "en-GB"))).toBeInTheDocument();
    expect(col.getByText(when(BASE_ISO, "en-GB"))).toBeInTheDocument();
    expect(col.getByText(`${num(3.5, "en-GB", 1)} MB`)).toBeInTheDocument();
  });

  it("wariant regionalny angielskiego (en-US) też liczy się jako angielski", () => {
    renderCard({ lang: "en-US", renditions: { pl: rendition() } });

    expect(within(plColumn()).getByText(when(BASE_ISO, "en-GB"))).toBeInTheDocument();
  });
});

describe("TtsVoiceCard - ostrzeżenie o kosztownej ponownej syntezie", () => {
  it("zmiana kanonicznego głosu przy istniejącym nagraniu OSTRZEGA o nowej syntezie", () => {
    renderCard({ voicePl: SARAH, renditions: { pl: rendition({ voice_id: GEORGE }) } });

    expect(
      within(plColumn()).getByText("adminPostPanes.sections.ttsRenditionVoiceChanged"),
    ).toBeInTheDocument();
  });

  it("głos zgodny z nagraniem nie generuje ostrzeżenia", () => {
    renderCard({ voicePl: GEORGE, renditions: { pl: rendition({ voice_id: GEORGE }) } });

    expect(
      within(plColumn()).queryByText("adminPostPanes.sections.ttsRenditionVoiceChanged"),
    ).not.toBeInTheDocument();
  });

  it("przy dziedziczeniu głosu nie twierdzimy nic o zmianie (nie znamy głosu najemcy)", () => {
    renderCard({ voicePl: null, renditions: { pl: rendition({ voice_id: GEORGE }) } });

    expect(
      within(plColumn()).queryByText("adminPostPanes.sections.ttsRenditionVoiceChanged"),
    ).not.toBeInTheDocument();
  });

  it("bez nagrania nie ma z czym porównywać, więc nie ma ostrzeżenia", () => {
    renderCard({ voicePl: SARAH, renditions: {} });

    expect(
      screen.queryByText("adminPostPanes.sections.ttsRenditionVoiceChanged"),
    ).not.toBeInTheDocument();
  });
});

describe("TtsVoiceCard - świadek defektu", () => {
  it("SWIADEK DEFEKTU: etykieta kolumny wskazuje na nieistniejące pole (htmlFor bez id)", () => {
    // `<label htmlFor="tts-voice-pl">` jest w kodzie karty, ale `TtsVoiceSelect`
    // nie przyjmuje ani nie ustawia `id` (patrz TtsVoiceSelectProps), więc
    // powiązanie jest MARTWE: klik w etykietę nie ustawia fokusu na kontrolce.
    // Kontrolka ma osobno `aria-label`, więc nie jest bezimienna dla czytnika -
    // dlatego to defekt użyteczności, nie blokada dostępności. Test opisuje stan
    // OBECNY: karta prosi o powiązanie, którego nie ma jak spełnić.
    renderCard();

    const label = screen.getByText("adminPostPanes.sections.ttsVoicePlLabel");
    expect(label.getAttribute("for")).toBe("tts-voice-pl");
    expect(document.getElementById("tts-voice-pl")).toBeNull();
    // Atrapa jest wierna produkcji: karta NIE przekazuje atomowi żadnego `id`.
    expect(h.selectProps.every((p) => !("id" in p))).toBe(true);
  });
});
