// Metering GOŚCIA - jedyna droga, którą niezalogowany czytelnik konsumuje
// darmowy limit "N artykułów / miesiąc" (audyt billingowy SUB-17).
//
// Klient nie podaje żadnej tożsamości: identyfikator gościa żyje w cookie
// HttpOnly z podpisem HMAC, najemca wynika z zaufanego hosta, a adres - z
// jedynej definicji „kto dzwoni"; baza (funkcje tylko dla `service_role`)
// liczy limit gościa i sufit adresu pod blokadą per podmiot. Szczegóły:
// `src/lib/access/meteringVisitor.server.ts`.
//
// POST, nie GET: konsumpcja jest efektem ubocznym (slot limitu + Set-Cookie),
// więc odpowiedź nie może trafić do cache'a, a prefetch/boty nie mogą jej
// odpalić odnośnikiem.
//
// Moduł zawiera WYŁĄCZNIE deklaracje server functions + importy (wymóg
// tss-serverfn-split); moduł serwerowy ładuje handler dynamicznie.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const consumeSchema = z.object({
  entityType: z.enum(["post", "page"]),
  entityId: z.string().uuid(),
});

/** Konsumpcja slotu gościa dla bytu (albo werdykt odmowy z pełnym stanem licznika). */
export const consumeMeteredVisitorView = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => consumeSchema.parse(data))
  .handler(async ({ data }) => {
    const { consumeVisitorView } = await import("@/lib/access/meteringVisitor.server");
    return consumeVisitorView(data.entityType, data.entityId);
  });

/** Stan miesięcznego limitu gościa bez konsumpcji (licznik "zostało N"). */
export const getMeteredVisitorQuota = createServerFn({ method: "POST" }).handler(async () => {
  const { visitorQuota } = await import("@/lib/access/meteringVisitor.server");
  return visitorQuota();
});
