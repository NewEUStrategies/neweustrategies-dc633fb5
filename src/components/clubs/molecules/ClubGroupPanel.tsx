// Molekuła: panel wybranego działu klubu.
//
// PO CO. Kliknięcie działu zmieniało dotąd tylko listę wątków - bez żadnego
// potwierdzenia, gdzie użytkownik właściwie jest i co ten dział zawiera.
// Panel odpowiada na cztery pytania naraz i rozróżnia cztery byty, które
// wcześniej wyglądały identycznie: PODGRUPY (nawigacja w dół), TEMAT
// (klasyfikacja), DOKUMENTY (materiały) i WĄTKI (rozmowa).
//
// Akcent działu wchodzi delikatnie: cienki pasek u góry i 8-procentowa
// podkładka nagłówka. Reszta karty zostaje w tokenach serwisu.
import { useTranslation } from "react-i18next";
import { uiLang } from "@/lib/i18n/format";
import { FileText, MessagesSquare, Network, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { HUB_SURFACE } from "@/components/clubs/atoms/ClubHubPrimitives";
import {
  CLUB_GROUP_CHIP_ACTIVE,
  CLUB_GROUP_TINT,
  ClubGroupIcon,
  clubGroupAccentVars,
} from "@/components/clubs/atoms/ClubGroupAccent";
import { clubGroupDescription, clubGroupName } from "@/components/clubs/molecules/ClubGroupTree";
import type { ClubGroupNode } from "@/lib/clubs/groupTree";

function Metric({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof FileText;
  value: number;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2 py-1 text-[11px] sm:text-xs">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

export function ClubGroupPanel({
  node,
  path,
  documentCount,
  onGroupChange,
  className,
}: {
  node: ClubGroupNode;
  path: readonly ClubGroupNode[];
  documentCount: number;
  onGroupChange: (groupId: string | null) => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const { group, depth, children, totalThreads } = node;
  const description = clubGroupDescription(group, lang);
  const ancestors = path.slice(0, -1);

  return (
    <section
      style={clubGroupAccentVars(group.accent_color)}
      className={cn(HUB_SURFACE, "overflow-hidden", className)}
      aria-label={clubGroupName(group, lang)}
    >
      <div className="h-0.5 w-full bg-[color-mix(in_oklab,var(--club-accent)_65%,transparent)]" />
      <div className={cn("space-y-2.5 p-3", CLUB_GROUP_TINT, "border-0")}>
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
              CLUB_GROUP_CHIP_ACTIVE,
            )}
          >
            <ClubGroupIcon icon={group.icon} depth={depth} />
          </span>
          <div className="min-w-0 flex-1">
            {ancestors.length > 0 ? (
              <nav className="mb-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                {ancestors.map((parent) => (
                  <button
                    key={parent.group.id}
                    type="button"
                    onClick={() => onGroupChange(parent.group.id)}
                    className="rounded-lg hover:text-foreground hover:underline"
                  >
                    {clubGroupName(parent.group, lang)}
                  </button>
                ))}
              </nav>
            ) : null}
            <h2 className="truncate text-base font-semibold leading-tight sm:text-lg">
              {clubGroupName(group, lang)}
            </h2>
            {description !== "" ? (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground sm:text-sm">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onGroupChange(null)}
            aria-label={t("club.groupPanel.clear")}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Metric icon={MessagesSquare} value={totalThreads} label={t("club.groupPanel.threads")} />
          <Metric icon={FileText} value={documentCount} label={t("club.groupPanel.documents")} />
          {children.length > 0 ? (
            <Metric icon={Network} value={children.length} label={t("club.groupPanel.subgroups")} />
          ) : null}
        </div>

        {children.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("club.groupPanel.subgroups")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {children.map((child) => (
                <button
                  key={child.group.id}
                  type="button"
                  onClick={() => onGroupChange(child.group.id)}
                  style={clubGroupAccentVars(child.group.accent_color)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors sm:text-xs",
                    CLUB_GROUP_TINT,
                    "hover:bg-[color-mix(in_oklab,var(--club-accent)_16%,transparent)]",
                  )}
                >
                  <ClubGroupIcon
                    icon={child.group.icon}
                    depth={child.depth}
                    className="h-3.5 w-3.5"
                  />
                  {clubGroupName(child.group, lang)}
                  <span className="tabular-nums text-muted-foreground">{child.totalThreads}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
