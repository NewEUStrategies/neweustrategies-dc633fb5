# Wyciaga z pliku migracji WYLACZNIE instrukcje `CREATE POLICY` / `DROP POLICY`
# dotyczace tabel czatu i wypisuje je DOSLOWNIE, zakonczone srednikiem.
#
# PO CO TO ISTNIEJE. `run.sh` aplikuje migracje w calosci i to jest domyslna
# droga. Migracje polityk czatu sa jednak ZLEPKAMI: jeden plik niesie polityke
# czatu obok `storage.buckets`, `notifications`, `content_access`,
# `author_profiles`, tabel sieci kontaktow i kilkunastu funkcji obcych modulow.
# Zeby taki plik przeszedl w calosci, atrapa musialaby postawic kilkanascie
# tabel spoza modulu - a kazda atrapa to kolejne NIEZWERYFIKOWANE zdanie
# o ksztalcie cudzej tabeli (ten sam argument stoi w
# `scripts/careers-harness/run.sh`). Dlatego dla plaszczyzny czatu bierzemy
# z migracji sam artefakt, ktory jest przedmiotem dowodu: TRESC POLITYKI.
#
# CO JEST GWARANTOWANE. Tekst polityki nie jest przepisywany ani sklejany -
# jest kopiowany bajt w bajt z migracji. Odtworzenie kolejnosci plikow
# (chronologicznie) i kolejnosci instrukcji w pliku sprawia, ze idiom repo
# „DROP POLICY IF EXISTS x; CREATE POLICY x …" daje ten sam STAN KONCOWY,
# co pelny przebieg migracji - dokladnie tak, jak liczy go
# `src/lib/ci/rlsPolicies.ts`.
#
# CZEGO NIE ROBI. Nie wykonuje instrukcji spoza polityk (ALTER TABLE, GRANT,
# triggery, funkcje) - te musi dostarczyc `harness.sql`. Nie siega do wnetrza
# blokow `DO $$ … $$`, wiec polityki kanalow realtime (`realtime.messages`,
# zawsze zamkniete w takim bloku) nie wchodza i wejsc nie moga: kanaly sa poza
# zakresem tej atrapy.
#
# PARSER. Plik jest czytany jako jeden ciag i dzielony na instrukcje po
# sredniku, ktory NIE stoi w literale ('…'), w cytowaniu dolarowym ($tag$…$tag$)
# ani w komentarzu (-- do konca linii, /* … */). Bez tego rozroznienia srednik
# z ciala funkcji rozcinalby instrukcje w losowym miejscu, a komentarz cytujacy
# polityke (migracje tego repo cytuja je w prozie) wygladalby jak instrukcja.
BEGIN {
  # Tabele czatu. `messages` MUSI byc kwalifikowane `public.` - `realtime.messages`
  # to inna tabela (kanaly) i celowo do dowodu nie wchodzi.
  split("conversations conversation_participants conversation_nicknames messages " \
        "message_reactions message_stars user_blocks expert_inmails", t, " ")
  for (i in t) chat[t[i]] = 1
  src = ""
}
# Caly plik zbieramy do jednego bufora, bo instrukcja SQL potrafi isc przez
# kilkanascie linii. Skladanie recznie, a nie przez `RS`, bo zachowanie `RS`
# przy „calym pliku jako rekordzie" rozni sie miedzy mawk a gawk.
{ src = src $0 "\n" }

END {
  n = length(src)
  stmt = ""
  i = 1
  while (i <= n) {
    c = substr(src, i, 1)
    two = substr(src, i, 2)

    if (two == "--") {                       # komentarz liniowy
      while (i <= n && substr(src, i, 1) != "\n") i++
      stmt = stmt " "
      continue
    }
    if (two == "/*") {                       # komentarz blokowy
      i += 2
      while (i <= n && substr(src, i, 2) != "*/") i++
      i += 2
      stmt = stmt " "
      continue
    }
    if (c == "'") {                          # literal tekstowy
      stmt = stmt c; i++
      while (i <= n) {
        c = substr(src, i, 1); stmt = stmt c; i++
        if (c == "'") break
      }
      continue
    }
    if (c == "\"") {                         # identyfikator w cudzyslowie
      stmt = stmt c; i++
      while (i <= n) {
        c = substr(src, i, 1); stmt = stmt c; i++
        if (c == "\"") break
      }
      continue
    }
    if (c == "$") {                          # cytowanie dolarowe: $$ albo $tag$
      tag = ""
      j = i + 1
      while (j <= n && substr(src, j, 1) ~ /[A-Za-z0-9_]/) { tag = tag substr(src, j, 1); j++ }
      if (j <= n && substr(src, j, 1) == "$") {
        open = "$" tag "$"
        close_at = index(substr(src, j + 1), open)
        if (close_at > 0) {
          stmt = stmt substr(src, i, (j + close_at + length(open)) - i)
          i = j + close_at + length(open)
          continue
        }
      }
      stmt = stmt c; i++
      continue
    }
    if (c == ";") {                          # koniec instrukcji
      emit(stmt)
      stmt = ""; i++
      continue
    }
    stmt = stmt c; i++
  }
  emit(stmt)
}

# Wypisuje instrukcje, jesli jest to CREATE/DROP POLICY na tabeli czatu.
function emit(s,   norm, table) {
  gsub(/[ \t\r\n]+/, " ", s)
  sub(/^ +/, "", s)
  if (s !~ /^(CREATE|DROP)[ ]+POLICY[ ]/) return
  norm = s
  if (match(norm, / ON +public\.[A-Za-z0-9_]+/) == 0) return
  table = substr(norm, RSTART, RLENGTH)
  sub(/ ON +public\./, "", table)
  if (!(table in chat)) return
  print s ";"
}
