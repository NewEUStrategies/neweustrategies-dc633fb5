import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Trash2, Plus, Search } from "@/lib/lucide-shim";
import { normalize, type Gender } from "@/lib/greetings/greetings";

export const Route = createFileRoute("/admin/names")({
  component: AdminNamesPage,
});

interface NameRow {
  id: string;
  name: string;
  name_normalized: string;
  gender: Gender;
  origin_country: string | null;
  vocative_pl: string | null;
  vocative_en: string | null;
  notes: string | null;
}

const COUNTRIES: { code: string; pl: string; en: string }[] = [
  { code: "PL", pl: "Polska", en: "Poland" },
  { code: "US", pl: "USA", en: "USA" },
  { code: "GB", pl: "Wielka Brytania", en: "United Kingdom" },
  { code: "DE", pl: "Niemcy", en: "Germany" },
  { code: "FR", pl: "Francja", en: "France" },
  { code: "IT", pl: "Włochy", en: "Italy" },
  { code: "ES", pl: "Hiszpania", en: "Spain" },
  { code: "UA", pl: "Ukraina", en: "Ukraine" },
  { code: "CZ", pl: "Czechy", en: "Czechia" },
  { code: "SK", pl: "Słowacja", en: "Slovakia" },
  { code: "LT", pl: "Litwa", en: "Lithuania" },
  { code: "BY", pl: "Białoruś", en: "Belarus" },
  { code: "RU", pl: "Rosja", en: "Russia" },
  { code: "OTHER", pl: "Inny", en: "Other" },
];

function AdminNamesPage() {
  const { isSuperAdmin, loading } = useAuth();
  const { i18n, t } = useTranslation();
  const lang: "pl" | "en" = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";

  const [rows, setRows] = useState<NameRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [filterGender, setFilterGender] = useState<"all" | Gender>("all");
  const [filterCountry, setFilterCountry] = useState<string>("all");

  // Draft for the "Add" form.
  const [draft, setDraft] = useState({
    name: "", gender: "male" as Gender, origin_country: "PL",
    vocative_pl: "", vocative_en: "",
  });

  useEffect(() => {
    if (!isSuperAdmin) return;
    void load();
  }, [isSuperAdmin]);

  const load = async () => {
    setBusy(true);
    const { data, error } = await supabase
      .from("name_dictionary")
      .select("id, name, name_normalized, gender, origin_country, vocative_pl, vocative_en, notes")
      .order("name", { ascending: true });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setRows((data ?? []) as NameRow[]);
  };

  const filtered = useMemo(() => rows.filter((r) => {
    if (filterGender !== "all" && r.gender !== filterGender) return false;
    if (filterCountry !== "all" && (r.origin_country ?? "") !== filterCountry) return false;
    if (query.trim() && !r.name_normalized.includes(normalize(query))) return false;
    return true;
  }), [rows, filterGender, filterCountry, query]);

  const addOne = async () => {
    const name = draft.name.trim();
    if (!name) { toast.error(lang === "pl" ? "Podaj imię" : "Enter a name"); return; }
    setBusy(true);
    const { error } = await supabase.from("name_dictionary").insert({
      name,
      name_normalized: normalize(name),
      gender: draft.gender,
      origin_country: draft.origin_country,
      vocative_pl: draft.vocative_pl.trim() || null,
      vocative_en: draft.vocative_en.trim() || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setDraft({ name: "", gender: draft.gender, origin_country: draft.origin_country, vocative_pl: "", vocative_en: "" });
    toast.success(lang === "pl" ? "Dodano" : "Added");
    void load();
  };

  const updateRow = async (id: string, patch: Partial<NameRow>) => {
    const { error } = await supabase.from("name_dictionary").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, ...patch } : r));
  };

  const deleteRow = async (id: string) => {
    const { error } = await supabase.from("name_dictionary").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setRows((rs) => rs.filter((r) => r.id !== id));
  };

  if (loading) return null;
  if (!isSuperAdmin) return <Navigate to="/admin" />;

  const L = lang === "pl";

  return (
    <AdminShell>
      <div className="space-y-5 max-w-6xl">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">{L ? "Słownik imion" : "Name dictionary"}</h1>
            <p className="text-sm text-muted-foreground">
              {L
                ? "Imiona, płeć, kraj pochodzenia i formy wołacza. Używane do personalizowanych powitań."
                : "Names, gender, country of origin and vocative forms. Powers personalized greetings."}
            </p>
          </div>
          <Badge variant="secondary">{rows.length}</Badge>
        </div>

        {/* Add */}
        <Card>
          <CardHeader><CardTitle className="text-base">{L ? "Dodaj imię" : "Add a name"}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
              <div className="md:col-span-2">
                <Label>{L ? "Imię" : "Name"}</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={L ? "np. Aleksander" : "e.g. Alexander"} />
              </div>
              <div>
                <Label>{L ? "Płeć" : "Gender"}</Label>
                <Select value={draft.gender} onValueChange={(v) => setDraft({ ...draft, gender: v as Gender })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">{L ? "Męskie" : "Male"}</SelectItem>
                    <SelectItem value="female">{L ? "Żeńskie" : "Female"}</SelectItem>
                    <SelectItem value="neutral">{L ? "Neutralne" : "Neutral"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{L ? "Kraj" : "Country"}</Label>
                <Select value={draft.origin_country} onValueChange={(v) => setDraft({ ...draft, origin_country: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{L ? c.pl : c.en}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{L ? "Wołacz PL" : "Vocative PL"}</Label>
                <Input value={draft.vocative_pl} onChange={(e) => setDraft({ ...draft, vocative_pl: e.target.value })} placeholder={L ? "Aleksandrze" : "—"} />
              </div>
              <div>
                <Label>{L ? "Forma EN" : "Vocative EN"}</Label>
                <Input value={draft.vocative_en} onChange={(e) => setDraft({ ...draft, vocative_en: e.target.value })} placeholder="Alexander" />
              </div>
              <div className="md:col-span-6 flex justify-end">
                <Button onClick={addOne} disabled={busy}><Plus className="w-4 h-4 mr-2" />{L ? "Dodaj" : "Add"}</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={L ? "Szukaj imienia" : "Search names"}
                  className="pl-9"
                />
              </div>
              <Select value={filterGender} onValueChange={(v) => setFilterGender(v as "all" | Gender)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{L ? "Wszystkie płcie" : "All genders"}</SelectItem>
                  <SelectItem value="male">{L ? "Męskie" : "Male"}</SelectItem>
                  <SelectItem value="female">{L ? "Żeńskie" : "Female"}</SelectItem>
                  <SelectItem value="neutral">{L ? "Neutralne" : "Neutral"}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterCountry} onValueChange={setFilterCountry}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{L ? "Wszystkie kraje" : "All countries"}</SelectItem>
                  {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{L ? c.pl : c.en}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="text-sm text-muted-foreground self-center">
                {L ? "Wyświetlono" : "Showing"}: <strong>{filtered.length}</strong>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left p-3">{L ? "Imię" : "Name"}</th>
                  <th className="text-left p-3">{L ? "Płeć" : "Gender"}</th>
                  <th className="text-left p-3">{L ? "Kraj" : "Country"}</th>
                  <th className="text-left p-3">{L ? "Wołacz PL" : "Vocative PL"}</th>
                  <th className="text-left p-3">{L ? "Forma EN" : "Vocative EN"}</th>
                  <th className="p-3 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/20">
                    <td className="p-2 font-medium">{r.name}</td>
                    <td className="p-2">
                      <Select value={r.gender} onValueChange={(v) => void updateRow(r.id, { gender: v as Gender })}>
                        <SelectTrigger className="h-8 w-[120px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="male">{L ? "Męskie" : "Male"}</SelectItem>
                          <SelectItem value="female">{L ? "Żeńskie" : "Female"}</SelectItem>
                          <SelectItem value="neutral">{L ? "Neutralne" : "Neutral"}</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-2">
                      <Select
                        value={r.origin_country ?? "OTHER"}
                        onValueChange={(v) => void updateRow(r.id, { origin_country: v })}
                      >
                        <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{L ? c.pl : c.en}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-2">
                      <Input
                        defaultValue={r.vocative_pl ?? ""}
                        className="h-8"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (r.vocative_pl ?? "")) void updateRow(r.id, { vocative_pl: v || null });
                        }}
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        defaultValue={r.vocative_en ?? ""}
                        className="h-8"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (r.vocative_en ?? "")) void updateRow(r.id, { vocative_en: v || null });
                        }}
                      />
                    </td>
                    <td className="p-2 text-right">
                      <Button size="icon" variant="ghost" onClick={() => void deleteRow(r.id)} aria-label={t("admin.users.delete") || "Delete"}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">{L ? "Brak wyników" : "No results"}</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
