// Molecule: panel "Powiązane elementy" - jedna karta dla wszystkich modułów
// czytająca graf cross_references przez useLinkedItems (etykiety rozwiązane
// w bazie, zero joinów po stronie klienta). Używana w panelach admina
// (lead CRM, edytory); responsywna lista, ikony wg typu encji.
import "@/lib/i18n-cohesion";
import type { ComponentType, SVGProps } from "react";
import { useTranslation } from "react-i18next";
import { AppLink } from "@/components/atoms/AppLink";
import {
  FileText,
  Link as LinkIcon,
  Mail,
  Newspaper,
  Pencil,
  Quote,
  Send,
  User,
  UserPlus,
} from "@/lib/lucide-shim";
import {
  linkedItemHref,
  useLinkedItems,
  useLinkedItemsRealtime,
  type LinkedItem,
  type LinkedItemType,
} from "@/lib/links/useLinkedItems";
import { cn } from "@/lib/utils";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const TYPE_ICONS: Record<string, IconComponent> = {
  post: Newspaper,
  page: FileText,
  comment: Quote,
  crm_lead: UserPlus,
  crm_note: Pencil,
  profile: User,
  message: Send,
  newsletter_subscriber: Mail,
};

export interface LinkedItemsCardProps {
  itemType: LinkedItemType;
  itemId: string | null | undefined;
  className?: string;
  /** Ogranicz liczbę pozycji (domyślnie 20). */
  limit?: number;
}

function typeLabelKey(itemType: string): string {
  return TYPE_ICONS[itemType] ? `cohesion.linked.type.${itemType}` : "cohesion.linked.type.unknown";
}

function relationLabelKey(relation: string): string | null {
  return relation === "mention" || relation === "belongs_to" || relation === "related"
    ? `cohesion.linked.relation.${relation}`
    : null;
}

function LinkedItemRow({ item }: { item: LinkedItem }) {
  const { t } = useTranslation();
  const Icon = TYPE_ICONS[item.itemType] ?? LinkIcon;
  const href = linkedItemHref(item);
  const relationKey = relationLabelKey(item.relation);

  const body = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-muted-foreground">{t(typeLabelKey(item.itemType))}:</span>{" "}
        <span className="font-medium">{item.label ?? item.itemId.slice(0, 8)}</span>
      </span>
      {relationKey && (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {t(relationKey)}
        </span>
      )}
    </>
  );

  const rowClass = "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs";
  if (href) {
    return (
      <li>
        <AppLink href={href} className={cn(rowClass, "hover:bg-muted/60")}>
          {body}
        </AppLink>
      </li>
    );
  }
  return <li className={rowClass}>{body}</li>;
}

export function LinkedItemsCard({ itemType, itemId, className, limit = 20 }: LinkedItemsCardProps) {
  const { t } = useTranslation();
  const q = useLinkedItems(itemType, itemId);
  useLinkedItemsRealtime();

  const items = (q.data ?? []).slice(0, limit);

  return (
    <section
      aria-label={t("cohesion.linked.title")}
      className={cn("rounded-lg border bg-card p-3", className)}
    >
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
        {t("cohesion.linked.title")}
        {items.length > 0 && (
          <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
            {items.length}
          </span>
        )}
      </h3>
      {q.isError ? (
        <p className="px-2 py-1.5 text-xs text-destructive">{t("cohesion.linked.loadError")}</p>
      ) : items.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          {q.isLoading ? "..." : t("cohesion.linked.empty")}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((item) => (
            <LinkedItemRow key={`${item.referenceId}:${item.direction}`} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}
