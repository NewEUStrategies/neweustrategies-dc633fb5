import { describe, it, expect } from "vitest";
import { normalizeTtsInput } from "./tts";
import {
  DEFAULT_TTS_MODEL_ID,
  DEFAULT_TTS_VOICE_ID,
  TTS_MAX_CHARS,
  TTS_MODELS,
  TTS_VOICES,
} from "@/lib/audio/ttsCanonical";

// Stałe importujemy ze ŹRÓDŁA PRAWDY, a nie przepisujemy do testu. Przepisana
// wartość rozjeżdża się po cichu przy pierwszej zmianie allowlisty - a to jest
// dokładnie ten rodzaj rozjazdu, który ten plik ma wykrywać.
//
// Szukamy pozycji INNEJ niż domyślna, żeby przypadek „przyjmuje wartość
// z allowlisty" nie przechodził przypadkiem przez gałąź wartości domyślnej.
// Wyszukiwaniem, a nie indeksem: indeks wybuchłby, gdyby ktoś legalnie skrócił
// allowlistę do jednej pozycji, i test padłby z powodu, który nie jest defektem.
const GLOS_NIEDOMYSLNY = TTS_VOICES.find((v) => v.id !== DEFAULT_TTS_VOICE_ID)?.id;
const MODEL_NIEDOMYSLNY = TTS_MODELS.find((m) => m.id !== DEFAULT_TTS_MODEL_ID)?.id;

describe("normalizeTtsInput", () => {
  it("odrzuca brak tekstu i tekst złożony z samych spacji", () => {
    expect(normalizeTtsInput({})).toEqual({ ok: false, error: "Missing text" });
    expect(normalizeTtsInput({ text: "   " })).toEqual({ ok: false, error: "Missing text" });
  });

  it("przycina tekst i stosuje kanoniczne wartości domyślne głosu i modelu", () => {
    const r = normalizeTtsInput({ text: "  hello  " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.safeText).toBe("hello");
      expect(r.voiceId).toBe(DEFAULT_TTS_VOICE_ID);
      expect(r.model).toBe(DEFAULT_TTS_MODEL_ID);
    }
  });

  it("przyjmuje głos i model z allowlisty kanonicznej inne niż domyślne", () => {
    // Gdyby allowlista miała po jednej pozycji, ten przypadek nie ma czego
    // sprawdzić - i ma to powiedzieć wprost, zamiast paść na `undefined`.
    expect(GLOS_NIEDOMYSLNY, "allowlista głosów ma tylko pozycję domyślną").toBeDefined();
    expect(MODEL_NIEDOMYSLNY, "allowlista modeli ma tylko pozycję domyślną").toBeDefined();
    const r = normalizeTtsInput({
      text: "hi",
      voiceId: GLOS_NIEDOMYSLNY,
      model: MODEL_NIEDOMYSLNY,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.voiceId).toBe(GLOS_NIEDOMYSLNY);
      expect(r.model).toBe(MODEL_NIEDOMYSLNY);
    }
  });

  it("odrzuca głos o niepoprawnym kształcie", () => {
    for (const voiceId of ["short", "has space 1234", "../../secret0000"]) {
      expect(normalizeTtsInput({ text: "hi", voiceId })).toEqual({
        ok: false,
        error: "Invalid voiceId",
      });
    }
  });

  // TO JEST REGRESJA DEFEKTU, NIE KOLEJNY PRZYPADEK BRZEGOWY.
  //
  // Do 2026-09-14 walidacja głosu była regexem `[A-Za-z0-9]{8,40}`, czyli
  // sprawdzeniem KSZTAŁTU. Ten identyfikator ma poprawny kształt i przechodził -
  // mimo że nie jest żadnym z sześciu głosów opłaconych przez platformę.
  // Jeżeli ten test kiedyś zzielenieje na `ok: true`, znaczy to, że walidacja
  // wróciła do sprawdzania kształtu zamiast przynależności.
  it("odrzuca głos o poprawnym kształcie, ale spoza allowlisty", () => {
    const ksztaltOk = "ABCdef123456";
    expect(/^[A-Za-z0-9]{8,40}$/.test(ksztaltOk)).toBe(true);
    expect(TTS_VOICES.some((v) => v.id === ksztaltOk)).toBe(false);
    expect(normalizeTtsInput({ text: "hi", voiceId: ksztaltOk })).toEqual({
      ok: false,
      error: "Invalid voiceId",
    });
  });

  // DRUGA POŁOWA TEJ SAMEJ REGRESJI. Trasa miała własną listę czterech modeli,
  // z czego dwa nie występują w kanonicznej `TTS_MODELS`. Model jest wymiarem
  // KOSZTOWYM, więc każdy z nich był furtką do syntezy w cenniku, którego
  // najemca nigdy nie wybrał.
  it("odrzuca modele z nieistniejącej już lokalnej listy trasy", () => {
    for (const model of ["eleven_monolingual_v1", "eleven_turbo_v2"]) {
      expect(TTS_MODELS.some((m) => m.id === model)).toBe(false);
      expect(normalizeTtsInput({ text: "hi", model })).toEqual({
        ok: false,
        error: "Invalid model",
      });
    }
  });

  it("przycina tekst do kanonicznego limitu znaków", () => {
    const r = normalizeTtsInput({ text: "a".repeat(TTS_MAX_CHARS + 1000) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.safeText.length).toBe(TTS_MAX_CHARS);
  });
});
