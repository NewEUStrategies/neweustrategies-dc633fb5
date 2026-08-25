// PODGLĄD MAILI TRANSAKCYJNYCH W PANELU (`src/lib/email/tx-preview.server.ts`).
// Przed tym plikiem: 0% - 40 niepokrytych linii, w tym CAŁA tabela danych
// demonstracyjnych dla 22 typów wiadomości w dwóch językach.
//
// PO CO TO JEST WAŻNE. Podgląd jest jedynym miejscem, w którym człowiek OGLĄDA
// mail przed jego wysłaniem: redakcja edytuje tu treść trzech wiadomości
// o miejscach zespołowych i na podstawie tego, co zobaczy, decyduje, czy
// zapisać zmianę. Jeżeli podgląd renderuje co innego niż sender, panel kłamie.
// Dlatego dowodzimy nie „że się renderuje", tylko ŻE TO, CO WIDAĆ, JEST
// TREŚCIĄ, KTÓRA POLECI: temat ze słownika, nadpisania z panelu, podstawione
// zmienne i - przede wszystkim - brak `undefined` w treści.
//
// ROZSTRZYGNIĘCIE i18n (pełne uzasadnienie w
// `src/lib/email-templates/__tests__/txCopy.test.ts`). Ten plik jest
// server-only (tx-preview.server.ts:3 „Plik server-only: React Email `render`
// nie może trafić do bundla klienta") i renderuje szablony POZA drzewem Reacta
// aplikacji, więc poza `I18nextProvider`. Treść bierze z własnych słowników:
// `txCopy` / `txSubject` (import w linii 9) i `txBody` (linia 11). Nie ma tu
// ani i18next, ani `useTranslation` - dokładnie jak w `errorCopy.ts` przy
// granicy błędu. Asertujemy więc na wyrenderowanej treści obu języków
// i na kompletności słowników, nie na kluczach i18n.
//
// ZEGAR jest zamrożony, bo stopka ramki drukuje bieżący rok
// (`nes-layout.tsx:172`), a bez zamrożenia test pękłby 1 stycznia.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TX_EMAIL_TYPES as TYPY_ZE_SLOWNIKA,
  txCopy,
  txSubject,
} from "@/lib/email-templates/tx-copy";
import type { TxEmailType } from "@/lib/email-templates/tx-copy";
import {
  renderAllTxEmailPreviews,
  renderTxEmailPreview,
  TX_EMAIL_TYPES,
  type TxEmailPreview,
} from "@/lib/email/tx-preview.server";
import { TX_OVERRIDES_DEFAULTS, TxOverridesSchema } from "@/lib/email/txOverrides";

/**
 * Licznik zapytań do bazy. Podgląd renderuje WYŁĄCZNIE dane demonstracyjne,
 * więc każde zapytanie stąd byłoby odczytem danych subskrybenta na ścieżce,
 * która nie ma własnej autoryzacji (autoryzuje middleware funkcji serwerowej).
 */
const zapytania = vi.hoisted(() => ({ wywolania: [] as string[] }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      zapytania.wywolania.push(`admin.from:${table}`);
      throw new Error("test: podgląd nie ma prawa czytać bazy");
    },
    rpc: (name: string) => {
      zapytania.wywolania.push(`admin.rpc:${name}`);
      throw new Error("test: podgląd nie ma prawa wołać RPC");
    },
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      zapytania.wywolania.push(`client.from:${table}`);
      throw new Error("test: podgląd nie ma prawa czytać bazy");
    },
  },
}));

/** Ślad zmiennej, której nie było - w wysłanym mailu nie do cofnięcia. */
const SLAD_BRAKU = /\b(undefined|NaN)\b|\[object Object\]/;

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  zapytania.wywolania = [];
});

describe("tx-preview.server - lista typów podglądu", () => {
  it("podgląd pokazuje DOKŁADNIE te typy, które zna słownik treści", () => {
    // Rozjazd tych dwóch list to albo mail, którego redakcja nigdy nie zobaczy
    // przed wysyłką, albo pozycja w panelu, która wywraca render.
    expect([...TX_EMAIL_TYPES].sort()).toEqual([...TYPY_ZE_SLOWNIKA].sort());
    // 22 -> 26: cztery maile cyklu życia zgłoszenia formularzowego
    // (`event_registration_received/_approved/_rejected`, `event_waitlist_promoted`).
    expect(TX_EMAIL_TYPES).toHaveLength(26);
  });

  it("lista podglądu nie ma duplikatów - każdy mail jest w panelu raz", () => {
    const unikalne = new Set(TX_EMAIL_TYPES);

    expect(unikalne.size).toBe(TX_EMAIL_TYPES.length);
    expect(unikalne.size).toBe(26);
  });
});

describe("tx-preview.server - komplet podglądów w obu językach", () => {
  it("polski komplet renderuje wszystkie 22 wiadomości z tematem i treścią", async () => {
    const podglady = await renderAllTxEmailPreviews("pl", "Marek", "male");

    expect(podglady).toHaveLength(TX_EMAIL_TYPES.length);
    for (const p of podglady) {
      expect(p.subject.length, `${p.type}: pusty temat`).toBeGreaterThan(10);
      expect(p.html, `${p.type}: brak marki w treści`).toContain("New European Strategies");
      expect(p.html, `${p.type}: brak wołacza`).toContain("Marku");
      expect(p.text.length, `${p.type}: pusta wersja tekstowa`).toBeGreaterThan(100);
    }
  });

  it("angielski komplet renderuje się bez polskich resztek w powitaniu", async () => {
    const podglady = await renderAllTxEmailPreviews("en", "Anna", "female");

    expect(podglady).toHaveLength(TX_EMAIL_TYPES.length);
    for (const p of podglady) {
      expect(p.lang, `${p.type}`).toBe("en");
      expect(p.html, `${p.type}`).toContain("Hi Anna,");
      expect(p.html, `${p.type}: polskie powitanie w mailu EN`).not.toContain("Dzień dobry");
    }
  });

  it("ŻADEN podgląd nie pokazuje undefined - to jest treść, która poleci", async () => {
    // Najwyższa konsekwencja w tym pliku. `undefined` wpisane w temat albo
    // w akapit trafia do skrzynki odbiorcy i zostaje tam na zawsze.
    const wszystkie: TxEmailPreview[] = [
      ...(await renderAllTxEmailPreviews("pl", "Marek", "male")),
      ...(await renderAllTxEmailPreviews("en", null, "unknown")),
    ];
    const skazone = wszystkie
      .filter((p) => SLAD_BRAKU.test(`${p.subject} ${p.preview} ${p.text}`))
      .map((p) => `${p.type}/${p.lang}`);

    expect(skazone).toEqual([]);
    // 26 typów razy dwa języki.
    expect(wszystkie).toHaveLength(52);
  });

  it("każdy podgląd niesie preheader ze słownika - inaczej lista maili jest ślepa", async () => {
    const podglady = await renderAllTxEmailPreviews("pl", "Marek", "unknown");
    const braki = podglady.filter((p) => p.preview !== txCopy(p.type, "pl").preview);

    expect(braki).toEqual([]);
    expect(podglady.every((p) => p.preview.length > 20)).toBe(true);
  });

  it("temat podglądu jest tym samym tematem, który złoży sender", async () => {
    // Panel i sender muszą czytać z tego samego miejsca; rozjazd znaczyłby,
    // że redakcja zatwierdza temat, którego odbiorca nie zobaczy.
    const podglady = await renderAllTxEmailPreviews("en", null, "unknown");
    const rozjazdy = podglady.filter((p) => !p.subject.includes("New European Strategies"));

    expect(rozjazdy).toEqual([]);
    expect(podglady[0]?.subject).toBe(
      txSubject(podglady[0]?.type ?? "newsletter_confirmed", "en", { subject: "Professional" }),
    );
  });

  it.each(TX_EMAIL_TYPES)(
    "%s: podglądy PL i EN różnią się treścią, nie tylko etykietą",
    async (type) => {
      const pl = await renderTxEmailPreview(type, "pl", "Marek", "male");
      const en = await renderTxEmailPreview(type, "en", "Mark", "unknown");

      expect(pl.subject, `${type}: temat nieprzetłumaczony`).not.toBe(en.subject);
      expect(pl.preview, `${type}: preheader nieprzetłumaczony`).not.toBe(en.preview);
      expect(pl.html).toContain(txCopy(type, "pl").heading);
      expect(en.html).toContain(txCopy(type, "en").heading);
    },
  );
});

describe("tx-preview.server - kontekst pusty i dane brzegowe", () => {
  it("bez imienia odbiorcy powitanie jest neutralne, nie urwane", async () => {
    // Podgląd bez imienia to realny stan panelu: pole imienia jest puste,
    // dopóki redakcja czegoś nie wpisze.
    const pl = await renderTxEmailPreview("subscription_confirmed", "pl", null, "unknown");
    const en = await renderTxEmailPreview("subscription_confirmed", "en", null, "unknown");

    expect(pl.html).toContain("Dzień dobry");
    expect(pl.html).not.toMatch(/Dzień dobry,\s*</);
    expect(en.html).toContain("Hello,");
    expect(en.html).not.toContain("undefined");
  });

  it("newsletter nie ma szczegółów i to jest poprawny, kompletny mail", async () => {
    // Jedyny typ z pustą tabelą szczegółów - gałąź `details.length > 0`
    // po stronie fałszu. Pusty blok ramki psułby układ w Gmailu.
    const p = await renderTxEmailPreview("newsletter_confirmed", "pl", "Marek", "male");

    expect(p.html).toContain(txCopy("newsletter_confirmed", "pl").heading);
    expect(p.subject).toBe(txSubject("newsletter_confirmed", "pl", { subject: null }));
  });

  it("wiadomości klubowe pokazują nazwę specjalizacji w temacie", async () => {
    const pl = await renderTxEmailPreview("club_application_accepted", "pl", "Marek", "male");
    const en = await renderTxEmailPreview("club_application_rejected", "en", null, "unknown");

    expect(pl.subject).toContain("Energetyka");
    expect(en.subject).toContain("Energy");
  });

  it("dane demonstracyjne są jawnie demonstracyjne - nie ma tu danych klienta", async () => {
    // Podgląd jest widoczny dla każdego admina; wpuszczenie tu realnego
    // rekordu subskrybenta byłoby wyciekiem danych osobowych przez panel.
    const p = await renderTxEmailPreview("payment_refunded", "pl", "Marek", "male");

    expect(p.html).toContain("txn_01hxyz9k2m4n6p8q");
    expect(p.html).toContain("Professional");
    expect(p.html).not.toMatch(/@(?!neweuropeanstrategies\.com)[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it("wersja tekstowa niesie tę samą treść co HTML, nie sam szkielet", async () => {
    // Klient pocztowy bez HTML dostaje `text/plain`; pusta wersja tekstowa
    // to wiadomość, której część odbiorców po prostu nie przeczyta.
    const p = await renderTxEmailPreview("event_registered", "pl", "Marek", "male");

    expect(p.text).toContain("Europejski Briefing Strategiczny");
    expect(p.text).toContain("Warszawa / online");
  });
});

describe("tx-preview.server - nadpisania treści z panelu redakcyjnego", () => {
  const nadpisania = TxOverridesSchema.parse({
    team_seat_grace: {
      pl: {
        subject: "Karencja miejsca w {orgName}",
        preview: "Zostało {daysLeft} dni",
        eyebrow: "Miejsce zespołowe",
        heading: "Twoje miejsce w {orgName} wygasa",
        intro: "Dostęp masz do {accessUntil}.",
        extra: "Skontaktuj się z administratorem.",
        cta: "Sprawdź plany",
        note: "Po tym terminie dostęp znika.",
      },
    },
  });

  it("nadpisany temat i preheader zastępują treść ze słownika", async () => {
    const p = await renderTxEmailPreview("team_seat_grace", "pl", "Marek", "male", nadpisania);

    expect(p.subject).toBe("Karencja miejsca w Acme Group");
    expect(p.preview).toBe("Zostało 7 dni");
  });

  it("nadpisane akapity trafiają do treści maila, a nie tylko do podglądu pola", async () => {
    const p = await renderTxEmailPreview("team_seat_grace", "pl", "Marek", "male", nadpisania);

    expect(p.html).toContain("Twoje miejsce w Acme Group wygasa");
    expect(p.html).toContain("Dostęp masz do 29 sierpnia 2026.");
    expect(p.html).toContain("Skontaktuj się z administratorem.");
    expect(p.html).toContain("Sprawdź plany");
  });

  it("język BEZ nadpisania spada na treść domyślną ze słownika", async () => {
    // Redakcja nadpisała tylko polską wersję. Angielski odbiorca MUSI dostać
    // kompletny mail, a nie pusty szablon po nieznalezionym nadpisaniu.
    const en = await renderTxEmailPreview("team_seat_grace", "en", null, "unknown", nadpisania);

    expect(en.subject).toBe(txSubject("team_seat_grace", "en", { subject: "Acme Group" }));
    expect(en.html).toContain(txCopy("team_seat_grace", "en").heading);
  });

  it("typ NIEEDYTOWALNY ignoruje nadpisania - panel nie może ich tam wstawić", async () => {
    // Edytowalne są trzy typy miejsc zespołowych. Gdyby nadpisanie przeciekło
    // na inny typ, redakcja zmieniałaby treść maila, którego nie widzi w panelu.
    const p = await renderTxEmailPreview("payment_failed", "pl", "Marek", "male", nadpisania);

    expect(p.subject).not.toContain("Karencja miejsca");
    expect(p.subject).toBe(txSubject("payment_failed", "pl", { subject: "Professional" }));
  });

  it("puste nadpisanie NIE kasuje treści - pole puste znaczy „bez zmian”", async () => {
    // To jest kontrakt panelu: wyczyszczenie pola przywraca domyślną treść.
    // Gdyby puste pole trafiało do maila, redakcja jednym backspace'em
    // wysłałaby wiadomość bez nagłówka.
    const puste = TxOverridesSchema.parse({
      team_seat_grace: { pl: { heading: "   ", intro: "", subject: "" } },
    });
    const p = await renderTxEmailPreview("team_seat_grace", "pl", "Marek", "male", puste);

    expect(p.html).toContain(txCopy("team_seat_grace", "pl").heading);
    expect(p.subject).toBe(txSubject("team_seat_grace", "pl", { subject: "Acme Group" }));
  });

  it("nadpisanie złożone z samych nieznanych zmiennych też nie kasuje treści", async () => {
    // `{cokolwiek}` znika przy podstawianiu; gdyby wynik pustego napisu
    // przeszedł dalej, nagłówek maila byłby pusty.
    const znikajace = TxOverridesSchema.parse({
      team_seat_grace: { pl: { heading: "{nieznanyToken}" } },
    });
    const p = await renderTxEmailPreview("team_seat_grace", "pl", "Marek", "male", znikajace);

    expect(p.html).toContain(txCopy("team_seat_grace", "pl").heading);
    expect(p.html).not.toContain("{nieznanyToken}");
  });

  it("brak argumentu nadpisań działa jak komplet treści domyślnych", async () => {
    const bezArgumentu = await renderTxEmailPreview("team_seat_grace", "pl", "Marek", "male");
    const zDomyslnymi = await renderTxEmailPreview(
      "team_seat_grace",
      "pl",
      "Marek",
      "male",
      TX_OVERRIDES_DEFAULTS,
    );

    expect(bezArgumentu.subject).toBe(zDomyslnymi.subject);
    expect(bezArgumentu.html).toBe(zDomyslnymi.html);
  });

  it("komplet podglądów przyjmuje nadpisania i stosuje je do właściwego typu", async () => {
    const podglady = await renderAllTxEmailPreviews("pl", "Marek", "male", nadpisania);
    const karencja = podglady.find((p) => p.type === "team_seat_grace");
    const inny = podglady.find((p) => p.type === "team_seat_access_ended");

    expect(karencja?.subject).toBe("Karencja miejsca w Acme Group");
    expect(inny?.subject).toBe(
      txSubject("team_seat_access_ended", "pl", { subject: "Acme Group" }),
    );
  });
});

describe("tx-preview.server - odmowa i granice bezpieczeństwa", () => {
  it("renderowanie podglądu NIE wykonuje ŻADNEGO zapytania do bazy", async () => {
    // Ten moduł nie ma własnej bramki uprawnień - autoryzuje middleware funkcji
    // serwerowej (`requireAdmin`). Dowodem, że brak bramki nie jest tu wyciekiem,
    // jest to, że renderowanie w ogóle nie sięga po dane: gdyby ktoś wywołał
    // podgląd bez uprawnienia, nie dostałby ani jednego wiersza z bazy.
    await renderAllTxEmailPreviews("pl", "Marek", "male");
    await renderAllTxEmailPreviews("en", null, "unknown");

    expect(zapytania.wywolania).toEqual([]);
    expect(zapytania.wywolania).toHaveLength(0);
  });

  it("nieistniejący szablon NIE wypuszcza pustej wiadomości - wywraca się głośno", async () => {
    // Rzutowanie `string` -> `TxEmailType` odtwarza realny rozjazd: typ maila
    // przychodzi z bazy, a kompilator nie sprawdza jej zawartości. Cichy pusty
    // podgląd byłby gorszy od wyjątku - redakcja zatwierdziłaby pustkę.
    const zBazy: string = "subscription_teleported";

    await expect(
      renderTxEmailPreview(zBazy as TxEmailType, "pl", "Marek", "male"),
    ).rejects.toThrow();
    expect(zapytania.wywolania).toEqual([]);
  });

  it("nieistniejący szablon wywraca się tak samo w obu językach", async () => {
    const zBazy: string = "club_application_withdrawn";

    await expect(
      renderTxEmailPreview(zBazy as TxEmailType, "pl", null, "unknown"),
    ).rejects.toThrow();
    await expect(
      renderTxEmailPreview(zBazy as TxEmailType, "en", null, "unknown"),
    ).rejects.toThrow();
  });

  it("podgląd nie zawiera linku wychodzącego poza domenę platformy", async () => {
    // Link do obcej domeny w mailu marki to wektor phishingu; podgląd jest
    // ostatnim miejscem, w którym można go zauważyć.
    const p = await renderTxEmailPreview("customer_portal_link", "pl", "Marek", "male");
    const linki = [...p.html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    const obce = linki.filter(
      (href) =>
        !href.startsWith("https://neweuropeanstrategies.com") &&
        !href.startsWith("https://www.linkedin.com") &&
        !href.startsWith("https://www.facebook.com") &&
        !href.startsWith("https://x.com"),
    );

    expect(obce).toEqual([]);
    expect(linki.length).toBeGreaterThan(3);
  });
});
