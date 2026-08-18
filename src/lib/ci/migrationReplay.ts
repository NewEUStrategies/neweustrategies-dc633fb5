// Inwariant CI: BAZĘ MUSI DAĆ SIĘ ODTWORZYĆ Z MIGRACJI.
//
// Jeden moduł na jedno pytanie: czy `supabase db start` (świeża baza, migracje od
// zera) dobiegnie do końca. Obie klasy błędów zebrane tu razem mają wspólną,
// paskudną własność: są NIEWIDOCZNE dla każdego, kto odtwarza bazę przyrostowo
// (`db push` na produkcję), i obie ubijają joby `pgtap`, `e2e` oraz `e2e-seeded`
// ZANIM cokolwiek się uruchomi - a przy okazji sprawiają, że żadna migracja po
// feralnej nie jest już w CI walidowana.
//
// ── INWARIANT 1: unikalność wersji ──────────────────────────────────────────
// `supabase_migrations.schema_migrations.version` to KLUCZ GŁÓWNY, a wersja to
// prefiks timestampu z nazwy pliku. Trzy pliki dzieliły `20260803090000`
// (`harden_enqueue_notification_acl`, `link_monitor_archive_and_alerts`,
// `payment_orders_gdpr_retention`). Audyt 2026-08-03 (korekta 5, P1, rekomendacja
// powtarzana od trzech wydań) opisał skutek słowo w słowo: „różnica między
// »działa« a »nie da się odtworzyć bazy z migracji« jest tu kwestią kolejności
// alfabetycznej". Zmaterializował się jako:
//   ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
//
// ── INWARIANT 2: zapisy do storage.objects tylko przez sankcjonowaną furtkę ──
// storage-api >= 0055 (w CI od pinu supabase/setup-cli 2.111.0) zakłada
// statementowy trigger `protect_objects_delete`: `DELETE`/`UPDATE` na
// `storage.objects` bez GUC `storage.allow_delete_query` rzuca 42501 „Direct
// deletion from storage tables is not allowed". Repo sankcjonuje furtkę od
// 20260801122000 (`tg_messages_purge_attachment`), ale DWIE późniejsze migracje
// (`20260803085428`, `20260803120000`) miały wykonywane bloki `DO $$` bez niej -
// i każda z nich osobno przerywała odtwarzanie bazy.
//
// KLUCZOWE ROZRÓŻNIENIE: liczą się WYŁĄCZNIE bloki WYKONYWANE przy migracji.
// Ten sam `DELETE` w ciele `CREATE FUNCTION` jest bezpieczny - to tylko
// przechowywany tekst, wykonywany później z GUC-iem ustawionym przez wołającego
// (tak działają `20260712190000` i `20260712192421`, których bramka słusznie nie
// rusza). Bramka, która by ich nie odróżniała, byłaby fałszywie czerwona.
//
// Warstwa wykonawcza (odczyt katalogu + exit code) żyje w
// `scripts/check-sql-migration-replay.ts`; ten moduł jest czysty i testowalny.

// ── INWARIANT 3: żadna migracja nie wjeżdża DWA RAZY pod dwiema nazwami ─────
// Bramka wersji pilnuje KLUCZA, nie TREŚCI - a duplikaty treści przechodziły
// przez nią bez śladu, bo mają różne timestampy. Powstają mechanicznie: ta sama
// zmiana raz jako plik pisany w PR-ze, raz jako plik wygenerowany po merge'u
// przez dashboard platformy (nazwa z UUID). Wszystkie są idempotentne
// (`ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS`), więc odtwarzanie bazy
// nie pęka - koszt jest inny: HISTORIA MIGRACJI PRZESTAJE MÓWIĆ PRAWDĘ o tym,
// kiedy zmiana realnie weszła. Przy spłaszczonej historii commitów to jedyne
// narzędzie datowania regresji, jakie zostaje audytowi i debuggerowi.
//
// SKALA (pomiar 2026-08-06, pierwszy w historii repo): **34 pary**, najstarsza
// z 30 czerwca. Audyt 05.08 naliczył sześć - bo szukał ręcznie, wśród migracji
// z ostatnich dni. Zjawisko jest systemowe i ciągnie się od początku projektu;
// dopiero bramka pokazała jego rozmiar. Stan bieżący: **45 par** - bramka łapie
// każde kolejne wdrożenie przez dashboard platformy (patrz wpisy z 09-10.08,
// 14.08, 16.08 i 18.08 na końcu rejestru).
//
// Dlaczego lista długu zamiast twardej odmowy: te pary są już ZASTOSOWANE (ich
// wersje siedzą w `schema_migrations` na produkcji). Skasowanie pliku
// zastosowanej migracji rozjeżdża ledger z repo i wymaga świadomej decyzji
// operatora, nie commita audytowego.
//
// KAŻDA nowa para wywala CI i ma dokładnie dwie drogi wyjścia (patrz komunikat
// bramki w `renderMigrationReplayReport`):
//   1. para jeszcze NIE wdrożona -> usuń wygenerowany duplikat, zostaw plik z PR-a;
//   2. obie wersje już zastosowane (platforma nałożyła je w chwili generowania)
//      -> wpis tutaj wraz z decyzją operatora i DOWODEM zastosowania.
// Ratchet dotyczy naprawialności: wpis wolno usunąć wyłącznie po uporządkowaniu
// ledgera, nigdy po to, żeby uciszyć bramkę.
//
// ── INWARIANT 4: rejestr długu odpowiada za samego siebie ───────────────────
// Ścieżka nr 2 wyżej żąda „decyzji operatora i DOWODU zastosowania", ale przez
// pierwsze wydania nośnikiem była płaska lista kluczy `"a.sql|b.sql"`, więc
// jedno i drugie mieszkało w KOMENTARZACH, których bramka nie czytała. Taki
// dług gnije bezgłośnie: komentarz „Wdrożenie PR #191" wisiał nad wpisem z PR
// #209 długo po tym, jak wpis, którego dotyczył, zniknął. Od 2026-08-18 wpis
// jest REKORDEM (`KnownContentTwin`), a `validateTwinLedger` sprawdza rejestr
// tak samo bezlitośnie jak katalog migracji - z `appliedOn` konfrontowanym
// z wersją późniejszego pliku pary.

/** `20260803090000_opis.sql` -> wersja + opis. */
const FILE_RE = /^(\d{14})_(.+)\.sql$/;

/** Data z wersji pliku: `20260818061944_...sql` -> `2026-08-18`. */
function versionDate(file: string): string | null {
  const match = FILE_RE.exec(file);
  if (!match) return null;
  const version = match[1];
  return `${version.slice(0, 4)}-${version.slice(4, 6)}-${version.slice(6, 8)}`;
}

/** Tożsamość pary: nazwy plików posortowane i sklejone `|`. */
function twinKey(files: readonly string[]): string {
  return [...files].sort().join("|");
}

/**
 * Wpis rejestru zastanych bliźniaków - para plików WRAZ z decyzją operatora
 * i dowodem zastosowania obu wersji.
 *
 * Doktryna modułu wymagała jednego i drugiego od pierwszego dnia, ale nośnikiem
 * była płaska lista kluczy `"a.sql|b.sql"`, a decyzje mieszkały w komentarzach
 * NAD wpisami - czyli w miejscu, którego bramka nigdy nie czytała. Skutki były
 * dokładnie takie, jakich się po takim układzie spodziewać: komentarz
 * „Wdrożenie PR #191" wisi dziś nad wpisem z PR #209, bo wpis, którego dotyczył,
 * kiedyś zniknął, a tekst został. Dług o sobie NIE MÓWIŁ.
 *
 * Rekord to naprawia u podstawy: każde pole jest albo notatką człowieka
 * (`deployment`, `rationale`), albo faktem, który bramka WERYFIKUJE
 * (`files`, `appliedOn` - patrz `validateTwinLedger`). Wpis bez decyzji nie
 * przechodzi typowania, wpis z rozjechaną datą nie przechodzi bramki.
 */
export interface KnownContentTwin {
  /** Nazwy plików pary, ROSNĄCO. Ta para jest tożsamością wpisu. */
  readonly files: readonly [string, string];
  /** Wdrożenie, które parę wyprodukowało: numer PR-a albo nazwa serii. */
  readonly deployment: string;
  /** Dzień wejścia PÓŹNIEJSZEJ z dwóch wersji (`YYYY-MM-DD`), z jej nazwy pliku. */
  readonly appliedOn: string;
  /** Decyzja operatora wraz z dowodem, że obie wersje są zastosowane. */
  readonly rationale: string;
}

/** Pojedyncza wada rejestru: co jest nie tak i z którym wpisem. */
export interface TwinLedgerDefect {
  /** Klucz wpisu (`a.sql|b.sql`) - albo `files.join("|")`, gdy para jest krzywa. */
  readonly entry: string;
  /** Co dokładnie jest nie tak. */
  readonly problem: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rejestr sprawdza SAM SIEBIE. Lista długu, której nikt nie waliduje, gnije
 * w jedną stronę: wpisy się dublują, klucze rozjeżdżają z konwencją nazw, daty
 * przestają odpowiadać plikom, a uzasadnienia pustoszeją do „decyzja
 * operatorska" bez treści. Wtedy ratchet („lista może tylko maleć") jest już
 * tylko zdaniem w komentarzu, bo nie ma czego mierzyć.
 *
 * Dlatego wada rejestru CZERWIENI bramkę tak samo jak nowy bliźniak: to nie jest
 * higiena stylu, tylko warunek, pod którym lista w ogóle cokolwiek znaczy.
 */
export function validateTwinLedger(entries: readonly KnownContentTwin[]): TwinLedgerDefect[] {
  const defects: TwinLedgerDefect[] = [];
  const seen = new Set<string>();
  let previousKey = "";

  for (const entry of entries) {
    const [first, second] = entry.files;
    const key = twinKey(entry.files);
    const report = (problem: string): void => {
      defects.push({ entry: key, problem });
    };

    for (const file of entry.files) {
      if (!FILE_RE.test(file)) {
        report(`\`${file}\` nie pasuje do konwencji nazw (14 cyfr + '_' + opis + '.sql')`);
      }
    }
    if (first === second) {
      report("para wskazuje dwa razy ten sam plik");
    } else if (first > second) {
      report(`pliki nie stoją rosnąco - \`${second}\` jest starszy niż \`${first}\``);
    }

    if (seen.has(key)) report("wpis powtórzony w rejestrze");
    seen.add(key);
    if (key < previousKey) report(`rejestr nie jest posortowany - wpis stoi po \`${previousKey}\``);
    previousKey = key;

    if (entry.deployment.trim() === "") {
      report("puste `deployment` - wpis nie mówi, które wdrożenie parę wyprodukowało");
    }
    if (entry.rationale.trim() === "") {
      report("puste `rationale` - dług bez decyzji operatora jest długiem niemym");
    }

    if (!ISO_DATE_RE.test(entry.appliedOn)) {
      report(`\`appliedOn\` (${entry.appliedOn}) poza formatem YYYY-MM-DD`);
    } else {
      // Data nie jest wolnym tekstem: musi wynikać z wersji PÓŹNIEJSZEGO pliku,
      // czyli z chwili, w której para się domknęła. Jedyne pole opisowe,
      // które bramka potrafi skonfrontować z rzeczywistością - i konfrontuje.
      const expected = versionDate(second);
      if (expected !== null && expected !== entry.appliedOn) {
        report(
          `\`appliedOn\` (${entry.appliedOn}) rozjeżdża się z wersją \`${second}\` (${expected})`,
        );
      }
    }
  }
  return defects;
}

/**
 * Bliźniaki treści już ZASTOSOWANE na hostowanej bazie - zastane 2026-08-06
 * plus kolejne wdrożenia przez dashboard platformy. Rejestr wolno SKRACAĆ po
 * uporządkowaniu ledgera; dopisać - wyłącznie parę, dla której udokumentowano
 * zastosowanie obu wersji (inaczej właściwą naprawą jest usunięcie
 * wygenerowanego duplikatu PRZED wdrożeniem).
 */
const KNOWN_CONTENT_TWINS: readonly KnownContentTwin[] = [
  {
    files: [
      "20260630095255_8eed6a02-fe17-4a5d-b379-e149b5617099.sql",
      "20260630130000_web_vitals_daily_p75.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-06-30",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260702090000_workflow_status_values.sql",
      "20260702112958_449e5bf2-540b-4b63-82ad-5d0aabf999b9.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-02",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260702090100_editorial_workflow.sql",
      "20260702113027_d3940358-76a0-4e77-bf9c-52f475d524b6.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-02",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260708170000_profiles_pii_grant_fix.sql",
      "20260708205846_ba807e22-1223-434c-ae83-1ab83ab71329.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-08",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260711120200_payment_orders_subscription_ref.sql",
      "20260711170456_5a2f7744-f674-4a50-9cb4-8ca70573e171.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-11",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260711130000_drop_dead_subscription_tiers.sql",
      "20260711170409_336c351b-badf-4e31-a246-90dff05d18ca.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-11",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260711200000_domain_event_bus.sql",
      "20260711220607_555aaf71-75e5-4153-a123-4d3b78715ffc.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-11",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260711201000_cross_references_and_mentions.sql",
      "20260711220719_8ea0af08-fe4b-4184-bc57-56ce7cdfd8c3.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-11",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260711202000_pending_counters.sql",
      "20260711220826_7d40944d-a182-433f-968c-70dfeaba4ebe.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-11",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260711203000_idempotency_and_integration_outbox.sql",
      "20260711220935_220b8de1-c64d-481d-8ca7-3cb8e677dc72.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-11",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260711204000_workflow_engine.sql",
      "20260711221058_9dbe5dcf-e0b7-4760-a0a7-c40e80042a56.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-11",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260711205000_enqueue_notification_recipient_tenant.sql",
      "20260711221135_e1498398-269b-415e-8cd2-1c649381ca1c.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-11",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260712190000_chat_privacy_tenant_hardening.sql",
      "20260712192421_f5534986-5cf6-4b3b-81b3-8dd3cbf060d2.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-12",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260713080601_c143de36-df8b-414b-9980-215c6a7bdf13.sql",
      "20260714090000_integration_endpoints_secret_vault.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-14",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260719231236_9814f56f-06d5-40f4-891f-c34a43628255.sql",
      "20260801121000_revoke_content_access_password_hints_authenticated.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-08-01",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260721211451_add_slug_to_get_chat_peers.sql",
      "20260721211552_f786a170-6950-4356-8d9a-e8d9decec852.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-21",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260722194752_91a36022-8b3a-4628-82bc-65fab0012b4c.sql",
      "20260722200000_pricing_audiences_faq.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-22",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260722223653_3a30e875-d618-4cfb-b88b-6989cd025470.sql",
      "20260722230000_pricing_catalog_v3_retention.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-22",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260722232800_cccc5cf5-2ad0-4c34-8d9c-fafaab2e60f4.sql",
      "20260723090000_tier_content_gating_tracker.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-23",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260723060808_0c9d46bb-7d5e-429e-9a19-cb6b08e637fc.sql",
      "20260723150000_plan_interval_quarter.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-23",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260723104913_5b9c4d2f-b2aa-4b13-ad64-513dc74393dd.sql",
      "20260723170000_expert_request_capability.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-23",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260724104608_1d969894-68ab-4185-a781-933b1fd09894.sql",
      "20260724110000_harden_user_bookmarks_tenant_scope.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-24",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260724192249_flatten_menu_taxonomy_hrefs.sql",
      "20260724192307_b51fd20f-484c-41ea-b740-206f6d456f78.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-24",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260726090000_related_posts_config_provisioning.sql",
      "20260728093211_8ffa7d51-40cf-4128-addb-c4fd4904b26e.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-28",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260730190000_plan_interval_two_weeks.sql",
      "20260730194544_eea8e34d-649f-410b-89c1-32c01bae53c9.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-30",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260730191000_business_partner_catalog.sql",
      "20260730194653_461c4aeb-4d8d-4b9b-a32a-1ed55f020448.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-30",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260731193000_get_expert_materials.sql",
      "20260731213605_c59ddd2f-6697-4a68-ba6d-12c0f6d86c4e.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-31",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260731210001_expert_layout_inline_overrides.sql",
      "20260731211632_832b5da6-50c1-4907-86b5-8abf90033136.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-07-31",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260731220000_payment_orders_environment_isolation.sql",
      "20260801135636_3f04a060-6643-497b-ac56-554258fd2703.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-08-01",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260803090001_link_monitor_archive_and_alerts.sql",
      "20260803092325_19f1e04f-5ff8-4f47-b28a-129254553dd0.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-08-03",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260803095150_6d9df3b2-518b-47a1-8d3c-2e947eeda4a2.sql",
      "20260803113000_profile_badge_domain_sync.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-08-03",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260803140001_consent_gpc_signal.sql",
      "20260803190927_fff99c9d-23b7-4465-adad-c3aef71099ff.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-08-03",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260804145341_26ab64e2-3671-4530-8e8e-b4d7ff4ec953.sql",
      "20260804150000_newsletter_popup_design_jsonb.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-08-04",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260806084556_16d8191a-65d0-4002-b075-3a41d62ed1a5.sql",
      "20260806120000_mobile_bottom_bar_reference_look.sql",
    ],
    deployment: "dług zastany",
    appliedOn: "2026-08-06",
    rationale:
      "Para z pierwszego pomiaru bliźniaków treści w historii repo (34 pary, najstarsza z 30.06). Obie wersje w `schema_migrations`, SQL idempotentny.",
  },
  {
    files: [
      "20260806160001_expert_request_single_generation.sql",
      "20260806185055_1272fb55-fdb9-4eac-9035-66377484ac2c.sql",
    ],
    deployment: "PR #189 / #190",
    appliedOn: "2026-08-06",
    rationale:
      "Plik z gałęzi i bliźniak z zastosowania na hostowanej bazie. Obie wersje w ledgerze, SQL idempotentny (CREATE OR REPLACE + DROP TRIGGER IF EXISTS).",
  },
  {
    files: [
      "20260806160002_profile_verification_guard_insert_parity.sql",
      "20260806190257_9386c9cc-9f1f-4ce8-8320-b3abad5ecc3f.sql",
    ],
    deployment: "PR #189 / #190",
    appliedOn: "2026-08-06",
    rationale:
      "Plik z gałęzi i bliźniak z zastosowania na hostowanej bazie. Obie wersje w ledgerze, SQL idempotentny (CREATE OR REPLACE + DROP TRIGGER IF EXISTS).",
  },
  {
    files: [
      "20260809000000_discussion_clubs_a29_products_and_topic_sections.sql",
      "20260809075619_80bcd58c-c652-4f9d-8324-a89ab2b68202.sql",
    ],
    deployment: "PR #209",
    appliedOn: "2026-08-09",
    rationale:
      "A29 (dorobek klubu + działy tematyczne). Pliki różnią się WYŁĄCZNIE znakiem końca ostatniej linii; obie wersje w ledgerze.",
  },
  {
    files: [
      "20260809091046_7f9142c0-3b00-4cb9-afb4-3186e1a2c743.sql",
      "20260809120000_discussion_clubs_a30_reply_outcome.sql",
    ],
    deployment: "PR #210-#213",
    appliedOn: "2026-08-09",
    rationale:
      "A30 (wynik odpowiedzi). Plik z gałęzi i bliźniak zapisany przez platformę przy zastosowaniu migracji na hostowanej bazie. Obie wersje w ledgerze, SQL idempotentny.",
  },
  {
    files: [
      "20260810105134_d5d870da-90ed-455b-b950-3764d7a62e17.sql",
      "20260810120000_discussion_clubs_a32_networking.sql",
    ],
    deployment: "PR #210-#213",
    appliedOn: "2026-08-10",
    rationale:
      "A32 (networking). Plik z gałęzi i bliźniak zapisany przez platformę przy zastosowaniu migracji na hostowanej bazie. Obie wersje w ledgerze, SQL idempotentny.",
  },
  {
    files: [
      "20260810105510_20a7837a-44a0-43a4-92c9-74459d55cae0.sql",
      "20260810180000_discussion_clubs_a33_network_screens.sql",
    ],
    deployment: "PR #210-#213",
    appliedOn: "2026-08-10",
    rationale:
      "A33 (ekrany sieci). Plik z gałęzi i bliźniak zapisany przez platformę przy zastosowaniu migracji na hostowanej bazie. Obie wersje w ledgerze, SQL idempotentny.",
  },
  {
    files: [
      "20260810120817_e2ee8061-1872-49be-9b25-dbb68ba85f44.sql",
      "20260810210000_discussion_clubs_a34_roster_faces.sql",
    ],
    deployment: "PR #210-#213",
    appliedOn: "2026-08-10",
    rationale:
      "A34 (twarze rosteru). Plik z gałęzi i bliźniak zapisany przez platformę przy zastosowaniu migracji na hostowanej bazie. Obie wersje w ledgerze, SQL idempotentny.",
  },
  {
    files: [
      "20260814100000_careers_tenant_scope.sql",
      "20260814122639_37dcf7c4-65f3-4b41-a1a8-d5e5cf3cab5c.sql",
    ],
    deployment: "PR #226",
    appliedOn: "2026-08-14",
    rationale:
      "Rekrutacja /zatrudniamy - izolacja najemców. Bliźniak różni się odjętymi komentarzami i brakiem znaku końca ostatniej linii; kasowanie pliku wymagałoby `supabase migration repair` na każdym środowisku.",
  },
  {
    files: [
      "20260814110000_careers_pipeline_and_cv_retention.sql",
      "20260814123014_97f305de-e08e-4e76-b1d0-e5d17f909f1d.sql",
    ],
    deployment: "PR #226",
    appliedOn: "2026-08-14",
    rationale:
      "Rekrutacja /zatrudniamy - pipeline zgłoszeń i retencja CV. Jak wyżej: obie wersje w ledgerze, SQL idempotentny.",
  },
  {
    files: [
      "20260816090000_club_topics_public_read_tenant_scope.sql",
      "20260816204256_d05ac5e5-13f2-43dc-b08b-15a03105188b.sql",
    ],
    deployment: "PR #242",
    appliedOn: "2026-08-16",
    rationale:
      "Izolacja najemcy w club_topics. Plik z gałęzi nigdy nie zadziałał na produkcji (polityka stała na USING (true), club_topics_active() na tautologii); skutek dał dopiero bliźniak zastosowany narzędziem migracji.",
  },
  // Wdrożenie PR #247 (kariera: publiczny odczyt sekcji respektuje `is_visible`).
  // Pierwsze trafienie bramki bliźniaków w trybie „złapane na gorąco", nie
  // „zastane": plik z gałęzi wjechał commitem 5b759d7, a bliźniak - commitem
  // acd05fc (gpt-engineer-app[bot]) już PO merge'u. Pliki różnią się WYŁĄCZNIE
  // znakiem końca ostatniej linii.
  //
  // DOWÓD ZASTOSOWANIA (dlaczego to ścieżka nr 2, a nie „usuń duplikat"):
  // ten sam commit acd05fc przyniósł REGENEROWANE `src/integrations/supabase/
  // types.ts` z blokami `Insert`/`Update` dla `career_page_sections_public`,
  // w których kolumny owinięte w `CASE` mają `never`, a przepuszczone wprost
  // (`key`, `is_visible`, `sort_order`) - wartości opcjonalne. Tego podziału nie
  // da się napisać z głowy: generator bierze go z `information_schema.columns
  // .is_updatable`, czyli z introspekcji ŻYWEJ bazy. Widok tam JEST, więc
  // migracja się wykonała, a wersja bliźniaka siedzi w `schema_migrations`.
  //
  // DECYZJA OPERATORSKA: zostawiamy oba pliki. Skasowanie któregokolwiek
  // wymagałoby `supabase migration repair` na każdym środowisku - to zmiana
  // operatorska, nie porządkowa. Oba SQL-e są idempotentne (`DROP POLICY IF
  // EXISTS`, `DROP VIEW IF EXISTS` + `CREATE`), więc replay od zera przechodzi.
  {
    files: [
      "20260817230000_career_sections_visibility_public_read.sql",
      "20260818061944_397f082a-34ba-4c68-8a6f-71b7248c0bd7.sql",
    ],
    deployment: "PR #247",
    appliedOn: "2026-08-18",
    rationale:
      "Kariera: publiczny odczyt sekcji respektuje `is_visible`. Plik z gałęzi (5b759d7) i bliźniak wygenerowany przez platformę po merge'u (acd05fc); różnią się wyłącznie znakiem końca ostatniej linii. Dowód zastosowania: ten sam commit przyniósł regenerowane `types.ts` z blokami Insert/Update dla `career_page_sections_public`, z `never` dokładnie na kolumnach owiniętych w CASE - to odczyt `information_schema.columns.is_updatable` z żywej bazy, więc widok tam istnieje.",
  },
];

/**
 * Treść migracji bez komentarzy i bez różnic w białych znakach. Dwa pliki
 * generowane osobno dla tej samej zmiany różnią się zwykle wyłącznie nagłówkiem
 * i wcięciami, więc porównanie surowych bajtów nic by nie znalazło.
 */
function normalizeSql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Zapis do storage.objects, który trigger `protect_objects_delete` blokuje. */
const STORAGE_WRITE_RE = /\b(?:DELETE\s+FROM|UPDATE)\s+storage\.objects\b/i;

/** Sankcjonowana furtka z 20260801122000. */
const STORAGE_GUC = "storage.allow_delete_query";

export interface MigrationFileName {
  readonly file: string;
  readonly version: string;
  readonly name: string;
}

export interface MigrationReplayReport {
  /** Liczba plików z poprawnie sparsowaną wersją. */
  readonly total: number;
  /** Pliki, których nazwa nie daje się sparsować na wersję + opis. */
  readonly unparsable: readonly string[];
  /** Kolizje: wersja -> pliki, które ją dzielą (zawsze >= 2). */
  readonly duplicates: ReadonlyMap<string, readonly string[]>;
  /** Miejsca, gdzie porządek nazw rozjeżdża się z porządkiem wersji. */
  readonly outOfOrder: readonly string[];
  /** Pliki z WYKONYWANYM zapisem do storage.objects bez furtki GUC. */
  readonly unguardedStorageWrites: readonly string[];
  /** NOWE bliźniaki treści (identyczna treść po odjęciu komentarzy), spoza listy długu. */
  readonly contentTwins: readonly (readonly string[])[];
  /** Bliźniaki z rejestru znanego długu, które nadal istnieją - raportowane, nie blokujące. */
  readonly knownContentTwins: readonly KnownTwinSighting[];
  /** Wpisy rejestru, których już nie ma w repo - ratchet każe je usunąć. */
  readonly staleKnownTwins: readonly string[];
  /** Wady SAMEGO rejestru długu (kolejność, duplikaty, brak decyzji, krzywa data). */
  readonly twinLedgerDefects: readonly TwinLedgerDefect[];
  /** `CREATE FUNCTION` (bez OR REPLACE) dla sygnatury utworzonej wcześniej. */
  readonly recreatedFunctions: readonly RecreatedFunction[];
}

/** Znana para przyłapana w repo wraz z wpisem rejestru, który ją usprawiedliwia. */
export interface KnownTwinSighting {
  /** Pliki pary, tak jak leżą w katalogu migracji. */
  readonly files: readonly string[];
  /** Wpis rejestru: wdrożenie, data domknięcia pary i decyzja operatora. */
  readonly entry: KnownContentTwin;
}

export interface RecreatedFunction {
  /** `nazwa/liczba_argumentów` - tyle wystarczy, bo PostgreSQL rozstrzyga po niej. */
  readonly signature: string;
  /** Plik, który próbuje utworzyć sygnaturę drugi raz. */
  readonly file: string;
  /** Plik, który utworzył ją wcześniej. */
  readonly earlier: string;
}

/**
 * Wycina ciała `CREATE [OR REPLACE] FUNCTION ... $tag$ ... $tag$`, zostawiając
 * wszystko, co migracja realnie WYKONUJE (w tym bloki `DO $$`).
 *
 * Dopasowanie idzie po znaczniku dolarowym otwierającym ciało, więc `$$`, `$fn$`
 * i każdy inny wariant zamykają się poprawnie i funkcja z `$$` w treści komentarza
 * nie urywa wycinania w złym miejscu.
 */
export function stripFunctionBodies(sql: string): string {
  const createFn = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi;
  let out = "";
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = createFn.exec(sql)) !== null) {
    if (match.index < cursor) continue;
    // Znacznik otwierający ciało: pierwszy $tag$ po nagłówku funkcji.
    const tagMatch = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(match.index));
    if (!tagMatch) break;
    const tag = tagMatch[0];
    const bodyStart = match.index + (tagMatch.index ?? 0) + tag.length;
    const bodyEnd = sql.indexOf(tag, bodyStart);
    if (bodyEnd === -1) break; // niedomknięte ciało - nie zgaduj

    out += sql.slice(cursor, match.index + (tagMatch.index ?? 0));
    cursor = bodyEnd + tag.length;
    createFn.lastIndex = cursor;
  }
  return out + sql.slice(cursor);
}

/**
 * Czy plik wykonuje zapis do `storage.objects` BEZ sankcjonowanej furtki.
 *
 * Furtka sprawdzana jest w obrębie CAŁEGO wykonywanego fragmentu (a nie linia po
 * linii), bo `set_config` stoi kilka wierszy nad `DELETE`, w tym samym bloku.
 */
export function hasUnguardedStorageWrite(sql: string): boolean {
  const executed = stripFunctionBodies(sql);
  if (!STORAGE_WRITE_RE.test(executed)) return false;
  return !executed.includes(STORAGE_GUC);
}

export interface MigrationSource {
  readonly file: string;
  readonly sql: string;
}

/**
 * Liczba argumentów z listy parametrów. Liczymy przecinki NA POZIOMIE ZERO,
 * bo `numeric(10,2)`, `DEFAULT (a, b)` i literały z przecinkiem w środku
 * dawałyby inaczej zawyżoną arność - a arność jest tu całym kluczem tożsamości.
 */
function paramArity(params: string): number {
  const trimmed = params.trim();
  if (trimmed === "") return 0;
  let depth = 0;
  let quote: string | null = null;
  let count = 1;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) count += 1;
  }
  return count;
}

/** Wyciąga `nazwa/arność` dla każdego dopasowania nagłówka funkcji. */
function functionSignatures(sql: string, header: RegExp): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(
    header.source,
    header.flags.includes("g") ? header.flags : `${header.flags}g`,
  );
  while ((match = re.exec(sql)) !== null) {
    let depth = 0;
    let start = -1;
    for (let i = re.lastIndex - 1; i < sql.length; i += 1) {
      if (sql[i] === "(") {
        if (depth === 0) start = i + 1;
        depth += 1;
      } else if (sql[i] === ")") {
        depth -= 1;
        if (depth === 0) {
          out.push(`${match[1]}/${paramArity(sql.slice(start, i))}`);
          break;
        }
      }
    }
  }
  return out;
}

const PLAIN_CREATE_FN = /(?<!OR\s{1,8}REPLACE\s{1,8})\bCREATE\s+FUNCTION\s+public\.(\w+)\s*\(/gi;
const REPLACE_CREATE_FN = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\s*\(/gi;
const DROP_FN = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?public\.(\w+)\s*\(/gi;

/**
 * `CREATE FUNCTION` bez `OR REPLACE` dla sygnatury, którą utworzyła już
 * wcześniejsza migracja, wywala CAŁY replay błędem 42723 ("function already
 * exists with same argument types"). Na bazie, która obie migracje ma już
 * zastosowane, nic się nie dzieje - dlatego ten błąd jest niewidoczny aż do
 * chwili, gdy ktoś odtwarza schemat od zera. Właśnie tak położyło CI
 * `redeem_gift_link/3` (08.2026): jedna migracja zdjęła wariant dwuargumentowy
 * i utworzyła trzyargumentowy, a druga powtórzyła dokładnie ten sam ruch.
 *
 * Zdjęcie DOKŁADNIE tej sygnatury w tym samym pliku jest legalne i częste -
 * tak zmienia się typ zwracany, którego `CREATE OR REPLACE` nie przepuszcza.
 */
function findRecreatedFunctions(sources: readonly MigrationSource[]): RecreatedFunction[] {
  const createdIn = new Map<string, string>();
  const problems: RecreatedFunction[] = [];

  for (const { file, sql } of [...sources].sort((a, b) => a.file.localeCompare(b.file))) {
    // Nagłówki zostają, ciała znikają - inaczej `CREATE FUNCTION` w komentarzu
    // albo w treści innej funkcji liczyłoby się jak realna definicja.
    const executed = stripFunctionBodies(sql);
    const dropped = new Set(functionSignatures(executed, DROP_FN));

    for (const signature of functionSignatures(executed, PLAIN_CREATE_FN)) {
      const earlier = createdIn.get(signature);
      if (earlier !== undefined && earlier !== file && !dropped.has(signature)) {
        problems.push({ signature, file, earlier });
      }
      createdIn.set(signature, file);
    }
    for (const signature of functionSignatures(executed, REPLACE_CREATE_FN)) {
      createdIn.set(signature, file);
    }
  }
  return problems;
}

/**
 * Czysta analiza migracji. `sources` jest opcjonalne: bez treści plików bramka
 * sprawdza tylko inwariant wersji (nazwy), co pozwala testować go w izolacji.
 *
 * Sortowanie po nazwie jest ISTOTNE, nie kosmetyczne: dokładnie w tej kolejności
 * Supabase CLI aplikuje pliki, więc to ona decyduje, który plik zapisze się
 * w ledgerze pod wspólną wersją.
 */
export function analyzeMigrationReplay(
  files: readonly string[],
  sources: readonly MigrationSource[] = [],
  ledger: readonly KnownContentTwin[] = KNOWN_CONTENT_TWINS,
): MigrationReplayReport {
  const sorted = [...files].sort();
  const unparsable: string[] = [];
  const parsed: MigrationFileName[] = [];

  for (const file of sorted) {
    const match = FILE_RE.exec(file);
    if (!match) {
      unparsable.push(file);
      continue;
    }
    parsed.push({ file, version: match[1], name: match[2] });
  }

  const byVersion = new Map<string, string[]>();
  for (const { version, file } of parsed) {
    const bucket = byVersion.get(version);
    if (bucket) bucket.push(file);
    else byVersion.set(version, [file]);
  }
  const duplicates = new Map<string, readonly string[]>();
  for (const [version, group] of byVersion) {
    if (group.length > 1) duplicates.set(version, group);
  }

  // Wersje muszą rosnąć w tym samym porządku, w którym CLI aplikuje pliki.
  // Rozjazd znaczy, że ledger dostanie wersję „z przeszłości" po nowszej -
  // a wtedy `supabase db push` uzna ją za już zastosowaną i ją POMINIE.
  const outOfOrder: string[] = [];
  for (let i = 1; i < parsed.length; i += 1) {
    if (parsed[i].version < parsed[i - 1].version) {
      outOfOrder.push(`${parsed[i].file} (wersja starsza niż ${parsed[i - 1].file})`);
    }
  }

  const unguardedStorageWrites = [...sources]
    .filter(({ sql }) => hasUnguardedStorageWrite(sql))
    .map(({ file }) => file)
    .sort();

  // Bliźniaki treści: grupujemy po znormalizowanym SQL-u. Pustych (sam komentarz
  // albo plik zerowy) nie grupujemy - byłyby fałszywym alarmem.
  const byContent = new Map<string, string[]>();
  for (const { file, sql } of sources) {
    const key = normalizeSql(sql);
    if (key === "") continue;
    const bucket = byContent.get(key);
    if (bucket) bucket.push(file);
    else byContent.set(key, [file]);
  }
  const known = new Map<string, KnownContentTwin>(
    ledger.map((entry): [string, KnownContentTwin] => [twinKey(entry.files), entry]),
  );
  const seenKnown = new Set<string>();
  const contentTwins: string[][] = [];
  const knownContentTwins: KnownTwinSighting[] = [];
  for (const group of byContent.values()) {
    if (group.length < 2) continue;
    const sortedGroup = [...group].sort();
    const key = twinKey(sortedGroup);
    const entry = known.get(key);
    if (entry) {
      seenKnown.add(key);
      knownContentTwins.push({ files: sortedGroup, entry });
    } else {
      contentTwins.push(sortedGroup);
    }
  }
  contentTwins.sort((a, b) => a[0].localeCompare(b[0]));
  knownContentTwins.sort((a, b) => a.files[0].localeCompare(b.files[0]));
  // Ratchet: wpis jest NIEAKTUALNY, gdy para przestała być bliźniacza, mimo że
  // jej pliki są w zakresie analizy (usunięto jeden plik albo treści się
  // rozjechały). Gdy ŻADNEGO pliku pary nie ma w zakresie, wpis jest po prostu
  // poza zasięgiem tego wywołania - inaczej analiza cząstkowa (testy
  // jednostkowe na syntetycznych plikach) uznałaby całą listę za martwą.
  const scanned = new Set(sources.map(({ file }) => file));
  const staleKnownTwins = [...known.keys()]
    .filter((key) => !seenKnown.has(key) && key.split("|").some((file) => scanned.has(file)))
    .sort();

  return {
    total: parsed.length,
    unparsable,
    duplicates,
    outOfOrder,
    unguardedStorageWrites,
    contentTwins,
    knownContentTwins,
    staleKnownTwins,
    twinLedgerDefects: validateTwinLedger(ledger),
    recreatedFunctions: findRecreatedFunctions(sources),
  };
}

export function migrationReplayFailed(report: MigrationReplayReport): boolean {
  return (
    report.duplicates.size > 0 ||
    report.unparsable.length > 0 ||
    report.outOfOrder.length > 0 ||
    report.unguardedStorageWrites.length > 0 ||
    // Nowy bliźniak treści = czerwone CI. Znane pary są tylko raportowane,
    // ale wpis, który przestał odpowiadać rzeczywistości, też blokuje - inaczej
    // lista długu rosłaby w nieskończoność, zamiast maleć.
    report.contentTwins.length > 0 ||
    report.staleKnownTwins.length > 0 ||
    // Rejestr, który sam siebie nie trzyma w ryzach, przestaje być rejestrem -
    // i wtedy dwa punkty wyżej mierzą już tylko własny szum.
    report.twinLedgerDefects.length > 0 ||
    report.recreatedFunctions.length > 0
  );
}

export function renderMigrationReplayReport(report: MigrationReplayReport): string {
  const lines: string[] = [];

  if (report.duplicates.size > 0) {
    lines.push("✗ Zduplikowane wersje migracji (schema_migrations.version to KLUCZ GŁÓWNY):");
    for (const [version, group] of report.duplicates) {
      lines.push(`  wersja ${version} dzielona przez ${group.length} plików:`);
      for (const file of group) lines.push(`    - ${file}`);
    }
    lines.push(
      "  Napraw: przenumeruj wszystkie POZA pierwszym alfabetycznie (ten zapisał się",
      "  w ledgerze) na kolejne sekundy, zachowując względną kolejność -",
      "  konwencja repo: ...0000 / ...0001 / ...0002 (patrz 20260731210000/210001).",
    );
  }

  if (report.unparsable.length > 0) {
    lines.push("✗ Nazwy bez parsowalnej wersji (oczekiwane: 14 cyfr + '_' + opis + '.sql'):");
    for (const file of report.unparsable) lines.push(`    - ${file}`);
  }

  if (report.recreatedFunctions.length > 0) {
    lines.push(
      "✗ CREATE FUNCTION (bez OR REPLACE) dla sygnatury utworzonej wcześniej -",
      "  odtworzenie schematu od zera wywala się błędem 42723:",
    );
    for (const entry of report.recreatedFunctions) {
      lines.push(`    - ${entry.signature}`);
      lines.push(`        tworzy ponownie: ${entry.file}`);
      lines.push(`        wcześniej:       ${entry.earlier}`);
    }
    lines.push(
      "  Napraw: dopisz `DROP FUNCTION IF EXISTS public.<nazwa>(<te same typy>);`",
      "  bezpośrednio nad CREATE, albo użyj CREATE OR REPLACE, jeśli typ zwracany",
      "  się nie zmienia. Na bazie już zmigrowanej DROP IF EXISTS jest bez skutku.",
    );
  }

  if (report.outOfOrder.length > 0) {
    lines.push("✗ Porządek nazw plików rozjeżdża się z porządkiem wersji:");
    for (const entry of report.outOfOrder) lines.push(`    - ${entry}`);
  }

  if (report.unguardedStorageWrites.length > 0) {
    lines.push("✗ Wykonywany zapis do storage.objects BEZ furtki `storage.allow_delete_query`:");
    for (const file of report.unguardedStorageWrites) lines.push(`    - ${file}`);
    lines.push(
      "  storage-api >= 0055 rzuca 42501 i PRZERYWA `supabase db start`.",
      "  Napraw wzorem 20260801122000: transakcyjne",
      "  `set_config('storage.allow_delete_query','true',true)` wokół zapisu,",
      "  przywrócenie poprzedniej wartości i blok EXCEPTION.",
      "  (Ten sam zapis w ciele CREATE FUNCTION jest OK - nie wykonuje się przy migracji.)",
    );
  }

  if (report.contentTwins.length > 0) {
    lines.push("✗ Ta sama migracja wjechała DWA RAZY pod różnymi nazwami (identyczna treść):");
    for (const group of report.contentTwins) {
      lines.push(`  ${group.length} pliki o tej samej treści:`);
      for (const file of group) lines.push(`    - ${file}`);
    }
    lines.push(
      "  Odtwarzanie bazy przeżyje (migracje są idempotentne), ale HISTORIA KŁAMIE",
      "  o tym, kiedy zmiana realnie weszła - a przy spłaszczonej historii commitów",
      "  to jedyne narzędzie datowania regresji.",
      "  Napraw: zostaw plik z PR-a, usuń wygenerowany duplikat PRZED wdrożeniem.",
      "  Jeśli obie wersje są już zastosowane, dopisz wpis do KNOWN_CONTENT_TWINS",
      "  (files + deployment + appliedOn + rationale z DOWODEM zastosowania) -",
      "  rejestr może tylko maleć.",
    );
  }

  if (report.staleKnownTwins.length > 0) {
    lines.push("✗ Nieaktualne wpisy KNOWN_CONTENT_TWINS (te pary już nie istnieją):");
    for (const key of report.staleKnownTwins) lines.push(`    - ${key}`);
    lines.push(
      "  Usuń je z rejestru - ratchet działa tylko wtedy, gdy rejestr odzwierciedla stan.",
    );
  }

  if (report.twinLedgerDefects.length > 0) {
    lines.push("✗ Rejestr KNOWN_CONTENT_TWINS jest niespójny sam ze sobą:");
    for (const { entry, problem } of report.twinLedgerDefects) {
      lines.push(`    - ${entry}`);
      lines.push(`        ${problem}`);
    }
    lines.push(
      "  Wpisy stoją rosnąco po kluczu, nie powtarzają się, obie nazwy trzymają",
      "  konwencję migracji, a `appliedOn` równa się dacie z wersji PÓŹNIEJSZEGO",
      "  pliku. `deployment` i `rationale` muszą być niepuste: dług, który nie mówi,",
      "  skąd się wziął i kto go przyjął, jest nieodróżnialny od przeoczenia.",
    );
  }

  if (lines.length === 0) {
    const debt =
      report.knownContentTwins.length > 0
        ? `, ${report.knownContentTwins.length} znanych par bliźniaków treści (dług, rejestr może tylko maleć)`
        : "";
    lines.push(
      `✓ Inwariant odtwarzalności migracji OK (${report.total} plików: zero kolizji wersji, ` +
        `zero niezabezpieczonych zapisów do storage.objects${debt}).`,
    );
    for (const { files, entry } of report.knownContentTwins) {
      lines.push(`    dług: ${entry.deployment} (${entry.appliedOn}) ${files.join(" ≡ ")}`);
    }
  }
  return lines.join("\n");
}
