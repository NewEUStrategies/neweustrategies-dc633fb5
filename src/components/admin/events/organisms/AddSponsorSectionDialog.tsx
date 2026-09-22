// Organizm: dwuetapowe okno „Dodaj sekcję" - wybór Baner / Siatka logo, potem tytuł.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Image as ImageIcon, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SponsorSectionLayout } from "@/lib/events/sponsorBoardApi";
import "@/lib/i18n-admin-event-sponsor-board";

export interface NewSectionInput {
  layout: SponsorSectionLayout;
  namePl: string;
  nameEn: string;
}

export function AddSponsorSectionDialog({
  open,
  onOpenChange,
  isSaving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSaving: boolean;
  onSubmit: (input: NewSectionInput) => void;
}) {
  const { t } = useTranslation();
  const [layout, setLayout] = useState<SponsorSectionLayout | null>(null);
  const [namePl, setNamePl] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLayout(null);
    setNamePl("");
    setNameEn("");
    setTouched(false);
  }, [open]);

  const invalid = namePl.trim() === "" && nameEn.trim() === "";

  const options: Array<{ key: SponsorSectionLayout; Icon: typeof ImageIcon }> = [
    { key: "banner", Icon: ImageIcon },
    { key: "grid", Icon: LayoutGrid },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {layout !== null ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setLayout(null)}
                aria-label={t("sponsorBoard.add.back")}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </Button>
            ) : null}
            <DialogTitle>
              {layout === null
                ? t("sponsorBoard.add.title")
                : t(
                    layout === "banner"
                      ? "sponsorBoard.add.bannerTitle"
                      : "sponsorBoard.add.gridTitle",
                  )}
            </DialogTitle>
          </div>
          <DialogDescription className={layout === null ? "sr-only" : undefined}>
            {t("sponsorBoard.add.hintNext")}
          </DialogDescription>
        </DialogHeader>

        {layout === null ? (
          <ul className="space-y-2">
            {options.map(({ key, Icon }) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setLayout(key)}
                  className="flex w-full items-start gap-4 rounded-lg p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block font-semibold">
                      {t(
                        key === "banner"
                          ? "sponsorBoard.add.bannerTitle"
                          : "sponsorBoard.add.gridTitle",
                      )}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {t(
                        key === "banner"
                          ? "sponsorBoard.add.bannerDesc"
                          : "sponsorBoard.add.gridDesc",
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (invalid) return;
              onSubmit({
                layout,
                namePl: namePl.trim() || nameEn.trim(),
                nameEn: nameEn.trim() || namePl.trim(),
              });
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="section-title-pl">{t("sponsorBoard.add.titlePl")}</Label>
              <Input
                id="section-title-pl"
                value={namePl}
                placeholder={t("sponsorBoard.add.titlePlaceholderPl")}
                onChange={(e) => setNamePl(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="section-title-en">{t("sponsorBoard.add.titleEn")}</Label>
              <Input
                id="section-title-en"
                value={nameEn}
                placeholder={t("sponsorBoard.add.titlePlaceholderEn")}
                onChange={(e) => setNameEn(e.target.value)}
                maxLength={120}
              />
            </div>
            {touched && invalid ? (
              <p className="text-xs text-destructive" role="alert">
                {t("sponsorBoard.add.titleRequired")}
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" disabled={isSaving}>
                {t(
                  layout === "banner"
                    ? "sponsorBoard.add.submitBanner"
                    : "sponsorBoard.add.submitGrid",
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
