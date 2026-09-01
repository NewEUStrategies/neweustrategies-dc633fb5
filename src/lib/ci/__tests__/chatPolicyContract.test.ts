/**
 * Bramka KONTRAKTU POLITYK RLS MODUŁU CZATU - stan końcowy, nie pojedyncza
 * migracja.
 *
 * PO CO. Warstwa danych czatu jest najlepszą częścią modułu (97,6% linii), ale
 * jej bezpieczeństwo NIE mieszka w TypeScripcie - mieszka w politykach. Audyt
 * wydania 8 zostawił trzy pytania bez odpowiedzi, a pytanie bez zapisanej
 * odpowiedzi wraca przy każdym przeglądzie:
 *
 *   1. `expert_requests` ma trzy polityki i ŻADNA nie wiąże `tenant_id`,
 *      choć każda inna tabela czatu wiąże. Czy prośba ekspercka MA przecinać
 *      obszary robocze?
 *   2. `user_blocks` wyznacza tenanta DWOMA sposobami: `INSERT WITH CHECK`
 *      podzapytaniem do `profiles`, a `SELECT`/`DELETE` funkcją
 *      `current_tenant_id()`. Ta sama niespójność jest w
 *      `notification_preferences`. Czy te formy są równoważne?
 *   3. Brak polityki `INSERT` na `conversations` i brak polityk zapisu na
 *      `conversation_participants` to decyzja czy przeoczenie?
 *
 * Ten plik ODPOWIADA na wszystkie trzy i przypina odpowiedzi, żeby następna
 * osoba nie „naprawiła" ich w złą stronę (np. dopisując politykę INSERT na
 * `conversations`, co otworzyłoby tworzenie rozmów z pominięciem RPC).
 *
 * MIGRACJA JEST ZDARZENIEM, NIE STANEM. Nie wnioskujemy o politykach z jednego
 * pliku: późniejszy `DROP`/`CREATE` unieważnia wcześniejszy. Stan końcowy
 * czytamy przez `extractLatestPolicies`, dokładnie jak
 * `tenantIsolationPolicies.test.ts` i `policyTenantRegression.ts`.
 *
 * ZAKRES DOWODU. To jest bramka STATYCZNA nad treścią migracji - dowodzi
 * KSZTAŁTU polityk, a nie ich działania w bazie. Wykonanie polityk sprawdza
 * osobna warstwa (`bun run db:test` / pgTAP, `check:tenant-isolation`), która
 * wymaga uruchomionego Postgresa i dlatego nie mieści się w suicie vitest.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractLatestPolicies, type PolicyDef } from "../rlsPolicies";
import { stripSqlComments } from "../../../../scripts/lib/sqlMigrations";

const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");

function migrationFiles(): Array<{ file: string; sql: string }> {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8")),
    }));
}

const FILES = migrationFiles();
const POLICIES: PolicyDef[] = [...extractLatestPolicies(FILES).values()];
/** Cała treść migracji sklejona - do dowodów o funkcjach, nie o politykach. */
const ALL_SQL = FILES.map((f) => f.sql).join("\n");

function policiesFor(table: string): PolicyDef[] {
  return POLICIES.filter((policy) => policy.table === table);
}

function names(policies: readonly PolicyDef[]): string[] {
  return policies.map((policy) => policy.name).sort();
}

/** Obie klauzule polityki jako jeden tekst (pusta klauzula = pusty string). */
function predicates(policy: PolicyDef): string {
  return `${policy.using ?? ""} ${policy.withCheck ?? ""}`;
}

/**
 * Czy polityka dotyczy `realtime.messages`, a nie `public.messages`.
 *
 * `extractLatestPolicies` normalizuje nazwę tabeli BEZ SCHEMATU, więc polityki
 * kanałów (`realtime.messages`: pisanie „pisze…" i obecność) wpadają do tego
 * samego wiadra, co wiadomości czatu. Rozróżniamy je po predykacie, bo tylko
 * one czytają `realtime.topic()` / kolumnę `extension` - i tylko dla nich
 * tenant jest w TEMACIE kanału, a nie w kolumnie wiersza.
 */
function isRealtimeChannelPolicy(policy: PolicyDef): boolean {
  const text = predicates(policy);
  return /realtime\.topic\(\)|extension\s*=/.test(text);
}

describe("messages - jedenaście polityk, dwie różne płaszczyzny", () => {
  const all = policiesFor("messages");
  const rows = all.filter((policy) => !isRealtimeChannelPolicy(policy));
  const channels = all.filter(isRealtimeChannelPolicy);

  it("stan końcowy to 5 polityk wierszy i 6 polityk kanałów", () => {
    // Liczby są RATCHETEM: nowa polityka na `messages` ma wymusić decyzję,
    // do której płaszczyzny należy, zamiast wejść po cichu.
    expect(names(rows)).toEqual([
      "messages_member_insert",
      "messages_member_select",
      "messages_sender_update",
      "messages_staff_read",
      "messages_staff_update",
    ]);
    expect(names(channels)).toEqual([
      "chat_presence_tenant_read",
      "chat_presence_tenant_write",
      "chat_typing_member_read",
      "chat_typing_member_write",
      "entity_presence_tenant_read",
      "entity_presence_tenant_write",
    ]);
  });

  it("KAŻDA polityka wiersza wiąże tenanta kolumną `tenant_id`", () => {
    const gaps = rows
      .filter(
        (policy) =>
          !/tenant_id\s*=\s*\(?\s*(SELECT\s+)?public\.current_tenant_id/i.test(predicates(policy)),
      )
      .map((policy) => policy.name);
    expect(gaps).toEqual([]);
  });

  it("dostęp członkowski dodatkowo wiąże PRZYNALEŻNOŚĆ do rozmowy", () => {
    const membershipScoped = rows.filter((policy) =>
      /member_conversation_ids\(\)/.test(predicates(policy)),
    );
    expect(names(membershipScoped)).toEqual(["messages_member_insert", "messages_member_select"]);
  });

  it("zapis wiadomości stempluje NADAWCĘ - nie da się napisać cudzym nazwiskiem", () => {
    const insert = rows.find((policy) => policy.name === "messages_member_insert");
    expect(insert?.withCheck ?? "").toMatch(/sender_id\s*=\s*\(SELECT auth\.uid\(\)\)/);
  });

  it("odczyt członkowski respektuje TTL i wyczyszczoną historię", () => {
    // Znikanie wiadomości i „wyczyść u mnie" są egzekwowane W POLITYCE, nie
    // w kliencie - inaczej wystarczyłoby ominąć UI, żeby przeczytać wygasłe.
    const select = policiesFor("messages").find(
      (policy) => policy.name === "messages_member_select",
    );
    expect(select?.using ?? "").toMatch(/expires_at IS NULL OR expires_at > now\(\)/);
    expect(select?.using ?? "").toMatch(/cleared_before/);
  });

  it("polityki KANAŁÓW wiążą tenanta tematem, a nie kolumną", () => {
    for (const policy of channels) {
      expect(
        /current_tenant_id\(\)|is_tenant_conversation_member/.test(predicates(policy)),
        `${policy.name} bez zawężenia tenanta w temacie`,
      ).toBe(true);
    }
  });
});

describe("conversations - brak polityki INSERT jest DECYZJĄ, nie luką", () => {
  const policies = policiesFor("conversations");

  it("stan końcowy: dokładnie trzy polityki, żadna z nich nie jest INSERT", () => {
    expect(names(policies)).toEqual([
      "conversations_member_select",
      "conversations_staff_delete",
      "conversations_staff_read",
    ]);
    expect(policies.filter((policy) => policy.command === "insert")).toEqual([]);
    // `ALL` też otworzyłoby zapis - dlatego pilnujemy komend jawnie.
    expect(policies.filter((policy) => policy.command === "all")).toEqual([]);
  });

  it("tworzenie rozmowy idzie WYŁĄCZNIE przez RPC, które istnieją w stanie końcowym", () => {
    // To jest druga połowa decyzji: brak polityki INSERT ma sens tylko wtedy,
    // gdy istnieje SECURITY DEFINER, który tę rozmowę zakłada.
    expect(ALL_SQL).toMatch(/FUNCTION public\.get_or_create_direct_conversation/);
    expect(ALL_SQL).toMatch(/FUNCTION public\.create_group_conversation/);
  });

  it("każda polityka rozmowy wiąże tenanta", () => {
    for (const policy of policies) {
      expect(predicates(policy), `${policy.name}`).toMatch(/current_tenant_id\(\)/);
    }
  });

  it("kasowanie rozmowy jest zarezerwowane dla sztabu, i to węższego niż odczyt", () => {
    const del = policies.find((policy) => policy.name === "conversations_staff_delete");
    const read = policies.find((policy) => policy.name === "conversations_staff_read");
    // Redaktor CZYTA, ale nie KASUJE - kasowanie kaskaduje na wiadomości.
    expect(read?.using ?? "").toMatch(/'editor'/);
    expect(del?.using ?? "").not.toMatch(/'editor'/);
  });
});

describe("conversation_participants i conversation_nicknames - tylko odczyt", () => {
  it("obie tabele mają WYŁĄCZNIE politykę SELECT", () => {
    for (const table of ["conversation_participants", "conversation_nicknames"]) {
      const policies = policiesFor(table);
      expect(policies.length, `${table}: liczba polityk`).toBeGreaterThan(0);
      expect(
        policies.filter((policy) => policy.command !== "select").map((policy) => policy.name),
        `${table}: polityki inne niż SELECT`,
      ).toEqual([]);
    }
  });

  it("zapisy uczestników i pseudonimów mają swoje RPC", () => {
    expect(ALL_SQL).toMatch(/FUNCTION public\.chat_set_nickname/);
  });

  it("widoczność wiersza uczestnika honoruje POTWIERDZENIA ODCZYTU obu stron", () => {
    // Wyłączone potwierdzenia mają UKRYWAĆ wiersz peera, a nie tylko przestać
    // go rysować w UI - inaczej „nie pokazuj, że przeczytałem" byłoby ozdobą.
    const policy = policiesFor("conversation_participants")[0];
    expect(policy?.using ?? "").toMatch(/chat_read_receipts_enabled/);
    expect(policy?.using ?? "").toMatch(/current_tenant_id\(\)/);
  });
});

describe("message_reactions i message_stars - własność plus przynależność", () => {
  it("każda polityka wiąże tenanta, a każdy ZAPIS wiąże też właściciela", () => {
    for (const table of ["message_reactions", "message_stars"]) {
      const policies = policiesFor(table);
      expect(policies.length, table).toBeGreaterThan(0);
      for (const policy of policies) {
        expect(predicates(policy), `${table}::${policy.name}`).toMatch(/current_tenant_id\(\)/);
        // Odczyt reakcji jest CZŁONKOWSKI, nie właścicielski: każdy uczestnik
        // rozmowy widzi wszystkie reakcje (inaczej licznik pod dymkiem
        // pokazywałby wyłącznie własną). Właściciela wiążą dopiero zapisy.
        if (policy.command === "select") continue;
        expect(predicates(policy), `${table}::${policy.name}`).toMatch(/user_id\s*=\s*\(/);
      }
    }
  });

  it("odczyt reakcji jest CZŁONKOWSKI, a odczyt gwiazdek WŁAŚCICIELSKI", () => {
    // Gwiazdka jest prywatną zakładką - gdyby jej odczyt był członkowski,
    // wszyscy w rozmowie wiedzieliby, co kto sobie zapisał.
    const reactionSelect = policiesFor("message_reactions").find((p) => p.command === "select");
    expect(reactionSelect?.using ?? "").toMatch(/member_conversation_ids\(\)/);
    expect(reactionSelect?.using ?? "").not.toMatch(/user_id\s*=\s*\(/);

    const starSelect = policiesFor("message_stars").find((p) => p.command === "select");
    expect(starSelect?.using ?? "").toMatch(/user_id\s*=\s*\(/);
  });

  it("wstawienie reakcji i gwiazdki wymaga PRZYNALEŻNOŚCI do rozmowy", () => {
    for (const table of ["message_reactions", "message_stars"]) {
      const insert = policiesFor(table).find((policy) => policy.command === "insert");
      expect(insert?.withCheck ?? "", table).toMatch(/member_conversation_ids\(\)/);
    }
  });
});

describe("expert_requests - czy prośba ekspercka przecina obszary robocze", () => {
  const policies = policiesFor("expert_requests");

  it("ODPOWIEDŹ: NIE. Zapis wymusza tego samego tenanta u obu stron", () => {
    // To jest ustalenie, o które prosił audyt, i mieszka ono w JEDYNYM
    // pisarzu tej tabeli. `send_expert_request` czyta tenanta nadawcy
    // i odbiorcy z `profiles` i odmawia, gdy się różnią.
    expect(ALL_SQL).toMatch(/FUNCTION public\.send_expert_request/);
    expect(ALL_SQL).toMatch(
      /v_tenant IS NULL OR v_peer_tenant IS NULL OR v_tenant <> v_peer_tenant/,
    );
  });

  it("INSERT jest CELOWO zamknięty - jedyną drogą zapisu jest RPC", () => {
    const insert = policies.find((policy) => policy.command === "insert");
    expect(insert?.name).toBe("expert_requests: no direct insert");
    expect((insert?.withCheck ?? "").trim().toLowerCase()).toBe("false");
  });

  it("tabela MA kolumnę tenanta, więc jest czym zawężać", () => {
    // Kolumna istnieje od `CREATE TABLE public.expert_inmails` (tabela została
    // później przemianowana na `expert_requests`), jest NOT NULL i wskazuje
    // na `tenants`. Bez tego dowodu propozycja polityki niżej byłaby pusta.
    expect(ALL_SQL).toMatch(/CREATE TABLE public\.expert_inmails[\s\S]*?tenant_id uuid NOT NULL/);
    expect(ALL_SQL).toMatch(
      /ALTER TABLE IF EXISTS public\.expert_inmails RENAME TO expert_requests/,
    );
  });

  it.fails("DEFEKT: odczyt i aktualizacja prośby eksperckiej NIE wiążą tenanta", () => {
    // ZŁAMANY KONTRAKT. Zapis wymusza jeden obszar roboczy (dowód wyżej),
    // ale `SELECT` i `UPDATE` bramkują wyłącznie tożsamość:
    //   sender_id = auth.uid() OR recipient_id = auth.uid() OR is_super_admin(...)
    // Przy DRYFIE DANYCH (profil przepięty do innego obszaru roboczego) ten
    // sam wiersz zostaje czytelny i edytowalny spoza obszaru, w którym
    // powstał - dokładnie ta klasa defektu, którą repo zamknęło migracją
    // 20260829091010 dla `media_mentions`, `saved_searches` i `user_follows`
    // (patrz `tenantIsolationPolicies.test.ts`). Każda inna tabela czatu
    // wiąże `tenant_id`; ta jedna nie.
    //
    // OCZEKIWANY KONTRAKT - proponowana polityka (do osobnej migracji,
    // NIE w tym zadaniu, bo to zmiana schematu):
    //
    //   DROP POLICY "expert_requests: participants and admin can read"
    //     ON public.expert_requests;
    //   CREATE POLICY "expert_requests: participants and admin can read"
    //     ON public.expert_requests FOR SELECT TO authenticated
    //     USING (
    //       tenant_id = (SELECT public.current_tenant_id())
    //       AND (sender_id = (SELECT auth.uid())
    //            OR recipient_id = (SELECT auth.uid())
    //            OR public.is_super_admin((SELECT auth.uid())))
    //     );
    //
    //   -- analogicznie dla UPDATE, w USING i w WITH CHECK.
    //
    // UWAGA przy wdrożeniu: `is_super_admin` musi zachować dostęp
    // ponadtenantowy albo nie - to jest osobna decyzja produktowa; powyższa
    // propozycja zawęża TAKŻE super-admina, co jest spójne z
    // `messages_staff_read` (sztab też jest zawężony do swojego tenanta).
    const unscoped = policies
      .filter((policy) => policy.command !== "insert")
      .filter((policy) => !/tenant_id/.test(predicates(policy)))
      .map((policy) => policy.name);
    expect(unscoped).toEqual([]);
  });
});

describe("user_blocks i notification_preferences - dwa sposoby wyznaczania tenanta", () => {
  const INLINE_TENANT =
    /\(\s*SELECT\s+(?:p\.)?tenant_id\s+FROM\s+public\.profiles\s+(?:p\s+)?WHERE\s+(?:p\.)?id\s*=\s*(?:\(select\s+)?auth\.uid\(\)/i;

  it("ODPOWIEDŹ: formy są RÓWNOWAŻNE co do wartości - to ta sama kwerenda", () => {
    // `current_tenant_id()` to dosłownie to samo zapytanie, opakowane w
    // funkcję. Dowód czytamy z definicji funkcji, a nie z pamięci.
    expect(ALL_SQL).toMatch(
      /CREATE OR REPLACE FUNCTION public\.current_tenant_id\(\)[\s\S]{0,400}?SELECT tenant_id FROM public\.profiles WHERE id = auth\.uid\(\)/,
    );
  });

  it("RÓŻNICA, która zostaje: funkcja jest SECURITY DEFINER, podzapytanie nie", () => {
    // Podzapytanie w polityce biegnie jako WOŁAJĄCY, więc podlega RLS na
    // `profiles`; funkcja go omija. To jedyne miejsce, w którym obie formy
    // mogą się rozjechać - i rozjadą się dokładnie wtedy, gdy `profiles`
    // przestanie pozwalać czytać własny wiersz.
    expect(ALL_SQL).toMatch(
      /CREATE OR REPLACE FUNCTION public\.current_tenant_id\(\)[\s\S]{0,200}?SECURITY DEFINER/,
    );
    const selfRead = policiesFor("profiles").find((policy) => policy.command === "select");
    expect(selfRead?.using ?? "", "profiles bez odczytu własnego wiersza").toMatch(
      /id\s*=\s*auth\.uid\(\)/,
    );
  });

  it("SESJA BEZ PROFILU odmawia w OBU formach - `= NULL` nigdy nie jest prawdą", () => {
    // Dowód strukturalny, nie wykonaniowy: obie formy porównują `tenant_id`
    // z wartością skalarną, więc brak wiersza w `profiles` daje NULL, a
    // porównanie z NULL nie przepuszcza wiersza. Żadna z nich nie ma gałęzi
    // `OR tenant_id IS NULL`, która byłaby furtką.
    for (const table of ["user_blocks", "notification_preferences"]) {
      for (const policy of policiesFor(table)) {
        expect(predicates(policy), `${table}::${policy.name}`).not.toMatch(
          /tenant_id\s+IS\s+NULL/i,
        );
      }
    }
  });

  it("user_blocks: każda polityka wiąże WŁAŚCICIELA i tenanta - jedną z dwóch form", () => {
    const policies = policiesFor("user_blocks");
    expect(names(policies)).toEqual([
      "user_blocks_owner_delete",
      "user_blocks_owner_insert",
      "user_blocks_owner_select",
    ]);
    for (const policy of policies) {
      const text = predicates(policy);
      expect(text, `${policy.name}: właściciel`).toMatch(/blocker_id\s*=\s*auth\.uid\(\)/);
      expect(
        /current_tenant_id\(\)/.test(text) || INLINE_TENANT.test(text),
        `${policy.name}: tenant`,
      ).toBe(true);
    }
  });

  it("notification_preferences: ta sama para inwariantów", () => {
    const policies = policiesFor("notification_preferences");
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      const text = predicates(policy);
      expect(text, `${policy.name}: właściciel`).toMatch(
        /user_id\s*=\s*\(?\s*(select\s+)?auth\.uid/i,
      );
      expect(
        /current_tenant_id\(\)/.test(text) || INLINE_TENANT.test(text),
        `${policy.name}: tenant`,
      ).toBe(true);
    }
  });

  it("obie formy WYSTĘPUJĄ w repo - to jest zapis niespójności, nie jej ukrycie", () => {
    // Bramka nie każe ujednolicić (to zmiana schematu, poza tym zadaniem),
    // ale pilnuje, żeby nikt nie „posprzątał" jednej formy bez decyzji:
    // gdyby obie zniknęły albo została tylko jedna, ten dowód padnie i każe
    // przeczytać powyższe uzasadnienie.
    const chatSurface = [...policiesFor("user_blocks"), ...policiesFor("notification_preferences")];
    const viaFunction = chatSurface.filter((policy) =>
      /current_tenant_id\(\)/.test(predicates(policy)),
    );
    const viaSubquery = chatSurface.filter((policy) => INLINE_TENANT.test(predicates(policy)));
    expect(viaFunction.length, "forma z funkcją zniknęła").toBeGreaterThan(0);
    expect(viaSubquery.length, "forma z podzapytaniem zniknęła").toBeGreaterThan(0);
  });
});
