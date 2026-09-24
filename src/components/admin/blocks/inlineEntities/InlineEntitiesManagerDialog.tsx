// Menedżer encji inline materiału: lista firm i osób z licznikiem użyć,
// edycja (zmienia wszystkie wystąpienia naraz) i usuwanie rekordów, do których
// nie prowadzi już żadne odwołanie w treści (PL ani EN).

import { useTranslation } from "react-i18next";
import { Building2, Pencil, Trash2, UserRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { buildAvatarSrc } from "@/lib/cropSizes";
import {
  inlineEntityDisplayName,
  inlineEntityInitials,
  pickLocalized,
  type InlineEntity,
  type InlineEntityLang,
} from "@/lib/blocks/inlineEntities/model";
import "@/lib/i18n-admin-blocks";

interface Props {
  open: boolean;
  entities: Readonly<Record<string, InlineEntity>>;
  usage: ReadonlyMap<string, number>;
  lang: InlineEntityLang;
  onOpenChange: (open: boolean) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

function subtitle(entity: InlineEntity, lang: InlineEntityLang): string {
  if (entity.kind === "company") {
    return [pickLocalized(entity.industry, lang), entity.country?.[lang]]
      .filter(Boolean)
      .join(" · ");
  }
  return [pickLocalized(entity.position, lang), entity.company].filter(Boolean).join(" · ");
}

export function InlineEntitiesManagerDialog({
  open,
  entities,
  usage,
  lang,
  onOpenChange,
  onEdit,
  onRemove,
}: Props) {
  const { t } = useTranslation();
  const list = Object.values(entities).sort((a, b) =>
    inlineEntityDisplayName(a).localeCompare(inlineEntityDisplayName(b), lang),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[6px] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("blocks.inlineEntity.manager.title")}</DialogTitle>
          <DialogDescription>{t("blocks.inlineEntity.manager.description")}</DialogDescription>
        </DialogHeader>
        {list.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">
            {t("blocks.inlineEntity.manager.empty")}
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {list.map((entity) => {
              const count = usage.get(entity.id) ?? 0;
              const name = inlineEntityDisplayName(entity);
              const KindIcon = entity.kind === "company" ? Building2 : UserRound;
              return (
                <li
                  key={entity.id}
                  className="flex items-center gap-3 rounded-[6px] border border-border px-3 py-2"
                >
                  {entity.image?.src ? (
                    <img
                      alt=""
                      src={buildAvatarSrc(entity.image.src, 32)}
                      width={32}
                      height={32}
                      className="size-8 shrink-0 rounded-[6px] object-cover ring-1 ring-foreground/10"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-muted text-xs font-semibold text-muted-foreground"
                    >
                      {inlineEntityInitials(entity)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="m-0 flex items-center gap-1.5 truncate text-sm font-medium">
                      <KindIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      {name}
                    </p>
                    <p className="m-0 truncate text-xs text-muted-foreground">
                      {subtitle(entity, lang)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-[6px] bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                    {count > 0
                      ? t("blocks.inlineEntity.manager.uses", { count })
                      : t("blocks.inlineEntity.manager.unused")}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={`${t("blocks.inlineEntity.manager.edit")}: ${name}`}
                    title={t("blocks.inlineEntity.manager.edit")}
                    onClick={() => onEdit(entity.id)}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 text-destructive hover:text-destructive"
                    disabled={count > 0}
                    aria-label={`${t("blocks.inlineEntity.manager.remove")}: ${name}`}
                    title={
                      count > 0
                        ? t("blocks.inlineEntity.manager.removeBlocked")
                        : t("blocks.inlineEntity.manager.remove")
                    }
                    onClick={() => onRemove(entity.id)}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("blocks.inlineEntity.manager.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
