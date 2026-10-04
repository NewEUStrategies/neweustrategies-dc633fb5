#!/usr/bin/env bash
# P0.5: księga per zadanie dla jednego przebiegu w 3 formach x 2 reżimach (bazowy, C3 = dropscripts-before-lcp).
# Użycie: run-ledgers.sh <dir artefaktów mobile|desktop> <form: mobile|desktop> <nazwa>
# Wynik: $P/ledgers/<nazwa>-<forma>-<reżim>.{txt,json} + linia AUDIT (audyt LH what-if) vs suma księgi.
P=/tmp/claude-0/-home-user-neweustrategies-dc633fb5/8fd9e8e2-d544-5db4-ae5e-c509c5e3ff6c/scratchpad/phase2/p05
src=$(realpath $1); form=$2; name=$3
mkdir -p $P/ledgers
if [ "$form" = mobile ]; then variants="m4:: m4c3::dropscripts-before-lcp"; else variants="d4::cpu:4 d4c3::cpu:4,dropscripts-before-lcp d5::cpu:5 d5c3::cpu:5,dropscripts-before-lcp d1::"; fi
for v in $variants; do
  tag=${v%%::*}; edits=${v#*::}; edits=${edits//,/ }
  out=$P/ledgers/$name-$tag
  if [ -z "$edits" ]; then
    # reżim bazowy w ustawieniach przebiegu: audyt = LHR z gathera
    node $P/ledger.mjs $src --detail --json $out.json > $out.txt
    audit=$(python3 -c "import json;print(round(json.load(open('$src/lhr.report.json'))['audits']['total-blocking-time']['numericValue']))")
  else
    res=$(WI_SRC=$src WI_KEEP=1 python3 $P/whatif.py $form $name-$tag $edits 2>/dev/null | tail -1)
    audit=$(echo "$res" | python3 -c "import json,sys;print(json.loads(sys.stdin.read())['TBT'])")
    node $P/ledger.mjs $P/wi/tmp-$name-$tag-$form --detail --json $out.json > $out.txt
    rm -rf $P/wi/tmp-$name-$tag-$form
  fi
  sum=$(python3 -c "import json;d=json.load(open('$out.json'));print(round(d['sum'],1), round(d['tbtExact'],1), round(d['fcp']['opt']), round(d['tti']['opt']), round(d['tti']['pes']))")
  echo "AUDIT $name $tag audytLH=$audit ksiega(suma,lantern,FCPsim,TTIopt,TTIpes)=$sum"
done
