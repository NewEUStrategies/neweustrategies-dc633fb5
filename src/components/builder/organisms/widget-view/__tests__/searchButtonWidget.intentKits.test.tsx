// Zależności wyszukiwarki na intencję (P2.3, runda poprawek po dowodzie).
// Dowód pokazał w sieci gościa `useVoiceSearch` (chunk wskaźnika nagrywania)
// i `facetModel` -> archiwa w 10/10 przebiegach: chunk widgetu jest
// gruntowany i hydratowany w oknie startu, więc jego STATYCZNE importy jechały
// do każdego gościa. Test liczy PIERWSZE załadowania tych modułów (fabryka
// `vi.mock` rusza dopiero przy pierwszym imporcie modułu):
//  - render serwera i hydratacja nie ładują ani dyktowania, ani modelu
//    kubełków, a mikrofon i tak jest widoczny (sonda możliwości przeglądarki);
//  - otwarcie panelu (fokus pola) ładuje model kubełków, dyktowania nadal nie;
//  - pierwsze kliknięcie mikrofonu ładuje dyktowanie i od razu je startuje,
//    na tym samym węźle przycisku (fokus z klawiatury zostaje);
//  - sonda przed zestawem: samo nagrywanie (bez Web Speech) tylko z zapisaną
//    sesją, jak efekt montażu `useVoiceSearch`.
// Rejestr modułów jest wspólny dla pliku, a Vitest wykonuje przypadki w
// kolejności deklaracji - pierwszy sprawdza stan „nic nie załadowane".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { SearchButtonWidget } from "../SearchButtonWidget";

const loads = vi.hoisted(() => ({ voice: 0, indicator: 0, facets: 0 }));

vi.mock("@/lib/search/useVoiceSearch", async (importOriginal) => {
  loads.voice += 1;
  return await importOriginal<typeof import("@/lib/search/useVoiceSearch")>();
});
vi.mock("@/components/voice/VoiceListeningIndicator", async (importOriginal) => {
  loads.indicator += 1;
  return await importOriginal<typeof import("@/components/voice/VoiceListeningIndicator")>();
});
vi.mock("@/lib/search/facetModel", async (importOriginal) => {
  loads.facets += 1;
  return await importOriginal<typeof import("@/lib/search/facetModel")>();
});

// Atrapa bez `auth`: `useVoiceSearch` traktuje błąd odczytu sesji jak gościa
// i startuje rozpoznawanie mowy w przeglądarce (Web Speech).
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: [], error: null }),
    from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
  },
}));
vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  useRouter: () => undefined,
}));

const speech = { started: 0 };

class StubSpeechRecognition {
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 0;
  onresult: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start(): void {
    speech.started += 1;
  }
  stop(): void {
    this.onend?.();
  }
  abort(): void {}
}

type VoiceGlobals = Record<
  "SpeechRecognition" | "webkitSpeechRecognition" | "MediaRecorder",
  unknown
>;

function installSpeechRecognition(): void {
  Object.defineProperty(window, "webkitSpeechRecognition", {
    configurable: true,
    writable: true,
    value: StubSpeechRecognition,
  });
}

function dropVoiceGlobals(): void {
  const w = window as unknown as Partial<VoiceGlobals>;
  delete w.webkitSpeechRecognition;
  delete w.SpeechRecognition;
  delete w.MediaRecorder;
  Reflect.deleteProperty(navigator, "mediaDevices");
}

/** Przeglądarka z nagrywaniem, ale bez Web Speech (np. Firefox). */
function installRecordingOnly(): void {
  Object.defineProperty(window, "MediaRecorder", {
    configurable: true,
    writable: true,
    value: class {},
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => Promise.reject(new Error("bez mikrofonu w teście")) },
  });
}

const widget = () => (
  <SearchButtonWidget
    label="Szukaj"
    mode="dropdown"
    heading=""
    liveResults
    limit={8}
    lang="pl"
    height={36}
    radius={6}
    fontSize={14}
  />
);

/** Przycisk mikrofonu niezależnie od widoczności (role pomijają ukryte). */
const micButton = (container: HTMLElement): HTMLButtonElement => {
  const buttons = container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]");
  expect(buttons).toHaveLength(1);
  return buttons[0];
};

describe("SearchButtonWidget - dyktowanie i model kubełków na intencję (P2.3)", () => {
  beforeEach(() => {
    localStorage.clear();
    speech.started = 0;
    dropVoiceGlobals();
  });
  afterEach(() => {
    cleanup();
    dropVoiceGlobals();
    document.body.innerHTML = "";
  });

  it("render serwera i hydratacja nie ładują dyktowania ani modelu kubełków", async () => {
    installSpeechRecognition();
    const container = document.createElement("div");
    container.innerHTML = renderToString(widget());
    document.body.append(container);
    const errors: unknown[] = [];
    let root: Root | null = null;
    await act(async () => {
      root = hydrateRoot(container, widget(), { onRecoverableError: (e) => errors.push(e) });
    });
    // Efekt sondy mikrofonu i debounce wyników na żywo (200 ms, pusta fraza).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(errors).toEqual([]);
    const mic = micButton(container);
    expect(mic.getAttribute("aria-label")).toBe("Wyszukiwanie głosowe");
    expect(mic.style.visibility).toBe("");
    expect(mic.hasAttribute("inert")).toBe(false);
    expect(mic.hasAttribute("data-voice-unsupported")).toBe(false);
    expect(loads).toEqual({ voice: 0, indicator: 0, facets: 0 });

    await act(async () => root?.unmount());
    container.remove();
  });

  it("otwarcie panelu (fokus pola) ładuje model kubełków, dyktowania nadal nie", async () => {
    const { container } = render(widget());
    fireEvent.focus(container.querySelector("input")!);
    await waitFor(() => expect(loads.facets).toBe(1));
    expect(loads.voice).toBe(0);
    expect(loads.indicator).toBe(0);
  });

  it("pierwsze kliknięcie mikrofonu ładuje dyktowanie i startuje je na tym samym przycisku", async () => {
    installSpeechRecognition();
    const { container } = render(widget());
    const mic = micButton(container);
    expect(loads.voice).toBe(0);

    // Klawiatura: fokus (rozgrzewka) i aktywacja tego samego węzła.
    act(() => mic.focus());
    fireEvent.click(mic);
    await waitFor(() => expect(speech.started).toBe(1));
    await waitFor(() => expect(mic.getAttribute("aria-pressed")).toBe("true"));
    expect(mic.isConnected).toBe(true);
    expect(micButton(container)).toBe(mic);
    expect(document.activeElement).toBe(mic);
    expect(mic.getAttribute("aria-label")).toBe("Zatrzymaj dyktowanie");
    expect(loads.voice).toBe(1);
    expect(loads.indicator).toBe(1);

    // Drugie kliknięcie idzie już do zamontowanego hooka: stop, bez startu.
    fireEvent.click(mic);
    await waitFor(() => expect(mic.getAttribute("aria-pressed")).toBe("false"));
    expect(speech.started).toBe(1);
  });

  it("rozgrzewka (najechanie, fokus) nie startuje dyktowania", async () => {
    installSpeechRecognition();
    const { container } = render(widget());
    const mic = micButton(container);
    fireEvent.pointerEnter(mic);
    act(() => mic.focus());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(speech.started).toBe(0);
    expect(mic.getAttribute("aria-pressed")).toBe("false");
  });

  it("samo nagrywanie bez Web Speech: mikrofon tylko z zapisaną sesją", () => {
    installRecordingOnly();
    const guest = render(widget());
    const guestMic = micButton(guest.container);
    expect(guestMic.style.visibility).toBe("hidden");
    expect(guestMic.hasAttribute("inert")).toBe(true);
    expect(guestMic.hasAttribute("data-voice-unsupported")).toBe(true);
    cleanup();

    localStorage.setItem("sb-test-auth-token", '{"access_token":"t"}');
    const signedIn = render(widget());
    const mic = micButton(signedIn.container);
    expect(mic.style.visibility).toBe("");
    expect(mic.hasAttribute("inert")).toBe(false);
    expect(mic.hasAttribute("data-voice-unsupported")).toBe(false);
  });

  it("bez Web Speech i bez nagrywania mikrofon jest schowany (pudełko zostaje)", () => {
    const { container } = render(widget());
    const mic = micButton(container);
    expect(mic.style.visibility).toBe("hidden");
    expect(mic.hasAttribute("inert")).toBe(true);
  });
});
