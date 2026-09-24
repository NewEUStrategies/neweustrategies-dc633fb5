// Widok węzła encji inline w kanwie edytora - WYSIWYG z publikacją.
//
// Te same klasy co znacznik publiczny (`INLINE_ENTITY_CLASSES`), awatar 6 px
// i nazwa z linią pod spodem. Dane czyta z rejestru dokumentu przez kontekst,
// więc edycja encji w jednym miejscu natychmiast odświeża każde jej wystąpienie
// (także wklejone kopie). Klik otwiera wspólne okno edycji.

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { buildAvatarSrc, buildAvatarSrcSet } from "@/lib/cropSizes";
import { INLINE_AVATAR_PX, INLINE_ENTITY_CLASSES } from "@/lib/blocks/inlineEntities/expand";
import {
  inlineEntityDisplayName,
  inlineEntityInitials,
  type InlineEntityKind,
} from "@/lib/blocks/inlineEntities/model";
import { INLINE_ENTITY_ATTR } from "@/lib/blocks/inlineEntities/registry";
import { cn } from "@/lib/utils";
import { useInlineEntities } from "./InlineEntitiesContext";
import "@/lib/i18n-admin-blocks";

export function InlineEntityNodeView({ node, selected }: NodeViewProps) {
  const { t } = useTranslation();
  const ctx = useInlineEntities();
  const id = typeof node.attrs.id === "string" ? node.attrs.id : "";
  const kind: InlineEntityKind = node.attrs.kind === "person" ? "person" : "company";
  const label = String(node.attrs.label ?? "");
  const entity = id ? ctx?.entities[id] : undefined;

  const open = () => {
    if (!ctx || !id) return;
    ctx.openEditor({ mode: "edit", id, fallback: { kind, label } });
  };

  const wrapperProps = { [INLINE_ENTITY_ATTR]: id, "data-nes-entity-kind": kind };

  if (!entity) {
    return (
      <NodeViewWrapper as="span" className={INLINE_ENTITY_CLASSES.root} {...wrapperProps}>
        <span
          role="button"
          tabIndex={-1}
          onClick={open}
          title={t("blocks.inlineEntity.missing")}
          className={cn(
            INLINE_ENTITY_CLASSES.static,
            "cursor-pointer rounded-[0.3em] border-b border-dashed border-amber-500 text-amber-700 dark:text-amber-300",
            selected && "ring-2 ring-ring ring-offset-1",
          )}
        >
          <AlertTriangle aria-hidden="true" className="size-[1em] shrink-0" />
          <span>{label || id}</span>
        </span>
      </NodeViewWrapper>
    );
  }

  const src = entity.image?.src;
  const srcSet = src ? buildAvatarSrcSet(src, INLINE_AVATAR_PX) : "";
  return (
    <NodeViewWrapper as="span" className={INLINE_ENTITY_CLASSES.root} {...wrapperProps}>
      <span
        role="button"
        tabIndex={-1}
        aria-expanded={selected}
        onClick={open}
        title={t("blocks.inlineEntity.editHint")}
        className={cn(
          INLINE_ENTITY_CLASSES.trigger,
          selected && "ring-2 ring-ring ring-offset-1 ring-offset-background",
        )}
      >
        {src ? (
          <img
            alt=""
            className={INLINE_ENTITY_CLASSES.avatar}
            decoding="async"
            draggable={false}
            height={INLINE_AVATAR_PX}
            src={buildAvatarSrc(src, INLINE_AVATAR_PX)}
            srcSet={srcSet || undefined}
            width={INLINE_AVATAR_PX}
          />
        ) : (
          <span aria-hidden="true" className={INLINE_ENTITY_CLASSES.initials}>
            {inlineEntityInitials(entity)}
          </span>
        )}
        <span className={INLINE_ENTITY_CLASSES.name}>{inlineEntityDisplayName(entity)}</span>
      </span>
    </NodeViewWrapper>
  );
}
