import { describe, expect, it } from "vitest";
import {
  analyzeOwnership,
  attributeMigrations,
  attributeRoutes,
  buildRuleIndex,
  buildVocabulary,
  extractIdentifiers,
  globToRegExp,
  matchIdentifier,
  ownershipFailed,
  parseRegistry,
  renderCodeowners,
  renderOwnershipReport,
  stripSqlComments,
  stripSqlNoise,
  type MigrationSource,
  type OwnershipDomain,
  type OwnershipInput,
} from "../ownership";

/** Minimalny, ale KOMPLETNY rejestr - taki, jaki musi przejść `parseRegistry`. */
function registryJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kontraktUtrzymaniowy: {
      dokument: "docs/UMOWA_UTRZYMANIOWA.md",
      runbookCiaglosci: "docs/RUNBOOK_CIAGLOSC_WYKONAWCY.md",
      zamawiajacy: "New European Strategies",
      wykonawca: "NIEOBSADZONE",
      obowiazujeOd: "2026-08-29",
      obowiazujeDo: "2027-08-31",
      ostrzegajOdDni: 60,
    },
    osoby: {
      wlasciciel: {
        rola: "Właściciel techniczny",
        organizacja: "Wykonawca",
        kontakt: "kto@example.test",
        github: "@kto",
        obsadzone: true,
        zrodlo: "test",
      },
      zastepca: {
        rola: "Zastępca",
        organizacja: "Wykonawca",
        kontakt: null,
        github: null,
        obsadzone: false,
        zrodlo: "test",
      },
      "organizacja-nes": {
        rola: "Zamawiający",
        organizacja: "New European Strategies",
        kontakt: "office@example.test",
        github: "@NewEUStrategies",
        obsadzone: true,
        zrodlo: "test",
      },
    },
    progi: {
      domenyBezWlasciciela: 0,
      martweWzorceTras: 0,
      migracjeBezAtrybucjiDozwolone: [],
    },
    identyfikatoryPrzekrojowe: { tier2: { profiles: "tozsamosc" } },
    domeny: [
      {
        slug: "kluby",
        nazwa: "Kluby",
        zakres: "Kluby i czat.",
        wlasciciel: "wlasciciel",
        zastepca: "zastepca",
        eskalacja: "organizacja-nes",
        klasaSla: "sla-1",
        zespolGithub: "@org/kluby",
        trasy: ["admin.community.*"],
        obiektyBazy: ["club_"],
      },
      {
        slug: "tozsamosc",
        nazwa: "Tożsamość",
        zakres: "Konta i role.",
        wlasciciel: "wlasciciel",
        zastepca: "zastepca",
        eskalacja: "organizacja-nes",
        klasaSla: "sla-1",
        zespolGithub: "@org/tozsamosc",
        trasy: ["admin.users.tsx"],
        obiektyBazy: ["user_roles"],
      },
    ],
    ...overrides,
  };
}

function input(overrides: Partial<OwnershipInput> = {}): OwnershipInput {
  return {
    registry: parseRegistry(registryJson()),
    routeFiles: ["admin.community.clubs.tsx", "admin.users.tsx"],
    migrations: [
      { file: "20260101000000_a.sql", sql: "CREATE TABLE public.club_members (id uuid);" },
      { file: "20260101000001_b.sql", sql: "GRANT SELECT ON public.user_roles TO anon;" },
    ],
    documentExists: {
      "docs/UMOWA_UTRZYMANIOWA.md": true,
      "docs/RUNBOOK_CIAGLOSC_WYKONAWCY.md": true,
    },
    today: "2026-08-29",
    ...overrides,
  };
}

describe("parseRegistry", () => {
  it("przyjmuje kompletny rejestr", () => {
    const registry = parseRegistry(registryJson());
    expect(registry.domeny).toHaveLength(2);
    expect(registry.osoby["wlasciciel"].obsadzone).toBe(true);
    expect(registry.progi.martweWzorceTras).toBe(0);
  });

  it("wskazuje ŚCIEŻKĘ do brakującego pola, a nie tylko fakt błędu", () => {
    const broken = registryJson();
    delete (broken["kontraktUtrzymaniowy"] as Record<string, unknown>)["obowiazujeDo"];
    expect(() => parseRegistry(broken)).toThrow(/kontraktUtrzymaniowy\.obowiazujeDo/);
  });

  it("odrzuca duplikat sluga domeny", () => {
    const duplicated = registryJson();
    const domains = duplicated["domeny"] as Record<string, unknown>[];
    domains[1]["slug"] = "kluby";
    expect(() => parseRegistry(duplicated)).toThrow(/zduplikowany slug/);
  });

  it("odrzuca domenę, która nie pokrywa NICZEGO", () => {
    const empty = registryJson();
    const domains = empty["domeny"] as Record<string, unknown>[];
    domains[1]["trasy"] = [];
    domains[1]["obiektyBazy"] = [];
    expect(() => parseRegistry(empty)).toThrow(/nie pokrywa NICZEGO/);
  });

  it("odrzuca 'obsadzone' inne niż boolean - null nie jest 'nie wiem'", () => {
    const bad = registryJson();
    const people = bad["osoby"] as Record<string, Record<string, unknown>>;
    people["wlasciciel"]["obsadzone"] = null;
    expect(() => parseRegistry(bad)).toThrow(/obsadzone.*boolean/);
  });
});

describe("globToRegExp", () => {
  it("traktuje kropkę LITERALNIE - inaczej wzorce tras zlewałyby się ze sobą", () => {
    expect(globToRegExp("admin.events.*").test("admin.events.list.tsx")).toBe(true);
    expect(globToRegExp("admin.events.*").test("adminXevents.list.tsx")).toBe(false);
  });

  it("nie pozwala, by katalog wydarzeń połknął trasy studia (podkreślnik)", () => {
    expect(globToRegExp("admin.events.*").test("admin.events_.$eventId.general.tsx")).toBe(false);
    expect(
      globToRegExp("admin.events_.$eventId.*").test("admin.events_.$eventId.general.tsx"),
    ).toBe(true);
  });

  it("nie traktuje '$' z nazwy trasy dynamicznej jako metaznaku", () => {
    expect(globToRegExp("admin.users.$id.tsx").test("admin.users.$id.tsx")).toBe(true);
    expect(globToRegExp("admin.users.$id.tsx").test("admin.users.Xid.tsx")).toBe(false);
  });

  it("wzorzec bez kropki łapie warianty z myślnikiem", () => {
    const re = globToRegExp("admin.billing*");
    expect(re.test("admin.billing.tsx")).toBe(true);
    expect(re.test("admin.billing-audit.tsx")).toBe(true);
    expect(re.test("admin.ads.tsx")).toBe(false);
  });
});

describe("attributeRoutes", () => {
  const domains: OwnershipDomain[] = parseRegistry(registryJson()).domeny as OwnershipDomain[];

  it("przypisuje trasę do domeny i zapamiętuje, który wzorzec wygrał", () => {
    const { attributions } = attributeRoutes(["admin.community.chat.tsx"], domains);
    expect(attributions[0].domain).toBe("kluby");
    expect(attributions[0].pattern).toBe("admin.community.*");
  });

  it("zgłasza trasę, której nie pokrywa żaden wzorzec", () => {
    const { attributions } = attributeRoutes(["admin.nowa-trasa.tsx"], domains);
    expect(attributions[0].domain).toBeNull();
  });

  it("rozstrzyga nakładające się wzorce KOLEJNOŚCIĄ domen i raportuje przegranych", () => {
    const registry = parseRegistry(
      registryJson({
        identyfikatoryPrzekrojowe: { tier2: { profiles: "waska" } },
        domeny: [
          {
            slug: "waska",
            nazwa: "Wąska",
            zakres: "Jedna trasa.",
            wlasciciel: "wlasciciel",
            zastepca: "zastepca",
            eskalacja: "organizacja-nes",
            klasaSla: "sla-1",
            zespolGithub: "@org/waska",
            trasy: ["admin.settings.privacy.tsx"],
            obiektyBazy: ["consent"],
          },
          {
            slug: "szeroka",
            nazwa: "Szeroka",
            zakres: "Wszystkie ustawienia.",
            wlasciciel: "wlasciciel",
            zastepca: "zastepca",
            eskalacja: "organizacja-nes",
            klasaSla: "sla-1",
            zespolGithub: "@org/szeroka",
            trasy: ["admin.settings.*"],
            obiektyBazy: ["tenant_"],
          },
        ],
      }),
    );
    const { attributions } = attributeRoutes(["admin.settings.privacy.tsx"], registry.domeny);
    expect(attributions[0].domain).toBe("waska");
    expect(attributions[0].alsoMatched).toEqual(["szeroka"]);
  });

  it("melduje, które wzorce faktycznie trafiły - to podstawa wykrywania reguł martwych", () => {
    const { usedPatterns } = attributeRoutes(["admin.users.tsx"], domains);
    expect(usedPatterns.has("admin.users.tsx")).toBe(true);
    expect(usedPatterns.has("admin.community.*")).toBe(false);
  });
});

describe("stripSqlNoise / extractIdentifiers", () => {
  it("wycina komentarze, żeby bramka nie trafiała we własny nagłówek migracji", () => {
    const cleaned = stripSqlNoise("-- CREATE TABLE public.club_x\nSELECT 1;");
    expect(cleaned).not.toContain("club_x");
  });

  it("wycina literały napisowe (szum), zachowując ciała funkcji", () => {
    const cleaned = stripSqlNoise("SELECT 'public.club_ghost' FROM public.club_real;");
    expect(cleaned).not.toContain("club_ghost");
    expect(cleaned).toContain("club_real");
  });

  it("czyta odwołania KWALIFIKOWANE schematem", () => {
    expect(extractIdentifiers("SELECT * FROM public.event_rsvps;")).toContain("event_rsvps");
  });

  it("czyta odwołania NIEKWALIFIKOWANE z pozycji strukturalnych", () => {
    const ids = extractIdentifiers("UPDATE pages SET builder_data = '{}'::jsonb;");
    expect(ids).toContain("pages");
  });

  it("nie bierze słów kluczowych SQL za nazwy obiektów", () => {
    const ids = extractIdentifiers("CREATE TABLE public.x (id uuid); SELECT * FROM pg_proc;");
    expect(ids.has("uuid")).toBe(false);
    expect(ids.has("pg_proc")).toBe(false);
  });
});

describe("buildVocabulary", () => {
  it("odsiewa nazwy CTE i aliasy, których nikt nie definiuje", () => {
    const sources: MigrationSource[] = [
      {
        file: "a.sql",
        sql: "CREATE TABLE public.club_members (id uuid); WITH ranked AS (SELECT 1) SELECT * FROM ranked;",
      },
    ];
    const vocabulary = buildVocabulary(sources);
    expect(vocabulary.has("club_members")).toBe(true);
    expect(vocabulary.has("ranked")).toBe(false);
  });

  it("odrzuca identyfikatory krótsze niż 4 znaki i zmienne PL/pgSQL", () => {
    const vocabulary = buildVocabulary([
      {
        file: "a.sql",
        sql: "CREATE TABLE public.abc (id uuid); CREATE TABLE public.v_temp (id uuid);",
      },
    ]);
    expect(vocabulary.has("abc")).toBe(false);
    expect(vocabulary.has("v_temp")).toBe(false);
  });
});

describe("matchIdentifier", () => {
  const rules = buildRuleIndex([
    {
      slug: "tresc",
      nazwa: "Treść",
      zakres: "",
      wlasciciel: "w",
      zastepca: "z",
      eskalacja: "e",
      klasaSla: "sla-1",
      zespolGithub: "@o/t",
      trasy: ["x"],
      obiektyBazy: ["post_", "posts"],
    },
    {
      slug: "monetyzacja",
      nazwa: "Monetyzacja",
      zakres: "",
      wlasciciel: "w",
      zastepca: "z",
      eskalacja: "e",
      klasaSla: "sla-1",
      zespolGithub: "@o/m",
      trasy: ["y"],
      obiektyBazy: ["post_gift_", "plan_interval$"],
    },
  ]);

  it("NAJDŁUŻSZY prefiks wygrywa - `post_gift_links` to monetyzacja, nie treść", () => {
    expect(matchIdentifier("post_gift_links", rules)?.[0]).toBe("monetyzacja");
    expect(matchIdentifier("post_views", rules)?.[0]).toBe("tresc");
  });

  it("klucz z '$' dopasowuje się DOKŁADNIE, nie prefiksowo", () => {
    expect(matchIdentifier("plan_interval", rules)?.[0]).toBe("monetyzacja");
    expect(matchIdentifier("plan_intervals_extra", rules)).toBeNull();
  });

  it("zdejmuje opakowania czasownikowe, żeby `admin_get_post_x` trafiło w `post_`", () => {
    expect(matchIdentifier("admin_get_post_stats", rules)?.[0]).toBe("tresc");
  });

  it("awaryjne dopasowanie bierze NAJWCZEŚNIEJSZY klucz, nie najdłuższy", () => {
    const twoKeys = buildRuleIndex([
      {
        slug: "platforma",
        nazwa: "Platforma",
        zakres: "",
        wlasciciel: "w",
        zastepca: "z",
        eskalacja: "e",
        klasaSla: "sla-1",
        zespolGithub: "@o/p",
        trasy: ["x"],
        obiektyBazy: ["push_"],
      },
      {
        slug: "monetyzacja",
        nazwa: "Monetyzacja",
        zakres: "",
        wlasciciel: "w",
        zastepca: "z",
        eskalacja: "e",
        klasaSla: "sla-1",
        zespolGithub: "@o/m",
        trasy: ["y"],
        obiektyBazy: ["subscription"],
      },
    ]);
    // `subscription` jest DŁUŻSZE, ale `push_` stoi w nazwie WCZEŚNIEJ -
    // rzeczownik główny funkcji jest przed dopełnieniem.
    expect(matchIdentifier("mark_push_subscription_failed", twoKeys)?.[0]).toBe("platforma");
  });

  it("zwraca null dla identyfikatora spoza rejestru", () => {
    expect(matchIdentifier("webinar_sessions", rules)).toBeNull();
  });

  it("odrzuca rejestr, w którym ten sam prefiks należy do dwóch domen", () => {
    expect(() =>
      buildRuleIndex([
        {
          slug: "a",
          nazwa: "A",
          zakres: "",
          wlasciciel: "w",
          zastepca: "z",
          eskalacja: "e",
          klasaSla: "sla-1",
          zespolGithub: "@o/a",
          trasy: ["x"],
          obiektyBazy: ["club_"],
        },
        {
          slug: "b",
          nazwa: "B",
          zakres: "",
          wlasciciel: "w",
          zastepca: "z",
          eskalacja: "e",
          klasaSla: "sla-1",
          zespolGithub: "@o/b",
          trasy: ["y"],
          obiektyBazy: ["club_"],
        },
      ]),
    ).toThrow(/przypisany do dwóch domen/);
  });
});

describe("attributeMigrations", () => {
  const registry = parseRegistry(registryJson());

  it("przypisuje migrację po identyfikatorze specyficznym", () => {
    const { attributions } = attributeMigrations(
      [{ file: "a.sql", sql: "CREATE TABLE public.club_members (id uuid);" }],
      registry,
    );
    expect(attributions[0].domain).toBe("kluby");
    expect(attributions[0].tier).toBe("identyfikatory");
  });

  it("schodzi do warstwy przekrojowej, gdy migracja rusza WYŁĄCZNIE `profiles`", () => {
    const { attributions } = attributeMigrations(
      [{ file: "a.sql", sql: "GRANT SELECT ON public.profiles TO anon;" }],
      registry,
    );
    expect(attributions[0].domain).toBe("tozsamosc");
    expect(attributions[0].tier).toBe("przekrojowe");
  });

  it("łapie nazwy ukryte w LITERAŁACH (dynamiczny SQL, bloki DO)", () => {
    const sources: MigrationSource[] = [
      { file: "slownik.sql", sql: "CREATE TABLE public.club_members (id uuid);" },
      {
        file: "dynamiczna.sql",
        sql: "DO $$ BEGIN EXECUTE format('REVOKE ALL ON %I FROM anon', 'club_members'); END $$;",
      },
    ];
    const { attributions } = attributeMigrations(sources, registry);
    const dynamic = attributions.find((a) => a.file === "dynamiczna.sql");
    expect(dynamic?.tier).toBe("literaly");
    expect(dynamic?.domain).toBe("kluby");
  });

  it("migracja bez ŻADNEGO rozpoznanego obiektu ląduje w warstwie 'brak'", () => {
    const { attributions } = attributeMigrations(
      [{ file: "a.sql", sql: "CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;" }],
      registry,
    );
    expect(attributions[0].tier).toBe("brak");
    expect(attributions[0].votes).toBe(0);
  });

  it("kubeł 'brak' wpada do OSTATNIEJ domeny rejestru - domeny przekrojowej", () => {
    const { attributions } = attributeMigrations([{ file: "a.sql", sql: "SELECT 1;" }], registry);
    expect(attributions[0].domain).toBe(registry.domeny[registry.domeny.length - 1].slug);
  });

  it("melduje reguły, które faktycznie trafiły", () => {
    const { usedRules } = attributeMigrations(
      [{ file: "a.sql", sql: "CREATE TABLE public.club_members (id uuid);" }],
      registry,
    );
    expect(usedRules.has("club_")).toBe(true);
    expect(usedRules.has("user_roles")).toBe(false);
  });
});

describe("analyzeOwnership + ownershipFailed", () => {
  it("przechodzi, gdy rejestr pokrywa obie powierzchnie", () => {
    const report = analyzeOwnership(input());
    expect(report.routes.unmatched).toEqual([]);
    expect(report.migrations.noHit).toEqual([]);
    expect(report.deadRoutePatterns).toEqual([]);
    expect(ownershipFailed(report)).toBe(false);
  });

  it("OBLEWA na trasie bez właściciela - to jest sedno tej bramki", () => {
    const report = analyzeOwnership(
      input({ routeFiles: ["admin.community.chat.tsx", "admin.users.tsx", "admin.sierota.tsx"] }),
    );
    expect(report.routes.unmatched).toEqual(["admin.sierota.tsx"]);
    expect(ownershipFailed(report)).toBe(true);
    expect(renderOwnershipReport(report)).toContain("TRASY BEZ WŁAŚCICIELA");
  });

  it("OBLEWA, gdy migracji bez atrybucji jest więcej, niż dopuszcza zapadka", () => {
    const report = analyzeOwnership(
      input({
        migrations: [
          { file: "a.sql", sql: "CREATE TABLE public.club_members (id uuid);" },
          { file: "b.sql", sql: "SELECT 1;" },
        ],
      }),
    );
    expect(report.migrations.noHitNowe).toEqual(["b.sql"]);
    expect(ownershipFailed(report)).toBe(true);
  });

  it("PRZECHODZI, gdy migracja bez atrybucji jest WYMIENIONA Z NAZWY na liście bazowej", () => {
    const raw = registryJson();
    (raw["progi"] as Record<string, unknown>)["migracjeBezAtrybucjiDozwolone"] = ["b.sql"];
    const report = analyzeOwnership(
      input({
        registry: parseRegistry(raw),
        migrations: [
          { file: "a.sql", sql: "CREATE TABLE public.club_members (id uuid);" },
          { file: "b.sql", sql: "SELECT 1;" },
          { file: "c.sql", sql: "GRANT SELECT ON public.user_roles TO anon;" },
        ],
      }),
    );
    expect(report.migrations.noHit).toHaveLength(1);
    expect(report.migrations.noHitNowe).toEqual([]);
    expect(ownershipFailed(report)).toBe(false);
  });

  it("OBLEWA na wskazaniu do nieistniejącej osoby", () => {
    const raw = registryJson();
    (raw["domeny"] as Record<string, unknown>[])[0]["wlasciciel"] = "duch";
    const report = analyzeOwnership(input({ registry: parseRegistry(raw) }));
    expect(report.people.danglingRefs[0]).toContain("duch");
    expect(ownershipFailed(report)).toBe(true);
  });

  it("OBLEWA, gdy właściciel jest jednocześnie zastępcą - to zerowy bus factor", () => {
    const raw = registryJson();
    (raw["domeny"] as Record<string, unknown>[])[0]["zastepca"] = "wlasciciel";
    const report = analyzeOwnership(input({ registry: parseRegistry(raw) }));
    expect(report.people.ownerEqualsDeputy).toEqual(["kluby"]);
    expect(ownershipFailed(report)).toBe(true);
  });

  it("OBLEWA na martwej regule - rejestr nie może zgnić po usunięciu trasy", () => {
    const report = analyzeOwnership(input({ routeFiles: ["admin.community.chat.tsx"] }));
    expect(report.deadRoutePatterns).toContain("tozsamosc: 'admin.users.tsx'");
    expect(ownershipFailed(report)).toBe(true);
  });

  it("OBLEWA przy braku dokumentu utrzymaniowego", () => {
    const report = analyzeOwnership(
      input({
        documentExists: {
          "docs/UMOWA_UTRZYMANIOWA.md": true,
          "docs/RUNBOOK_CIAGLOSC_WYKONAWCY.md": false,
        },
      }),
    );
    expect(report.documents.missing).toEqual(["docs/RUNBOOK_CIAGLOSC_WYKONAWCY.md"]);
    expect(ownershipFailed(report)).toBe(true);
  });

  it("OBLEWA po wygaśnięciu umowy - o to chodzi w polu 'obowiazujeDo'", () => {
    const report = analyzeOwnership(input({ today: "2027-09-01" }));
    expect(report.contract.expired).toBe(true);
    expect(ownershipFailed(report)).toBe(true);
    expect(renderOwnershipReport(report)).toContain("UMOWA UTRZYMANIOWA WYGASŁA");
  });

  it("OSTRZEGA, ale NIE blokuje, w oknie 60 dni przed wygaśnięciem", () => {
    const report = analyzeOwnership(input({ today: "2027-08-01" }));
    expect(report.contract.warning).toBe(true);
    expect(report.contract.expired).toBe(false);
    expect(ownershipFailed(report)).toBe(false);
    expect(renderOwnershipReport(report)).toContain("Umowa utrzymaniowa wygasa za");
  });

  it("liczy domeny bez obsadzonego właściciela i respektuje ich zapadkę", () => {
    const raw = registryJson();
    const people = raw["osoby"] as Record<string, Record<string, unknown>>;
    people["wlasciciel"]["obsadzone"] = false;
    (raw["progi"] as Record<string, unknown>)["domenyBezWlasciciela"] = 2;
    const report = analyzeOwnership(input({ registry: parseRegistry(raw) }));
    expect(report.people.unstaffedDomains).toEqual(["kluby", "tozsamosc"]);
    expect(ownershipFailed(report)).toBe(false);
    expect(renderOwnershipReport(report)).toContain("OSTRZEŻENIA");
  });

  it("raport wypisuje każdą domenę z liczbą tras i migracji", () => {
    const rendered = renderOwnershipReport(analyzeOwnership(input()));
    expect(rendered).toContain("kluby");
    expect(rendered).toContain("tozsamosc");
    expect(rendered).toContain("2 tras admina i 2 migracji");
  });
});

describe("renderCodeowners", () => {
  it("KOMENTUJE reguły, dopóki właściciel nie jest obsadzony", () => {
    const raw = registryJson();
    const people = raw["osoby"] as Record<string, Record<string, unknown>>;
    people["wlasciciel"]["obsadzone"] = false;
    const rendered = renderCodeowners(parseRegistry(raw));
    expect(rendered).toContain("# /src/routes/admin.community.* @org/kluby");
    expect(rendered).not.toMatch(/^\/src\/routes\/admin\.community/m);
  });

  it("aktywuje regułę, gdy właściciel jest obsadzony", () => {
    const rendered = renderCodeowners(parseRegistry(registryJson()));
    expect(rendered).toMatch(/^\/src\/routes\/admin\.community\.\* @org\/kluby$/m);
  });

  it("jest deterministyczny - inaczej bramka byte-for-byte byłaby fałszywie czerwona", () => {
    const registry = parseRegistry(registryJson());
    expect(renderCodeowners(registry)).toBe(renderCodeowners(registry));
  });
});

describe("poprawki z przeglądu adwersaryjnego", () => {
  it("stripSqlNoise: '--' W LITERALE nie jest komentarzem i nie zjada reszty linii", () => {
    const cleaned = stripSqlNoise(
      "UPDATE t SET sep = '--' WHERE id IN (SELECT id FROM public.club_members);",
    );
    expect(cleaned).toContain("club_members");
  });

  it("stripSqlNoise: apostrof W KOMENTARZU nie otwiera literału połykającego SQL", () => {
    const cleaned = stripSqlNoise("-- to nie zadziała, don't\nSELECT * FROM public.club_members;");
    expect(cleaned).toContain("club_members");
  });

  it("stripSqlNoise: komentarze blokowe są ZAGNIEŻDŻALNE, jak w Postgresie", () => {
    const cleaned = stripSqlNoise(
      "/* zewn /* wewn */ nadal komentarz */ SELECT public.club_members;",
    );
    expect(cleaned).toContain("club_members");
    expect(cleaned).not.toContain("wewn");
  });

  it("extractIdentifiers czyta tabelę zza literału z '--'", () => {
    const ids = extractIdentifiers("INSERT INTO public.user_roles VALUES ('--'); SELECT 1;");
    expect(ids).toContain("user_roles");
  });

  it("wzorzec trafiający, ale zawsze PRZEGRYWAJĄCY, nie jest martwy", () => {
    const registry = parseRegistry(
      registryJson({
        identyfikatoryPrzekrojowe: { tier2: { profiles: "pierwsza" } },
        domeny: [
          {
            slug: "pierwsza",
            nazwa: "Pierwsza",
            zakres: "Wygrywa kolejnością.",
            wlasciciel: "wlasciciel",
            zastepca: "zastepca",
            eskalacja: "organizacja-nes",
            klasaSla: "sla-1",
            zespolGithub: "@org/pierwsza",
            trasy: ["admin.users.*"],
            obiektyBazy: ["club_"],
          },
          {
            slug: "druga",
            nazwa: "Druga",
            zakres: "Zawsze przegrywa.",
            wlasciciel: "wlasciciel",
            zastepca: "zastepca",
            eskalacja: "organizacja-nes",
            klasaSla: "sla-1",
            zespolGithub: "@org/druga",
            trasy: ["admin.users.tsx"],
            obiektyBazy: ["user_roles"],
          },
        ],
      }),
    );
    const { usedPatterns } = attributeRoutes(["admin.users.tsx"], registry.domeny);
    expect(usedPatterns.has("admin.users.tsx")).toBe(true);
    expect(usedPatterns.has("admin.users.*")).toBe(true);
  });

  it("OBLEWA na wzorcu-łapaczu - 100% pokrycia i zero informacji to nie jest zielona bramka", () => {
    const raw = registryJson();
    (raw["domeny"] as Record<string, unknown>[])[0]["trasy"] = ["admin.*"];
    (raw["domeny"] as Record<string, unknown>[])[1]["trasy"] = ["admin.users.tsx"];
    const routeFiles = Array.from({ length: 30 }, (_, i) => `admin.strona${i}.tsx`);
    const report = analyzeOwnership(
      input({ registry: parseRegistry(raw), routeFiles: [...routeFiles, "admin.users.tsx"] }),
    );
    expect(report.routes.unmatched).toEqual([]);
    expect(report.routes.catchAll).toHaveLength(1);
    expect(ownershipFailed(report)).toBe(true);
    expect(renderOwnershipReport(report)).toContain("WZORZEC-ŁAPACZ");
  });

  it("nie krzyczy o łapaczu na małym zbiorze tras, gdzie procent nic nie znaczy", () => {
    const report = analyzeOwnership(input());
    expect(report.routes.catchAll).toEqual([]);
  });

  it("OBLEWA na obsadzeniu pozornym - sam boolean bez kontaktu nie obsadza nikogo", () => {
    const raw = registryJson();
    const people = raw["osoby"] as Record<string, Record<string, unknown>>;
    people["zastepca"]["obsadzone"] = true;
    const report = analyzeOwnership(input({ registry: parseRegistry(raw) }));
    expect(report.people.staffedWithoutContact).toHaveLength(1);
    expect(ownershipFailed(report)).toBe(true);
    expect(renderOwnershipReport(report)).toContain("OBSADZENIE POZORNE");
  });

  it("martwy PREFIKS BAZY tylko ostrzega - historia migracji bywa spłaszczana", () => {
    const report = analyzeOwnership(
      input({
        migrations: [{ file: "a.sql", sql: "CREATE TABLE public.club_members (id uuid);" }],
      }),
    );
    expect(report.deadDbRules).toContain("tozsamosc: 'user_roles'");
    expect(report.deadRoutePatterns).toEqual([]);
    expect(ownershipFailed(report)).toBe(false);
    expect(renderOwnershipReport(report)).toContain("OSTRZEŻENIA");
  });

  it("zgłasza NIEAKTUALNY wpis listy bazowej, gdy migracja daje się już przypisać", () => {
    const raw = registryJson();
    (raw["progi"] as Record<string, unknown>)["migracjeBezAtrybucjiDozwolone"] = [
      "20260101000000_a.sql",
    ];
    const report = analyzeOwnership(input({ registry: parseRegistry(raw) }));
    expect(report.migrations.noHitNieaktualne).toEqual(["20260101000000_a.sql"]);
    expect(ownershipFailed(report)).toBe(false);
  });

  it("CODEOWNERS wypisuje domeny ODWROTNIE - GitHub bierze OSTATNIE trafienie", () => {
    const rendered = renderCodeowners(parseRegistry(registryJson()));
    const kluby = rendered.indexOf("@org/kluby");
    const tozsamosc = rendered.indexOf("@org/tozsamosc");
    expect(tozsamosc).toBeLessThan(kluby);
  });

  it("CODEOWNERS nie zawiera aktywnej reguły wskazującej samą organizację", () => {
    const rendered = renderCodeowners(parseRegistry(registryJson()));
    expect(rendered).not.toMatch(/^\/governance\/ @NewEUStrategies$/m);
  });
});

describe("poprawki ze zgłoszeń bota przeglądowego (PR #305)", () => {
  it("warstwa 1.5 NIE bierze nazwy z KOMENTARZA - inaczej pusty placeholder ucieka z kubła 'brak'", () => {
    const sources: MigrationSource[] = [
      { file: "slownik.sql", sql: "CREATE TABLE public.club_members (id uuid);" },
      // Cała treść pliku to komentarz - dokładnie kształt trzech pustych
      // placeholderów z linii bazowej `migracjeBezAtrybucjiDozwolone`.
      { file: "placeholder.sql", sql: "-- Follow-up for club_members; no SQL yet\n" },
    ];
    const { attributions } = attributeMigrations(sources, parseRegistry(registryJson()));
    const placeholder = attributions.find((a) => a.file === "placeholder.sql");
    expect(placeholder?.tier).toBe("brak");
    expect(placeholder?.votes).toBe(0);
  });

  it("warstwa 1.5 NADAL bierze nazwę z LITERAŁU - po to istnieje", () => {
    const sources: MigrationSource[] = [
      { file: "slownik.sql", sql: "CREATE TABLE public.club_members (id uuid);" },
      {
        file: "dynamiczna.sql",
        sql: "DO $$ BEGIN EXECUTE format('REVOKE ALL ON %I FROM anon', 'club_members'); END $$;",
      },
    ];
    const { attributions } = attributeMigrations(sources, parseRegistry(registryJson()));
    const dynamic = attributions.find((a) => a.file === "dynamiczna.sql");
    expect(dynamic?.tier).toBe("literaly");
    expect(dynamic?.domain).toBe("kluby");
  });

  it("stripSqlComments zdejmuje komentarze, ale ZOSTAWIA literały", () => {
    const cleaned = stripSqlComments("-- club_members w komentarzu\nSELECT 'club_threads';");
    expect(cleaned).not.toContain("club_members");
    expect(cleaned).toContain("club_threads");
  });

  it("stripSqlNoise nadal zdejmuje OBA - to jego zadanie w warstwie 1", () => {
    const cleaned = stripSqlNoise("-- club_members\nSELECT 'club_threads';");
    expect(cleaned).not.toContain("club_members");
    expect(cleaned).not.toContain("club_threads");
  });

  it("rejestr z literówką w domenie tier2 jest ODRZUCANY, a nie liczony jako NaN", () => {
    const raw = registryJson();
    (raw["identyfikatoryPrzekrojowe"] as Record<string, unknown>)["tier2"] = {
      profiles: "tozsamosc-literowka",
    };
    expect(() => parseRegistry(raw)).toThrow(/wskazuje domenę 'tozsamosc-literowka'/);
  });

  it("poprawny cel tier2 nadal przechodzi", () => {
    expect(() => parseRegistry(registryJson())).not.toThrow();
  });
});
