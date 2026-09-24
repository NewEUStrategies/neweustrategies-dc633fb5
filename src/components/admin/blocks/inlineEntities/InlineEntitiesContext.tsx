// Kontekst encji inline w edytorze bloków.
//
// Rejestr encji (`doc.meta.inlineEntities`) należy do DOKUMENTU, a węzły
// TipTap żyją głęboko w kanwie (także w zagnieżdżeniach kolumn/grup) - kontekst
// daje im dostęp do rejestru i do jednego, wspólnego okna edycji bez
// przewiercania propsów przez każdy blok. Brak providera = funkcja wyłączona
// (inne edytory TipTap w panelu nie pokazują przycisków encji).

import { createContext, useContext } from "react";
import type {
  InlineEntity,
  InlineEntityKind,
  InlineEntityLang,
} from "@/lib/blocks/inlineEntities/model";

export type InlineEntityEditorRequest =
  | {
      mode: "create";
      kind: InlineEntityKind;
      /** Zaznaczony tekst - podpowiedź nazwy. */
      prefillName?: string;
      /** Wywoływane po zapisie - wstawia odwołanie w miejscu kursora. */
      onSaved: (entity: InlineEntity) => void;
    }
  | {
      mode: "edit";
      id: string;
      /** Odwołanie bez rekordu (np. wklejone z innego materiału) - szkic startowy. */
      fallback?: { kind: InlineEntityKind; label: string };
    };

export interface InlineEntitiesContextValue {
  /** Język aktywnego dokumentu (treść), nie język interfejsu. */
  lang: InlineEntityLang;
  entities: Readonly<Record<string, InlineEntity>>;
  /** Liczba odwołań w obu wersjach językowych materiału. */
  usage: ReadonlyMap<string, number>;
  upsert: (entity: InlineEntity) => void;
  remove: (id: string) => void;
  importEntities: (entities: readonly InlineEntity[]) => void;
  openEditor: (request: InlineEntityEditorRequest) => void;
  openManager: () => void;
}

export const InlineEntitiesContext = createContext<InlineEntitiesContextValue | null>(null);

export function useInlineEntities(): InlineEntitiesContextValue | null {
  return useContext(InlineEntitiesContext);
}
