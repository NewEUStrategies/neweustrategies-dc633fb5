// WYWOŁANIE RPC HUBA PRZED DOPISANIEM SYGNATUR DO `types.ts` (SPEC §5.2, N19).
//
// I0 dopisuje do typów bazy wyłącznie tabele i kolumny (wdrażane od razu);
// sygnatury funkcji `admin_revenue_*` / `admin_journey_*` dopisuje I9 po
// wdrożeniu migracji. Do tego czasu `supabase.rpc("<nazwa>")` nie kompiluje
// się z typem `Database`, więc server fns rzutują klienta na ten kształt
// (precedens: `lib/email/reputationGate.server.ts`). Nazwa funkcji zostaje
// LITERAŁEM w wywołaniu - bramka `generate:ts-sql-contract` czyta ją ze źródła
// i sprawdza grant (AGENTS: literalne nazwy RPC z pasującymi grantami).
//
// Moduł czysto typowy: zero wartości w runtime, więc import z niego nie
// zmienia grafu chunków.
export type RpcCallable = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};
