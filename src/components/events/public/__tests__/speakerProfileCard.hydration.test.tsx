// Karta prelegenta: HTML z serwera i pierwszy render klienta musza byc
// identyczne, a karta z serwera jest ZWINIETA.
//
// PRZEDMIOT DOWODU. Stan karty zalezy WYLACZNIE od klikniecia; `matchMedia`
// (`prefers-reduced-motion`), pomiary ukladu (FLIP) i rozgrzewanie duzego
// kadru czyta obsluga zdarzenia oraz `useLayoutEffect`, nigdy render. Odczyt
// ktoregokolwiek w renderze dalby na serwerze inny rysunek niz u uczestnika -
// React zglosilby niezgodnosc hydratacji i przerysowal siatke, a to jest i
// koszt INP, i skok ukladu (CLS). Test stawia HTML `renderToString`, hydratuje
// go tym samym drzewem i zada ZERA bledow odzyskiwalnych i ZERA `console.error`.
//
// CORE WEB VITALS. HTML z serwera niesie tylko miniature (kwadrat 2x80 px) -
// duzy kadr 800 px nie moze trafic do dokumentu, bo przegladarka pobralaby go
// dla kazdej karty siatki, zanim ktokolwiek kliknie.
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/i18nReal";

import type { PublicSpeakerRow } from "@/lib/builder/speakersQuery";
import { eventFrontPl } from "@/lib/i18n-event-front";

const { SpeakerProfileCard, SPEAKER_CARD_LARGE_PX } =
  await import("@/components/events/public/molecules/SpeakerProfileCard");

const AVATAR = "https://proj.supabase.co/storage/v1/object/public/avatars/anna.jpg";
const CARD_PHOTO = "https://proj.supabase.co/storage/v1/object/public/cards/anna-scena.jpg";
const CARD = eventFrontPl.eventFront.speakers.card;
const EXPAND = CARD.expand.replace("{{name}}", "Anna Kowalska");
const COLLAPSE = CARD.collapse.replace("{{name}}", "Anna Kowalska");

function speaker(overrides: Partial<PublicSpeakerRow> = {}): PublicSpeakerRow {
  return {
    user_id: "u1",
    slug: "anna-kowalska",
    display_name: "Anna Kowalska",
    avatar_url: AVATAR,
    job_title: "Dyrektor",
    company: "NASK",
    headline_pl: "Prezes",
    headline_en: "President",
    bio_pl: null,
    bio_en: null,
    topics_pl: [],
    topics_en: [],
    languages: [],
    talks_count: 0,
    rating: 0,
    reviews_count: 0,
    is_expert: true,
    has_speaker_profile: true,
    sort_order: 0,
    card_photo_url: CARD_PHOTO,
    card_cta_color: "#ffcc00",
    tracks: [
      {
        id: "t1",
        key: "energia",
        namePl: "Energetyka",
        nameEn: "Energy",
        accentColor: "#aa3300",
        sessionsCount: 2,
      },
    ],
    ...overrides,
  };
}

async function serverThenClient(view: ReactElement) {
  const host = document.createElement("div");
  host.innerHTML = renderToString(view);
  document.body.append(host);
  const serverHtml = host.innerHTML;

  const errors: unknown[] = [];
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(host, view, { onRecoverableError: (error) => errors.push(error) });
  });
  return { host, root, errors, serverHtml };
}

const CASES: Array<{ label: string; view: () => ReactElement }> = [
  {
    label: "pelna karta z linkiem wewnetrznym (AppLink bez routera)",
    view: () => (
      <SpeakerProfileCard speaker={speaker({ card_cta_url: "/events/forum/program" })} lang="pl" />
    ),
  },
  {
    label: "karta z linkiem zewnetrznym i etykieta redakcji",
    view: () => (
      <SpeakerProfileCard
        speaker={speaker({
          card_cta_url: "https://example.org/rejestracja",
          card_cta_label_pl: "Zapisz sie",
        })}
        lang="pl"
      />
    ),
  },
  {
    label: "karta z przyciskiem profilu po angielsku",
    view: () => <SpeakerProfileCard speaker={speaker()} lang="en" onSelect={() => undefined} />,
  },
  {
    label: "karta bez zdjecia (bez przelacznika)",
    view: () => (
      <SpeakerProfileCard
        speaker={speaker({ avatar_url: null, card_photo_url: null, tracks: [], is_expert: false })}
        lang="pl"
      />
    ),
  },
];

describe("SpeakerProfileCard - SSR i hydratacja", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  for (const { label, view } of CASES) {
    it(`${label}: zero niezgodnosci i zero console.error`, async () => {
      const { host, root, errors, serverHtml } = await serverThenClient(view());
      try {
        expect(errors).toEqual([]);
        expect(consoleError).not.toHaveBeenCalled();
        // Hydratacja nie przerysowala niczego - DOM jest ten sam, co z serwera.
        expect(host.innerHTML).toBe(serverHtml);
        expect(serverHtml).not.toContain(`width=${SPEAKER_CARD_LARGE_PX}`);
        expect(serverHtml).toContain('data-state="collapsed"');
      } finally {
        await act(async () => root.unmount());
      }
    });
  }

  it("HTML z serwera: karta zwinieta, sama miniatura 2x80 px, bez duzego kadru", async () => {
    const { root, serverHtml } = await serverThenClient(
      <SpeakerProfileCard speaker={speaker()} lang="pl" onSelect={() => undefined} />,
    );
    try {
      expect(serverHtml).toContain('aria-expanded="false"');
      expect(serverHtml).toContain(`aria-label="${EXPAND}"`);
      expect(serverHtml).toContain("width=160");
      expect(serverHtml).not.toContain(`width=${SPEAKER_CARD_LARGE_PX}`);
      expect(serverHtml).not.toContain(`height=${SPEAKER_CARD_LARGE_PX}`);
      // Kolor redakcji dziala dopiero po rozwinieciu - serwer go nie rysuje.
      expect(serverHtml).toContain(
        `aria-label="${CARD.actionFor.replace("{{label}}", CARD.profileAction).replace("{{name}}", "Anna Kowalska")}"`,
      );
      expect(serverHtml.toLowerCase()).not.toContain("#ffcc00");
      // Podpis jest w HTML (SEO i pierwszy rysunek bez JS).
      expect(serverHtml).toContain("Anna Kowalska");
      expect(serverHtml).toContain("Energetyka");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("render i hydratacja nie czytaja matchMedia, ukladu ani nie pobieraja duzego kadru", async () => {
    const matchMedia = vi.spyOn(window, "matchMedia");
    const measure = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const created: string[] = [];
    vi.stubGlobal(
      "Image",
      class {
        decoding = "";
        set src(value: string) {
          created.push(value);
        }
      },
    );

    const { host, root, errors } = await serverThenClient(
      <SpeakerProfileCard speaker={speaker()} lang="pl" onSelect={() => undefined} />,
    );
    try {
      expect(errors).toEqual([]);
      expect(matchMedia).not.toHaveBeenCalled();
      expect(measure).not.toHaveBeenCalled();
      expect(created).toEqual([]);

      // Po hydratacji karta dziala: klik rozwija ja na kliencie.
      const toggle = host.querySelector("[aria-expanded]") as HTMLButtonElement;
      await act(async () => {
        toggle.click();
      });
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(toggle.getAttribute("aria-label")).toBe(COLLAPSE);
      expect(host.innerHTML).toContain(`width=${SPEAKER_CARD_LARGE_PX}`);
      // Dopiero klik czyta preferencje ruchu i rozgrzewa duzy kadr.
      expect(matchMedia).toHaveBeenCalled();
      expect(created).toHaveLength(1);
      expect(created[0]).toContain(`width=${SPEAKER_CARD_LARGE_PX}`);
      expect(errors).toEqual([]);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
    }
  });
});
