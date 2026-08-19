// Atom: komunikat „ta lista jest pusta" w panelu redakcyjnym.
//
// Cztery identyczne akapity z przerywaną ramką (segmenty, warstwy bez segmentu,
// FAQ, powody rezygnacji) różniły się wyłącznie treścią.
//
// Kontrakt dostępności: `role="status"`. Pusta lista jest ODPOWIEDZIĄ panelu na
// wczytanie danych, a nie ozdobą - osoba korzystająca z czytnika ma usłyszeć,
// że nic tu nie ma, a nie ciszę, którą trudno odróżnić od trwającego zapytania.
export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </p>
  );
}
