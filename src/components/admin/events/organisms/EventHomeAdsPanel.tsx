// Organizm: reklamy strony głównej wydarzenia - tabela (obraz, grupy, wyświetlenia,
// kliknięcia, status) i okno dodawania/edycji z grupami docelowymi i harmonogramem.
//
// FORMULARZ WALIDUJE APLIKACJA, NIE PRZEGLĄDARKA (`noValidate`). Pole linku ma
// `type="url"` dla klawiatury ekranowej z „/" i „.com", ale natywna walidacja
// tego typu zatrzymywała wysłanie dymkiem w języku PRZEGLĄDARKI, zanim
// `validateHomeAd` zdążył zadziałać - komunikat panelu (PL/EN) nigdy się nie
// pojawiał. Reguły wszystkich pól okna ma `validateHomeAd` (obrazy, link,
// kolejność dat); tekst alternatywny ogranicza `maxLength`, które działa przy
// wpisywaniu, a nie przy wysyłce, więc `noValidate` go nie wyłącza. Każdy
// komunikat błędu jest związany ze swoim polem (`aria-invalid` plus
// `aria-describedby`), żeby czytnik ekranu przeczytał go razem z nazwą pola.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ImageUrlField } from "@/components/admin/auth/organisms/ImageUrlField";
import { confirmDialog } from "@/lib/appDialogs";
import { brandedMediaUrl } from "@/lib/media/publicUrl";
import {
  useDeleteHomeAd,
  useHomeAds,
  useSaveHomeAd,
  validateHomeAd,
  type EventHomeAdRow,
  type HomeAdField,
  type HomeAdInput,
} from "@/lib/events/sponsorBoardApi";
import { useEventGroups } from "@/lib/events/useEventTermsGroups";
import "@/lib/i18n-admin-event-sponsor-board";

function draftFrom(eventId: string, row: EventHomeAdRow | null): HomeAdInput {
  return {
    id: row?.id,
    eventId,
    imageUrl: row?.image_url ?? "",
    imageMobileUrl: row?.image_mobile_url ?? "",
    linkUrl: row?.link_url ?? "",
    altText: row?.alt_text ?? "",
    groupIds: row?.group_ids ?? [],
    startsAt: row?.starts_at ?? "",
    endsAt: row?.ends_at ?? "",
    isActive: row?.is_active ?? true,
  };
}

export function EventHomeAdsPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("en") ? "en" : "pl";
  const adsQ = useHomeAds(eventId);
  const groupsQ = useEventGroups(eventId);
  const save = useSaveHomeAd(eventId);
  const remove = useDeleteHomeAd(eventId);
  const [editing, setEditing] = useState<EventHomeAdRow | null | undefined>(undefined);
  const [draft, setDraft] = useState<HomeAdInput>(() => draftFrom(eventId, null));
  const [errors, setErrors] = useState<HomeAdField[]>([]);

  useEffect(() => {
    if (editing === undefined) return;
    setDraft(draftFrom(eventId, editing));
    setErrors([]);
  }, [editing, eventId]);

  const groups = groupsQ.data ?? [];
  const groupName = (id: string) => {
    const g = groups.find((x) => x.id === id);
    return g === undefined ? "" : lang === "en" ? g.name_en || g.name_pl : g.name_pl || g.name_en;
  };
  const ads = adsQ.data ?? [];
  const linkInvalid = errors.includes("linkUrl");
  const endsInvalid = errors.includes("endsAt");

  return (
    <section className="space-y-4" aria-labelledby="home-ads-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="home-ads-title" className="text-lg font-semibold">
            {t("sponsorBoard.ads.title")}
          </h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            <li>{t("sponsorBoard.ads.lead1")}</li>
            <li>{t("sponsorBoard.ads.lead2")}</li>
            <li>{t("sponsorBoard.ads.lead3")}</li>
          </ul>
        </div>
        <Button type="button" onClick={() => setEditing(null)}>
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          {t("sponsorBoard.ads.add")}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">{t("sponsorBoard.ads.colImage")}</th>
              <th className="p-3 font-medium">{t("sponsorBoard.ads.colGroups")}</th>
              <th className="p-3 font-medium">{t("sponsorBoard.ads.colViews")}</th>
              <th className="p-3 font-medium">{t("sponsorBoard.ads.colClicks")}</th>
              <th className="p-3 font-medium">{t("sponsorBoard.ads.colStatus")}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {ads.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  {t("sponsorBoard.ads.empty")}
                </td>
              </tr>
            ) : (
              ads.map((ad) => (
                <tr key={ad.id} className="border-b border-border last:border-b-0">
                  <td className="p-3">
                    <img
                      src={brandedMediaUrl(ad.image_url)}
                      alt={ad.alt_text}
                      className="h-16 w-12 rounded object-cover"
                      loading="lazy"
                    />
                  </td>
                  <td className="p-3">
                    {ad.group_ids.length === 0
                      ? t("sponsorBoard.ads.allGroups")
                      : ad.group_ids
                          .map(groupName)
                          .filter((n) => n !== "")
                          .join(", ")}
                  </td>
                  <td className="p-3 tabular-nums">{ad.views}</td>
                  <td className="p-3 tabular-nums">{ad.clicks}</td>
                  <td className="p-3">
                    <Badge variant={ad.is_active ? "default" : "secondary"}>
                      {t(ad.is_active ? "sponsorBoard.ads.active" : "sponsorBoard.ads.paused")}
                    </Badge>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("sponsorBoard.ads.edit")}
                      onClick={() => setEditing(ad)}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("sponsorBoard.ads.remove")}
                      onClick={async () => {
                        const ok = await confirmDialog({
                          title: t("sponsorBoard.ads.remove"),
                          destructive: true,
                        });
                        if (!ok) return;
                        remove.mutate(ad.id, {
                          onSuccess: () => toast.success(t("sponsorBoard.ads.deleted")),
                          onError: () => toast.error(t("sponsorBoard.toasts.error")),
                        });
                      }}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={editing !== undefined} onOpenChange={(o) => (o ? null : setEditing(undefined))}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {t(editing ? "sponsorBoard.ads.dialogEdit" : "sponsorBoard.ads.dialogNew")}
            </DialogTitle>
            <DialogDescription>{t("sponsorBoard.ads.lead2")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const found = validateHomeAd(draft);
              setErrors(found);
              if (found.length > 0) return;
              save.mutate(draft, {
                onSuccess: () => {
                  toast.success(t("sponsorBoard.ads.saved"));
                  setEditing(undefined);
                },
                onError: () => toast.error(t("sponsorBoard.toasts.error")),
              });
            }}
          >
            <ImageUrlField
              label={t("sponsorBoard.ads.image")}
              value={draft.imageUrl}
              aspect="1 / 2"
              onChange={(v) => setDraft({ ...draft, imageUrl: v })}
              error={errors.includes("imageUrl") ? t("sponsorBoard.ads.imageInvalid") : undefined}
            />
            <ImageUrlField
              label={t("sponsorBoard.ads.imageMobile")}
              value={draft.imageMobileUrl}
              aspect="9 / 16"
              onChange={(v) => setDraft({ ...draft, imageMobileUrl: v })}
              error={
                errors.includes("imageMobileUrl") ? t("sponsorBoard.ads.imageInvalid") : undefined
              }
            />
            <div className="space-y-1">
              <Label htmlFor="ad-link">{t("sponsorBoard.ads.link")}</Label>
              <Input
                id="ad-link"
                type="url"
                value={draft.linkUrl}
                aria-invalid={linkInvalid || undefined}
                aria-describedby={linkInvalid ? "ad-link-error" : undefined}
                onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })}
              />
              {linkInvalid ? (
                <p id="ad-link-error" className="text-xs text-destructive">
                  {t("sponsorBoard.ads.linkInvalid")}
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ad-alt">{t("sponsorBoard.ads.alt")}</Label>
              <Input
                id="ad-alt"
                value={draft.altText}
                maxLength={300}
                onChange={(e) => setDraft({ ...draft, altText: e.target.value })}
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("sponsorBoard.ads.groups")}</legend>
              <p className="text-xs text-muted-foreground">{t("sponsorBoard.ads.groupsHint")}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {groups.map((g) => {
                  const checked = draft.groupIds.includes(g.id);
                  return (
                    <label key={g.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) =>
                          setDraft({
                            ...draft,
                            groupIds:
                              v === true
                                ? [...draft.groupIds, g.id]
                                : draft.groupIds.filter((id) => id !== g.id),
                          })
                        }
                      />
                      {groupName(g.id)}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ad-from">{t("sponsorBoard.ads.startsAt")}</Label>
                <DateTimePicker
                  id="ad-from"
                  lang={lang}
                  value={draft.startsAt || null}
                  onChange={(v) => setDraft({ ...draft, startsAt: v ?? "" })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ad-to">{t("sponsorBoard.ads.endsAt")}</Label>
                <DateTimePicker
                  id="ad-to"
                  lang={lang}
                  value={draft.endsAt || null}
                  onChange={(v) => setDraft({ ...draft, endsAt: v ?? "" })}
                  aria-invalid={endsInvalid || undefined}
                  aria-describedby={endsInvalid ? "ad-to-error" : undefined}
                />
                {endsInvalid ? (
                  <p id="ad-to-error" className="text-xs text-destructive">
                    {t("sponsorBoard.ads.endsInvalid")}
                  </p>
                ) : null}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={draft.isActive}
                onCheckedChange={(v) => setDraft({ ...draft, isActive: v })}
              />
              {t("sponsorBoard.ads.isActive")}
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(undefined)}>
                {t("sponsorBoard.ads.cancel")}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {t("sponsorBoard.ads.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
