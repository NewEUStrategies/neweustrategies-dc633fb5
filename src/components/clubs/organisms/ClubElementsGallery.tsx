// Galeria ŻYWYCH elementów Klubu dyskusyjnego dla katalogu /club/elements.
//
// Różnica wobec sekcji słownikowych na tej samej stronie jest zasadnicza:
// tam stoją WARTOŚCI (zbiory z CHECK-ów), tutaj stoją KOMPONENTY - dokładnie
// te, które renderują się w produkcie, z tymi samymi propsami. Zrzut ekranu
// albo makieta rozjechałaby się przy pierwszej zmianie tokenów motywu; import
// nie ma jak.
//
// Dane są przykładowe i lokalne. Ta strona niczego nie odpytuje i niczego nie
// zapisuje - stan przełączników żyje w useState.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { ClubCover } from "@/components/clubs/atoms/ClubCover";
import { ClubFollowButton } from "@/components/clubs/molecules/ClubFollowButton";
import { ClubStanceBar } from "@/components/clubs/molecules/ClubStanceBar";
import { ClubThreadList } from "@/components/clubs/organisms/ClubThreadList";
import { ClubLayoutPicker } from "@/components/admin/clubs/molecules/ClubLayoutPicker";
import {
  CLUB_SUBSCRIPTION_STATES,
  type ClubLayout,
  type ClubStance,
  type ClubStanceSummaryRow,
  type ClubThreadListRow,
} from "@/lib/clubs/types";
import type { ClubHubAccess } from "@/lib/clubs/hubAccess";
import { ClubHubAccessBadge } from "@/components/clubs/atoms/ClubHubAccessBadge";

/** Podpis nad przykładem - jeden kształt dla całej galerii.
 *
 *  `hint` jest WYMAGANY: okaz bez zdania o tym, czym ten element się różni od
 *  sąsiedniego, jest samym obrazkiem - a katalog istnieje dla tego zdania,
 *  nie dla obrazka. Wszystkie okazy tej strony podawały je od początku, więc
 *  opcjonalność była wyłącznie martwą gałęzią w renderze. */
function Specimen({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}

/**
 * Przykładowe wątki. Pola pokrywają CAŁY wiersz `club_threads_list`, bo
 * `ClubThreadList` dostaje tu prawdziwy typ - gdyby RPC dołożyło kolumnę,
 * ta strona przestanie się kompilować i to jest zamierzone: katalog ma się
 * psuć razem z kontraktem, a nie cicho pokazywać nieaktualny układ.
 */
function sampleThread(overrides: Partial<ClubThreadListRow> & { id: string }): ClubThreadListRow {
  return {
    slug: `przyklad-${overrides.id}`,
    title: "",
    kind: "discussion",
    status: "open",
    group_id: "00000000-0000-0000-0000-000000000001",
    group_name_pl: "Ogólna",
    group_name_en: "General",
    anchor_type: null,
    anchor_id: null,
    anchor_label: null,
    is_anonymous: false,
    author_id: null,
    author_name: "Anna Kowalska",
    author_avatar: null,
    author_slug: null,
    author_alias: null,
    posted_by_admin_name: null,
    reply_count: 12,
    participant_count: 5,
    reaction_count: 8,
    insightful_count: 3,
    is_unread: false,
    pinned_at: null,
    last_reply_at: "2026-08-05T10:00:00Z",
    created_at: "2026-08-01T09:00:00Z",
    hotness: 42,
    cursor_value: "",
    topic: "geopolitics",
    icon: null,

    excerpt:
      "Fragment treści wątku, który odróżnia układ kart i magazynu od zwykłej listy - bez niego siatka jest tylko listą w dwóch kolumnach.",
    ...overrides,
  };
}

const SAMPLE_STANCES: ClubStanceSummaryRow[] = [
  { stance: "support", total: 9, mine: false },
  { stance: "oppose", total: 4, mine: true },
  { stance: "abstain", total: 2, mine: false },
];

const HUB_ACCESS_STATES: readonly ClubHubAccess[] = ["member", "invited", "entitled", "locked"];

export function ClubElementsGallery() {
  const { t } = useTranslation();

  const [layout, setLayout] = useState<ClubLayout>("cards");
  const [stances, setStances] = useState<ClubStanceSummaryRow[]>(SAMPLE_STANCES);
  const [subscription, setSubscription] = useState<"subscribed" | "muted" | null>(null);

  const threads = useMemo(
    () => [
      sampleThread({
        id: "11111111-1111-1111-1111-111111111111",
        title: "Czy pakiet gazowy przetrwa trilog w obecnym kształcie?",
        kind: "position",
        pinned_at: "2026-08-01T09:00:00Z",
      }),
      sampleThread({
        id: "22222222-2222-2222-2222-222222222222",
        title: "Kto ma dane o kosztach bilansowania po stronie OSD?",
        kind: "question",
        status: "resolved",
        reply_count: 6,
        participant_count: 4,
      }),
      sampleThread({
        id: "33333333-3333-3333-3333-333333333333",
        title: "Materiał: analiza skutków rozporządzenia dla CEE",
        kind: "resource",
        status: "locked",
        author_name: null,
        author_alias: "Uczestnik #7",
        reply_count: 2,
        participant_count: 2,
      }),
    ],
    [],
  );

  // Przełączanie stanowiska działa jak w produkcie: stanowiska WYKLUCZAJĄ się
  // wzajemnie, więc poprzednie znika, a licznik przechodzi na nowe.
  const setStance = (next: ClubStance) =>
    setStances((prev) =>
      prev.map((row) => {
        if (row.stance === next) {
          return { ...row, mine: true, total: row.mine ? row.total : Number(row.total) + 1 };
        }
        return {
          ...row,
          mine: false,
          total: row.mine ? Math.max(0, Number(row.total) - 1) : row.total,
        };
      }),
    );

  return (
    <div className="space-y-8">
      {/* --- układy listy tematów --- */}
      <Specimen
        label={t("clubElements.gallery.layouts")}
        hint={t("clubElements.gallery.layoutsHint")}
      >
        <div className="space-y-4">
          <ClubLayoutPicker value={layout} onChange={setLayout} />
          <Card>
            <CardContent className="p-4">
              <ClubThreadList clubSlug="przyklad" threads={threads} layout={layout} />
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground">
            {t(`clubElements.gallery.layoutWhy.${layout}`)}
          </p>
        </div>
      </Specimen>

      {/* --- okładka --- */}
      <Specimen label={t("clubElements.gallery.cover")} hint={t("clubElements.gallery.coverHint")}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t("clubElements.gallery.coverBanner")}</p>
            <ClubCover url={SAMPLE_COVER} variant="banner" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t("clubElements.gallery.coverCard")}</p>
              <div className="overflow-hidden rounded-lg border border-border/60">
                <ClubCover url={SAMPLE_COVER} variant="card" />
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                {t("clubElements.gallery.coverFallback")}
              </p>
              <div className="overflow-hidden rounded-lg border border-border/60">
                <ClubCover url={null} variant="card" />
              </div>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("clubElements.gallery.coverRule")}</p>
      </Specimen>

      {/* --- stanowiska --- */}
      <Specimen
        label={t("clubElements.gallery.stance")}
        hint={t("clubElements.gallery.stanceHint")}
      >
        <ClubStanceBar rows={stances} disabled={false} pending={false} onSet={setStance} />
      </Specimen>

      {/* --- obserwowanie --- */}
      <Specimen
        label={t("clubElements.gallery.follow")}
        hint={t("clubElements.gallery.followHint")}
      >
        <div className="flex flex-wrap items-center gap-3">
          {/* Trzy stany obok siebie, bo różnica między "brak wpisu"
              a "wyciszony" jest niewidoczna, dopóki nie stoją razem. */}
          {[null, ...CLUB_SUBSCRIPTION_STATES].map((state) => (
            <div key={state ?? "default"} className="space-y-1 text-center">
              <ClubFollowButton state={state} pending={false} disabled onChange={() => undefined} />
              <p className="text-[11px] text-muted-foreground">
                {state === null
                  ? t("clubElements.gallery.followDefault")
                  : t(`club.subscription.${state}`)}
              </p>
            </div>
          ))}
          <div className="space-y-1 text-center">
            <ClubFollowButton
              state={subscription}
              pending={false}
              disabled={false}
              onChange={setSubscription}
            />
            <p className="text-[11px] text-muted-foreground">
              {t("clubElements.gallery.followLive")}
            </p>
          </div>
        </div>
      </Specimen>

      {/* --- stan dostępu na hubie --- */}
      <Specimen
        label={t("clubElements.gallery.hubAccess")}
        hint={t("clubElements.gallery.hubAccessHint")}
      >
        <div className="flex flex-wrap gap-2">
          {HUB_ACCESS_STATES.map((access) => (
            <ClubHubAccessBadge key={access} access={access} />
          ))}
        </div>
      </Specimen>
    </div>
  );
}

/** Okładka przykładowa jako data URI - katalog nie ma sięgać po sieć ani po
 *  plik z bucketu, który ktoś kiedyś skasuje. */
const SAMPLE_COVER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 300">
       <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0%" stop-color="#1e3a5f"/><stop offset="100%" stop-color="#c2703a"/>
       </linearGradient></defs>
       <rect width="1200" height="300" fill="url(#g)"/>
     </svg>`,
  );
