// Renumeracja `sort_order` po przesunięciu wiersza w panelu redakcyjnym.
//
// Reguła, nie komponent: dotyczy każdej listy porządkowanej ręcznie w panelu
// (segmenty cennika, pytania FAQ, powody rezygnacji), a jej poprawność widać
// wyłącznie po skutku w bazie. Mieszkała w pliku trasy `/admin/pricing`, więc
// nie dała się przetestować bez renderowania całego panelu.
//
// Zapisujemy TYLKO wiersze, których docelowa pozycja faktycznie się zmieniła -
// przy dwudziestu segmentach przesunięcie jednego to jeden lub dwa UPDATE-y,
// nie dwadzieścia.
import { supabase } from "@/integrations/supabase/client";

export type OrderedTable = "pricing_audiences" | "pricing_faq_items" | "retention_reasons";

/** Renumeracja sort_order po przesunięciu - aktualizuje tylko zmienione wiersze. */
export async function persistOrder(
  table: OrderedTable,
  rows: { id: string; sort_order: number }[],
  moved: { fromIndex: number; toIndex: number },
): Promise<void> {
  const next = rows.slice();
  const [row] = next.splice(moved.fromIndex, 1);
  next.splice(moved.toIndex, 0, row);
  for (let i = 0; i < next.length; i += 1) {
    const target = i * 10;
    if (next[i].sort_order === target) continue;
    const { error } = await supabase
      .from(table)
      .update({ sort_order: target })
      .eq("id", next[i].id);
    if (error) throw error;
  }
}
