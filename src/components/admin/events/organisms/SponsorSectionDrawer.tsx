// Organizm: boczny panel edycji sekcji sponsorów - tytuł PL/EN, układ, logotypy
// z przekierowaniem, dodawanie firmy z CRM i usunięcie sekcji.
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SponsorRedirectField } from "@/components/admin/events/molecules/SponsorRedirectField";
import type { SponsorLogo } from "@/components/admin/events/molecules/SponsorSectionCard";
import { SponsorSectionTitleForm } from "@/components/admin/events/molecules/SponsorSectionTitleForm";
import { confirmDialog } from "@/lib/appDialogs";
import { adminSponsorErrorMessage } from "@/lib/events/adminSponsorErrors";
import { brandedMediaUrl } from "@/lib/media/publicUrl";
import type { EventSponsorTierRow } from "@/lib/events/sponsorsApi";
import {
  useSetSponsorLink,
  useSetTierLayout,
  type SponsorLink,
  type SponsorSectionLayout,
} from "@/lib/events/sponsorBoardApi";
import {
  useDeleteSponsor,
  useDeleteSponsorTier,
  useSaveSponsorTier,
} from "@/lib/events/useEventSponsors";
import "@/lib/i18n-admin-event-sponsor-board";

const NO_LINK: SponsorLink = { mode: "exhibitor", url: "" };

export function SponsorSectionDrawer({
  eventId,
  tier,
  layout,
  logos,
  links,
  onOpenChange,
  onAddSponsor,
  onEditSponsor,
}: {
  eventId: string;
  tier: EventSponsorTierRow | null;
  layout: SponsorSectionLayout;
  logos: SponsorLogo[];
  links: Map<string, SponsorLink>;
  onOpenChange: (open: boolean) => void;
  onAddSponsor: (tierId: string) => void;
  onEditSponsor: (sponsorId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const saveTier = useSaveSponsorTier(eventId);
  const deleteTier = useDeleteSponsorTier(eventId);
  const setLayout = useSetTierLayout(eventId);
  const setLink = useSetSponsorLink(eventId);
  const deleteSponsor = useDeleteSponsor(eventId);

  const fail = () => toast.error(t("sponsorBoard.toasts.error"));
  const title =
    tier === null
      ? ""
      : i18n.language.startsWith("en")
        ? tier.name_en || tier.name_pl
        : tier.name_pl || tier.name_en;
  const bannerFull = layout === "banner" && logos.length >= 1;
  // Baza odmówi banera przy więcej niż jednej firmie (`banner_single_image`),
  // więc przycisk gaśnie wcześniej i mówi, co trzeba zrobić.
  const bannerBlocked = logos.length > 1;

  return (
    <Sheet open={tier !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {tier === null ? null : (
          <>
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>{t(`sponsorBoard.sponsors.${layout}`)}</SheetDescription>
            </SheetHeader>

            {/* `key` = nowa sekcja to nowy formularz; odświeżony wiersz TEJ SAMEJ
                sekcji nie nadpisuje tytułu, którego organizator jeszcze nie zapisał. */}
            <SponsorSectionTitleForm
              key={tier.id}
              initialNamePl={tier.name_pl}
              initialNameEn={tier.name_en}
              isSaving={saveTier.isPending}
              onSave={(titles) =>
                saveTier.mutate(
                  { id: tier.id, eventId, ...titles },
                  {
                    onSuccess: () => toast.success(t("sponsorBoard.toasts.sectionSaved")),
                    onError: fail,
                  },
                )
              }
            />

            <fieldset className="mt-4 space-y-1">
              <legend className="text-sm font-medium">{t("sponsorBoard.drawer.layout")}</legend>
              <div className="flex gap-2">
                {(["grid", "banner"] as const).map((key) => (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant={layout === key ? "default" : "outline"}
                    aria-pressed={layout === key}
                    aria-describedby={
                      key === "banner" && bannerBlocked ? "drawer-banner-blocked" : undefined
                    }
                    disabled={setLayout.isPending || (key === "banner" && bannerBlocked)}
                    onClick={() =>
                      setLayout.mutate(
                        { id: tier.id, layout: key },
                        { onError: (error) => toast.error(adminSponsorErrorMessage(error)) },
                      )
                    }
                  >
                    {t(`sponsorBoard.sponsors.${key}`)}
                  </Button>
                ))}
              </div>
              {bannerBlocked ? (
                <p id="drawer-banner-blocked" className="text-xs text-muted-foreground">
                  {t("sponsorBoard.drawer.bannerBlocked")}
                </p>
              ) : null}
            </fieldset>

            <ul className="mt-6 space-y-4">
              {logos.map((logo) => (
                <li key={logo.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-16 items-center justify-center rounded bg-muted p-1">
                      {logo.logoUrl === "" ? (
                        <span className="text-[10px] font-medium">{logo.name}</span>
                      ) : (
                        <img
                          src={brandedMediaUrl(logo.logoUrl)}
                          alt={logo.name}
                          className="max-h-full max-w-full object-contain"
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{logo.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("sponsorBoard.drawer.editLogo")}
                      onClick={() => onEditSponsor(logo.id)}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("sponsorBoard.drawer.deleteLogo")}
                      onClick={() => deleteSponsor.mutate(logo.id, { onError: fail })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                  <div className="mt-3">
                    <SponsorRedirectField
                      id={`link-${logo.id}`}
                      value={links.get(logo.id) ?? NO_LINK}
                      isSaving={setLink.isPending}
                      onSave={(link) =>
                        setLink.mutate(
                          { id: logo.id, ...link },
                          {
                            onSuccess: () => toast.success(t("sponsorBoard.toasts.linkSaved")),
                            onError: fail,
                          },
                        )
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-4 space-y-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={bannerFull}
                onClick={() => onAddSponsor(tier.id)}
              >
                <Plus className="mr-1 h-4 w-4" aria-hidden />
                {t("sponsorBoard.drawer.addSponsor")}
              </Button>
              {bannerFull ? (
                <p className="text-xs text-muted-foreground">
                  {t("sponsorBoard.drawer.bannerFull")}
                </p>
              ) : null}
            </div>

            <div className="mt-8 border-t border-border pt-4">
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={logos.length > 0 || deleteTier.isPending}
                onClick={async () => {
                  const ok = await confirmDialog({
                    title: t("sponsorBoard.drawer.deleteConfirmTitle"),
                    description: t("sponsorBoard.drawer.deleteConfirmBody"),
                    confirmLabel: t("sponsorBoard.drawer.confirm"),
                    cancelLabel: t("sponsorBoard.drawer.cancel"),
                    destructive: true,
                  });
                  if (!ok) return;
                  deleteTier.mutate(tier.id, {
                    onSuccess: () => {
                      toast.success(t("sponsorBoard.toasts.sectionDeleted"));
                      onOpenChange(false);
                    },
                    onError: fail,
                  });
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" aria-hidden />
                {t("sponsorBoard.drawer.deleteSection")}
              </Button>
              {logos.length > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("sponsorBoard.drawer.deleteBlocked")}
                </p>
              ) : null}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
