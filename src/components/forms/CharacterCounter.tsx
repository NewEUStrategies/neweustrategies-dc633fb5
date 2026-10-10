export function CharacterCounter({ count, limit, lang, id }: {
  count: number;
  limit: number;
  lang: "pl" | "en";
  id?: string;
}) {
  return (
    <p id={id} className={`mt-1 text-end text-xs tabular-nums ${count > limit ? "text-destructive" : "text-muted-foreground"}`}>
      {count.toLocaleString(lang)} / {limit.toLocaleString(lang)} {lang === "pl" ? "znaków" : "characters"}
    </p>
  );
}