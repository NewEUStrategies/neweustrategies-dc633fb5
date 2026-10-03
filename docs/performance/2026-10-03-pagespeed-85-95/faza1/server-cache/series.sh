#!/bin/bash
# time series of document cache status for "/" (Chrome-like headers)
out=$1; n=${2:-30}; gap=${3:-10}
for i in $(seq 1 $n); do
  ts=$(date +%H:%M:%S)
  curl -s -o /dev/null -D /tmp/nes_h_$$ -H 'accept: text/html,application/xhtml+xml' -H 'accept-encoding: gzip, deflate, br, zstd' -H 'accept-language: pl-PL,pl;q=0.9' -H 'user-agent: Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse' -w "%{time_starttransfer} %{time_total} %{size_download}" https://neweuropeanstrategies.com/ > /tmp/nes_w_$$
  st=$(grep -i '^x-nes-cache:' /tmp/nes_h_$$ | tr -d '\r' | awk '{print $2}')
  age=$(grep -i '^x-nes-cache-age:' /tmp/nes_h_$$ | tr -d '\r' | awk '{print $2}')
  ray=$(grep -i '^cf-ray:' /tmp/nes_h_$$ | tr -d '\r' | awk '{print $2}')
  stt=$(grep -i '^server-timing:' /tmp/nes_h_$$ | tr -d '\r' | sed 's/server-timing: //I' | tr '\n' '|')
  echo "$ts $st age=$age ray=$ray w=$(cat /tmp/nes_w_$$) st=$stt" >> $out
  sleep $gap
done
rm -f /tmp/nes_h_$$ /tmp/nes_w_$$
