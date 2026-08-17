// Karta „Oznaczenie komercyjne" w kroku 1 edytora wpisu.
//
// TRZY DECYZJE PROJEKTOWE, KTÓRE WYNIKAJĄ Z PRAWA, NIE Z UX-u:
//
// 1) WŁĄCZENIE FLAGI USTAWIA RODZAJ RELACJI W TYM SAMYM PATCHU. Gdyby te dwa
//    pola szły osobno, istniałby stan „materiał komercyjny bez rodzaju relacji" -
//    render nie miałby czego pokazać, a CHECK w bazie
//    (posts_sponsored_disclosure_complete_check) odrzuciłby autozapis razem
//    z niezwiązanymi zmianami treści z tej samej migawki. Atomowy patch czyni ten
//    stan nieosiągalnym z UI, dlatego CHECK może zostać twardy.
//
// 2) ETYKIETY GŁÓWNEJ NIE DA SIĘ WPISAĆ RĘCZNIE. Redakcja wybiera RODZAJ relacji,
//    brzmienie przychodzi ze słownika (i18n-sponsored.ts). Rekomendacje UOKiK
//    (2022) wprost odrzucają skróty i formy nieoczywiste (#ad, #sp, #collab, samo
//    #współpraca), a pole tekstowe zaprasza do wpisania właśnie tego. Ponad kanon
//    służy „Dodatkowe wyjaśnienie" - DOKLEJANE, nie zastępujące.
//
// 3) PODGLĄD POKAZUJE PRAWDZIWY KOMPONENT PUBLICZNY. Karta renderuje
//    `SponsoredDisclosure` - ten sam, który zobaczy czytelnik, z tymi samymi
//    kluczami i18n. Makieta „na oko" rozjechałaby się z produkcją przy pierwszej
//    zmianie brzmienia, a to brzmienie jest treścią oświadczenia prawnego.
import { useTranslation } from "react-i18next";
import { Megaphone } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { SponsoredDisclosure } from "@/components/post/SponsoredDisclosure";
import {
  DEFAULT_SPONSORED_KIND,
  SPONSORED_KINDS,
  disclosureGaps,
  type SponsoredKind,
} from "@/lib/content/sponsored";
import { FieldRow, InfoHint } from "../atoms";
import type { PostForm } from "../types";
import "@/lib/i18n-admin-post-panes";

export function PostSponsoredCard({
  form,
  uiLang,
  onPatch,
}: {
  form: PostForm;
  uiLang: string;
  /** Patch wieloklucza - jedno wejście w historii undo i jeden autozapis. */
  onPatch: (patch: Partial<PostForm>) => void;
}) {
  const { t } = useTranslation();
  const gaps = disclosureGaps(form);
  const lang: "pl" | "en" = uiLang === "en" ? "en" : "pl";

  const toggle = (next: boolean) => {
    onPatch(
      next
        ? {
            is_sponsored: true,
            // Rodzaj razem z flagą - patrz decyzja (1) w nagłówku.
            sponsored_kind: form.sponsored_kind ?? DEFAULT_SPONSORED_KIND,
            // Reklamodawcą jest najczęściej przypisana organizacja; podpowiadamy
            // ją, żeby najważniejsze pole nie startowało puste. Redakcja może
            // nadpisać - podpowiedź nie jest ustaleniem.
            sponsored_advertiser_name: form.sponsored_advertiser_name ?? form.organization_name,
            sponsored_advertiser_url: form.sponsored_advertiser_url ?? form.organization_website,
          }
        : {
            is_sponsored: false,
            // Wyłączenie NIE czyści deklaracji: redakcja bywa w trakcie ustalania
            // szczegółów i przełącza flagę tam i z powrotem. Kasowanie nazwy
            // reklamodawcy przy każdym wyłączeniu zmuszałoby do wpisywania jej od
            // nowa, a przy okazji niszczyłoby ślad tego, co już ustalono.
            sponsored_political: false,
          },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Megaphone className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("adminPostPanes.sponsored.title")}
        </h3>
        <InfoHint text={t("adminPostPanes.sponsored.hint")} />
      </div>

      <label className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3">
        <Switch
          checked={form.is_sponsored}
          onCheckedChange={toggle}
          aria-label={t("adminPostPanes.sponsored.toggle")}
        />
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">
            {t("adminPostPanes.sponsored.toggle")}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            {t("adminPostPanes.sponsored.toggleHint")}
          </span>
        </span>
      </label>

      {form.is_sponsored && (
        <div className="space-y-3">
          <FieldRow
            label={t("adminPostPanes.sponsored.kindLabel")}
            hint={t("adminPostPanes.sponsored.kindHint")}
          >
            <Select
              value={form.sponsored_kind ?? DEFAULT_SPONSORED_KIND}
              onValueChange={(value) => onPatch({ sponsored_kind: value as SponsoredKind })}
            >
              <SelectTrigger className="h-9 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPONSORED_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {kind === "advertisement" &&
                      t("adminPostPanes.sponsored.kindOption.advertisement")}
                    {kind === "sponsored" && t("adminPostPanes.sponsored.kindOption.sponsored")}
                    {kind === "partner" && t("adminPostPanes.sponsored.kindOption.partner")}
                    {kind === "barter" && t("adminPostPanes.sponsored.kindOption.barter")}
                    {kind === "self_promo" && t("adminPostPanes.sponsored.kindOption.self_promo")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>

          {/* AC z Rekomendacji UOKiK: powtarzalne świadczenia od tego samego
              podmiotu to współpraca reklamowa, nie barter. Ostrzeżenie stoi przy
              wyborze, bo tam podejmowana jest zła decyzja. */}
          {form.sponsored_kind === "barter" && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11.5px] leading-relaxed">
              {t("adminPostPanes.sponsored.barterWarning")}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldRow
              label={t("adminPostPanes.sponsored.advertiserLabel")}
              hint={t("adminPostPanes.sponsored.advertiserHint")}
              missing={gaps.includes("advertiser")}
            >
              <Input
                value={form.sponsored_advertiser_name ?? ""}
                onChange={(e) => onPatch({ sponsored_advertiser_name: e.target.value || null })}
                className="h-9 text-[13px]"
                maxLength={200}
              />
              {form.organization_name &&
                form.sponsored_advertiser_name !== form.organization_name && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5 text-[11px]"
                    onClick={() => onPatch({ sponsored_advertiser_name: form.organization_name })}
                  >
                    {t("adminPostPanes.sponsored.advertiserFromOrg")}
                  </Button>
                )}
            </FieldRow>

            <FieldRow
              label={t("adminPostPanes.sponsored.advertiserUrlLabel")}
              hint={t("adminPostPanes.sponsored.advertiserUrlHint")}
              missing={gaps.includes("advertiserUrl")}
            >
              <Input
                type="url"
                value={form.sponsored_advertiser_url ?? ""}
                onChange={(e) => onPatch({ sponsored_advertiser_url: e.target.value || null })}
                placeholder="https://"
                className="h-9 text-[13px]"
                maxLength={2048}
              />
            </FieldRow>

            <FieldRow
              label={t("adminPostPanes.sponsored.payerLabel")}
              hint={t("adminPostPanes.sponsored.payerHint")}
            >
              <Input
                value={form.sponsored_payer_name ?? ""}
                onChange={(e) => onPatch({ sponsored_payer_name: e.target.value || null })}
                className="h-9 text-[13px]"
                maxLength={200}
              />
            </FieldRow>

            <FieldRow
              label={t("adminPostPanes.sponsored.orderRefLabel")}
              hint={t("adminPostPanes.sponsored.orderRefHint")}
            >
              <Input
                value={form.sponsored_order_ref ?? ""}
                onChange={(e) => onPatch({ sponsored_order_ref: e.target.value || null })}
                className="h-9 text-[13px]"
                maxLength={120}
              />
            </FieldRow>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldRow
              label={t("adminPostPanes.sponsored.notePlLabel")}
              hint={t("adminPostPanes.sponsored.noteHint")}
            >
              <Textarea
                value={form.sponsored_note_pl ?? ""}
                onChange={(e) => onPatch({ sponsored_note_pl: e.target.value || null })}
                rows={3}
                maxLength={1000}
                className="text-[13px]"
              />
            </FieldRow>
            <FieldRow label={t("adminPostPanes.sponsored.noteEnLabel")}>
              <Textarea
                value={form.sponsored_note_en ?? ""}
                onChange={(e) => onPatch({ sponsored_note_en: e.target.value || null })}
                rows={3}
                maxLength={1000}
                className="text-[13px]"
              />
            </FieldRow>
          </div>

          <label className="flex items-start gap-3 rounded-md border border-border p-3">
            <Switch
              checked={form.sponsored_political}
              onCheckedChange={(next) => onPatch({ sponsored_political: next })}
              aria-label={t("adminPostPanes.sponsored.politicalLabel")}
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">
                {t("adminPostPanes.sponsored.politicalLabel")}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {t("adminPostPanes.sponsored.politicalHint")}
              </span>
            </span>
          </label>

          {form.sponsored_political && (
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldRow
                label={t("adminPostPanes.sponsored.politicalProcessLabel")}
                hint={t("adminPostPanes.sponsored.politicalProcessHint")}
                missing={gaps.includes("politicalProcess")}
              >
                <Input
                  value={form.sponsored_political_process ?? ""}
                  onChange={(e) => onPatch({ sponsored_political_process: e.target.value || null })}
                  placeholder={t("adminPostPanes.sponsored.politicalProcessPlaceholder")}
                  className="h-9 text-[13px]"
                  maxLength={300}
                />
              </FieldRow>
              <FieldRow
                label={t("adminPostPanes.sponsored.sponsorControllerLabel")}
                hint={t("adminPostPanes.sponsored.sponsorControllerHint")}
              >
                <Input
                  value={form.sponsored_sponsor_controller ?? ""}
                  onChange={(e) =>
                    onPatch({ sponsored_sponsor_controller: e.target.value || null })
                  }
                  className="h-9 text-[13px]"
                  maxLength={200}
                />
              </FieldRow>
            </div>
          )}
        </div>
      )}

      {/* Afiliacja stoi POZA blokiem `is_sponsored`: prowizja jest korzyścią
          majątkową i podlega ujawnieniu także w materiale, za który nikt nie
          zapłacił (dyr. 2005/29/WE art. 7 ust. 2). Ukrycie tego przełącznika pod
          flagą sponsoringu zamknęłoby drogę do zgodnego oznaczenia takiej
          sytuacji. */}
      <label className="flex items-start gap-3 rounded-md border border-border p-3">
        <Switch
          checked={form.sponsored_affiliate}
          onCheckedChange={(next) => onPatch({ sponsored_affiliate: next })}
          aria-label={t("adminPostPanes.sponsored.affiliateLabel")}
        />
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">
            {t("adminPostPanes.sponsored.affiliateLabel")}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            {t("adminPostPanes.sponsored.affiliateHint")}
          </span>
        </span>
      </label>

      {form.sponsored_marked_at && (
        <p className="text-[11px] text-muted-foreground">
          {t("adminPostPanes.sponsored.markedBy", {
            when: new Date(form.sponsored_marked_at).toLocaleString(lang),
          })}
        </p>
      )}

      {(form.is_sponsored || form.sponsored_affiliate) && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("adminPostPanes.sponsored.previewHeading")}
          </p>
          <SponsoredDisclosure post={form} lang={lang} className="mb-0" />
        </div>
      )}
    </div>
  );
}
