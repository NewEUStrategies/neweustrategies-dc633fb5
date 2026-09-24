// Bramka dwóch pasów migracji: każdy plik w `drizzle/migrations/` ma w rejestrze
// DECYZJĘ - albo bliźniaka w `supabase/migrations/` o tym samym SQL-u, albo jawny
// powód, dla którego bliźniaka nie ma.
//
// PRZYCZYNA ŹRÓDŁOWA. Repozytorium ma DWA pasy migracji i oba jadą na produkcję,
// co `docs/MAIN_RECOVERY_2026-09-12.md` mówi wprost: „Drizzle i Supabase mają
// odrębne rejestry; samo wykonanie `0002` w Drizzle nie dowodzi obecności wersji
// w rejestrze Supabase". Cała warstwa dowodowa repozytorium patrzy jednak
// WYŁĄCZNIE na pas supabase: `MIGRATIONS_DIR = "supabase/migrations"`
// (scripts/lib/sqlMigrations.ts) zasila każdą bramkę `check:sql-*`, a bazę pgTAP
// stawia `supabase db start` z tego samego katalogu. Plik dołożony tylko do
// drizzle/ jest dla nich NIEWIDZIALNY.
//
// Tak przeszło `0001_profiles_discoverable_default_true`: przestawiło
// `profiles.discoverable` na DEFAULT true i przepisało wszystkie wiersze, podczas
// gdy pas supabase trzymał NOT NULL DEFAULT false, a późniejsza migracja opierała
// na tym argument prawny listy uczestników. Żadna bramka nie miała jak tego zobaczyć.
//
// CO ZNACZY „TEN SAM SQL". Pliki obu pasów NIE są bajt w bajt i nie taka jest
// konwencja - ZMIERZONE na wszystkich parach: pas supabase niesie długi nagłówek
// po polsku, pas drizzle zaczyna się od pierwszej instrukcji, a polskie znaki
// diakrytyczne w literałach `COMMENT ON` są w pasie drizzle złożone do ASCII
// („ktorego" wobec „którego"). Porównujemy więc SQL WYKONYWALNY: bez komentarzy,
// ze złożonymi diakrytykami, ze znormalizowaną spacją i z treścią literałów
// `COMMENT ON ... IS '...'` zastąpioną znacznikiem.
//
// CZEGO TA BRAMKA ŚWIADOMIE NIE ŁAPIE, powiedziane wprost: rozjazdu PROZY
// w literałach `COMMENT ON` (dziś realnie różni się tak para 0010). To
// dokumentacja zapisana w bazie - nie zmienia ani schematu, ani zachowania,
// a traktowanie jej na równi z DDL-em zapaliłoby bramkę na każdej poprawce
// literówki i skończyło się jej wyłączeniem.
//
// DLACZEGO REJESTR, A NIE REGUŁA „każdy plik musi mieć bliźniaka". Bo to
// nieprawda: dwa pliki pasa drizzle powstały jako operacje jednorazowe na
// produkcji i bliźniaka mieć nie powinny. Reguła, której stan faktyczny nie
// spełnia, zostaje wyłączona pierwszego dnia. Rejestr wymusza coś słabszego, ale
// wykonalnego: KAŻDY nowy plik w drizzle/ wymaga świadomego wpisu - wskazania
// bliźniaka albo napisania, czemu go nie ma. Nie da się już dołożyć pliku po cichu.
import { readFileSync } from "node:fs";

export const DRIZZLE_DIR = "drizzle/migrations";
export const SUPABASE_DIR = "supabase/migrations";

/** Wpis rejestru: pas drizzle ma bliźniaka albo ma powód, dla którego go nie ma. */
export type LaneEntry =
  | {
      readonly tag: string;
      /** Nazwa pliku w `supabase/migrations/` o tym samym SQL-u wykonywalnym. */
      readonly twin: string;
    }
  | {
      readonly tag: string;
      /** Powód, dla którego ten plik świadomie nie ma bliźniaka. */
      readonly drizzleOnly: string;
    };

/**
 * Rejestr pasów. Kolejność jak w `drizzle/migrations/meta/_journal.json`.
 *
 * Dopisanie pliku do `drizzle/migrations/` BEZ wpisu tutaj zapala bramkę - i o to
 * chodzi. `drizzleOnly` nie jest wytrychem: to zdanie, które ktoś musi napisać
 * i podpisać w przeglądzie, a nie domyślne zachowanie.
 */
export const MIGRATION_LANES: readonly LaneEntry[] = [
  {
    tag: "0000_search_people_super_admin_bypass",
    twin: "20260911160000_search_people_super_admin_bypass.sql",
  },
  {
    tag: "0001_profiles_discoverable_default_true",
    drizzleOnly:
      "Regresja prywatności zastosowana wyłącznie na tym pasie - przestawiła profiles.discoverable na DEFAULT true i przepisała wszystkie wiersze. Pas supabase NIE dostaje bliźniaka: oba pasy jadą na produkcję, więc skopiowanie tego pliku uruchomiłoby jego hurtowy UPDATE DRUGI RAZ i ponownie przestawiło każdego, kto od tamtej pory się wypisał. Stan naprawia forward-only 0011 (DEFAULT false) obecne w OBU pasach. Pliku nie usuwamy - repozytorium jest forward-only, a usunięcie nie cofa tego, co już zastosowane.",
  },
  {
    tag: "0002_pr350_member_crm_sync_and_chat_compat",
    drizzleOnly:
      "Uzgodnienie stanu produkcyjnego po scaleniu #350, wykonane na pasie drizzle. Odpowiadający SQL wszedł do pasa supabase osobnymi migracjami o innej treści, więc porównanie instrukcja po instrukcji nie ma tu sensu.",
  },
  {
    tag: "0003_read_only_schema_contract",
    twin: "20260912170000_read_only_schema_contract.sql",
  },
  {
    tag: "0004_read_only_schema_contract",
    twin: "20260912170000_read_only_schema_contract.sql",
  },
  {
    tag: "0005_pr353_admin_dashboard_aggregates",
    twin: "20260912110000_admin_dashboard_aggregates.sql",
  },
  {
    tag: "0006_impersonation_tenant_scope",
    twin: "20260912180000_impersonation_tenant_scope.sql",
  },
  {
    tag: "0007_job_runner_base_url_shape_guard",
    twin: "20260912181000_job_runner_base_url_shape_guard.sql",
  },
  {
    tag: "0008_payment_webhook_events_tenant_binding",
    twin: "20260913100000_payment_webhook_events_tenant_binding.sql",
  },
  {
    tag: "0009_email_log_tenant_scope",
    twin: "20260913101000_email_log_tenant_scope.sql",
  },
  {
    tag: "0010_email_send_log_tenant_producers",
    twin: "20260913140000_email_send_log_tenant_producers.sql",
  },
  {
    tag: "0011_profiles_discoverable_opt_in_restore",
    twin: "20260913150000_profiles_discoverable_opt_in_restore.sql",
  },
  {
    tag: "0012_email_account_tenant_for_address",
    twin: "20260913160000_email_account_tenant_for_address.sql",
  },
  {
    tag: "0013_pr355_discoverable_optin_and_email_account_tenant",
    drizzleOnly:
      "Uzgodnienie stanu po scaleniu #355: 0011 i 0012 nigdy nie pojechały na to środowisko (przyrostowy `supabase db push` bez --include-all pominął wersje starsze od zdalnej historii), więc oba SQL-e zostały wykonane RAZEM na pasie drizzle. Pas supabase ma je już jako 20260913150000 i 20260913160000 - bliźniak byłby trzecim wykonaniem tej samej treści, a nie nowym kontraktem. Pliku nie usuwamy: repozytorium jest forward-only.",
  },
  {
    tag: "0014_profile_view_privacy_fix",
    twin: "20260913170000_profile_view_privacy_fix.sql",
  },
  {
    tag: "0015_introduction_gates_and_dedup",
    twin: "20260913171000_introduction_gates_and_dedup.sql",
  },
  {
    tag: "0016_mutual_visible_count",
    twin: "20260913172000_mutual_visible_count.sql",
  },
  {
    tag: "0017_set_user_consents_atomic",
    twin: "20260913173000_set_user_consents_atomic.sql",
  },
  {
    tag: "0018_pr365_tenant_follows_profile",
    drizzleOnly:
      "Stan końcowy siedmiu migracji serii 20260914* (090000 push_subscriptions_tenant_binding, 120000 tenant_follows_profile, 140000 author_profiles, 160000 profile_cv, 180000 media_mentions, 200000 profile_graph, 220000 endorse_skill_tenant_guard) wykonany JEDNYM plikiem na pasie drizzle. Bliźniak 1:1 nie istnieje z założenia: pięć z tych plików nadpisuje tę samą funkcję tg_profiles_repin_account_tenant kolejnymi wersjami, więc pas drizzle niesie wyłącznie wersję końcową, a nie łańcuch pośrednich. Pas supabase ma wszystkie siedem wersji w rejestrze; pliku nie usuwamy - repozytorium jest forward-only.",
  },
  {
    tag: "0019_related_post_clicks_viewer_window_idx",
    twin: "20260914230000_related_post_clicks_viewer_window_idx.sql",
  },
  {
    tag: "0020_club_covers_per_club_storage_write",
    twin: "20260914184500_club_covers_per_club_storage_write.sql",
  },
  {
    tag: "0021_brand_media_urls_on_canonical_domain",
    twin: "20260915091000_brand_media_urls_on_canonical_domain.sql",
  },
  // Ten sam SQL, co 0020 - bajt w bajt - wykonany PONOWNIE na pasie drizzle,
  // bo pierwszego przebiegu nie potwierdzał żaden rejestr. Wpis wskazuje więc
  // TEGO SAMEGO bliźniaka, co 0020 (tak samo jak para 0003/0004): treść ma być
  // nadal pilnowana, a nie zwolniona z porównania przez `drizzleOnly`.
  {
    tag: "0022_club_covers_per_club_storage_write_register",
    twin: "20260914184500_club_covers_per_club_storage_write.sql",
  },
  {
    tag: "0023_record_club_covers_migration_in_ledger",
    drizzleOnly:
      "Wpis do REJESTRU WDROŻEŃ pasa supabase (supabase_migrations.schema_migrations), a nie zmiana schematu: SQL z 20260914184500 był już wykonany na bazie, ale bez wiersza w rejestrze, więc check:migration-ledger widział go jako niewdrożony. Bliźniak byłby błędem z definicji - plik leżący w supabase/migrations/ sam dostaje wiersz w tym rejestrze w chwili zastosowania, więc dopisywałby wiersz za SĄSIADA i na świeżej bazie ogłaszał cudzą migrację za wdrożoną, zanim ta się wykona. To dokładnie kłamstwo, które check:migration-ledger ma wykrywać. Pliku nie usuwamy - repozytorium jest forward-only.",
  },
  {
    tag: "0024_profiles_tenant_id_not_client_writable",
    twin: "20260915092000_profiles_tenant_id_not_client_writable.sql",
  },
  {
    tag: "0025_tenant_scope_presence_and_rsvp_owner_read",
    twin: "20260915194500_tenant_scope_presence_and_rsvp_owner_read.sql",
  },
  {
    tag: "0026_selfservice_privilege_pins",
    twin: "20260917163900_selfservice_privilege_pins.sql",
  },
  {
    tag: "0027_coupon_per_user_limit_and_cv_upload_quota",
    twin: "20260919094000_coupon_per_user_limit_and_cv_upload_quota.sql",
  },
  {
    tag: "0028_club_cover_position_y",
    twin: "20260919220300_club_cover_position_y.sql",
  },
  {
    tag: "0029_club_set_cover_position_tenant_scope",
    twin: "20260920120000_club_set_cover_position_tenant_scope.sql",
  },
  // Kontekst nawigacji dla RUM: pięć kolumn `web_vitals` plus cztery CHECK-i.
  // SQL WYKONYWALNY obu plików jest identyczny; różnią się wyłącznie NAGŁÓWEK
  // (pas supabase niesie uzasadnienie migracji, pas drizzle zaczyna od pierwszej
  // instrukcji) i DŁUGOŚĆ PROZY w literałach `COMMENT ON` - a tego ta bramka
  // świadomie nie pilnuje, bo dokumentacja w bazie nie zmienia ani schematu,
  // ani zachowania.
  {
    tag: "0030_web_vitals_navigation_context",
    twin: "20260920121000_web_vitals_navigation_context.sql",
  },
  {
    tag: "0031_user_invitations_pin_all_non_acceptance_columns",
    twin: "20260922080100_user_invitations_pin_all_non_acceptance_columns.sql",
  },
  {
    tag: "0032_mention_targets_people_crm_companies",
    drizzleOnly:
      "Pierwsza wersja funkcji celów @wzmianki (search_mention_targets, get_mention_target), nadpisana w całości przez 0033 na tym samym pasie - firmy dostały tam stabilny slug `org-<uuid>` zamiast identyfikatora z nazwy. Obie deklaracje to CREATE OR REPLACE, więc pas kanoniczny dostaje WYŁĄCZNIE stan końcowy (20260922080000_mention_targets_rpc.sql): odtwarzanie wersji pośredniej niczego nie dowodzi, a zostawiałoby w bazie przez moment funkcję, której żaden klient już nie woła. Pliku nie usuwamy - repozytorium jest forward-only.",
  },
  {
    tag: "0033_stable_organization_mention_slugs",
    twin: "20260922080000_mention_targets_rpc.sql",
  },
  // DWA DUPLIKATY Z SCALENIA PR #385. Gałąź dorzuciła na pas drizzle drugą
  // kopię plików, które już na nim stały pod innym numerem: SQL WYKONYWALNY
  // 0034 jest bajt w bajt tożsamy z 0033, a 0035 różni się od 0031 wyłącznie
  // komentarzami nagłówka i brakiem znaku końca linii. Pas kanoniczny
  // (supabase/migrations) ma po jednym bliźniaku dla każdej z tych zmian i tam
  // wskazują wpisy 0031/0033 wyżej - dopisanie im drugiego bliźniaka kazałoby
  // bramce oczekiwać dwóch wykonań tej samej definicji. Plików nie usuwamy,
  // repozytorium jest forward-only; obie definicje to CREATE OR REPLACE /
  // DROP POLICY + CREATE POLICY, więc powtórne wykonanie jest idempotentne.
  {
    tag: "0034_mention_targets_rpc",
    drizzleOnly:
      "Duplikat 0033_stable_organization_mention_slugs z tego samego scalenia (PR #385) - SQL wykonywalny identyczny bajt w bajt. Bliźniaka supabase/migrations/20260922080000_mention_targets_rpc.sql pilnuje wpis 0033.",
  },
  {
    tag: "0035_user_invitations_pin_all_non_acceptance_columns",
    drizzleOnly:
      "Duplikat 0031_user_invitations_pin_all_non_acceptance_columns z tego samego scalenia (PR #385) - różnica to wyłącznie komentarze nagłówka i brak znaku końca linii. Bliźniaka supabase/migrations/20260922080100_user_invitations_pin_all_non_acceptance_columns.sql pilnuje wpis 0031.",
  },
  {
    tag: "0036_event_sponsor_sections_and_home_ads",
    twin: "20260922200000_event_sponsor_sections_and_home_ads.sql",
  },
  {
    tag: "0037_event_home_ads_viewer_status_fix",
    twin: "20260922200100_event_home_ads_viewer_status_fix.sql",
  },
  {
    tag: "0038_event_ticket_presentation",
    twin: "20260922210000_event_ticket_presentation.sql",
  },
  {
    tag: "0039_event_ticket_codes",
    twin: "20260922220000_event_ticket_codes.sql",
  },
  {
    tag: "0040_event_ticket_tax_and_group",
    twin: "20260922230000_event_ticket_tax_and_group.sql",
  },
  {
    tag: "0041_event_link_url_regex_within_limit",
    twin: "20260923000000_event_link_url_regex_within_limit.sql",
  },
  {
    tag: "0042_member_resources_file_path_regex_within_limit",
    twin: "20260923000100_member_resources_file_path_regex_within_limit.sql",
  },
  {
    tag: "0043_event_sponsor_layout_follows_limit",
    twin: "20260923100100_event_sponsor_layout_follows_limit.sql",
  },
  {
    tag: "0044_event_ticket_group_codes",
    twin: "20260923110000_event_ticket_group_codes.sql",
  },
  {
    tag: "0045_event_agenda_sponsor_affiliation",
    twin: "20260923120000_event_agenda_sponsor_affiliation.sql",
  },
  // Plik zastosowany z panelu Lovable WYŁĄCZNIE na pasie drizzle. Bliźniak
  // supabase dopisany później, z nagłówkiem, ale z tym samym SQL-em
  // wykonywalnym - bez niego świeża baza (pgTAP, harness wydarzeń) gubiła
  // z programu prelegentów bez konta, widocznych na produkcji.
  {
    tag: "0046_event_agenda_people_without_accounts",
    twin: "20260923130000_event_agenda_people_without_accounts.sql",
  },
  // Karta prelegenta rozwijana kliknieciem (pola na nakladce scenicznej)
  // i sciezki prelegenta wyprowadzone z obsady sesji.
  {
    tag: "0047_event_speaker_card_tracks",
    twin: "20260924120000_event_speaker_card_tracks.sql",
  },
];

export type LaneViolationKind = "brak-wpisu" | "wpis-bez-pliku" | "brak-blizniaka" | "rozjazd-sql";

export interface LaneViolation {
  readonly kind: LaneViolationKind;
  readonly tag: string;
  readonly detail: string;
}

export interface LaneReport {
  readonly checked: number;
  readonly twins: number;
  readonly drizzleOnly: number;
  readonly violations: readonly LaneViolation[];
}

/** Odczyt pliku; `null`, gdy pliku nie ma. Wstrzykiwalny, żeby test nie dotykał dysku. */
export type ReadFile = (path: string) => string | null;

export const readFileOrNull: ReadFile = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** Polskie znaki do ASCII - pas drizzle zapisuje literały bez diakrytyków. */
function foldDiacritics(sql: string): string {
  return sql.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L");
}

/** Czy tekst POZA literałami, od ostatniego `;`, kończy się na `COMMENT ON ... IS `. */
function isCommentOperand(stmt: string): boolean {
  return /\bCOMMENT\s+ON\b[\s\S]*\bIS\s+$/i.test(stmt);
}

/** Koniec (wyłącznie) literału zaczynającego się na `at`; `''` w środku to escape. */
function literalEnd(src: string, at: number): number {
  let j = at + 1;
  while (j < src.length) {
    if (src[j] === "'") {
      if (src[j + 1] === "'") {
        j += 2;
        continue;
      }
      break;
    }
    j += 1;
  }
  return Math.min(j + 1, src.length);
}

/**
 * Koniec CAŁEGO ciągu sklejanych literałów zaczynającego się na `at`.
 *
 * KONIEC WIERSZA JEST WARUNKIEM, NIE OZDOBĄ. PostgreSQL skleja dwie sąsiadujące
 * stałe napisowe tylko wtedy, gdy rozdzielający je biały znak zawiera ZNAK
 * NOWEGO WIERSZA; `'a' 'b'` w jednej linii to błąd składni, a nie napis `ab`.
 * Gdyby ta pętla łykała też wariant jednowierszowy, odcisk zrównywałby plik
 * NIEWYKONYWALNY z poprawnym bliźniakiem - a bramki `check:sql-*` czytają
 * wyłącznie pas supabase, więc nic innego by tego nie złapało. Zepsuty plik
 * pasa drizzle ma tu zapalić bramkę, nie przejść.
 *
 * Cokolwiek innego niż biały znak - również komentarz `--` - kończy ciąg.
 */
function concatenatedLiteralsEnd(src: string, at: number): number {
  let end = literalEnd(src, at);
  for (;;) {
    let k = end;
    let sawNewline = false;
    while (k < src.length && /\s/.test(src[k]!)) {
      if (src[k] === "\n") sawNewline = true;
      k += 1;
    }
    if (!sawNewline || src[k] !== "'") return end;
    end = literalEnd(src, k);
  }
}

/**
 * Skaner świadomy cytowania. Normalizuje WYŁĄCZNIE tekst poza literałami
 * i sam wycina komentarze - to drugie jest istotne, patrz `executableSql`.
 *
 * `maskCommentProse` włącza podmianę treści literału, który jest operandem
 * `COMMENT ON ... IS`. Wyłączamy je dla ciał cytowanych dolarami: `COMMENT ON`
 * w środku ciała funkcji czy widoku to NIE jest instrukcja komentująca obiekt,
 * tylko fragment zachowania - i dwa różne ciała nie mogą się przez to zrównać.
 *
 * `dollarIsCode` mówi, czym jest napotkany obszar `$tag$ ... $tag$`. Na
 * najwyższym poziomie to ciało funkcji albo widoku, czyli KOD: wchodzimy w nie
 * rekurencyjnie, bo spacja jest tam nieistotna, a komentarze `--` to proza,
 * którą trzeba wyciąć. JUŻ W ŚRODKU tego ciała zagnieżdżony obszar cytowany
 * dolarami jest natomiast WARTOŚCIĄ - i musi przejść bajt w bajt, razem
 * z tekstem, który tylko wygląda na komentarz.
 */
function scan(src: string, opts: { maskCommentProse: boolean; dollarIsCode: boolean }): string {
  let out = "";
  let buf = "";
  let stmt = "";
  let i = 0;

  /** Oddaje zebrany tekst spoza literałów - złożony i ze zwartą spacją. */
  const flush = (): void => {
    if (buf === "") return;
    const norm = foldDiacritics(buf).replace(/\s+/g, " ");
    buf = "";
    out += norm;
    const lastSemi = norm.lastIndexOf(";");
    stmt = lastSemi === -1 ? stmt + norm : norm.slice(lastSemi + 1);
  };

  while (i < src.length) {
    const ch = src[i]!;

    // Komentarze wycinamy TUTAJ, a nie przed wejściem do skanera: dopiero tu
    // wiadomo, czy `--` stoi w kodzie, czy w środku wartości. Zostaje spacja,
    // żeby `a--c\nb` nie skleiło się w `ab`.
    if (ch === "-" && src[i + 1] === "-") {
      const nl = src.indexOf("\n", i);
      buf += " ";
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      buf += " ";
      i = close === -1 ? src.length : close + 2;
      continue;
    }

    // $tag$ ... $tag$ - na wierzchu ciało funkcji/widoku (KOD), a w środku
    // takiego ciała już WARTOŚĆ, którą zostawiamy nietkniętą.
    if (ch === "$") {
      const opener = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(src.slice(i));
      if (opener) {
        const tag = opener[0];
        const bodyFrom = i + tag.length;
        const close = src.indexOf(tag, bodyFrom);
        const bodyTo = close === -1 ? src.length : close;
        const body = src.slice(bodyFrom, bodyTo);
        flush();
        out +=
          tag +
          (opts.dollarIsCode
            ? scan(body, { maskCommentProse: false, dollarIsCode: false })
            : body) +
          (close === -1 ? "" : tag);
        stmt += "x";
        i = close === -1 ? src.length : close + tag.length;
        continue;
      }
    }

    // Literał pojedynczy; '' w środku to escape, nie koniec.
    if (ch === "'") {
      const end = literalEnd(src, i);
      // `flush()` PRZED pytaniem o operand: dopiero on dokłada do `stmt` tekst
      // spoza literałów, a to w nim stoi `COMMENT ON ... IS `.
      flush();
      if (opts.maskCommentProse && isCommentOperand(stmt)) {
        // SĄSIADUJĄCE LITERAŁY TO JEDNA WARTOŚĆ. SQL skleja `'a' 'b'` w `'ab'`,
        // więc operand `COMMENT ON ... IS` rozbity na kilka literałów - tak
        // zapisuje długą prozę pas supabase - jest tą samą prozą, co jeden
        // literał w pasie drizzle. Bez zjedzenia całego ciągu pierwszy literał
        // dostawał znacznik, a reszta szła bajt w bajt i para 0016 zapalała
        // `rozjazd-sql` na SAMEJ PROZIE, której ta bramka świadomie nie pilnuje.
        out += "'<proza>'";
        stmt += "x";
        i = concatenatedLiteralsEnd(src, i);
        continue;
      }
      out += src.slice(i, end);
      stmt += "x";
      i = end;
      continue;
    }

    // Cytowany identyfikator - też nietykalny ("Kolumna" != "kolumna").
    if (ch === '"') {
      const close = src.indexOf('"', i + 1);
      const end = close === -1 ? src.length : close + 1;
      flush();
      out += src.slice(i, end);
      stmt += "x";
      i = end;
      continue;
    }

    buf += ch;
    i += 1;
  }

  flush();
  return out;
}

/**
 * SQL WYKONYWALNY: bez komentarzy, ze złożonymi diakrytykami i znormalizowaną
 * spacją POZA literałami, i z treścią operandu `COMMENT ON ... IS '...'`
 * zastąpioną znacznikiem - także wtedy, gdy operand jest sklejony z kilku
 * sąsiadujących literałów, bo SQL widzi w nich JEDNĄ wartość.
 *
 * Znacznik zamiast treści, a nie wycięcie całej instrukcji: gdyby jeden pas
 * przestał w ogóle komentować obiekt, różnica ma być nadal widoczna.
 *
 * DLACZEGO SKANER, A NIE TRZY `replace`. Poprzednia wersja składała diakrytyki
 * i zwierała spację GLOBALNIE, a literał komentarza łapała wyrażeniem
 * regularnym - i każda z tych trzech rzeczy potrafiła uzgodnić pliki, które
 * NAPRAWDĘ się różnią:
 *
 *   * globalne składanie diakrytyków zrównywało `CHECK (typ = 'złożony')`
 *     z `CHECK (typ = 'zlozony')` - inne ograniczenie, ten sam odcisk;
 *   * globalne zwieranie spacji zmieniało TREŚĆ literałów, więc `'a  b'`
 *     i `'a b'` przestawały się różnić;
 *   * wzorzec `COMMENT ON ... IS '...'` trafiał też WEWNĄTRZ ciała funkcji czy
 *     widoku cytowanego dolarami, więc dwa różne ciała zwracające
 *     `$$COMMENT ON x IS 'foo'$$` i `$$COMMENT ON x IS 'bar'$$` maskowały się
 *     nawzajem - a to jest różnica zachowania, nie prozy.
 *
 * CO JEST, A CO NIE JEST TREŚCIĄ. Literał pojedynczy i cytowany identyfikator
 * przechodzą bajt w bajt. Obszar cytowany dolarami zależy od piętra: NA WIERZCHU
 * to ciało funkcji albo widoku, czyli kod - wchodzimy w nie rekurencyjnie, bo
 * spacja jest tam nieistotna, a komentarze `--` to proza, którą trzeba wyciąć
 * (pas supabase komentuje ciała obficie, pas drizzle wcale; bez tego bramka
 * zapalałaby się na czterech z dziesięciu par WYŁĄCZNIE z powodu prozy).
 * JUŻ W ŚRODKU takiego ciała zagnieżdżony obszar cytowany dolarami jest
 * WARTOŚCIĄ i przechodzi nietknięty.
 *
 * DLACZEGO KOMENTARZE WYCINA SAM SKANER, a nie `stripSqlComments` przed nim.
 * Tamta funkcja zna apostrof i cudzysłów, ale NIE zna cytowania dolarami, więc
 * uruchomiona wcześniej kasowała tekst wyglądający na komentarz także ze środka
 * zagnieżdżonej WARTOŚCI - a rekurencja nie ma już czego ochronić, skoro wejście
 * przyszło zmienione. Para
 *
 *     $a$ BEGIN RETURN $b$foo -- A\nbar$b$; END $a$
 *     $a$ BEGIN RETURN $b$foo -- B\nbar$b$; END $a$
 *
 * zwracała ten sam odcisk, mimo że funkcje zwracają RÓŻNE napisy. Dlatego
 * wycinanie komentarzy siedzi w pętli skanera: dopiero tam wiadomo, czy `--`
 * stoi w kodzie, czy w wartości.
 */
export function executableSql(sql: string): string {
  return scan(sql, { maskCommentProse: true, dollarIsCode: true }).trim();
}

/**
 * Porównuje pas drizzle z rejestrem i - dla wpisów z bliźniakiem - z pasem supabase.
 *
 * `tags` to nazwy plików `.sql` z `drizzle/migrations/` BEZ rozszerzenia, czyli
 * dokładnie `tag` z dziennika drizzle.
 */
export function analyzeMigrationLanes(
  tags: readonly string[],
  entries: readonly LaneEntry[] = MIGRATION_LANES,
  read: ReadFile = readFileOrNull,
): LaneReport {
  const byTag = new Map(entries.map((e) => [e.tag, e]));
  const violations: LaneViolation[] = [];
  let twins = 0;
  let drizzleOnly = 0;

  for (const tag of tags) {
    const entry = byTag.get(tag);
    if (!entry) {
      violations.push({
        kind: "brak-wpisu",
        tag,
        detail: `Plik ${DRIZZLE_DIR}/${tag}.sql nie ma wpisu w MIGRATION_LANES. Wskaż bliźniaka z ${SUPABASE_DIR}/ albo napisz, czemu go nie ma.`,
      });
      continue;
    }
    if (!("twin" in entry)) {
      drizzleOnly += 1;
      continue;
    }

    twins += 1;
    const drizzleSql = read(`${DRIZZLE_DIR}/${tag}.sql`);
    const supabaseSql = read(`${SUPABASE_DIR}/${entry.twin}`);
    if (drizzleSql === null) continue; // brak pliku łapie pętla niżej
    if (supabaseSql === null) {
      violations.push({
        kind: "brak-blizniaka",
        tag,
        detail: `Wpis wskazuje na ${SUPABASE_DIR}/${entry.twin}, ale tego pliku nie ma.`,
      });
      continue;
    }
    if (executableSql(drizzleSql) !== executableSql(supabaseSql)) {
      violations.push({
        kind: "rozjazd-sql",
        tag,
        detail: `${DRIZZLE_DIR}/${tag}.sql i ${SUPABASE_DIR}/${entry.twin} mają RÓŻNY SQL wykonywalny. Produkcja i pgTAP testowałyby wtedy dwie różne bazy.`,
      });
    }
  }

  const present = new Set(tags);
  for (const entry of entries) {
    if (!present.has(entry.tag)) {
      violations.push({
        kind: "wpis-bez-pliku",
        tag: entry.tag,
        detail: `Rejestr ma wpis dla ${entry.tag}, ale pliku ${DRIZZLE_DIR}/${entry.tag}.sql nie ma. Martwy wpis maskuje brak pliku.`,
      });
    }
  }

  return { checked: tags.length, twins, drizzleOnly, violations };
}

export function laneParityFailed(report: LaneReport): boolean {
  return report.violations.length > 0;
}

export function renderLaneReport(report: LaneReport): string {
  const head = `Pasy migracji: ${report.checked} plików drizzle (${report.twins} z bliźniakiem, ${report.drizzleOnly} świadomie bez).`;
  if (report.violations.length === 0) return `${head} Zgodne.`;
  const lines = report.violations.map((v) => `  [${v.kind}] ${v.tag}: ${v.detail}`);
  return [head, `NARUSZENIA (${report.violations.length}):`, ...lines].join("\n");
}
