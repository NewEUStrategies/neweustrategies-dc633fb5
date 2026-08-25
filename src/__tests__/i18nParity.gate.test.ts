// Bramka CI: parytet kluczy i tłumaczeń PL/EN dla nowych bloków, widgetów
// buildera i raportu porównawczego.
//
// Ładuje rdzenne słowniki (src/lib/locale/{pl,en}.ts) ORAZ wszystkie nakładki
// `src/lib/i18n-*.ts` (rejestrują własne fragmenty w instancji i18next), po
// czym porównuje pełne drzewa zasobów. Bramkowane są prefiksy powierzchni,
// które realnie mają dwie wersje językowe w UI - reszta różnic trafia do logu
// jako ostrzeżenie, żeby bramka nie stała się nieużywalnym szumem.
//
// Zapisuje reports/i18n-parity.json, który konsumuje raport zgodności wdrożenia.
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import i18n from "@/lib/i18n";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";
import {
  diffParity,
  parityFailed,
  renderParityReport,
  type ResourceTree,
} from "@/lib/ci/i18nParity";

// Powierzchnie objęte twardą bramką (brak klucza = czerwone CI).
const GATED_PREFIXES = [
  "blocks",
  "builder",
  "comparison",
  "countryCompare",
  "adminBlocks",
  "adminThemeDesign",
  // Macierz uprawnień renderuje etykiety z kluczy technicznych (wiersze bramek,
  // flagi warstw), więc brak tłumaczenia oznaczałby surowy klucz na ekranie
  // audytu - to musi być bramkowane, nie tylko raportowane.
  "adminPermissions",
  // Sieć kontaktów: cała powierzchnia ma dwie wersje językowe w UI, a jej
  // komunikaty (ciche odmowy, limity zaproszeń, zgłoszenia do moderacji)
  // decydują o tym, co użytkownik rozumie ze swojej prywatności. Rozjazd
  // PL/EN już się tu raz zdarzył, więc od 08.2026 jest bramkowany, a nie
  // tylko logowany jako ostrzeżenie. Komplement po stronie kodu:
  // src/components/network/__tests__/networkI18nKeys.gate.test.ts.
  "network",
  "directMessage",
  // Discussion Club: komunikaty odmowy dostępu (kody z club_capabilities)
  // mówią użytkownikowi, CO ZROBIĆ - poprosić o dostęp, wykupić plan, poczekać
  // na otwarcie grupy. Surowy klucz zamiast zdania zostawiłby go bez następnego
  // kroku, więc powierzchnia jest bramkowana od pierwszego dnia, a nie po tym,
  // jak rozjazd PL/EN raz się zdarzy (lekcja z prefiksu "network").
  "club",
  "adminClubs",
  // Trzeci slownik modulu (katalog elementow, /admin/community/clubs/elements).
  // isGated() dopasowuje po prefiksie z kropka, wiec "club" NIE obejmuje
  // "clubElements.*" - bez tego wpisu 95 kluczy stalo poza bramka.
  "clubElements",
  // Ujawnienie komercyjne: te napisy NIE są interfejsem, są treścią
  // OŚWIADCZENIA PRAWNEGO przy artykule. Brak polskiego brzmienia nie daje
  // „surowego klucza" do zauważenia w code review - daje polską stronę
  // z angielską etykietą „ADVERTISEMENT", czyli oznaczenie w języku, którego
  // odbiorca nie musi znać. Rekomendacje UOKiK (2022) wymagają oznaczenia
  // w języku odbiorcy, a UPNPR art. 7 pkt 11 nie zna wymówki „tłumaczenie
  // przyjdzie w następnym PR". Dlatego bramka od pierwszego dnia, nie po
  // pierwszym incydencie (lekcja z prefiksów „network" i „club").
  "sponsored",
  "postOrganization",
  // MODUŁ 2 (edytor wpisów i workflow redakcyjny). Do 08.2026 obie powierzchnie
  // stały poza bramką i rozjazd PL/EN był tu wyłącznie OSTRZEŻENIEM, mimo że
  // panel administracyjny ma dwie wersje językowe, a redakcja bywa dwujęzyczna.
  // Skutek braku klucza jest inny niż na powierzchni publicznej i dlatego
  // groźniejszy: redaktor nie widzi surowego klucza w miejscu, gdzie spodziewa
  // się zdania - widzi go w ETYKIECIE POLA albo w komunikacie odmowy zapisu,
  // czyli dokładnie tam, gdzie musi zrozumieć, czego brakuje, żeby wpis
  // dało się opublikować. Bramka modułowa
  // (components/admin/post-editor/__tests__/i18nParity.test.ts) pilnowała
  // dotąd tylko ośmiu sub-namespace'ów `adminPostPanes` i nie była wpięta
  // w `check:i18n-parity`; oba braki domknięte razem z tym wpisem.
  "adminPostPanes",
  "adminWorkflows",
  // MODUŁ WYDARZEŃ (Event Builder), obie płaszczyzny: panel organizatora
  // i powierzchnia uczestnika. Do 08.2026 stał poza bramką - i to nie był
  // wybór, tylko przeoczenie: cztery nakładki modułu rejestrowały się dopiero
  // w ciele `ensureXI18n()`, więc parytet ich po prostu NIE WIDZIAŁ i liczył
  // je jako zero rozjazdów. Po wpięciu rejestracji przy imporcie okazało się,
  // że parytet jest pełny (`missingEn` i `missingPl` po zerze), więc bramka
  // nic nie kosztuje TERAZ, a zamyka drogę następnemu brakowi.
  //
  // Dlaczego to musi być bramka, a nie raport. Moduł renderuje z kluczy
  // ETYKIETY ENUMÓW (formaty, stany, role, rodzaje punktów kontroli) i
  // KOMUNIKATY ODMOWY - a odmowa mówi organizatorowi, CO ZROBIĆ, żeby zapis
  // przeszedł. Surowy klucz w tym miejscu zostawia go bez następnego kroku,
  // dokładnie tak jak na powierzchni klubów, gdzie ten sam argument
  // przesądził o bramce od pierwszego dnia.
  "adminEvents",
  "adminEventAgenda",
  "adminEventRegistration",
  "adminEventSponsors",
  "adminEventTerms",
  "adminEventOnsite",
  "adminEventMeetings",
  "eventRegistration",
  "eventMeetings",
  "eventFront",
] as const;

// Klucze, dla których identyczny tekst PL i EN jest poprawny (nazwy własne,
// skróty, jednostki).
const IDENTICAL_ALLOWLIST: readonly string[] = [
  // Nazwy własne poziomów członkostwa i ról - tłumaczenie byłoby błędem.
  "adminPermissions.caps.presidents_circle",
  "adminPermissions.roles.super_admin.name",
  "adminPermissions.roles.admin.name",
  "adminPermissions.roles.editor.name",
  // Słowo kluczowe SQL - w obu językach brzmi tak samo, bo tak brzmi w bazie.
  "adminPermissions.gate.definer",
  // Zapożyczenie funkcjonujące w polskim tak samo jak w angielskim - rodzaj
  // relacji w rekomendacjach (słownik domknięty CHECK-iem w bazie).
  "network.recommendations.relationshipOptions.mentor",
  // Discussion Club: nazwy własne ról i zapożyczenia brzmiące tak samo w obu
  // językach. "Moderator", "Status", "Administrator" i "Super admin" to nie
  // są nieprzetłumaczone stringi - to są te same słowa.
  "club.role.moderator",
  "adminClubs.filterStatus",
  "adminClubs.columns.status",
  "adminClubs.fields.status",
  "adminClubs.permissions.roles.super_admin",
  "adminClubs.permissions.roles.admin",
  "adminClubs.permissions.roles.moderator",
  // "Link" i "Segment" to zapozyczenia brzmiace tak samo w obu jezykach.
  "adminClubs.invitations.channelName.link",
  "adminClubs.invitations.channelName.segment",
  // To samo zapożyczenie w katalogu intencji profilu (pełna etykieta i skrót):
  // "mentoring" jest po polsku tym samym słowem, więc tłumaczenie byłoby błędem.
  "profileIntent.openTo.mentoring",
  "profileIntent.openToShort.mentoring",
  // Czysty format liczbowy miernika kompletności - nie ma czego tłumaczyć.
  "profileCompleteness.score",
  // Newsletter: nazwa modułu i nazwy własne dwóch builderów. "Newsletter",
  // "Inline builder" i "Popup builder" to terminy produktowe, którymi zespół
  // posługuje się tak samo po polsku - przekład ("Kreator wbudowany"?)
  // rozjechałby zakładkę z tym, jak o niej mówią ludzie.
  "adminNewsletter.nav.sectionTitle",
  "adminNewsletter.nav.inline",
  "adminNewsletter.nav.popup",
  // Wykrywanie płci "z automatu" - to samo słowo w obu językach.
  "adminNewsletter.emailPreview.genderAuto",
  // Nazwa punktu załamania w panelu układów wpisu. Sąsiedzi SĄ tłumaczeni
  // ("mobile" -> "Telefon", "desktop" -> "Komputer"), więc identyczność nie
  // wynika tu z pominięcia: "tablet" to po polsku to samo słowo i przekład
  // musiałby je wymyślić.
  "adminLayouts.postLayouts.breakpoint.tablet",
  // Nazwa sekcji cyklu artykułów. Reszta gałęzi jest tłumaczona ("part" ->
  // "część", "Previous part" -> "Poprzednia część"), a samo "Dossier" jest
  // zapożyczeniem używanym po polsku bez zmiany - jak "Newsletter" wyżej.
  "postExperience.series.series",
  // MODUŁ WYDARZEŃ. Dwadzieścia cztery pozycje tej samej klasy: zapożyczenia
  // i nazwy własne, które po polsku brzmią tak samo jak po angielsku.
  // "Sponsor", "Partner", "Moderator", "Catering", "Marketing", "Link",
  // "Format", "Status", "Online" i "Agenda" to nie są nieprzetłumaczone
  // napisy - to są te same słowa. "Chatham House" to nazwa własna reguły.
  // Nazwy walut zapisuje się małą literą w OBU językach ("euro"), więc
  // identyczność jest tu poprawną pisownią, a nie kopią.
  //
  // Jedna pozycja z pierwotnych dwudziestu pięciu NIE trafiła na tę listę, bo
  // była realną usterką: polska odznaka giełdy mówiła "Slot", gdy reszta
  // polskiej powierzchni mówi "Termin" - i została poprawiona, zamiast zostać
  // tu przykryta.
  "adminEvents.formats.online",
  "adminEvents.list.filters.formatLabel",
  "adminEvents.list.row.chathamHouse",
  "adminEvents.types.dialog.formatLabel",
  "adminEventAgenda.formats.online",
  "adminEventAgenda.nav.sectionTitle",
  "adminEventAgenda.roles.moderator",
  "adminEventMeetings.list.sponsorColumn",
  "adminEventMeetings.list.sponsorFilter",
  "adminEventOnsite.badges.dialog.paperFormat",
  "adminEventOnsite.checkpointKinds.catering",
  "adminEventOnsite.checkpoints.dialog.sponsor",
  "adminEventOnsite.filters.sponsor",
  "adminEventRegistration.currencies.EUR",
  "adminEventRegistration.registrations.columns.status",
  "adminEventRegistration.registrations.filters.status",
  "adminEventRegistration.sources.partner",
  "adminEventSponsors.contactRoles.marketing",
  "adminEventSponsors.materialKinds.link",
  "adminEventSponsors.roles.partner",
  "adminEventSponsors.roles.sponsor",
  "eventFront.formats.online",
  "eventFront.list.formatLabel",
  "eventMeetings.fields.sponsor",
];

function loadOverlays(): void {
  // Nakładki rejestrują zasoby jako efekt uboczny importu.
  const modules = import.meta.glob("/src/lib/i18n-*.ts", { eager: true });
  expect(Object.keys(modules).length).toBeGreaterThan(0);
}

function isTree(value: unknown): value is ResourceTree {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Głębokie scalenie - i18n rejestruje rdzeń tylko dla aktywnego języka,
 *  więc płytki spread gubiłby gałęzie drugiego języka i dawał fałszywe braki. */
function deepMerge(base: ResourceTree, overlay: ResourceTree): ResourceTree {
  const out: ResourceTree = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const existing = out[key];
    out[key] = isTree(value) && isTree(existing) ? deepMerge(existing, value) : value;
  }
  return out;
}

function bundle(lang: "pl" | "en", core: ResourceTree): ResourceTree {
  const registered = i18n.getResourceBundle(lang, "translation") as ResourceTree | undefined;
  return deepMerge(core, registered ?? {});
}

describe("parytet tłumaczeń PL/EN (bramka CI)", () => {
  it("każdy bramkowany klucz ma wersję PL i EN", () => {
    loadOverlays();

    const pl = bundle("pl", corePl as ResourceTree);
    const en = bundle("en", coreEn as ResourceTree);

    const gated = diffParity(pl, en, {
      gatedPrefixes: [...GATED_PREFIXES],
      identicalAllowlist: IDENTICAL_ALLOWLIST,
    });
    const full = diffParity(pl, en, { identicalAllowlist: IDENTICAL_ALLOWLIST });

    mkdirSync("reports", { recursive: true });
    writeFileSync(
      "reports/i18n-parity.json",
      `${JSON.stringify(
        {
          gatedPrefixes: GATED_PREFIXES,
          missing: [...gated.missingEn, ...gated.missingPl],
          missingEn: gated.missingEn,
          missingPl: gated.missingPl,
          untranslated: gated.untranslated,
          repoWide: {
            missingEn: full.missingEn.length,
            missingPl: full.missingPl.length,
            untranslated: full.untranslated.length,
          },
        },
        null,
        2,
      )}\n`,
    );

    if (parityFailed(full) && !parityFailed(gated)) {
      console.warn(
        `[i18n] Poza bramkowanymi prefiksami: ${full.missingEn.length} kluczy bez EN, ${full.missingPl.length} bez PL.`,
      );
    }

    expect(parityFailed(gated), renderParityReport(gated)).toBe(false);
  });
});
