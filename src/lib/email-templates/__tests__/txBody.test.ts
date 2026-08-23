// SPERSONALIZOWANE AKAPITY maili cyklu życia subskrypcji (`tx-body.ts`).
// Przed tym plikiem: 59,37% linii i 21,42% gałęzi - a to właśnie GAŁĘZIE są tu
// całą treścią. Każdy akapit składa się warunkowo z tego, co przyszło ze
// zdarzenia płatniczego: kwoty, cyklu, daty odnowienia, proraty, karencji.
// Niepokryta gałąź to zdanie, które NIGDY nie zostało przeczytane przez nikogo
// przed wysłaniem go do skrzynki odbiorcy.
//
// ROZSTRZYGNIĘCIE i18n (pełne uzasadnienie w `txCopy.test.ts`). `tx-body.ts`
// ma trzy importy i wszystkie trzy są `import type` (tx-body.ts:1-3):
//   import type { EmailLang } from "./nes-layout";
//   import type { PolishGender } from "@/lib/i18n/polishVocative";
//   import type { TxEmailType } from "./tx-copy";
// Ani `i18next`, ani `react-i18next`, ani `useTranslation`. Zamiast tego własny
// słownik budowniczych zdań indeksowany językiem (tx-body.ts:257):
//   const DICTS: Record<EmailLang, Partial<Record<TxEmailType, Builder>>> = { pl: PL, en: EN };
// Szablon renderuje się na serwerze, poza dostawcą i18n - tak samo jak
// `errorCopy.ts` przy granicy błędu. NIE wymuszamy tu i18next; asertujemy na
// słowniku i na KOMPLETNOŚCI obu języków.
//
// SPADEK NA TREŚĆ DOMYŚLNĄ. `tx-body` celowo NIE ma wariantu dla wszystkich 22
// typów - `Partial<Record<…>>` i `if (!build) return {}` (tx-body.ts:267) to
// świadoma furtka: gdy personalizacji nie ma, szablon bierze statyczny akapit
// z `tx-copy` (`intro ?? c.intro` w transactional.tsx:113). Mail nigdy nie
// wychodzi pusty - i to jest tu dowodzone wprost.
import { describe, expect, it } from "vitest";

import type { PolishGender } from "@/lib/i18n/polishVocative";
import type { EmailLang } from "../nes-layout";
import { txBody, type TxBodyVars } from "../tx-body";
import { txCopy, TX_EMAIL_TYPES, type TxEmailType } from "../tx-copy";

const LANGS: readonly EmailLang[] = ["pl", "en"];
const RODZAJE: readonly PolishGender[] = ["male", "female", "unknown"];

/** Komplet zmiennych, jaki przychodzi z pełnego zdarzenia płatniczego. */
const PELNE: TxBodyVars = {
  planName: "NES Professional",
  previousPlanName: "NES Essential",
  amount: "249,00 zł",
  interval: "miesięcznie",
  renewsAt: "29 sierpnia 2026",
  accessUntil: "29 sierpnia 2026",
  retryAt: "1 sierpnia 2026",
  graceDays: 14,
  prorationAmount: "64,00 zł",
  daysLeft: 7,
  orgName: "Acme Group",
  donorMessage: "Trzymajcie kurs na rzetelne analizy.",
};

/**
 * Typy, dla których `tx-body` ma spersonalizowany wariant. Lista jest
 * wyliczana Z KODU (a nie przepisana ręcznie), więc dopisanie wariantu tylko
 * w jednym języku od razu wywraca test parzystości niżej.
 */
const zWariantem = (lang: EmailLang): TxEmailType[] =>
  TX_EMAIL_TYPES.filter((type) => {
    const b = txBody(type, lang, "unknown", PELNE);
    return Boolean(b.intro ?? b.extra ?? b.note);
  });

/** Ślad zmiennej, której nie było - w mailu jest nie do cofnięcia. */
const SLAD_BRAKU = /\b(undefined|NaN)\b|\[object Object\]/;

const zlaczone = (v: { intro?: string; extra?: string; note?: string }): string =>
  [v.intro, v.extra, v.note].filter(Boolean).join(" ");

describe("txBody - kompletność wariantów w obu językach", () => {
  it("każdy spersonalizowany typ ma wariant w PL i w EN - EN nie zostaje w tyle", () => {
    const pl = zWariantem("pl").sort();
    const en = zWariantem("en").sort();

    // Wariant tylko po polsku znaczy, że anglojęzyczny subskrybent dostaje
    // ogólnik tam, gdzie Polak dostaje kwotę, datę i nazwę planu.
    expect(en).toEqual(pl);
    expect(pl.length).toBeGreaterThan(5);
  });

  it.each(TX_EMAIL_TYPES)("%s: brak wariantu to pusty obiekt, nigdy połowa zdania", (type) => {
    for (const lang of LANGS) {
      const b = txBody(type, lang, "unknown", {});
      const pola = [b.intro, b.extra, b.note];

      // Kontrakt `clean()`: pole albo niesie zdanie, albo go NIE MA. Pusty
      // napis przeszedłby przez `intro ?? c.intro` i wyzerował akapit maila.
      expect(pola.every((p) => p === undefined || p.trim().length > 0)).toBe(true);
      expect(pola.filter((p) => p === "")).toEqual([]);
    }
  });

  it("typ bez wariantu oddaje pusty obiekt, a szablon ma z czego wziąć treść", () => {
    const bezWariantu = txBody("newsletter_confirmed", "pl", "female", PELNE);

    expect(bezWariantu).toEqual({});
    // To jest cała pointa `Partial<Record<…>>`: brak personalizacji NIE jest
    // brakiem treści - statyczny akapit czeka w `tx-copy`.
    expect(txCopy("newsletter_confirmed", "pl").intro.length).toBeGreaterThan(40);
  });

  it.each(TX_EMAIL_TYPES)("%s: komplet zmiennych nie zostawia śladu po zmiennej", (type) => {
    for (const lang of LANGS) {
      for (const gender of RODZAJE) {
        const tekst = zlaczone(txBody(type, lang, gender, PELNE));
        expect(tekst, `${type}/${lang}/${gender}`).not.toMatch(SLAD_BRAKU);
        expect(tekst, `${type}/${lang}/${gender}: podwójna spacja po pustym slocie`).not.toMatch(
          / {2}/,
        );
      }
    }
  });

  it.each(TX_EMAIL_TYPES)("%s: ZERO zmiennych też nie wypuszcza undefined do maila", (type) => {
    // To jest przypadek o najwyższej konsekwencji w tym pliku: zdarzenie
    // płatnicze przychodzi z webhooka i potrafi nie mieć ŻADNEGO pola.
    // `undefined` wpisane w akapit maila zostaje w skrzynce na zawsze.
    for (const lang of LANGS) {
      for (const gender of RODZAJE) {
        const tekst = zlaczone(txBody(type, lang, gender, {}));
        expect(tekst, `${type}/${lang}/${gender}`).not.toMatch(SLAD_BRAKU);
        expect(tekst, `${type}/${lang}/${gender}`).not.toMatch(/ {2}|\s[.,]/);
      }
    }
  });
});

describe("txBody - nazwa planu, gdy zdarzenie jej nie przyniosło", () => {
  it("brak nazwy planu podstawia zdanie po polsku, nie pustkę", () => {
    const bez = txBody("subscription_confirmed", "pl", "unknown", { amount: "249,00 zł" });

    expect(bez.intro).toContain("wybranego planu");
    expect(bez.intro).not.toContain("undefined");
  });

  it("brak nazwy planu podstawia zdanie po angielsku", () => {
    const bez = txBody("subscription_canceled", "en", "unknown", {});

    expect(bez.intro).toContain("your plan");
    expect(bez.intro).not.toContain("undefined");
  });

  it("nazwa złożona z samych spacji jest traktowana jak brak nazwy", () => {
    // Baza potrafi oddać `" "` po nieudanej migracji nazw planów. Wpisanie
    // takiej „nazwy" do zdania dałoby „za plan  została zaksięgowana".
    const spacje = txBody("subscription_confirmed", "pl", "unknown", { planName: "   " });

    expect(spacje.intro).toContain("wybranego planu");
    expect(spacje.intro).not.toMatch(/ {2}/);
  });

  it("podana nazwa planu trafia do zdania w obu językach", () => {
    const pl = txBody("subscription_confirmed", "pl", "unknown", { planName: "NES Professional" });
    const en = txBody("subscription_confirmed", "en", "unknown", { planName: "NES Professional" });

    expect(pl.intro).toContain("NES Professional");
    expect(en.intro).toContain("NES Professional");
  });
});

describe("txBody - odmiana przez rodzaj gramatyczny (PL) i jej brak (EN)", () => {
  it.each(zWariantem("pl"))("%s: PL ma osobne formy męską i żeńską albo bezosobową", (type) => {
    const male = zlaczone(txBody(type, "pl", "male", PELNE));
    const female = zlaczone(txBody(type, "pl", "female", PELNE));
    const unknown = zlaczone(txBody(type, "pl", "unknown", PELNE));

    // Forma bezosobowa jest wymagana zawsze - to ona idzie do odbiorcy, którego
    // imienia nie ma w słowniku. Nie może być kopią formy męskiej z rodzajnikiem.
    expect(unknown.length).toBeGreaterThan(40);
    expect(unknown).not.toMatch(/łeś\/aś\b(?!.*mecenasów)/);
    expect(male.length).toBeGreaterThan(40);
    expect(female.length).toBeGreaterThan(40);
  });

  it("zdanie o zakupie odmienia się przez rodzaj odbiorcy", () => {
    const male = txBody("subscription_confirmed", "pl", "male", PELNE).extra ?? "";
    const female = txBody("subscription_confirmed", "pl", "female", PELNE).extra ?? "";

    expect(male).toContain("otrzymałeś");
    expect(female).toContain("otrzymałaś");
  });

  it("nieznany rodzaj dostaje formę bezosobową, nie męską", () => {
    // Domyślenie się rodzaju to najczęstszy sposób na obrażenie odbiorcy
    // mailem transakcyjnym. Bezosobowa forma jest tu wymogiem, nie estetyką.
    const neutral = txBody("subscription_confirmed", "pl", "unknown", PELNE).extra ?? "";

    expect(neutral).not.toMatch(/otrzymałeś|otrzymałaś/);
    expect(neutral).toContain("dostęp został nadany");
  });

  it("wersja angielska IGNORUJE rodzaj - jedno zdanie dla wszystkich", () => {
    // `lang === "pl" ? gender : "unknown"` (tx-body.ts:268). Angielski nie
    // odmienia się przez rodzaj, więc przekazanie go dalej byłoby błędem.
    const male = zlaczone(txBody("donation_received", "en", "male", PELNE));
    const female = zlaczone(txBody("donation_received", "en", "female", PELNE));

    expect(male).toBe(female);
    expect(male).toContain("patron community");
  });
});

describe("txBody - subskrypcja potwierdzona: warianty ceny i odnowienia", () => {
  it("kwota z cyklem rozliczeniowym daje pełne zdanie o płatności (PL)", () => {
    const b = txBody("subscription_confirmed", "pl", "male", {
      planName: "NES Pro",
      amount: "249,00 zł",
      interval: "miesięcznie",
      renewsAt: "29 sierpnia 2026",
    });

    expect(b.intro).toContain("Kwota 249,00 zł jest rozliczana miesięcznie.");
    expect(b.intro).toContain("Kolejne odnowienie nastąpi 29 sierpnia 2026.");
  });

  it("sama kwota bez cyklu daje zdanie o zamówieniu, nie o abonamencie (PL)", () => {
    // Zakup jednorazowy nie może obiecywać cyklicznego obciążenia.
    const b = txBody("subscription_confirmed", "pl", "male", {
      planName: "NES Pro",
      amount: "249,00 zł",
    });

    expect(b.intro).toContain("Kwota zamówienia to 249,00 zł.");
    expect(b.intro).not.toContain("rozliczana");
  });

  it("brak kwoty nie zostawia zdania o cenie ani pustego miejsca po niej (PL)", () => {
    const b = txBody("subscription_confirmed", "pl", "male", { planName: "NES Pro" });

    expect(b.intro).not.toMatch(/Kwota/);
    expect(b.intro).not.toMatch(/ {2}/);
  });

  it("EN: kwota z cyklem i data odnowienia wchodzą do zdania", () => {
    const b = txBody("subscription_confirmed", "en", "unknown", {
      planName: "NES Pro",
      amount: "EUR 59.00",
      interval: "monthly",
      renewsAt: "29 August 2026",
    });

    expect(b.intro).toContain("You are billed EUR 59.00 monthly.");
    expect(b.intro).toContain("Your next renewal is on 29 August 2026.");
  });

  it("EN: brak kwoty i daty zostawia samo potwierdzenie dostępu", () => {
    const b = txBody("subscription_confirmed", "en", "unknown", { planName: "NES Pro" });

    expect(b.intro).not.toMatch(/billed|renewal/);
    expect(b.intro).toContain("NES Pro");
  });
});

describe("txBody - rezygnacja: do kiedy działa dostęp", () => {
  it("znana data końca okresu mówi odbiorcy dokładnie, do kiedy płaci (PL)", () => {
    const b = txBody("subscription_canceled", "pl", "female", {
      planName: "NES Pro",
      accessUntil: "29 sierpnia 2026",
    });

    expect(b.intro).toContain("do 29 sierpnia 2026");
    expect(b.intro).toContain("płacisz tylko za okres");
  });

  it("brak daty nie kłamie o terminie - mówi o końcu opłaconego okresu (PL)", () => {
    const b = txBody("subscription_canceled", "pl", "female", { planName: "NES Pro" });

    expect(b.intro).toContain("do końca opłaconego okresu");
    expect(b.intro).not.toMatch(/\d{4}/);
  });

  it("EN: obie gałęzie terminu dostępu dają zdanie bez luki", () => {
    const zData = txBody("subscription_canceled", "en", "unknown", {
      accessUntil: "29 August 2026",
    });
    const bezDaty = txBody("subscription_canceled", "en", "unknown", {});

    expect(zData.intro).toContain("until 29 August 2026");
    expect(bezDaty.intro).toContain("until the end of the paid period");
  });
});

describe("txBody - zmiana planu w górę i w dół", () => {
  it("upgrade z proratą podaje dopłatę i poprzedni plan (PL)", () => {
    const b = txBody("subscription_upgraded", "pl", "male", PELNE);

    expect(b.intro).toContain("z NES Essential");
    expect(b.intro).toContain("dopłatę w wysokości 64,00 zł");
  });

  it("upgrade bez proraty i bez poprzedniego planu nie zmyśla kwoty (PL)", () => {
    // Zmyślona dopłata w mailu to reklamacja płatnicza, nie literówka.
    const b = txBody("subscription_upgraded", "pl", "unknown", { planName: "NES Pro" });

    expect(b.intro).not.toMatch(/dopłat/);
    expect(b.intro).not.toMatch(/ z /);
  });

  it("upgrade bez kwoty i bez daty odnowienia nie zostawia pustego akapitu (PL)", () => {
    const b = txBody("subscription_upgraded", "pl", "unknown", { planName: "NES Pro" });

    expect(b.extra).toBeUndefined();
    expect(b.note).toBeTruthy();
  });

  it("upgrade z samą datą odnowienia mówi tylko o dacie (PL)", () => {
    const b = txBody("subscription_upgraded", "pl", "female", {
      planName: "NES Pro",
      renewsAt: "29 sierpnia 2026",
    });

    expect(b.extra).toBe("Najbliższe odnowienie: 29 sierpnia 2026.");
    expect(b.extra).not.toMatch(/kwota/i);
  });

  it("EN: upgrade skleja cenę i datę odnowienia bez zlepienia słów", () => {
    const b = txBody("subscription_upgraded", "en", "unknown", PELNE);

    expect(b.extra).toContain("From the next billing period you pay 249,00 zł miesięcznie.");
    expect(b.extra).toContain("Next renewal: 29 sierpnia 2026.");
  });

  it("EN: upgrade bez proraty i bez poprzedniego planu jest krótszy o te zdania", () => {
    const b = txBody("subscription_upgraded", "en", "unknown", { planName: "Pro" });

    expect(b.intro).not.toMatch(/pro-rated|from /);
    expect(b.extra).toBeUndefined();
  });

  it("downgrade z datą trzyma dotychczasowy zakres do końca okresu (PL)", () => {
    const b = txBody("subscription_downgraded", "pl", "male", PELNE);

    expect(b.intro).toContain("Do 29 sierpnia 2026 korzystasz z dotychczasowego zakresu");
    expect(b.extra).toContain("Od kolejnego okresu kwota subskrypcji wyniesie 249,00 zł");
  });

  it("downgrade bez daty i bez kwoty nie obiecuje niczego, czego nie wie (PL)", () => {
    const b = txBody("subscription_downgraded", "pl", "unknown", { planName: "NES Essential" });

    expect(b.intro).toContain("od następnego okresu rozliczeniowego");
    expect(b.extra).toBeUndefined();
  });

  it("EN: downgrade pokrywa obie gałęzie daty i kwoty", () => {
    const zDanymi = txBody("subscription_downgraded", "en", "unknown", PELNE);
    const bezDanych = txBody("subscription_downgraded", "en", "unknown", {});

    expect(zDanymi.intro).toContain("until 29 sierpnia 2026");
    expect(bezDanych.extra).toBeUndefined();
  });
});

describe("txBody - nieudana płatność: karencja i termin ponowienia", () => {
  it("podaje kwotę, termin ponowienia i długość karencji (PL)", () => {
    const b = txBody("payment_failed", "pl", "male", PELNE);

    expect(b.intro).toContain("na kwotę 249,00 zł");
    expect(b.intro).toContain("Ponowimy próbę 1 sierpnia 2026.");
    expect(b.extra).toContain("(14 dni karencji)");
  });

  it("bez daty ponowienia i bez karencji nie zmyśla terminów (PL)", () => {
    // Nieprawdziwa data ponowienia to obietnica, której system nie dotrzyma.
    const b = txBody("payment_failed", "pl", "unknown", { planName: "NES Pro" });

    expect(b.intro).not.toMatch(/Ponowimy/);
    expect(b.extra).toContain("przez okres karencji");
  });

  it("bez daty końca dostępu mówi o karencji, nie o konkretnym dniu (PL)", () => {
    const b = txBody("payment_failed", "pl", "female", { graceDays: 7 });

    expect(b.extra).toContain("(7 dni karencji)");
    expect(b.extra).toContain("przez okres karencji");
  });

  it("EN: obie gałęzie terminu dostępu i karencji dają pełne zdanie", () => {
    const pelne = txBody("payment_failed", "en", "unknown", PELNE);
    const puste = txBody("payment_failed", "en", "unknown", {});

    expect(pelne.extra).toContain("(14-day grace period)");
    expect(puste.extra).toContain("during the grace period");
  });
});

describe("txBody - zwrot płatności", () => {
  it("zwrot z kwotą i planem wskazuje, czego dotyczy (PL)", () => {
    const b = txBody("payment_refunded", "pl", "male", PELNE);

    expect(b.intro).toContain("na kwotę 249,00 zł");
    expect(b.intro).toContain("za plan NES Professional");
  });

  it("zwrot bez kwoty i bez planu nadal jest zrozumiałym zdaniem (PL)", () => {
    const b = txBody("payment_refunded", "pl", "unknown", {});

    expect(b.intro).toContain("Potwierdzamy zwrot płatności.");
    expect(b.extra).not.toMatch(/\(\)/);
  });

  it("EN: zwrot pokrywa obie gałęzie kwoty, planu i daty dostępu", () => {
    const pelny = txBody("payment_refunded", "en", "unknown", PELNE);
    const goly = txBody("payment_refunded", "en", "unknown", {});

    expect(pelny.intro).toContain("a refund of 249,00 zł");
    expect(goly.intro).toContain("We are confirming a refund.");
  });
});

describe("txBody - karencja miejsca zespołowego i liczebniki", () => {
  it("jeden dzień odmienia się poprawnie po polsku", () => {
    // „pozostał 1 dni" w mailu do klienta korporacyjnego jest widoczne od razu.
    const b = txBody("team_seat_grace_reminder", "pl", "male", { daysLeft: 1 });

    expect(b.intro).toContain("1 dzień");
    expect(b.intro).not.toContain("1 dni");
  });

  it("od dwóch do czterech dni używa formy mnogiej", () => {
    const b = txBody("team_seat_grace_reminder", "pl", "male", { daysLeft: 3 });

    expect(b.intro).toContain("3 dni");
    expect(b.intro).not.toContain("3 dzień");
  });

  it("powyżej czterech dni także używa formy mnogiej", () => {
    const b = txBody("team_seat_grace_reminder", "pl", "female", { daysLeft: 7 });

    expect(b.intro).toContain("7 dni");
    expect(b.intro).not.toMatch(/undefined/);
  });

  it("nazwa organizacji wchodzi do zdania, a jej brak nie zostawia dziury (PL)", () => {
    const zNazwa = txBody("team_seat_grace_reminder", "pl", "male", { orgName: "Acme Group" });
    const bezNazwy = txBody("team_seat_grace_reminder", "pl", "male", {});

    expect(zNazwa.intro).toContain("w organizacji Acme Group");
    expect(bezNazwy.intro).toContain("w zespole");
  });

  it("EN: jeden dzień nie dostaje liczby mnogiej", () => {
    const b = txBody("team_seat_grace_reminder", "en", "unknown", { daysLeft: 1 });

    expect(b.intro).toContain("in 1 day.");
    expect(b.intro).not.toContain("1 days");
  });

  it("EN: więcej niż jeden dzień dostaje liczbę mnogą i nazwę organizacji", () => {
    const b = txBody("team_seat_grace_reminder", "en", "unknown", {
      daysLeft: 7,
      orgName: "Acme Group",
      accessUntil: "29 August 2026",
    });

    expect(b.intro).toContain("in 7 days");
    expect(b.intro).toContain("at Acme Group");
  });

  it("EN: brak wszystkich danych zostawia samo przypomnienie", () => {
    const b = txBody("team_seat_grace_reminder", "en", "unknown", {});

    expect(b.intro).toContain("grace period for your seat is ending.");
    expect(b.intro).not.toMatch(/undefined|\bat\b/);
  });

  it("zero dni nie jest traktowane jak liczba dni - mail nie liczy zerowej karencji", () => {
    // `0` jest falsy i to jest tu ZAMIERZONE: karencja, która już się skończyła,
    // nie ma o czym przypominać liczbą.
    const b = txBody("team_seat_grace_reminder", "pl", "male", { daysLeft: 0 });

    expect(b.intro).not.toContain("0 dni");
    expect(b.intro).toContain("dobiega końca.");
  });
});

describe("txBody - darowizna", () => {
  it("kwota i wiadomość darczyńcy trafiają do potwierdzenia (PL)", () => {
    const b = txBody("donation_received", "pl", "female", PELNE);

    expect(b.intro).toContain("w kwocie 249,00 zł");
    expect(b.intro).toContain("Twoją wiadomość przekazaliśmy redakcji.");
  });

  it("darowizna bez kwoty i bez wiadomości nadal dziękuje (PL)", () => {
    const b = txBody("donation_received", "pl", "unknown", {});

    expect(b.intro).toContain("Dziękujemy za darowiznę.");
    expect(b.extra).toContain("Dołączyłeś/aś");
  });

  it("EN: obie gałęzie kwoty i wiadomości darczyńcy", () => {
    const pelna = txBody("donation_received", "en", "unknown", PELNE);
    const pusta = txBody("donation_received", "en", "unknown", {});

    expect(pelna.intro).toContain("passed your message on");
    expect(pusta.intro).toContain("Thank you for your donation.");
  });
});
