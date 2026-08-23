// Molekuła: wiersze zastępcze tabeli gifting - "w locie" i "pusto".
//
// Przed ekstrakcją stały zduplikowane w dwóch tabelach (linki, audyt) z innym
// colSpan. Decyzja, którą tu domykamy: stan wczytywania i stan pustki to DWA
// RÓŻNE komunikaty i NIGDY nie pojawiają się razem - pusta lista w locie nie
// ma prawa powiedzieć "brak wyników".
export function GiftTableState({
  isLoading,
  isEmpty,
  colSpan,
  loadingLabel,
  emptyLabel,
}: {
  isLoading: boolean;
  isEmpty: boolean;
  colSpan: number;
  loadingLabel: string;
  emptyLabel: string;
}) {
  return (
    <>
      {isLoading && (
        <tr>
          <td colSpan={colSpan} className="px-3 py-6 text-center text-muted-foreground">
            {loadingLabel}
          </td>
        </tr>
      )}
      {!isLoading && isEmpty && (
        <tr>
          <td colSpan={colSpan} className="px-3 py-6 text-center text-muted-foreground">
            {emptyLabel}
          </td>
        </tr>
      )}
    </>
  );
}
