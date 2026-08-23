// Atomy: kafel statystyki gifting i jego szkielet.
//
// Liczba idzie przez `toLocaleString()` (separator tysięcy zgodny z językiem
// środowiska), a szkielet ma DOKŁADNIE tę samą wysokość co kafel - inaczej
// dojechanie odpowiedzi przeskakiwałoby układem pod kursorem admina.
export function GiftStatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[6px] border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">{value.toLocaleString()}</div>
    </div>
  );
}

export function GiftStatSkeleton() {
  return <div className="h-20 rounded-[6px] border border-border bg-muted/30 animate-pulse" />;
}
