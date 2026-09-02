// Panel ustawień kanału podcastowego - WYCIĄG z `routes/admin.podcasts.tsx`.
//
// CO TU MIESZKA: wariant odtwarzacza, adresy platform, adres kanału RSS,
// karta gotowości feedu i metadane Apple Podcasts Connect. Ustawienia to
// SINGLETON per tenant, więc panel nie ma listy - ma jeden formularz i jeden
// upsert (patrz `saveAdminPodcastSettings`).
//
// DLACZEGO GUARD `isLoading` JEST WAŻNY. Formularz wyrenderowany przed
// odczytem pokazuje wartości domyślne i zaprasza redakcję do zapisania ich
// NA WIERZCH tego, czego jeszcze nie przeczytał - a upsert nie ma cofnięcia.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Save } from "@/lib/lucide-shim";
import { FieldLabel } from "@/components/profile/FieldLabel";
import {
  ApplePodcastMetaFields,
  type ApplePodcastMetaValue,
} from "@/components/admin/podcasts/ApplePodcastMetaFields";
import { PodcastFeedReadinessCard } from "@/components/admin/podcasts/PodcastFeedReadinessCard";
import { useAuth } from "@/hooks/useAuth";
import type { PodcastSettings } from "@/lib/podcast/types";
import { appleMetaToSettingsPatch, mergePodcastSettings } from "@/lib/podcast/shape";
import {
  useAdminPodcastFeedEpisodes,
  useAdminPodcastSettings,
  useSaveAdminPodcastSettings,
} from "@/lib/podcast/queries";
// Osobny moduł od buildera RSS: panel potrzebuje tylko oceny gotowości,
// generator XML zostaje na serwerze (i poza bundlem admina).
import { podcastFeedReadiness } from "@/lib/seo/podcastFeedReadiness";
import {
  DEFAULT_APPLE_CATEGORY,
  DEFAULT_APPLE_SUBCATEGORY,
} from "@/lib/seo/applePodcastCategories";
import { SITE_DEFAULT_DESCRIPTION, SITE_NAME } from "@/lib/seo/meta";
import { ensureI18n as ensureAdminPodcastsI18n } from "@/lib/i18n-admin-podcasts";

export function PodcastSettingsPane({ onClose }: { onClose: () => void }) {
  ensureAdminPodcastsI18n();
  const { t } = useTranslation();
  const { tenantId } = useAuth();
  const { data, isLoading } = useAdminPodcastSettings();
  const [form, setForm] = useState<Partial<PodcastSettings>>({});
  // Kaskada: wersja robocza -> zapisany wiersz -> domyślne. Liczona przy
  // każdym renderze (tak było przed ekstrakcją), bo od jej pól zależy karta
  // gotowości feedu poniżej.
  const merged = mergePodcastSettings(form, data, tenantId);

  // Podsumowanie opublikowanych odcinków: pusty kanał jest dla Apple blokujący,
  // a enclosure bez rzeczywistego rozmiaru pliku - zgłaszany jako problem.
  const { data: episodeSummary } = useAdminPodcastFeedEpisodes();

  // Ta sama funkcja, która liczy braki dla feedu - panel pokazuje je, zanim
  // redakcja zgłosi kanał do Apple.
  const readiness = useMemo(
    () =>
      podcastFeedReadiness({
        title: `${SITE_NAME} · Podcast`,
        description: SITE_DEFAULT_DESCRIPTION.pl,
        language: "pl",
        copyright: merged.itunes_copyright ?? "",
        imageUrl: merged.itunes_image_url ?? "",
        author: merged.itunes_author ?? "",
        ownerName: merged.itunes_owner_name ?? "",
        ownerEmail: merged.itunes_owner_email ?? "",
        episodes: episodeSummary ?? { total: 0, withoutByteLength: 0, withoutDuration: 0 },
      }),
    [
      merged.itunes_copyright,
      merged.itunes_image_url,
      merged.itunes_author,
      merged.itunes_owner_name,
      merged.itunes_owner_email,
      episodeSummary,
    ],
  );

  const applyApple = (patch: Partial<ApplePodcastMetaValue>) =>
    setForm((f) => ({ ...f, ...appleMetaToSettingsPatch(patch) }));

  const save = useSaveAdminPodcastSettings({
    tenantId,
    merged,
    messages: {
      slug: t("adminPodcasts.errors.slug"),
      audio: t("adminPodcasts.errors.audio"),
      tenant: t("adminPodcasts.errors.tenant"),
    },
    onSaved: onClose,
  });

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">{t("adminPodcasts.settings.loading")}</div>
    );
  }

  return (
    <TooltipProvider>
      <section className="bg-card border border-border rounded-lg p-6 space-y-6 max-w-2xl">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">{t("adminPodcasts.settings.title")}</h2>
          <Button variant="ghost" onClick={onClose}>
            {t("adminPodcasts.settings.back")}
          </Button>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <FieldLabel tip={t("adminPodcasts.settings.variantTip")}>
              {t("adminPodcasts.settings.variantLabel")}
            </FieldLabel>
            <div className="flex gap-2">
              {(["full", "mini", "sticky"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, default_player_variant: v }))}
                  className={`px-3 py-1.5 text-xs rounded border ${merged.default_player_variant === v ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                >
                  {v === "full"
                    ? t("adminPodcasts.settings.variantFull")
                    : v === "mini"
                      ? t("adminPodcasts.settings.variantMini")
                      : t("adminPodcasts.settings.variantSticky")}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between gap-4 py-2">
            <span className="text-sm">{t("adminPodcasts.settings.showSpeed")}</span>
            <Switch
              checked={merged.show_speed_control}
              onCheckedChange={(v) => setForm((f) => ({ ...f, show_speed_control: v }))}
            />
          </label>

          <div className="grid gap-1.5">
            <Label>Spotify URL</Label>
            <Input
              value={merged.spotify_url ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, spotify_url: e.target.value }))}
              placeholder="https://open.spotify.com/show/…"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Apple Podcasts URL</Label>
            <Input
              value={merged.apple_url ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, apple_url: e.target.value }))}
              placeholder="https://podcasts.apple.com/…"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Google / YouTube URL</Label>
            <Input
              value={merged.google_url ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, google_url: e.target.value }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("adminPodcasts.settings.externalRss")}</Label>
            <Input
              value={merged.rss_url ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, rss_url: e.target.value }))}
              placeholder={t("adminPodcasts.settings.rssPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">
              {t("adminPodcasts.settings.rssHelperPre")}
              <code>/podcast/rss.xml</code>
            </p>
          </div>

          <PodcastFeedReadinessCard readiness={readiness} />
          <ApplePodcastMetaFields
            value={{
              author: merged.itunes_author ?? "",
              ownerName: merged.itunes_owner_name ?? "",
              ownerEmail: merged.itunes_owner_email ?? "",
              category: merged.itunes_category ?? DEFAULT_APPLE_CATEGORY,
              subcategory: merged.itunes_subcategory ?? DEFAULT_APPLE_SUBCATEGORY,
              explicit: merged.itunes_explicit,
              showType: merged.itunes_type,
              imageUrl: merged.itunes_image_url ?? "",
              copyright: merged.itunes_copyright ?? "",
            }}
            onChange={applyApple}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="w-4 h-4 mr-2" />
            {t("adminPodcasts.settings.saveSettings")}
          </Button>
        </div>
      </section>
    </TooltipProvider>
  );
}
