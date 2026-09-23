// Organizm: tablica „Sponsorzy i reklama" (wzór: Swapcard Studio) - karty sekcji
// sponsorów z kolejnością i edycją w bocznym panelu, pod nimi reklamy strony głównej.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventSponsorDialog } from "@/components/admin/events/molecules/EventSponsorDialog";
import {
  SponsorSectionCard,
  type SponsorLogo,
} from "@/components/admin/events/molecules/SponsorSectionCard";
import {
  AddSponsorSectionDialog,
  type NewSectionInput,
} from "@/components/admin/events/organisms/AddSponsorSectionDialog";
import { EventHomeAdsPanel } from "@/components/admin/events/organisms/EventHomeAdsPanel";
import { SponsorSectionDrawer } from "@/components/admin/events/organisms/SponsorSectionDrawer";
import { adminSponsorErrorMessage } from "@/lib/events/adminSponsorErrors";
import { slugifyEventTypeKey } from "@/lib/events/eventTypes";
import { SPONSOR_KEY_PATTERN } from "@/lib/events/sponsorDraft";
import type { EventSponsorRow } from "@/lib/events/sponsorsApi";
import { setTierLayout, useSponsorLinks, useTierLayouts } from "@/lib/events/sponsorBoardApi";
import {
  useReorderSponsorTiers,
  useSaveSponsor,
  useSaveSponsorTier,
  useSponsorTiers,
  useSponsors,
} from "@/lib/events/useEventSponsors";
import "@/lib/i18n-admin-event-sponsor-board";

function logoOf(row: EventSponsorRow): SponsorLogo {
  return {
    id: row.id,
    name: row.snapshot_name || row.crm_name,
    logoUrl: row.snapshot_logo_url || row.crm_logo_url,
  };
}

/** Górna granica rangi w bazie (`event_sponsor_tiers_rank_range`). */
const RANK_MAX = 1000;

// NUMERACJA OD MAKSIMUM, NIE OD LICZBY WIERSZY. Po usunięciu sekcji albo
// logotypu liczba wierszy spada, a zajęte wartości zostają - `(n + 1) * 10`
// trafiało wtedy w `sort_order` (i rangę) istniejącego wiersza albo stawiało
// nowy element PRZED ostatnim. Nowy element dostaje więc miejsce za
// największą wartością: kolejność +10, ranga +1.
function nextSortOrder(rows: ReadonlyArray<{ sort_order: number }>): number {
  return rows.reduce((max, row) => Math.max(max, row.sort_order), 0) + 10;
}

function nextRank(rows: ReadonlyArray<{ rank: number }>): number {
  return Math.min(RANK_MAX, rows.reduce((max, row) => Math.max(max, row.rank), 0) + 1);
}

// KLUCZ TECHNICZNY NOWEJ SEKCJI. `admin_event_sponsor_tier_save` odmawia nowego
// poziomu bez klucza `^[a-z][a-z0-9_]{1,48}$` (`invalid_key`), a okno dodawania
// sekcji pyta tylko o tytuł - bez tego żadna sekcja nie powstawała. Klucz to
// tytuł bez diakrytyków; tytuł, z którego nie da się go zrobić (cyfry, jedna
// litera, same znaki), dostaje przedrostek `sekcja`. Klucz zajęty w tym
// wydarzeniu (`event_sponsor_tiers_event_key_unique`) dostaje przyrostek `_2`,
// `_3`... Przycięcie do 32 znaków zostawia miejsce na oba.
function sectionKey(title: string, taken: ReadonlySet<string>): string {
  const slug = slugifyEventTypeKey(title).slice(0, 32).replace(/_+$/, "");
  const base = SPONSOR_KEY_PATTERN.test(slug) ? slug : slug === "" ? "sekcja" : `sekcja_${slug}`;
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}_${n}`;
  return key;
}

export function SponsorSectionsBoard({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const en = i18n.language.startsWith("en");
  const tiersQ = useSponsorTiers(eventId);
  const sponsorsQ = useSponsors({ eventId, limit: 500 });
  const layoutsQ = useTierLayouts(eventId);
  const linksQ = useSponsorLinks(eventId);
  const saveTier = useSaveSponsorTier(eventId);
  const reorder = useReorderSponsorTiers(eventId);
  const saveSponsor = useSaveSponsor(eventId);

  const [adding, setAdding] = useState(false);
  const [openTierId, setOpenTierId] = useState<string | null>(null);
  const [sponsorDialog, setSponsorDialog] = useState<{
    tierId: string;
    sponsor: EventSponsorRow | null;
  } | null>(null);

  const tiers = useMemo(
    () => [...(tiersQ.data ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [tiersQ.data],
  );
  const sponsors = sponsorsQ.data ?? [];
  const byTier = useMemo(() => {
    const map = new Map<string, EventSponsorRow[]>();
    for (const s of sponsors) {
      const list = map.get(s.tier_id) ?? [];
      list.push(s);
      map.set(s.tier_id, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.sort_order - b.sort_order);
    return map;
  }, [sponsors]);
  const layoutOf = (id: string) => layoutsQ.data?.get(id) ?? "grid";
  const openTier = tiers.find((x) => x.id === openTierId) ?? null;
  const fail = () => toast.error(t("sponsorBoard.toasts.error"));
  const failWith = (error: unknown) => toast.error(adminSponsorErrorMessage(error));

  const move = (index: number, dir: -1 | 1) => {
    const next = [...tiers];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate(
      next.map((tier, i) => ({ id: tier.id, sortOrder: (i + 1) * 10, rank: i + 1 })),
      { onError: fail },
    );
  };

  const create = (input: NewSectionInput) => {
    saveTier.mutate(
      {
        eventId,
        key: sectionKey(input.namePl, new Set(tiers.map((tier) => tier.key))),
        namePl: input.namePl,
        nameEn: input.nameEn,
        rank: nextRank(tiers),
        sortOrder: nextSortOrder(tiers),
        logoSize: input.layout === "banner" ? "lg" : "md",
        // LIMIT FIRM USTAWIA BAZA, NIE TABLICA. Limit 1 banera nadaje
        // `admin_event_sponsor_tier_set_layout` (20260923100100) razem z układem.
        // Wysłany tutaj zostawał w wierszu także wtedy, gdy zapis układu padł -
        // a wtedy sekcja była siatką z ukrytym limitem 1, druga firma odbijała
        // się od `tier_full`, a kliknięcie „siatka" limitu nie zdejmowało (baza
        // zdejmuje go tylko przy przejściu Z banera).
        maxCompanies: null,
      },
      {
        onSuccess: async (id) => {
          // SEKCJA JUŻ ISTNIEJE - okno dodawania zamyka się OD RAZU. Zostawione
          // otwarte na czas (albo po awarii) zapisu układu pozwalało wysłać je
          // drugi raz, a to tworzyło DRUGĄ sekcję o tym samym tytule. Awaria
          // układu kończy się panelem nowej sekcji, gdzie układ da się przełączyć.
          setAdding(false);
          try {
            await setTierLayout({ id, layout: input.layout });
            // Zapis układu zmienia w bazie także `max_companies`, a lista sekcji
            // odświeżyła się już po samym zapisie sekcji - bez tego panel poziomów
            // pokazywałby baner „bez limitu".
            void tiersQ.refetch();
            await layoutsQ.refetch();
            toast.success(t("sponsorBoard.toasts.sectionCreated"));
          } catch {
            toast.error(t("sponsorBoard.toasts.sectionCreatedLayoutFailed"));
          }
          setOpenTierId(id);
        },
        onError: fail,
      },
    );
  };

  return (
    <div className="space-y-10">
      <section aria-labelledby="sponsor-board-title" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="sponsor-board-title" className="text-lg font-semibold">
              {t("sponsorBoard.sponsors.title")}
            </h3>
            <p className="text-sm text-muted-foreground">{t("sponsorBoard.sponsors.lead")}</p>
          </div>
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            {t("sponsorBoard.sponsors.create")}
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {tiers.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {t("sponsorBoard.sponsors.empty")}
            </p>
          ) : (
            tiers.map((tier, index) => (
              <SponsorSectionCard
                key={tier.id}
                title={en ? tier.name_en || tier.name_pl : tier.name_pl || tier.name_en}
                layout={layoutOf(tier.id)}
                logos={(byTier.get(tier.id) ?? []).map(logoOf)}
                isFirst={index === 0}
                isLast={index === tiers.length - 1}
                onEdit={() => setOpenTierId(tier.id)}
                onMove={(dir) => move(index, dir)}
              />
            ))
          )}
        </div>
      </section>

      <EventHomeAdsPanel eventId={eventId} />

      <AddSponsorSectionDialog
        open={adding}
        onOpenChange={setAdding}
        isSaving={saveTier.isPending}
        onSubmit={create}
      />

      <SponsorSectionDrawer
        eventId={eventId}
        tier={openTier}
        layout={openTier === null ? "grid" : layoutOf(openTier.id)}
        logos={openTier === null ? [] : (byTier.get(openTier.id) ?? []).map(logoOf)}
        links={linksQ.data ?? new Map()}
        onOpenChange={(o) => (o ? null : setOpenTierId(null))}
        onAddSponsor={(tierId) => setSponsorDialog({ tierId, sponsor: null })}
        onEditSponsor={(id) =>
          setSponsorDialog({
            tierId: openTierId ?? "",
            sponsor: sponsors.find((s) => s.id === id) ?? null,
          })
        }
      />

      <EventSponsorDialog
        open={sponsorDialog !== null}
        onOpenChange={(o) => (o ? null : setSponsorDialog(null))}
        eventId={eventId}
        sponsor={sponsorDialog?.sponsor ?? null}
        tiers={tiers}
        defaultTierId={sponsorDialog?.tierId}
        nextSortOrder={nextSortOrder(
          sponsorDialog === null ? [] : (byTier.get(sponsorDialog.tierId) ?? []),
        )}
        isSaving={saveSponsor.isPending}
        onSubmit={(input) =>
          saveSponsor.mutate(input, {
            onSuccess: () => setSponsorDialog(null),
            // `tier_full` (pełna sekcja - także baner z limitem 1) i reszta odmów
            // bazy - zdaniem z mapy odmów sponsorów, a nie ogólnym „nie udało się".
            onError: failWith,
          })
        }
      />
    </div>
  );
}
