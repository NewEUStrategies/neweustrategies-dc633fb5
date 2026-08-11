// Bramka CI: próg „zgłoszenia do klubu od PRO w górę" ma JEDNĄ wartość
// w trzech niezależnych warstwach.
//
// PO CO. Ta sama reguła jest dziś zapisana trzy razy w trzech językach:
// literałem w `club_apply_submit` (SQL decyduje), stałą `PRO_MIN_RANK` na
// trasie `/club/apply` (decyduje o tym, czy formularz się w ogóle pokaże)
// i rangą `CLUB_PLAN_TIER_RANK.pro` w słowniku progów panelu. Rozjazd nie
// psuje ani kompilacji, ani żadnego testu jednostkowego którejkolwiek ze
// stron - psuje wyłącznie zgodność między tym, co UI obiecuje, a tym, co RPC
// przyjmie: użytkownik wypełnia dwadzieścia pól i dostaje `pro_required`
// (albo odwrotnie - widzi bramkę sprzedażową, choć ma wymagany plan).
// Katalog cenowy jest edytowalny migracją, więc ranga `pro` może się zmienić
// i wtedy trzeba ruszyć wszystkie trzy miejsca naraz.
//
// CZEGO TA BRAMKA NIE PILNUJE. Nie zna „właściwej" wartości progu - reguła
// produktowa może się zmienić. Pilnuje wyłącznie tego, że zmiana jest
// wprowadzona we wszystkich trzech warstwach jednocześnie.
//
// Parsery mają własny self-test, bo bramka czytająca pliki regexem psuje się
// cicho: po refaktorze, który przestawi zapis warunku, regex przestaje trafiać
// i bramka świeci zielono nad niczym. Dlatego brak dopasowania jest tu BŁĘDEM
// z nazwą pliku w komunikacie, nigdy pominięciem.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { stripSqlLineComments } from "@/lib/ci/pgTapPlan";
import { CLUB_PLAN_TIER_RANK } from "../planTiers";

const MIGRATION = "supabase/migrations/20260811150000_discussion_clubs_a35_applications_fixes.sql";
const ROUTE = "src/routes/club.apply.tsx";
const PLAN_TIERS = "src/lib/clubs/planTiers.ts";

/**
 * Literał progu z bramki `pro_required` w `club_apply_submit`.
 *
 * Czytamy WSTECZ od `RAISE EXCEPTION 'pro_required'`, a nie po nazwie zmiennej:
 * warunek może stać na `v_rank`, na `COALESCE(...)` albo wprost na wyniku
 * `current_membership_tier()` - nazwa zmiennej nie jest kontraktem, a ten
 * `RAISE` jest. Okno wsteczne jest krótkie, żeby nie złapać liczby z innej
 * bramki tej samej funkcji; komentarze SQL lecą wcześniej, bo próg bywa w nich
 * opisany słownie i taka wzmianka nie może udawać kodu.
 */
function proRankFromMigration(sql: string): number | null {
  const clean = stripSqlLineComments(sql);
  const fn = clean.indexOf("FUNCTION public.club_apply_submit");
  if (fn < 0) return null;
  const raise = clean.indexOf("'pro_required'", fn);
  if (raise < 0) return null;
  const before = clean.slice(Math.max(fn, raise - 200), raise);
  const last = [...before.matchAll(/<\s*=?\s*(\d+)/g)].at(-1);
  return last === undefined ? null : Number(last[1]);
}

/** Stała `PRO_MIN_RANK` z trasy `/club/apply`. */
function proRankFromRoute(source: string): number | null {
  const match = /const\s+PRO_MIN_RANK\s*=\s*(\d+)/.exec(source);
  return match === null ? null : Number(match[1]);
}

/**
 * Ranga `pro` ze słownika progów - czytana z TEKSTU, nie z importu.
 *
 * Import daje wartość po ewaluacji i sam by wystarczył do porównania, ale nie
 * dowodzi, że regexy tej bramki nadal widzą to, co widzą. Osobna asercja niżej
 * zestawia odczyt tekstowy z importowaną stałą, więc nietrafiony regex nie
 * przechodzi po cichu.
 */
function proRankFromPlanTiers(source: string): number | null {
  const dict = /CLUB_PLAN_TIER_RANK[^=]*=\s*\{([\s\S]*?)\}/.exec(source);
  if (dict === null) return null;
  const match = /\bpro\s*:\s*(\d+)/.exec(dict[1] ?? "");
  return match === null ? null : Number(match[1]);
}

describe("parsery bramki progu PRO (self-test)", () => {
  it("czyta literał z warunku poprzedzającego RAISE, nie z sąsiedniej bramki", () => {
    expect(
      proRankFromMigration(`
        CREATE OR REPLACE FUNCTION public.club_apply_submit(p jsonb) RETURNS uuid AS $$
        BEGIN
          IF length(v_txt) < 999 THEN
            RAISE EXCEPTION 'motivation_required';
          END IF;
          IF COALESCE(v_rank, 0) < 20 THEN
            RAISE EXCEPTION 'pro_required';
          END IF;
        END;
        $$;
      `),
    ).toBe(20);
  });

  it("nie bierze liczby z komentarza SQL", () => {
    expect(
      proRankFromMigration(`
        CREATE OR REPLACE FUNCTION public.club_apply_submit(p jsonb) RETURNS uuid AS $$
        BEGIN
          -- Prog globalny: ranga < 99 nie moze sie zglosic.
          IF COALESCE(v_rank, 0) < 20 THEN
            RAISE EXCEPTION 'pro_required';
          END IF;
        END;
        $$;
      `),
    ).toBe(20);
  });

  it("zwraca null, gdy funkcji, bramki albo literału nie ma", () => {
    expect(proRankFromMigration("SELECT 1;")).toBeNull();
    expect(
      proRankFromMigration(
        "CREATE FUNCTION public.club_apply_submit(p jsonb) RETURNS uuid AS $$ BEGIN RETURN NULL; END; $$;",
      ),
    ).toBeNull();
    expect(
      proRankFromMigration(
        "CREATE FUNCTION public.club_apply_submit(p jsonb) RETURNS uuid AS $$ BEGIN RAISE EXCEPTION 'pro_required'; END; $$;",
      ),
    ).toBeNull();
    expect(proRankFromRoute("const OTHER_RANK = 20;")).toBeNull();
    expect(proRankFromPlanTiers("export const CLUB_PLAN_TIERS = [] as const;")).toBeNull();
  });

  it("czyta stałą trasy i rangę słownika z realnego zapisu", () => {
    expect(proRankFromRoute('const PRO_MIN_RANK = 20;\nconst x = "y";')).toBe(20);
    expect(
      proRankFromPlanTiers(`
        export const CLUB_PLAN_TIER_RANK: Record<ClubPlanTier, number> = {
          free: 0,
          plus: 10,
          pro: 20,
          presidents_circle: 60,
        };
      `),
    ).toBe(20);
  });
});

describe("próg PRO zgłoszeń klubowych - parytet SQL / trasa / słownik", () => {
  it("odczyt tekstowy słownika zgadza się z wartością, którą widzi aplikacja", () => {
    // Ząb bramki: gdyby regex przestał trafiać (albo trafiał w inną liczbę),
    // dwie asercje niżej porównywałyby `null` z `null` albo fikcję z fikcją.
    expect(
      proRankFromPlanTiers(readFileSync(PLAN_TIERS, "utf8")),
      `regex nie odczytał CLUB_PLAN_TIER_RANK.pro z ${PLAN_TIERS} - popraw parser bramki`,
    ).toBe(CLUB_PLAN_TIER_RANK.pro);
  });

  it("SQL, trasa i słownik trzymają tę samą rangę", () => {
    const sqlRank = proRankFromMigration(readFileSync(MIGRATION, "utf8"));
    const routeRank = proRankFromRoute(readFileSync(ROUTE, "utf8"));
    const dictRank = CLUB_PLAN_TIER_RANK.pro;

    expect(
      sqlRank,
      `nie znalazłem literału progu przy RAISE EXCEPTION 'pro_required' w ${MIGRATION} ` +
        "- bramka rangi w club_apply_submit zniknęła albo zmieniła zapis; " +
        "popraw parser, nie usuwaj asercji",
    ).not.toBeNull();
    expect(
      routeRank,
      `nie znalazłem stałej PRO_MIN_RANK w ${ROUTE} - jeśli próg przeniósł się ` +
        "do innego modułu, wskaż bramce nowe miejsce",
    ).not.toBeNull();

    expect(
      sqlRank,
      `próg w SQL (${String(sqlRank)}) różni się od CLUB_PLAN_TIER_RANK.pro (${dictRank}) ` +
        `- zmiana progu wymaga dotknięcia ${MIGRATION}, ${ROUTE} i ${PLAN_TIERS} naraz`,
    ).toBe(dictRank);
    expect(
      routeRank,
      `PRO_MIN_RANK (${String(routeRank)}) różni się od CLUB_PLAN_TIER_RANK.pro (${dictRank}) ` +
        "- UI wpuściłby do formularza kogoś, kogo RPC odrzuci z `pro_required` (albo odwrotnie)",
    ).toBe(dictRank);
  });
});
