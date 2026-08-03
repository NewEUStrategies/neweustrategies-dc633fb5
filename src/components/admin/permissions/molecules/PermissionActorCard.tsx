// Molekuła: karta kolumny macierzy - rola systemowa albo warstwa członkostwa.
//
// Karty ról opisują ZAKRES ZAUFANIA (opis z i18n), karty warstw pokazują dane z
// bazy bieżącego obszaru roboczego: nazwę, rangę, znacznik warstwy domyślnej i
// licznik flag, które mają realną bramkę. Ten licznik jest sednem audytu: warstwa
// może obiecywać dziesięć benefitów, a egzekwować dwa.
import { Building2, Crown, PenSquare, Shield, ShieldAlert, ShieldCheck, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { AppLang } from "@/lib/i18n/localePath";
import type { MatrixActor } from "@/lib/authz/permissionMatrix";
import type { AppRole } from "@/lib/authz/roles";

const ROLE_ICON: Readonly<Record<AppRole, typeof Shield>> = {
  super_admin: ShieldAlert,
  admin: ShieldCheck,
  editor: Shield,
  author: PenSquare,
  user: User,
};

const ROLE_TONE: Readonly<Record<AppRole, string>> = {
  super_admin: "border-red-200 dark:border-red-900/70",
  admin: "border-amber-200 dark:border-amber-900/70",
  editor: "border-blue-200 dark:border-blue-900/70",
  author: "border-emerald-200 dark:border-emerald-900/70",
  user: "border-border",
};

function isRoleKey(key: string): key is AppRole {
  return key in ROLE_ICON;
}

export interface PermissionActorCardProps {
  actor: MatrixActor;
  lang: AppLang;
  /** Liczba flag warstwy z realną bramką / wszystkich włączonych (tylko warstwy). */
  enforcedFlags?: { enforced: number; total: number };
}

export function PermissionActorCard({ actor, lang, enforcedFlags }: PermissionActorCardProps) {
  const { t } = useTranslation();
  const isRole = actor.kind === "role";
  const roleKey = isRole && isRoleKey(actor.key) ? actor.key : null;
  const Icon =
    roleKey !== null
      ? ROLE_ICON[roleKey]
      : actor.rank !== null && actor.rank >= 30
        ? Building2
        : Crown;

  const name = isRole
    ? t(`adminPermissions.roles.${actor.key}.name`)
    : ((lang === "en" ? actor.nameEn : actor.namePl) ?? actor.key);

  return (
    <article
      className={cn(
        "flex items-start gap-3 rounded-[6px] border bg-card p-3",
        roleKey !== null ? ROLE_TONE[roleKey] : "border-border",
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border border-border/60 bg-background/60 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="text-sm font-semibold leading-tight">{name}</h3>
          <span className="rounded-full border border-border px-1.5 py-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t(isRole ? "adminPermissions.roleBadge" : "adminPermissions.tierBadge")}
          </span>
          {actor.rank !== null && (
            <span className="rounded-full border border-border px-1.5 py-0 text-[10px] text-muted-foreground">
              {t("adminPermissions.tierRank", { rank: actor.rank })}
            </span>
          )}
          {actor.isDefault && (
            <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0 text-[10px] font-medium text-primary">
              {t("adminPermissions.tierDefaultBadge")}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          {isRole ? (
            t(`adminPermissions.roles.${actor.key}.desc`)
          ) : enforcedFlags !== undefined ? (
            <>
              <span className="font-mono">{actor.key}</span>
              {" - "}
              {t("adminPermissions.kpi.enforced")}: {enforcedFlags.enforced}/{enforcedFlags.total}
            </>
          ) : (
            <span className="font-mono">{actor.key}</span>
          )}
        </p>
      </div>
    </article>
  );
}
