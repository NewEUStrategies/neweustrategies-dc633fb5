// Kontrakt renderowania bloków (atomic design).
//
// Monolityczny `switch` w BlocksRenderer został zastąpiony rejestrem
// `Record<BlockType, BlockRenderer>`. Każdy renderer to czysta funkcja
// przyjmująca jeden, w pełni otypowany kontekst - dzięki temu warstwy atoms /
// molecules / organisms nie muszą znać się nawzajem, a dyspozytor (BlockView)
// jest jedynym miejscem, które woła hooki i liczy wspólne wartości (align,
// widoczność, tłumaczenia). Zero `any` / `as any`.

import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import type { Block } from "@/lib/blocks/types";

/** Obsługiwane języki treści publicznej. */
export type BlockLang = "pl" | "en";

/**
 * Kontekst przekazywany do każdego renderera bloku. Jest niemutowalny w obrębie
 * pojedynczego renderu i w pełni otypowany - renderery nie sięgają po globalny
 * stan ani nie wołają hooków (robi to wyłącznie dyspozytor BlockView).
 */
export interface BlockRenderContext {
  /** Aktualnie renderowany blok. */
  readonly block: Block;
  /** Klasy wyrównania wyliczone raz przez dyspozytora (alignClass). */
  readonly cls: string;
  /**
   * Wstępnie policzone HTML-e z rozwiniętymi przypisami [fn]…[/fn], kluczowane
   * konwencją pól (`${id}`, `${id}:text`, `${id}:item:${i}`, …).
   */
  readonly fnHtml: ReadonlyMap<string, string>;
  /** Język treści - trafia do atrybutu `lang` i do widoków zależnych od kopii. */
  readonly lang: BlockLang;
  /** Wymagane przez bloki `liveblog` (subskrypcja realtime per wpis). */
  readonly postId?: string;
  /** Pełna, płaska lista bloków dokumentu - używana m.in. przez spis treści. */
  readonly allBlocks: readonly Block[];
  /** Funkcja tłumaczeń i18next (podąża za językiem trasy). */
  readonly t: TFunction;
  /**
   * Renderuje blok potomny (kolumny / grupy / siatki) przez pełnego dyspozytora,
   * dzięki czemu zagnieżdżona widoczność i wyrównanie działają rekurencyjnie.
   * Klucz React jest nadawany po `block.id`.
   */
  readonly renderChild: (child: Block) => ReactNode;
}

/** Czysta funkcja renderująca pojedynczy typ bloku. */
export type BlockRenderer = (ctx: BlockRenderContext) => ReactNode;
