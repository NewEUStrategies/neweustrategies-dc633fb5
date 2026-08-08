// Pasek liczników nad listą klubów.
//
// Liczby liczą się z tego, co RPC już zwróciło - świadomie nie ma tu drugiego
// zapytania. Licznik, który wymaga własnego round-tripu, mówi to samo co suma
// widocznych wierszy, tylko chwilę później i czasem inaczej.
import { useTranslation } from "react-i18next";
import { Layers, MessagesSquare, Users2 } from "lucide-react";

export interface ClubStatSource {
  member_count: number;
  thread_count: number;
  my_status: string | null;
}

export function ClubStatStrip({ clubs }: { clubs: readonly ClubStatSource[] }) {
  const { t } = useTranslation();

  const mine = clubs.filter((c) => c.my_status === "active").length;
  const threads = clubs.reduce((sum, c) => sum + c.thread_count, 0);
  // Suma członków po klubach LICZY OSOBY WIELOKROTNIE, jeśli ktoś należy do
  // dwóch. Dlatego etykieta mówi "miejsc w klubach", a nie "osób" - liczba
  // jest prawdziwa dla tego, co opisuje, i nie udaje niczego więcej.
  const seats = clubs.reduce((sum, c) => sum + c.member_count, 0);

  return (
    // Trzy kolumny dopiero od `sm`. Na 360 px trzy kafle po ~110 px ucinały
    // etykiety ("Wątk...", "Miejsc w klu..."), a `truncate` zamieniało to
    // w wielokropek zamiast w informację. Reszta repo skaluje paski liczników
    // tak samo: grid-cols-1/2 -> więcej dopiero wyżej.
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
      <Stat
        icon={<Layers className="h-4 w-4" />}
        label={t("club.hub.statClubs")}
        value={clubs.length}
        hint={t("club.hub.statMine", { count: mine })}
      />
      <Stat
        icon={<MessagesSquare className="h-4 w-4" />}
        label={t("club.hub.statThreads")}
        value={threads}
      />
      <Stat icon={<Users2 className="h-4 w-4" />} label={t("club.hub.statSeats")} value={seats} />
    </dl>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-card p-3">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span className="min-w-0 truncate">{label}</span>
      </dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums leading-none">{value}</dd>
      {hint !== undefined ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
