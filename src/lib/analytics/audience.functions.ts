// Analityka audytorium - zalogowani vs anonimowi.
// Czyta post_views per tenant, agreguje w JS (cap 50k rows/window).
// Admin-gated + tenant scope przez resolveUserTenantId.
// Niezmiennik panelu: suma słupków serii = kpi.views_total. Okno KPI jest
// kroczące (teraz minus days*24 h), siatka wykresu kalendarzowa, więc brzegowe
// kubełki domykają częściową pierwszą dobę - szczegóły przy agregacji niżej.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SegmentKey = "logged" | "anon";

export interface AudienceKpi {
  views_total: number;
  views_logged: number;
  views_anon: number;
  unique_readers: number;
  unique_logged: number;
  unique_anon: number;
  window_days: number;
}

export interface AudienceDayPoint {
  day: string; // YYYY-MM-DD
  logged: number;
  anon: number;
}

export interface AudienceTopPost {
  post_id: string;
  title: string;
  slug: string | null;
  views: number;
  uniques: number;
}

export interface AudienceSegmentsResult {
  kpi: AudienceKpi;
  series: AudienceDayPoint[];
  top_logged: AudienceTopPost[];
  top_anon: AudienceTopPost[];
  truncated: boolean;
}

const EMPTY: AudienceSegmentsResult = {
  kpi: {
    views_total: 0,
    views_logged: 0,
    views_anon: 0,
    unique_readers: 0,
    unique_logged: 0,
    unique_anon: 0,
    window_days: 28,
  },
  series: [],
  top_logged: [],
  top_anon: [],
  truncated: false,
};

const ROW_CAP = 50_000;

export const getAudienceSegments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) =>
    z.object({ days: z.number().int().min(1).max(365).default(28) }).parse(i ?? {}),
  )
  .handler(async ({ data, context }): Promise<AudienceSegmentsResult> => {
    // Admin gate (tenant-scoped przez has_role -> current_tenant_id()).
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveUserTenantId } = await import("@/lib/server/userTenant.server");
    const tenantId = await resolveUserTenantId(supabaseAdmin, context.userId);

    // Jedno „teraz" na całe wywołanie: granica okna i siatka serii MUSZĄ być
    // liczone z tego samego znacznika, inaczej przy wywołaniu o północy licznik
    // i wykres opisywałyby dwa różne okna.
    const now = Date.now();
    const since = new Date(now - data.days * 86_400_000).toISOString();

    // 1. Pobierz surowe wiersze post_views z okna (limit ROW_CAP).
    const { data: rows, error: viewsErr } = await supabaseAdmin
      .from("post_views")
      .select("post_id, user_id, viewer_hash, viewed_at")
      .eq("tenant_id", tenantId)
      .gte("viewed_at", since)
      .order("viewed_at", { ascending: false })
      .limit(ROW_CAP);
    if (viewsErr) {
      console.warn("[audience-segments] read failed:", viewsErr.message);
      return { ...EMPTY, kpi: { ...EMPTY.kpi, window_days: data.days } };
    }

    const truncated = (rows?.length ?? 0) >= ROW_CAP;

    // 2. Agreguj w JS.
    //
    // SIATKA SERII I OKNO KPI TO JEDNO OKNO. Okno KPI biegnie od `since`
    // (teraz minus `days`*24 h, godzina w godzinę - dokładnie tak filtruje
    // zapytanie wyżej), a siatka wykresu ma `days` punktów KALENDARZOWYCH,
    // ostatni to dzisiaj. Pierwsza doba okna jest więc częściowa: przy
    // wywołaniu w południe `since` wypada wczoraj po południu, a pierwszy
    // słupek to dopiero północ dnia następnego.
    //
    // KTÓRA STRONA MA RACJĘ: OKNO KPI. Trzy powody. (1) To ono jest
    // kontraktem odczytu - `gte("viewed_at", since)` decyduje, co w ogóle
    // przyszło z bazy, a `views_total` ma opisywać właśnie te dane; zawężenie
    // KPI do północy CICHO wyrzucałoby wiersze, które użytkownik wyprosił,
    // pytając o „ostatnie N dni". (2) Liczba nad wykresem musi być sumą
    // słupków - inaczej panel sam sobie przeczy i nie da się tego wyjaśnić
    // patrzącemu. (3) Wariant odwrotny (dodatkowy, `days+1`-szy słupek na
    // częściową dobę) dorysowałby słupek z natury niższy od pozostałych, czyli
    // sugerowałby spadek ruchu, którego nie było.
    //
    // Dlatego BRZEGOWE KUBEŁKI DOMYKAJĄ OKNO: wiersz z częściowej pierwszej
    // doby wchodzi do pierwszego punktu siatki, a wiersz z sekundy „po"
    // dzisiejszym dniu (przestawiony zegar klienta) do ostatniego. Suma serii
    // jest wtedy TOŻSAMA z `views_total` przy każdym `days` i o każdej porze.
    const gridDays: string[] = [];
    for (let i = data.days - 1; i >= 0; i--) {
      gridDays.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
    }
    const pierwszyDzien = gridDays[0];
    const ostatniDzien = gridDays[gridDays.length - 1];
    const doSiatki = (day: string): string => {
      if (day < pierwszyDzien) return pierwszyDzien;
      if (day > ostatniDzien) return ostatniDzien;
      return day;
    };

    const perDay = new Map<string, { logged: number; anon: number }>();
    const perPostLogged = new Map<string, { views: number; hashes: Set<string> }>();
    const perPostAnon = new Map<string, { views: number; hashes: Set<string> }>();
    const uniqLogged = new Set<string>();
    const uniqAnon = new Set<string>();
    let viewsLogged = 0;
    let viewsAnon = 0;

    (rows ?? []).forEach((r) => {
      const isLogged = r.user_id != null;
      const day = doSiatki(String(r.viewed_at).slice(0, 10));
      const bucket = perDay.get(day) ?? { logged: 0, anon: 0 };
      if (isLogged) {
        bucket.logged += 1;
        viewsLogged += 1;
        uniqLogged.add(r.user_id as string);
        const p = perPostLogged.get(r.post_id) ?? { views: 0, hashes: new Set<string>() };
        p.views += 1;
        p.hashes.add(r.viewer_hash);
        perPostLogged.set(r.post_id, p);
      } else {
        bucket.anon += 1;
        viewsAnon += 1;
        uniqAnon.add(r.viewer_hash);
        const p = perPostAnon.get(r.post_id) ?? { views: 0, hashes: new Set<string>() };
        p.views += 1;
        p.hashes.add(r.viewer_hash);
        perPostAnon.set(r.post_id, p);
      }
      perDay.set(day, bucket);
    });

    // Uzupełnij brakujące dni zerami, żeby wykres był spójny. Siatka jest ta
    // sama, po której domykaliśmy brzegi - dlatego żaden zliczony wiersz nie
    // może wypaść poza wykres.
    const series: AudienceDayPoint[] = gridDays.map((d) => {
      const b = perDay.get(d) ?? { logged: 0, anon: 0 };
      return { day: d, logged: b.logged, anon: b.anon };
    });

    // Top-N post_id.
    const topIds = new Set<string>();
    const toTop = (m: Map<string, { views: number; hashes: Set<string> }>) =>
      [...m.entries()]
        .sort((a, b) => b[1].views - a[1].views)
        .slice(0, 10)
        .map(([post_id, v]) => {
          topIds.add(post_id);
          return { post_id, views: v.views, uniques: v.hashes.size };
        });
    const topLoggedRaw = toTop(perPostLogged);
    const topAnonRaw = toTop(perPostAnon);

    // Pobierz tytuły / slugi dla top postów.
    const titles = new Map<string, { title: string; slug: string | null }>();
    if (topIds.size > 0) {
      const { data: posts } = await supabaseAdmin
        .from("posts")
        .select("id, title_pl, title_en, slug")
        .eq("tenant_id", tenantId)
        .in("id", [...topIds]);
      (posts ?? []).forEach((p) => {
        titles.set(p.id, {
          title: (p.title_pl || p.title_en || "").trim() || "(bez tytułu)",
          slug: p.slug ?? null,
        });
      });
    }
    const decorate = (r: { post_id: string; views: number; uniques: number }): AudienceTopPost => {
      const t = titles.get(r.post_id);
      return {
        post_id: r.post_id,
        title: t?.title ?? "(bez tytułu)",
        slug: t?.slug ?? null,
        views: r.views,
        uniques: r.uniques,
      };
    };

    return {
      kpi: {
        views_total: viewsLogged + viewsAnon,
        views_logged: viewsLogged,
        views_anon: viewsAnon,
        unique_readers: uniqLogged.size + uniqAnon.size,
        unique_logged: uniqLogged.size,
        unique_anon: uniqAnon.size,
        window_days: data.days,
      },
      series,
      top_logged: topLoggedRaw.map(decorate),
      top_anon: topAnonRaw.map(decorate),
      truncated,
    };
  });
