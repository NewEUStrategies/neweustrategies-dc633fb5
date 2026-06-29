// Słownik imion - rozszerzony edytor (i18n PL/EN) z polami:
// key, display_name, vocative_pl, instrumental_pl, genitive_pl, dative_pl,
// english_form, gender, is_compound, origin, notes.
// Funkcje: import/eksport CSV (dedupe po `key` z uzupełnianiem brakujących pól),
// nasłuch zmian w czasie rzeczywistym, filtry (gender, origin, search).
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash2, Plus, Search, Download, Upload, Circle as Radio, Loader2 } from "@/lib/lucide-shim";

import { normalize, type Gender } from "@/lib/greetings/greetings";

export const Route = createFileRoute("/admin/names")({
  component: AdminNamesPage,
});

interface NameRow {
  id: string;
  name: string;
  name_normalized: string;
  key: string | null;
  display_name: string | null;
  gender: Gender;
  origin_country: string | null;
  origin: string | null;
  vocative_pl: string | null;
  instrumental_pl: string | null;
  genitive_pl: string | null;
  dative_pl: string | null;
  vocative_en: string | null;
  english_form: string | null;
  is_compound: boolean;
  notes: string | null;
}

type RowPatch = Partial<Omit<NameRow, "id">>;

const SELECT_COLS =
  "id, name, name_normalized, key, display_name, gender, origin_country, origin," +
  " vocative_pl, instrumental_pl, genitive_pl, dative_pl, vocative_en, english_form, is_compound, notes";

const COUNTRIES: { code: string; pl: string; en: string; aliases?: string[] }[] = [
  { code: "PL", pl: "Polska", en: "Poland", aliases: ["polish", "polski", "polskie", "pl", "polonia", "pologne", "polen"] },
  { code: "US", pl: "USA", en: "United States", aliases: ["usa", "us", "u.s.", "u.s.a.", "united states of america", "america", "american", "stany zjednoczone", "stany", "estados unidos"] },
  { code: "GB", pl: "Wielka Brytania", en: "United Kingdom", aliases: ["english", "angielski", "british", "britain", "great britain", "uk", "u.k.", "gb", "england", "anglia", "brytyjski"] },
  { code: "DE", pl: "Niemcy", en: "Germany", aliases: ["german", "niemiecki", "de", "deutschland", "allemagne"] },
  { code: "FR", pl: "Francja", en: "France", aliases: ["french", "francuski", "fr", "francais", "français"] },
  { code: "IT", pl: "Włochy", en: "Italy", aliases: ["italian", "włoski", "wloski", "it", "italia", "italie"] },
  { code: "ES", pl: "Hiszpania", en: "Spain", aliases: ["spanish", "hiszpański", "hiszpanski", "es", "espana", "españa", "espagne"] },
  { code: "PT", pl: "Portugalia", en: "Portugal", aliases: ["portuguese", "portugalski", "pt"] },
  { code: "UA", pl: "Ukraina", en: "Ukraine", aliases: ["ukrainian", "ukraiński", "ukrainski", "ua"] },
  { code: "CZ", pl: "Czechy", en: "Czechia", aliases: ["czech", "czech republic", "czeski", "cz"] },
  { code: "SK", pl: "Słowacja", en: "Slovakia", aliases: ["slovak", "słowacki", "slowacki", "sk"] },
  { code: "LT", pl: "Litwa", en: "Lithuania", aliases: ["lithuanian", "litewski", "lt"] },
  { code: "BY", pl: "Białoruś", en: "Belarus", aliases: ["belarusian", "białoruski", "bialoruski", "by"] },
  { code: "RU", pl: "Rosja", en: "Russia", aliases: ["russian", "rosyjski", "ru", "russian federation"] },
  { code: "GR", pl: "Grecja", en: "Greece", aliases: ["greek", "grecki", "gr", "hellas"] },
  { code: "TR", pl: "Turcja", en: "Turkey", aliases: ["turkish", "turecki", "tr", "türkiye", "turkiye"] },
  { code: "JP", pl: "Japonia", en: "Japan", aliases: ["japanese", "japoński", "japonski", "jp", "nippon"] },
  { code: "CN", pl: "Chiny", en: "China", aliases: ["chinese", "chiński", "chinski", "cn", "prc"] },
  { code: "IN", pl: "Indie", en: "India", aliases: ["hindi", "indian", "indyjski", "in"] },
  { code: "SA", pl: "Arabia Saudyjska", en: "Saudi Arabia", aliases: ["arabic", "arabski", "arab", "sa"] },
  { code: "SE", pl: "Szwecja", en: "Sweden", aliases: ["swedish", "szwedzki", "scandinavian", "skandynawski", "se", "sverige"] },
  { code: "NO", pl: "Norwegia", en: "Norway", aliases: ["norwegian", "norweski", "no", "norge"] },
  { code: "FI", pl: "Finlandia", en: "Finland", aliases: ["finnish", "fiński", "finski", "fi", "suomi"] },
  { code: "DK", pl: "Dania", en: "Denmark", aliases: ["danish", "duński", "dunski", "dk", "danmark"] },
  { code: "NL", pl: "Holandia", en: "Netherlands", aliases: ["dutch", "holenderski", "nl", "holland", "the netherlands", "nederland"] },
  { code: "IE", pl: "Irlandia", en: "Ireland", aliases: ["irish", "irlandzki", "ie", "eire", "éire"] },
  { code: "RO", pl: "Rumunia", en: "Romania", aliases: ["romanian", "rumuński", "rumunski", "ro"] },
  { code: "HU", pl: "Węgry", en: "Hungary", aliases: ["hungarian", "węgierski", "wegierski", "hu", "magyarorszag", "magyarország"] },
  { code: "BG", pl: "Bułgaria", en: "Bulgaria", aliases: ["bulgarian", "bułgarski", "bulgarski", "bg"] },
  { code: "AT", pl: "Austria", en: "Austria", aliases: ["austrian", "austriacki", "at", "österreich", "osterreich"] },
  { code: "CH", pl: "Szwajcaria", en: "Switzerland", aliases: ["swiss", "szwajcarski", "ch", "schweiz", "suisse"] },
  { code: "BE", pl: "Belgia", en: "Belgium", aliases: ["belgian", "belgijski", "be", "belgique", "belgie", "belgië"] },
  { code: "CA", pl: "Kanada", en: "Canada", aliases: ["canadian", "kanadyjski", "ca"] },
  { code: "AU", pl: "Australia", en: "Australia", aliases: ["australian", "australijski", "au"] },
  { code: "BR", pl: "Brazylia", en: "Brazil", aliases: ["brazilian", "brazylijski", "br", "brasil"] },
  { code: "MX", pl: "Meksyk", en: "Mexico", aliases: ["mexican", "meksykański", "meksykanski", "mx", "mejico", "méjico"] },
  { code: "AR", pl: "Argentyna", en: "Argentina", aliases: ["argentinian", "argentyński", "argentynski", "ar"] },
  { code: "KR", pl: "Korea Południowa", en: "South Korea", aliases: ["korean", "koreański", "koreanski", "kr", "korea", "republic of korea"] },
  { code: "VN", pl: "Wietnam", en: "Vietnam", aliases: ["vietnamese", "wietnamski", "vn", "viet nam"] },
  { code: "TH", pl: "Tajlandia", en: "Thailand", aliases: ["thai", "tajski", "th"] },
  { code: "ID", pl: "Indonezja", en: "Indonesia", aliases: ["indonesian", "indonezyjski", "id"] },
  { code: "PH", pl: "Filipiny", en: "Philippines", aliases: ["filipino", "filipiński", "filipinski", "ph"] },
  { code: "ZA", pl: "RPA", en: "South Africa", aliases: ["south african", "południowoafrykański", "za", "rpa"] },
  { code: "EG", pl: "Egipt", en: "Egypt", aliases: ["egyptian", "egipski", "eg"] },
  { code: "IL", pl: "Izrael", en: "Israel", aliases: ["israeli", "izraelski", "hebrew", "hebrajski", "il"] },
  { code: "IR", pl: "Iran", en: "Iran", aliases: ["iranian", "persian", "perski", "ir"] },
  { code: "PK", pl: "Pakistan", en: "Pakistan", aliases: ["pakistani", "pakistański", "pakistanski", "pk", "urdu"] },
  { code: "RS", pl: "Serbia", en: "Serbia", aliases: ["serbian", "serbski", "rs", "srbija", "balkan", "bałkany", "balkany", "balkański", "balkanski"] },
  { code: "OTHER", pl: "Inny", en: "Other", aliases: ["other", "inny"] },
];

// Diacritic + punctuation insensitive normalization for matching.
function normCountry(s: string): string {
  return s.trim().toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Normalize any user/CSV input (country name PL/EN, ISO code, language adjective)
// to canonical { code, label }. Returns null when no match.
function resolveCountry(input: string | null | undefined): { code: string; pl: string; en: string } | null {
  if (!input) return null;
  const q = normCountry(input);
  if (!q) return null;
  for (const c of COUNTRIES) {
    if (normCountry(c.code) === q) return c;
    if (normCountry(c.pl) === q) return c;
    if (normCountry(c.en) === q) return c;
    if (c.aliases?.some((a) => normCountry(a) === q)) return c;
  }
  return null;
}



// CSV columns in canonical order (used for import + export).
const CSV_COLS = [
  "key", "display_name", "vocative", "instrumental", "genitive", "dative",
  "english_form", "gender", "is_compound", "origin", "notes",
] as const;

function csvEscape(v: string): string {
  if (v === "") return "";
  if (/[",\n\r;]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function toCSV(rows: NameRow[]): string {
  const head = CSV_COLS.join(",");
  const body = rows.map((r) => [
    r.key ?? r.name_normalized,
    r.display_name ?? r.name,
    r.vocative_pl ?? "",
    r.instrumental_pl ?? "",
    r.genitive_pl ?? "",
    r.dative_pl ?? "",
    r.english_form ?? r.vocative_en ?? "",
    r.gender,
    r.is_compound ? "true" : "false",
    r.origin ?? r.origin_country ?? "",
    r.notes ?? "",
  ].map((v) => csvEscape(String(v))).join(","));
  return [head, ...body].join("\n");
}

// Minimal CSV parser supporting quoted fields and embedded commas/newlines.
function parseCSV(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); cur = ""; out.push(row); row = [];
      } else { cur += ch; }
    }
  }
  if (cur.length || row.length) { row.push(cur); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim() !== ""));
}

interface CsvParsedRow {
  key: string;
  display_name: string;
  vocative_pl: string | null;
  instrumental_pl: string | null;
  genitive_pl: string | null;
  dative_pl: string | null;
  english_form: string | null;
  gender: Gender;
  is_compound: boolean;
  origin: string | null;
  notes: string | null;
}

function rowFromCsv(headers: string[], cells: string[]): CsvParsedRow | null {
  const get = (h: string) => {
    const idx = headers.indexOf(h);
    return idx >= 0 ? (cells[idx] ?? "").trim() : "";
  };
  const display = get("display_name") || get("name");
  if (!display) return null;
  const rawGender = get("gender").toLowerCase();
  const gender: Gender = rawGender === "female" || rawGender === "f" || rawGender === "ż" || rawGender === "z"
    ? "female"
    : rawGender === "neutral" || rawGender === "n"
      ? "neutral"
      : "male";
  const key = (get("key") || normalize(display)).toLowerCase();
  const truthy = (s: string) => /^(1|true|tak|yes|y|t)$/i.test(s);
  const rawOrigin = get("origin") || get("origin_country") || get("country") || get("kraj") || null;
  const resolved = resolveCountry(rawOrigin);
  return {
    key,
    display_name: display,
    vocative_pl: get("vocative") || get("vocative_pl") || get("wolacz") || get("wołacz") || null,
    instrumental_pl: get("instrumental") || get("instrumental_pl") || get("narzednik") || get("narzędnik") || null,
    genitive_pl: get("genitive") || get("genitive_pl") || get("dopelniacz") || get("dopełniacz") || null,
    dative_pl: get("dative") || get("dative_pl") || get("celownik") || null,
    english_form: get("english_form") || get("vocative_en") || get("english") || null,
    gender,
    is_compound: truthy(get("is_compound")) || truthy(get("compound")) || truthy(get("zlozone")) || truthy(get("złożone")),
    origin: resolved?.code ?? (rawOrigin || null),
    notes: get("notes") || null,
  };
}


function AdminNamesPage() {
  const { isSuperAdmin, loading } = useAuth();
  const { i18n, t } = useTranslation();
  const lang: "pl" | "en" = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const L = lang === "pl";

  const [rows, setRows] = useState<NameRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [filterGender, setFilterGender] = useState<"all" | Gender>("all");
  const [filterCountry, setFilterCountry] = useState<string>("all");
  const [filterCompound, setFilterCompound] = useState<"all" | "yes" | "no">("all");
  const [liveOn, setLiveOn] = useState(false);
  const [importProgress, setImportProgress] = useState<{ total: number; done: number; added: number; merged: number; skipped: number } | null>(null);
  const [preview, setPreview] = useState<{ rows: CsvParsedRow[]; headers: string[]; willAdd: number; willMerge: number; willSkip: number } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);


  const [draft, setDraft] = useState({
    name: "", gender: "male" as Gender, origin_country: "PL",
    vocative_pl: "", english_form: "",
  });

  useEffect(() => {
    if (!isSuperAdmin) return;
    void load();
  }, [isSuperAdmin]);

  // Realtime subscription on name_dictionary so multiple admins / bulk imports
  // surface immediately without manual refresh.
  useEffect(() => {
    if (!isSuperAdmin) return;
    const ch = supabase
      .channel("admin-names")
      .on("postgres_changes", { event: "*", schema: "public", table: "name_dictionary" }, (payload) => {
        setLiveOn(true);
        if (payload.eventType === "INSERT") {
          const r = payload.new as NameRow;
          setRows((rs) => rs.some((x) => x.id === r.id) ? rs : [...rs, r].sort((a, b) => (a.display_name ?? a.name).localeCompare(b.display_name ?? b.name)));
        } else if (payload.eventType === "UPDATE") {
          const r = payload.new as NameRow;
          setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, ...r } : x));
        } else if (payload.eventType === "DELETE") {
          const r = payload.old as NameRow;
          setRows((rs) => rs.filter((x) => x.id !== r.id));
        }
      })
      .subscribe((status) => { if (status === "SUBSCRIBED") setLiveOn(true); });
    return () => { void supabase.removeChannel(ch); };
  }, [isSuperAdmin]);

  const load = async () => {
    setBusy(true);
    const pageSize = 1000;
    const all: NameRow[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("name_dictionary")
        .select(SELECT_COLS)
        .order("name", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) { setBusy(false); toast.error(error.message); return; }
      const chunk = ((data ?? []) as unknown) as NameRow[];
      all.push(...chunk);
      if (chunk.length < pageSize) break;
    }
    setBusy(false);
    setRows(all);
  };

  const filtered = useMemo(() => rows.filter((r) => {
    if (filterGender !== "all" && r.gender !== filterGender) return false;
    if (filterCountry !== "all" && (r.origin_country ?? r.origin ?? "") !== filterCountry) return false;
    if (filterCompound !== "all" && !!r.is_compound !== (filterCompound === "yes")) return false;
    if (query.trim() && !r.name_normalized.includes(normalize(query))) return false;
    return true;
  }), [rows, filterGender, filterCountry, filterCompound, query]);

  const PAGE_SIZE = 100;
  const [page, setPage] = useState(1);
  const [pageChanging, setPageChanging] = useState(false);
  const pageChangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => { setPage(1); }, [query, filterGender, filterCountry, filterCompound]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const goToPage = (next: number | ((p: number) => number)) => {
    setPage((p) => {
      const target = typeof next === "function" ? next(p) : next;
      const clamped = Math.min(totalPages, Math.max(1, target));
      if (clamped === p) return p;
      setPageChanging(true);
      if (pageChangeTimer.current) clearTimeout(pageChangeTimer.current);
      pageChangeTimer.current = setTimeout(() => setPageChanging(false), 320);
      return clamped;
    });
  };
  useEffect(() => () => { if (pageChangeTimer.current) clearTimeout(pageChangeTimer.current); }, []);


  const addOne = async () => {
    const name = draft.name.trim();
    if (!name) { toast.error(L ? "Podaj imię" : "Enter a name"); return; }
    setBusy(true);
    const payload = {
      name,
      name_normalized: normalize(name),
      display_name: name,
      key: normalize(name),
      gender: draft.gender,
      origin_country: draft.origin_country,
      origin: draft.origin_country,
      vocative_pl: draft.vocative_pl.trim() || null,
      english_form: draft.english_form.trim() || null,
      vocative_en: draft.english_form.trim() || null,
    };
    const { error } = await supabase.from("name_dictionary").insert(payload as never);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setDraft({ name: "", gender: draft.gender, origin_country: draft.origin_country, vocative_pl: "", english_form: "" });
    toast.success(L ? "Dodano" : "Added");
  };

  const updateRow = async (id: string, patch: RowPatch) => {
    const { error } = await supabase.from("name_dictionary").update(patch as never).eq("id", id);
    if (error) { toast.error(error.message); return; }
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, ...patch } : r));
  };

  const deleteRow = async (id: string) => {
    const { error } = await supabase.from("name_dictionary").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
  };

  // Export current (filtered) view as CSV so the user can backup or share.
  const exportCsv = () => {
    const csv = toCSV(filtered.length ? filtered : rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `names-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Parse CSV and stage a preview - the user reviews the field mapping
  // (country resolved to ISO, grammatical cases, gender, compound flag) before
  // we touch the database.
  const onImportFile = async (file: File) => {
    const text = await file.text();
    const matrix = parseCSV(text);
    if (!matrix.length) { toast.error(L ? "Pusty plik" : "Empty file"); return; }
    const headers = matrix[0].map((h) => h.trim().toLowerCase());
    const dataRows = matrix.slice(1).map((cells) => rowFromCsv(headers, cells)).filter((x): x is CsvParsedRow => !!x);
    if (!dataRows.length) { toast.error(L ? "Brak prawidłowych wierszy" : "No valid rows"); return; }

    const byKey = new Map(rows.map((r) => [r.key ?? r.name_normalized, r] as const));
    let willAdd = 0, willMerge = 0, willSkip = 0;
    for (const row of dataRows) {
      const existing = byKey.get(row.key);
      if (!existing) { willAdd += 1; continue; }
      const fields: (keyof CsvParsedRow)[] = ["vocative_pl", "instrumental_pl", "genitive_pl", "dative_pl", "english_form", "origin", "notes"];
      const hasNew = fields.some((k) => {
        const v = row[k];
        if (v === null || v === undefined || v === "") return false;
        const ex = (existing as unknown as Record<string, unknown>)[k as string];
        return ex === null || ex === undefined || ex === "";
      });
      if (hasNew) willMerge += 1; else willSkip += 1;
    }
    setPreview({ rows: dataRows, headers, willAdd, willMerge, willSkip });
  };

  // Apply the staged import. Country values are written as canonical ISO codes
  // to both `origin_country` (ISO) and `origin` (kept in sync) so Polish forms
  // ("Polska") match English ("Poland") when we look up existing records.
  const commitImport = async () => {
    if (!preview) return;
    const { rows: dataRows } = preview;
    const byKey = new Map(rows.map((r) => [r.key ?? r.name_normalized, r] as const));
    const prog = { total: dataRows.length, done: 0, added: 0, merged: 0, skipped: 0 };
    setPreview(null);
    setImportProgress({ ...prog });

    for (const row of dataRows) {
      const resolved = resolveCountry(row.origin);
      const iso = resolved?.code ?? row.origin ?? null;
      const existing = byKey.get(row.key);
      if (!existing) {
        const insertPayload = {
          name: row.display_name,
          name_normalized: normalize(row.display_name),
          key: row.key,
          display_name: row.display_name,
          gender: row.gender,
          origin_country: iso,
          origin: iso,
          vocative_pl: row.vocative_pl,
          instrumental_pl: row.instrumental_pl,
          genitive_pl: row.genitive_pl,
          dative_pl: row.dative_pl,
          english_form: row.english_form,
          vocative_en: row.english_form,
          is_compound: row.is_compound,
          notes: row.notes,
        };
        const { error } = await supabase.from("name_dictionary").insert(insertPayload as never);
        if (error) prog.skipped += 1; else prog.added += 1;
      } else {
        const patch: RowPatch = {};
        const setIfMissing = <K extends keyof NameRow>(key: K, val: NameRow[K] | null | undefined) => {
          if (val === null || val === undefined || val === "") return;
          if (existing[key] === null || existing[key] === undefined || existing[key] === "") {
            (patch as Record<string, unknown>)[key as string] = val;
          }
        };
        setIfMissing("vocative_pl", row.vocative_pl);
        setIfMissing("instrumental_pl", row.instrumental_pl);
        setIfMissing("genitive_pl", row.genitive_pl);
        setIfMissing("dative_pl", row.dative_pl);
        setIfMissing("english_form", row.english_form);
        setIfMissing("vocative_en", row.english_form);
        setIfMissing("origin", iso);
        setIfMissing("origin_country", iso);
        setIfMissing("is_compound", row.is_compound ? true : null);
        setIfMissing("notes", row.notes);
        if (Object.keys(patch).length === 0) {
          prog.skipped += 1;
        } else {
          const { error } = await supabase.from("name_dictionary").update(patch as never).eq("id", existing.id);
          if (error) prog.skipped += 1; else prog.merged += 1;
        }
      }
      prog.done += 1;
      setImportProgress({ ...prog });
    }
    toast.success(
      L
        ? `Import: dodano ${prog.added}, uzupełniono ${prog.merged}, pominięto ${prog.skipped}`
        : `Import: added ${prog.added}, merged ${prog.merged}, skipped ${prog.skipped}`,
    );
    setTimeout(() => setImportProgress(null), 4000);

  };

  if (loading) return null;
  if (!isSuperAdmin) return <Navigate to="/admin" />;

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">{L ? "Słownik imion" : "Name dictionary"}</h1>
            <p className="text-sm text-muted-foreground">
              {L
                ? "Imiona z formami gramatycznymi (wołacz, narzędnik, dopełniacz, celownik), płeć, pochodzenie. Używane do personalizacji."
                : "Names with grammatical cases (vocative, instrumental, genitive, dative), gender and origin. Powers personalization."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={liveOn ? "default" : "secondary"} className="gap-1">
              <Radio className={`w-3 h-3 ${liveOn ? "animate-pulse" : ""}`} />
              {liveOn ? (L ? "Live" : "Live") : (L ? "Offline" : "Offline")}
            </Badge>
            <Badge variant="secondary">{rows.length}</Badge>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="w-4 h-4 mr-2" />{L ? "Eksport CSV" : "Export CSV"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4 mr-2" />{L ? "Import CSV" : "Import CSV"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImportFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        {importProgress && (
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span>{L ? "Import w toku" : "Import in progress"}</span>
                <span className="tabular-nums text-muted-foreground">
                  {importProgress.done}/{importProgress.total} · +{importProgress.added} · ~{importProgress.merged} · ×{importProgress.skipped}
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-[width] duration-200"
                  style={{ width: `${Math.round((importProgress.done / Math.max(1, importProgress.total)) * 100)}%` }}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Preview before commit */}
        <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>{L ? "Podgląd importu CSV" : "CSV import preview"}</DialogTitle>
              <DialogDescription>
                {L
                  ? "Sprawdź zmapowane pola (wołacz, narzędnik, dopełniacz, celownik, złożone, kraj/język). Kraje są zapisywane jako kanoniczny kod ISO."
                  : "Review mapped fields (vocative, instrumental, genitive, dative, compound, country/language). Countries are stored as canonical ISO codes."}
              </DialogDescription>
            </DialogHeader>
            {preview && (
              <>
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <Badge variant="default">{L ? "Dodawane" : "To add"}: {preview.willAdd}</Badge>
                  <Badge variant="secondary">{L ? "Scalane" : "To merge"}: {preview.willMerge}</Badge>
                  <Badge variant="outline">{L ? "Pomijane" : "To skip"}: {preview.willSkip}</Badge>
                  <span className="text-muted-foreground ml-auto">
                    {L ? "Łącznie wierszy" : "Total rows"}: {preview.rows.length}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {L ? "Wykryte nagłówki" : "Detected headers"}: {preview.headers.join(", ")}
                </div>
                <div className="max-h-[55vh] overflow-auto border rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr className="text-left">
                        <th className="p-2">{L ? "Imię" : "Name"}</th>
                        <th className="p-2">{L ? "Płeć" : "Gender"}</th>
                        <th className="p-2">{L ? "Kraj (ISO)" : "Country (ISO)"}</th>
                        <th className="p-2">{L ? "Wołacz" : "Vocative"}</th>
                        <th className="p-2">{L ? "Narzędnik" : "Instrumental"}</th>
                        <th className="p-2">{L ? "Dopełniacz" : "Genitive"}</th>
                        <th className="p-2">{L ? "Celownik" : "Dative"}</th>
                        <th className="p-2">EN</th>
                        <th className="p-2">{L ? "Złożone" : "Compound"}</th>
                        <th className="p-2">{L ? "Akcja" : "Action"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 200).map((r, i) => {
                        const c = resolveCountry(r.origin);
                        const label = c ? `${c.code} · ${L ? c.pl : c.en}` : (r.origin ?? "-");
                        const existing = rows.find((x) => (x.key ?? x.name_normalized) === r.key);
                        const action = !existing
                          ? (L ? "Dodaj" : "Add")
                          : ["vocative_pl", "instrumental_pl", "genitive_pl", "dative_pl", "english_form", "origin", "notes"].some((k) => {
                              const v = (r as unknown as Record<string, unknown>)[k];
                              if (v === null || v === undefined || v === "") return false;
                              const ex = (existing as unknown as Record<string, unknown>)[k];
                              return ex === null || ex === undefined || ex === "";
                            })
                            ? (L ? "Scal" : "Merge")
                            : (L ? "Pomiń" : "Skip");
                        return (
                          <tr key={i} className="border-t">
                            <td className="p-2 font-medium">{r.display_name}</td>
                            <td className="p-2">{r.gender}</td>
                            <td className="p-2">{label}</td>
                            <td className="p-2">{r.vocative_pl ?? "-"}</td>
                            <td className="p-2">{r.instrumental_pl ?? "-"}</td>
                            <td className="p-2">{r.genitive_pl ?? "-"}</td>
                            <td className="p-2">{r.dative_pl ?? "-"}</td>
                            <td className="p-2">{r.english_form ?? "-"}</td>
                            <td className="p-2">{r.is_compound ? "✓" : "-"}</td>
                            <td className="p-2"><Badge variant={action === (L ? "Dodaj" : "Add") ? "default" : action === (L ? "Scal" : "Merge") ? "secondary" : "outline"}>{action}</Badge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {preview.rows.length > 200 && (
                    <div className="p-2 text-center text-xs text-muted-foreground">
                      {L ? `... i ${preview.rows.length - 200} więcej` : `... and ${preview.rows.length - 200} more`}
                    </div>
                  )}
                </div>
              </>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreview(null)}>{L ? "Anuluj" : "Cancel"}</Button>
              <Button onClick={() => void commitImport()}>{L ? "Zatwierdź import" : "Confirm import"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


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
                <Input value={draft.vocative_pl} onChange={(e) => setDraft({ ...draft, vocative_pl: e.target.value })} placeholder={L ? "Aleksandrze" : "-"} />
              </div>
              <div>
                <Label>{L ? "Forma EN" : "English form"}</Label>
                <Input value={draft.english_form} onChange={(e) => setDraft({ ...draft, english_form: e.target.value })} placeholder="Alexander" />
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
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div className="relative md:col-span-2">
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
              <Select value={filterCompound} onValueChange={(v) => setFilterCompound(v as "all" | "yes" | "no")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{L ? "Wszystkie (złożone)" : "All (compound)"}</SelectItem>
                  <SelectItem value="yes">{L ? "Złożone" : "Compound"}</SelectItem>
                  <SelectItem value="no">{L ? "Pojedyncze" : "Single"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="text-xs text-muted-foreground mt-3">
              {L ? "Wyświetlono" : "Showing"}:{" "}
              <strong>{filtered.length === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, filtered.length)}</strong>
              {" "}{L ? "z" : "of"} <strong>{filtered.length}</strong>
              {filtered.length !== rows.length && <> ({L ? "łącznie" : "total"} {rows.length})</>}
            </div>

          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto relative">
            {pageChanging && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[1px] transition-opacity"
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center gap-2 rounded-md border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {L ? "Ładowanie strony…" : "Loading page…"}
                </div>
              </div>
            )}
            <table className={`w-full text-sm transition-opacity ${pageChanging ? "opacity-60" : "opacity-100"}`}>
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left p-3">{L ? "Imię" : "Name"}</th>
                  <th className="text-left p-3">{L ? "Płeć" : "Gender"}</th>
                  <th className="text-left p-3">{L ? "Kraj" : "Country"}</th>
                  <th className="text-left p-3">{L ? "Wołacz" : "Vocative"}</th>
                  <th className="text-left p-3">{L ? "Narzędnik" : "Instrumental"}</th>
                  <th className="text-left p-3">{L ? "Dopełniacz" : "Genitive"}</th>
                  <th className="text-left p-3">{L ? "Celownik" : "Dative"}</th>
                  <th className="text-left p-3">{L ? "Forma EN" : "English"}</th>
                  <th className="text-left p-3">{L ? "Złożone" : "Compound"}</th>
                  <th className="p-3 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/20 align-top">
                    <td className="p-2 font-medium whitespace-nowrap">
                      <div>{r.display_name ?? r.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{r.key ?? r.name_normalized}</div>
                    </td>
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
                        value={r.origin_country ?? r.origin ?? "OTHER"}
                        onValueChange={(v) => void updateRow(r.id, { origin_country: v, origin: v })}
                      >
                        <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{L ? c.pl : c.en}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    {(["vocative_pl", "instrumental_pl", "genitive_pl", "dative_pl", "english_form"] as const).map((field) => (
                      <td key={field} className="p-2">
                        <Input
                          defaultValue={r[field] ?? ""}
                          className="h-8 min-w-[120px]"
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== (r[field] ?? "")) {
                              const patch: RowPatch = { [field]: v || null } as RowPatch;
                              if (field === "english_form") patch.vocative_en = v || null;
                              void updateRow(r.id, patch);
                            }
                          }}
                        />
                      </td>
                    ))}
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={!!r.is_compound}
                        onChange={(e) => void updateRow(r.id, { is_compound: e.target.checked })}
                        className="h-4 w-4 accent-primary"
                        aria-label={L ? "Imię złożone" : "Compound name"}
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
                  <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">{L ? "Brak wyników" : "No results"}</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-muted-foreground">
              {L ? "Strona" : "Page"} <strong>{page}</strong> {L ? "z" : "of"} <strong>{totalPages}</strong>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" onClick={() => setPage(1)} disabled={page === 1}>«</Button>
              <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                {L ? "Poprzednia" : "Previous"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                {L ? "Następna" : "Next"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPage(totalPages)} disabled={page === totalPages}>»</Button>
            </div>
          </div>
        )}


        <p className="text-xs text-muted-foreground">
          {L
            ? "Format CSV: key, display_name, vocative, instrumental, genitive, dative, english_form, gender (male/female/neutral), is_compound (true/false), origin, notes. Duplikaty po `key` są pomijane - chyba że wnoszą nowe wartości w pustych kolumnach (wtedy są scalane)."
            : "CSV format: key, display_name, vocative, instrumental, genitive, dative, english_form, gender (male/female/neutral), is_compound (true/false), origin, notes. Duplicates by `key` are skipped - unless they fill previously empty columns (then merged)."}
      </p>
    </div>
  );
}
