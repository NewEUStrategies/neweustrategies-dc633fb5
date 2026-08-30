// Organizm: materiały partnerów wydarzenia.
//
// GRUPUJEMY PO PARTNERZE, NIE PO RODZAJU. Uczestnik szuka „prezentacji firmy X",
// a nie „wszystkich prezentacji" - lista posortowana po rodzaju kazałaby mu
// przejść całość, żeby znaleźć dwa pliki jednej firmy.
//
// SEKCJA DOMYŚLNIE STOI ZA ZAPISEM. `_event_default_sections()` daje jej
// widoczność `registered`, więc gość zobaczy kartę zamka zamiast listy -
// i to jest właściwe: materiały są korzyścią uczestnictwa, nie treścią
// sprzedażową.
//
// ZDANIE O PUSTCE JEST DRUGĄ LINIĄ OBRONY, NIE PIERWSZĄ. Od migracji
// 20260829221500 pustkę tej sekcji liczy BAZA (`event_sections.has_content`,
// tym samym dwustopniowym predykatem publikacji, co RPC listy), więc sekcja
// bez ani jednego materiału nie dociera tu wcale - `shouldRenderSection`
// ubija ją razem z nagłówkiem, który rysuje `EventPageSections`. Zdanie
// zostaje, bo sekcja i lista jadą DWOMA osobnymi zapytaniami i mogą się
// rozjechać w czasie: partner cofa publikację między jednym a drugim.
// Dokładnie tak samo, i z tego samego powodu, zostało zdanie o pustce
// w `EventSponsorsSection`.
//
// KAŻDY ODNOŚNIK WYCHODZI Z SERWISU. `rel="noopener noreferrer nofollow"` jest
// tu wymogiem, a nie ostrożnością: adresy pochodzą od partnerów, więc nie
// przekazujemy im ani uchwytu do okna, ani rankingu.
import { ExternalLink, FileText, Image, Link2, Presentation, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import {
  groupSponsorMaterials,
  sponsorMaterialKindKey,
  type SponsorMaterialKind,
} from "@/lib/events/sponsorsSurface";
import { usePublicEventMaterials } from "@/lib/events/usePublicEvent";
import { publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import { ensureI18n as ensureEventFrontI18n } from "@/lib/i18n-event-front";

ensureEventFrontI18n();

const KIND_ICON: Record<SponsorMaterialKind, typeof FileText> = {
  document: FileText,
  presentation: Presentation,
  video: Video,
  link: Link2,
  logo_pack: Image,
};

export function EventMaterialsSection({
  slug,
  enabled = true,
}: {
  slug: string;
  enabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const materialsQuery = usePublicEventMaterials(slug, enabled);

  if (materialsQuery.isPending) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label={t("eventFront.materials.loading")}>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (materialsQuery.isError) {
    return (
      <p className="rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {publicEventErrorMessage(materialsQuery.error)}
      </p>
    );
  }

  const groups = groupSponsorMaterials(materialsQuery.data ?? []);
  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("eventFront.sections.materials.empty")}</p>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.sponsorId} className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{group.sponsorName}</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-[6px] border border-border bg-card">
            {group.materials.map((material) => {
              const Icon = KIND_ICON[material.kind];
              const title = pickLocalized(
                { title_pl: material.titlePl, title_en: material.titleEn },
                "title",
                lang,
                material.sponsorName,
              );
              return (
                <li key={material.id}>
                  <a
                    href={material.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/50"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 font-medium text-foreground">{title}</span>
                    <Badge variant="outline">{t(sponsorMaterialKindKey(material.kind))}</Badge>
                    <span className="inline-flex items-center gap-1 text-xs text-primary">
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      {t("eventFront.materials.open")}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
