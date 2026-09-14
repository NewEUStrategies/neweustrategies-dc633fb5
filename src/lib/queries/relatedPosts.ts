// Related-posts: TanStack Query options for global config + per-post compute.
// Runs entirely client-side against publicly readable tables (posts,
// post_categories, post_tags, related_posts_config).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  RELATED_POSTS_DEFAULTS,
  buildIdf,
  documentFrequency,
  normalizeMap,
  rankRelated,
  scoreRelatedDetailed,
  type RelatedPostsConfig,
  type ScoringConfig,
  type ScoringSignals,
  type UserAffinityProfile,
} from "@/lib/relatedPosts";
import type { BlogListItem } from "@/lib/queries/public";
import { SPONSORED_LIST_COLS } from "@/lib/content/sponsored";
import { RELATED_TTL } from "@/lib/queries/relatedPostsConfig";

// Odczyt globalnej konfiguracji mieszka w `queries/relatedPostsConfig` - trasa
// wpisu importuje go statycznie i nie może przez to wciągać silnika scoringu do
// chunku wejściowego. Re-eksport zostaje, żeby konsumenci, którzy i tak liczą
// (komponent rekomendacji, testy), mieli jedno miejsce importu.
export { RELATED_TTL, relatedPostsConfigQueryOptions } from "@/lib/queries/relatedPostsConfig";

/**
 * Okno popularności. 28 dni to NIE jest dowolna stała: dokładnie ten okres
 * obiecuje czytelnikowi panelu podpowiedź suwaka
 * (`adminRelatedPosts.engine.popularityHint` w `i18n-admin-related-posts`) i w
 * tym samym oknie liczy domyślnie zakładka Analiza
 * (`relatedInsights.functions`). Rozjazd którejkolwiek z tych trzech wartości
 * sprawia, że panel opisuje inny silnik, niż działa. Klucz i18n, a nie cytat
 * z jego treści - treść wolno redagować, klucz zostaje.
 */
const POPULARITY_WINDOW_DAYS = 28;

/** Twardy sufit `trending_posts` - funkcja i tak klamruje do 50. */
const POPULARITY_SAMPLE = 50;

/**
 * Strojenie silnika v2 - dokładnie te pola, którymi steruje /admin/related-posts.
 *
 * Nazwy są takie jak w `related_posts_config`, świadomie: panel zapisuje
 * `weight_categories`, silnik czyta `weight_categories`. Każda warstwa
 * tłumacząca snake_case na camelCase to kolejne miejsce, w którym waga może się
 * po cichu zgubić - a tak właśnie ten silnik już raz umarł.
 */
export type RelatedScoringInput = Pick<
  RelatedPostsConfig,
  | "weight_categories"
  | "weight_tags"
  | "weight_author"
  | "weight_recency"
  | "weight_popularity"
  | "weight_dwell"
  | "weight_personalization"
  | "use_idf"
  | "min_score"
>;

/**
 * Popularność wpisów tenanta w oknie - WŁASNY wpis cache, wspólny dla całego
 * serwisu.
 *
 * Kluczowe jest to, czego w tym kluczu NIE MA: identyfikatora wpisu. Snapshot
 * `trending_posts` jest globalny dla tenanta, więc doklejenie go do klucza
 * rekomendacji („public/related-posts/<wpis>/…") kazałoby pobierać te same
 * dane od nowa pod KAŻDYM kolejnym artykułem - czytelnik przeglądający
 * dziesięć wpisów zapłaciłby dziesięć razy za jedną i tę samą listę. Osobny
 * klucz sprowadza to do jednego zapytania na `staleTime`, niezależnie od tego,
 * ile artykułów odwiedzi.
 *
 * Zwraca mapę wpis -> popularność 0..1, znormalizowaną względem szczytu CAŁEGO
 * tenanta (nie samych kandydatów): inaczej najpopularniejszy z garstki
 * niszowych kandydatów dostawałby 1.0 i „popularność" znaczyłaby co innego pod
 * każdym artykułem.
 */
export const relatedPopularityQueryOptions = (days: number = POPULARITY_WINDOW_DAYS) =>
  queryOptions({
    queryKey: ["public", "related-posts-popularity", days] as const,
    queryFn: async (): Promise<ReadonlyMap<string, number>> => {
      const { data, error: dataError } = await supabase.rpc("trending_posts", {
        _days: days,
        _limit: POPULARITY_SAMPLE,
      });
      if (dataError) throw dataError;
      const views = new Map<string, number>();
      (data ?? []).forEach((t) => {
        const count = Number(t.views_count);
        if (Number.isFinite(count) && count > 0) views.set(t.id as string, count);
      });
      return normalizeMap(views);
    },
    staleTime: RELATED_TTL,
  });

/** Klucz zgody w rejestrze RODO, który bramkuje profilowanie treści. */
export const PERSONALIZATION_CONSENT_KEY = "personalization";

/**
 * Zgoda na personalizację, czytana WPROST z rejestru `user_consents`.
 *
 * DLACZEGO NIE `useConsents`. Hook `useIsConsentGiven` robi dokładnie to samo,
 * ale jedzie przez `lib/consents.functions`, a ten ciągnie za sobą runtime
 * funkcji serwerowych (`@tanstack/react-start/server`) i middleware autoryzacji.
 * Na stronie ustawień to nic nie kosztuje - tam i tak są. Pod PUBLICZNYM
 * artykułem kosztuje budżet paczki klienckiej: `RelatedPosts` wchodzi do
 * pakietu trasy wpisu, więc każdy czytelnik - także niezalogowany, także taki,
 * u którego personalizacja ma wagę 0 - pobierałby kod, który nie ma dla niego
 * żadnego zastosowania. Bramka `Bundle size budget` złapała to jako regresję.
 *
 * Odczyt wprost jest bezpieczny i nie omija żadnej kontroli: polityka
 * `user_consents_select_own` przepuszcza wyłącznie `auth.uid() = user_id`,
 * a SELECT jest jedyną operacją, jaką klient na tej tabeli ma - INSERT, UPDATE
 * i DELETE zostały odebrane (20260803190927), bo ślad audytowy musi powstawać
 * funkcją `set_user_consent`. Czytanie własnej zgody to nie pisanie zgody.
 *
 * Semantyka jest ta sama co w `buildConsentViews`: brak wiersza znaczy BRAK
 * zgody (`personalization` nie ma `defaultGiven` w katalogu), a klamrę GPC
 * nakłada wywołujący - ten klucz jest w `GPC_CLAMPED_REGISTRY_KEYS`.
 */
export const relatedPersonalizationConsentQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: ["public", "related-posts-consent", userId] as const,
    queryFn: async (): Promise<boolean> => {
      const { data, error: dataError } = await supabase
        .from("user_consents")
        .select("given")
        .eq("user_id", userId)
        .eq("consent_key", PERSONALIZATION_CONSENT_KEY)
        .maybeSingle();
      if (dataError) throw dataError;
      return data?.given === true;
    },
    staleTime: RELATED_TTL,
  });

/** Ile ostatnio przeczytanych wpisów buduje profil zainteresowań. */
const AFFINITY_HISTORY_LIMIT = 100;

/**
 * Profil zainteresowań czytelnika z jego WŁASNEJ historii czytania.
 *
 * Czyta `user_read_history` wprost, bez funkcji SECURITY DEFINER, i to jest
 * poprawna droga: polityka „read_history owner select" przepuszcza wyłącznie
 * wiersze `user_id = auth.uid()`, więc zapytanie z definicji nie sięga cudzej
 * historii. Zawężenie `.eq("user_id", …)` jest tu drugim zamkiem obok RLS -
 * jawnym w kodzie, nie tylko w migracji.
 *
 * Klucz niesie identyfikator czytelnika, więc profil jednej osoby NIE MOŻE
 * trafić do rekomendacji drugiej - to ten sam wpis cache tylko dla tego samego
 * `userId`. Post NIE wchodzi do klucza: profil jest niezależny od artykułu,
 * więc liczy się raz na `staleTime`, a nie pod każdym wpisem z osobna.
 */
export const relatedAffinityQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: ["public", "related-posts-affinity", userId] as const,
    queryFn: async (): Promise<UserAffinityProfile> => {
      const { data: history, error: historyError } = await supabase
        .from("user_read_history")
        .select("post_id")
        .eq("user_id", userId)
        .order("read_at", { ascending: false })
        .limit(AFFINITY_HISTORY_LIMIT);
      if (historyError) throw historyError;

      const readIds = Array.from(new Set((history ?? []).map((r) => r.post_id as string)));
      const empty: UserAffinityProfile = {
        categoryHits: new Map(),
        tagHits: new Map(),
        totalReads: 0,
      };
      if (readIds.length === 0) return empty;

      const [{ data: pc, error: pcError }, { data: pt, error: ptError }] = await Promise.all([
        supabase.from("post_categories").select("post_id, category_id").in("post_id", readIds),
        supabase.from("post_tags").select("post_id, tag_id").in("post_id", readIds),
      ]);
      if (pcError) throw pcError;
      if (ptError) throw ptError;

      const categoryHits = new Map<string, number>();
      const zKategoriami = new Set<string>();
      (pc ?? []).forEach((r) => {
        const id = r.category_id as string;
        categoryHits.set(id, (categoryHits.get(id) ?? 0) + 1);
        zKategoriami.add(r.post_id as string);
      });
      const tagHits = new Map<string, number>();
      (pt ?? []).forEach((r) => {
        const id = r.tag_id as string;
        tagHits.set(id, (tagHits.get(id) ?? 0) + 1);
        zKategoriami.add(r.post_id as string);
      });

      // MIANOWNIK LICZY SIĘ Z WPISÓW, KTÓRE FAKTYCZNIE COŚ WNIOSŁY, nie z
      // długości historii. Historia jest zawężona tenantem DOMOWYM czytelnika
      // (`current_tenant_id()` w polityce RLS), a taksonomia kandydatów -
      // tenantem PRZEGLĄDANYM (`public_tenant_id()`). Czytelnik oglądający
      // serwis innego tenanta ma więc w historii wpisy, których kategorii i
      // tagów tutaj nie widać: zerowałyby licznik, a powiększały mianownik,
      // czyli rozcieńczały jego własny profil tym mocniej, im więcej czytał
      // gdzie indziej.
      const totalReads = zKategoriami.size;
      if (totalReads === 0) return empty;

      return { categoryHits, tagHits, totalReads };
    },
    staleTime: RELATED_TTL,
  });

export interface RelatedPostsInput {
  postId: string;
  limit: number;
  strategy: RelatedPostsConfig["source_strategy"];
  recencyBoostDays: number;
  /**
   * Wagi silnika. POLE JEST WYMAGANE i to jest cała naprawa na poziomie typów.
   *
   * Do 14.09.2026 warstwa zapytań w ogóle nie miała jak przyjąć wag: render
   * podawał cztery pola, wrapper `scoreRelated` dokładał domyślne, a panel
   * stroił pokrętła, których nikt nie czytał. Wartość domyślna w tym miejscu
   * odtworzyłaby dokładnie tę awarię - i znowu bez żadnego sygnału. Wymagane
   * pole sprawia, że konsument, który zapomni podać konfigurację, NIE
   * KOMPILUJE SIĘ, zamiast renderować ciszę.
   */
  scoring: RelatedScoringInput;
  /**
   * Czytelnik, dla którego wolno personalizować - albo `null`.
   *
   * To pole jest JEDNOCZEŚNIE bramką zgody i izolacją cache, i jedno bez
   * drugiego byłoby dziurawe:
   *
   *  - BRAMKA: wypełnia je wyłącznie render, który potwierdził zgodę
   *    `personalization` (klamrowaną sygnałem GPC). Silnik nie ma jak
   *    „domyślić się" profilu - bez identyfikatora po prostu nie ma czego
   *    czytać, więc brak zgody jest nieprzekraczalny, a nie umowny;
   *  - IZOLACJA: identyfikator wchodzi do klucza zapytania. Gdyby go tam nie
   *    było, spersonalizowana lista JEDNEGO czytelnika siedziałaby pod tym
   *    samym kluczem co lista każdego innego i wyjeżdżała z cache osobie,
   *    dla której nie była liczona.
   *
   * Dla gościa i dla czytelnika bez zgody jest tu `null` - wtedy klucz jest
   * wspólny, bo wynik jest bezosobowy i wolno go współdzielić.
   */
  personalizedFor: string | null;
}

export const relatedPostsQueryOptions = (input: RelatedPostsInput) =>
  queryOptions({
    queryKey: ["public", "related-posts", input] as const,
    enabled: !!input.postId,
    queryFn: async ({ client }): Promise<BlogListItem[]> => {
      // 1. Current post's category/tag/author IDs.
      const [
        { data: curCats, error: curCatsError },
        { data: curTags, error: curTagsError },
        { data: curPost, error: curPostError },
      ] = await Promise.all([
        supabase.from("post_categories").select("category_id").eq("post_id", input.postId),
        supabase.from("post_tags").select("tag_id").eq("post_id", input.postId),
        supabase
          .from("posts")
          .select("author_id, parent_page_id")
          .eq("id", input.postId)
          .maybeSingle(),
      ]);
      if (curCatsError) throw curCatsError;
      if (curTagsError) throw curTagsError;
      if (curPostError) throw curPostError;

      const curCatSet = new Set<string>((curCats ?? []).map((r) => r.category_id as string));
      const curTagSet = new Set<string>((curTags ?? []).map((r) => r.tag_id as string));
      const curAuthor = (curPost?.author_id as string | null) ?? null;

      // No signals at all → no related posts (avoid recommending random items).
      if (
        curCatSet.size === 0 &&
        curTagSet.size === 0 &&
        !(input.strategy === "author" && curAuthor)
      ) {
        return [];
      }

      // 2. Candidate post IDs sharing at least one signal.
      //
      // Oba pivoty jadą RÓWNOLEGLE. Przy domyślnej strategii `both` były to
      // dwa następujące po sobie `await`, choć żaden nie potrzebuje wyniku
      // drugiego - czysty round-trip do oddania na każdej stronie artykułu.
      const candidateIds = new Set<string>();
      const pytaKategorie =
        (input.strategy === "categories" || input.strategy === "both") && curCatSet.size > 0;
      const pytaTagi =
        (input.strategy === "tags" || input.strategy === "both") && curTagSet.size > 0;

      const [zKategorii, zTagow] = await Promise.all([
        pytaKategorie
          ? supabase
              .from("post_categories")
              .select("post_id")
              .in("category_id", Array.from(curCatSet))
          : null,
        pytaTagi
          ? supabase.from("post_tags").select("post_id").in("tag_id", Array.from(curTagSet))
          : null,
      ]);

      if (zKategorii) {
        const { data, error: dataError } = zKategorii;
        if (dataError) throw dataError;
        (data ?? []).forEach((r) => {
          const id = r.post_id as string;
          if (id !== input.postId) candidateIds.add(id);
        });
      }
      if (zTagow) {
        const { data, error: dataError } = zTagow;
        if (dataError) throw dataError;
        (data ?? []).forEach((r) => {
          const id = r.post_id as string;
          if (id !== input.postId) candidateIds.add(id);
        });
      }
      if (input.strategy === "author" && curAuthor) {
        const { data, error: dataError } = await supabase
          .from("posts")
          .select("id")
          .eq("author_id", curAuthor)
          .neq("id", input.postId)
          .eq("status", "published")
          .is("deleted_at", null)
          .order("published_at", { ascending: false })
          .limit(50);
        if (dataError) throw dataError;
        (data ?? []).forEach((r) => candidateIds.add(r.id as string));
      }

      if (candidateIds.size === 0) return [];

      // 3. Hydrate candidates.
      //
      // `sort()` przed zacięciem na 100 nie jest kosmetyką. Zbiór ma kolejność
      // WSTAWIANIA, czyli kolejność, w jakiej wiersze oddał PostgREST - a ta
      // zależy od układu danych w tabeli i potrafi się zmienić po wstawieniu
      // zupełnie niezwiązanego wpisu albo po VACUUM. Bez sortowania to samo
      // zapytanie o ten sam artykuł mogło wziąć INNĄ setkę kandydatów, a więc
      // policzyć inne `df` dla IDF i pokazać inną listę, bez żadnej zmiany w
      // treści. Porządek po identyfikatorze jest dowolny, ale POWTARZALNY - a
      // powtarzalność jest tu warunkiem sensu IDF i spójności cache.
      //
      // CZEGO TO NIE NAPRAWIA, ŚWIADOMIE: samo zacięcie na 100 jest starsze niż
      // ta zmiana i nadal tnie po kryterium bez związku z treścią. W kategorii
      // liczącej setki wpisów kandydatami zostaje ZAWSZE ta sama setka
      // o najniższych identyfikatorach, więc reszta nie ma jak trafić pod
      // artykuł. Naprawa wymaga wyboru po świeżości PO STRONIE BAZY (sortowanie
      // pivotu po `posts.published_at`), co przebudowuje kształt dwóch zapytań
      // i ich testy - osobna zmiana, nie doklejka do przywrócenia wag.
      const ids = Array.from(candidateIds).sort().slice(0, 100);
      const { data: posts, error: postsError } = await supabase
        .from("posts")
        .select(
          `id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, parent_page_id, author_id, ${SPONSORED_LIST_COLS}`,
        )
        .in("id", ids)
        .eq("status", "published")
        .is("deleted_at", null);
      if (postsError) throw postsError;
      const rows = (posts ?? []) as Array<{
        id: string;
        slug: string;
        title_pl: string;
        title_en: string;
        excerpt_pl: string | null;
        excerpt_en: string | null;
        cover_image_url: string | null;
        published_at: string | null;
        parent_page_id: string;
        author_id: string | null;
        is_sponsored: boolean | null;
        sponsored_kind: string | null;
        sponsored_affiliate: boolean | null;
      }>;
      if (rows.length === 0) return [];

      // 4. Fetch category/tag membership for candidates in bulk.
      const candIds = rows.map((r) => r.id);
      const [{ data: pc, error: pcError }, { data: pt, error: ptError }] = await Promise.all([
        supabase.from("post_categories").select("post_id, category_id").in("post_id", candIds),
        supabase.from("post_tags").select("post_id, tag_id").in("post_id", candIds),
      ]);
      if (pcError) throw pcError;
      if (ptError) throw ptError;
      const catsByPost = new Map<string, Set<string>>();
      (pc ?? []).forEach((r) => {
        const set = catsByPost.get(r.post_id as string) ?? new Set<string>();
        set.add(r.category_id as string);
        catsByPost.set(r.post_id as string, set);
      });
      const tagsByPost = new Map<string, Set<string>>();
      (pt ?? []).forEach((r) => {
        const set = tagsByPost.get(r.post_id as string) ?? new Set<string>();
        set.add(r.tag_id as string);
        tagsByPost.set(r.post_id as string, set);
      });

      // 5. Resolve parent page paths for href.
      const parentIds = Array.from(new Set(rows.map((r) => r.parent_page_id)));
      const paths = new Map<string, string>();
      await Promise.all(
        parentIds.map(async (pid) => {
          const { data: p, error: pError } = await supabase.rpc("page_full_path", {
            _page_id: pid,
          });
          if (pError) throw pError;
          if (typeof p === "string") paths.set(pid, p);
        }),
      );

      // 6. Sygnały silnika v2.
      //
      // IDF liczymy z PULI KANDYDATÓW, nie z całego korpusu - i to jest
      // właściwa skala, nie uproszczenie. Ranking rozstrzyga WYŁĄCZNIE między
      // kandydatami, więc informatywny jest termin, który tę pulę dzieli:
      // kategoria obecna u wszystkich stu kandydatów nie pomaga ich uszeregować,
      // choćby w skali serwisu była rzadka. Efekt uboczny jest darmowy -
      // `catsByPost`/`tagsByPost` są już pobrane, więc IDF nie kosztuje ani
      // jednego dodatkowego round-tripu.
      const signals: ScoringSignals = {};
      if (input.scoring.use_idf) {
        signals.idfCat = buildIdf(documentFrequency(catsByPost), rows.length);
        signals.idfTag = buildIdf(documentFrequency(tagsByPost), rows.length);
      }

      // Popularność idzie funkcją `trending_posts` - jedyną publiczną drogą do
      // `post_views`. Surowego odczytu tabeli NIE MA i nie może być: polityka
      // „post_views public read" została świadomie zdjęta (migracja
      // 20260625160054), a agregat wystawia SECURITY DEFINER z zawężeniem do
      // `public_tenant_id()`.
      //
      // Round-trip płacimy TYLKO gdy redakcja faktycznie używa tego sygnału -
      // przy wadze 0 wynik i tak byłby wyzerowany, więc pytanie o dane jest
      // czystym kosztem.
      //
      // Oba sygnały dostrajające lecą RÓWNOLEGLE - nie zależą ani od siebie,
      // ani od niczego, co jeszcze nie jest w ręku. Szeregowo ich awarie
      // sumowałyby się w czasie: nieudane `trending_posts` kazałoby czekać na
      // swój timeout, zanim w ogóle ruszyłby profil czytelnika.
      //
      // Oba mają też wspólną regułę: AWARIA NIE GASI WIDGETU. To świadomy
      // wyjątek od zasady „błąd leci w górę", która obowiązuje w sześciu
      // odczytach dostarczających KANDYDATÓW - bez tamtych nie ma czego
      // pokazać, te tylko PRZESTAWIAJĄ kolejność. Rekomendacje mają wtedy
      // wyjść z pozostałych sygnałów, a nie zniknąć spod artykułu.
      //
      // Round-trip płacimy TYLKO gdy sygnał realnie waży: przy wadze 0 wkład
      // i tak wyszedłby zerowy, więc pytanie o dane byłoby czystym kosztem
      // na każdej stronie artykułu.
      const chcePopularnosc = input.scoring.weight_popularity > 0;
      const chceProfil = !!input.personalizedFor && input.scoring.weight_personalization > 0;

      const [popularnosc, profil] = await Promise.all([
        chcePopularnosc
          ? client.fetchQuery(relatedPopularityQueryOptions()).catch((e: unknown) => {
              console.warn(
                "[related-posts] popularity signal unavailable:",
                e instanceof Error ? e.message : e,
              );
              return null;
            })
          : null,
        chceProfil && input.personalizedFor
          ? client
              .fetchQuery(relatedAffinityQueryOptions(input.personalizedFor))
              .catch((e: unknown) => {
                console.warn(
                  "[related-posts] personalization signal unavailable:",
                  e instanceof Error ? e.message : e,
                );
                return null;
              })
          : null,
      ]);
      if (popularnosc) signals.popularityByPost = popularnosc;
      if (profil) signals.userProfile = profil;

      const scoringCfg: ScoringConfig = {
        source_strategy: input.strategy,
        recency_boost_days: input.recencyBoostDays,
        weight_categories: input.scoring.weight_categories,
        weight_tags: input.scoring.weight_tags,
        weight_author: input.scoring.weight_author,
        weight_recency: input.scoring.weight_recency,
        weight_popularity: input.scoring.weight_popularity,
        weight_dwell: input.scoring.weight_dwell,
        weight_personalization: input.scoring.weight_personalization,
        use_idf: input.scoring.use_idf,
      };

      // 7. Score and rank.
      const scored = rows.map((r) => {
        const { total: score } = scoreRelatedDetailed(
          { categoryIds: curCatSet, tagIds: curTagSet, authorId: curAuthor },
          {
            categoryIds: catsByPost.get(r.id) ?? new Set(),
            tagIds: tagsByPost.get(r.id) ?? new Set(),
            authorId: r.author_id,
          },
          scoringCfg,
          r.published_at,
          r.id,
          signals,
        );
        const item: BlogListItem = {
          is_sponsored: r.is_sponsored,
          sponsored_kind: r.sponsored_kind,
          sponsored_affiliate: r.sponsored_affiliate,
          id: r.id,
          slug: r.slug,
          title_pl: r.title_pl,
          title_en: r.title_en,
          excerpt_pl: r.excerpt_pl,
          excerpt_en: r.excerpt_en,
          cover_image_url: r.cover_image_url,
          published_at: r.published_at,
          parent_page_id: r.parent_page_id,
          href: `/${paths.get(r.parent_page_id) ?? "blog"}/${r.slug}`,
        };
        return { post: item, score };
      });

      const ranked = rankRelated(scored, input.limit, input.scoring.min_score);

      // AWARIA NIE MOŻE WYGLĄDAĆ JAK PUSTKA. `min_score` to jedyne ustawienie
      // panelu, które potrafi skasować całą sekcję pod artykułem, a
      // `RelatedPosts` przy pustej liście zwraca `null` - widget po prostu
      // znika, strona wygląda poprawnie i nikt nie wie, że stało się to przez
      // suwak w panelu. Sytuacja jest tym bardziej realna, że próg mógł zostać
      // ustawiony, kiedy jeszcze NIC nie robił, a skala wyniku zależy dodatkowo
      // od `use_idf`. Zostawiamy więc decyzję redakcji nietkniętą, ale piszemy,
      // co ją wykonało - zakładka Analiza podpowiada wprost „zmniejsz próg".
      //
      // Diagnostyka musi wskazywać WINOWAJCĘ, inaczej sama wprowadza w błąd.
      // `rankRelated` odsiewa dwoma sitami naraz (`score > 0` ORAZ `>= minScore`),
      // więc pusta lista przy ustawionym progu nie dowodzi jeszcze, że to próg
      // ją opróżnił: przy wyzerowanych wagach żaden kandydat nie zdobywa punktu
      // i lista byłaby pusta przy KAŻDYM progu. Rozróżniamy oba przypadki -
      // redakcja odesłana do „zmniejsz próg", kiedy problemem są wagi, straci
      // czas i zaufanie do panelu.
      if (ranked.length === 0 && scored.length > 0) {
        const best = scored.reduce((m, s) => (s.score > m ? s.score : m), 0);
        if (best <= 0) {
          console.warn(
            `[related-posts] żaden z ${scored.length} kandydatów nie uzyskał wyniku > 0 ` +
              `- przy tych wagach nie ma czego pokazać (próg min_score=${input.scoring.min_score} nie jest tu przyczyną). ` +
              `Sekcja powiązanych wpisów nie wyrenderuje się.`,
          );
        } else if (input.scoring.min_score > 0) {
          console.warn(
            `[related-posts] min_score=${input.scoring.min_score} odrzucił WSZYSTKICH ${scored.length} kandydatów ` +
              `(najlepszy wynik: ${best.toFixed(2)}). Sekcja powiązanych wpisów nie wyrenderuje się.`,
          );
        }
      }

      return ranked.map((s) => s.post);
    },
    staleTime: RELATED_TTL,
  });
