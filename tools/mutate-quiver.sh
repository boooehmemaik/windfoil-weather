#!/usr/bin/env bash
# Mutationsprobe für die Quiver-Logik: jede Mutation muss quiver.test.mjs rot machen.
# Eine überlebende Mutation heißt, der zugehörige Test prüft nichts.
set -u
SRC=js/wf-scoring.js
BAK=$(mktemp)
cp "$SRC" "$BAK"
trap 'cp "$BAK" "$SRC"; rm -f "$BAK"' EXIT

mutate() {
  local name="$1" from="$2" to="$3"
  cp "$BAK" "$SRC"
  FROM="$from" TO="$to" perl -0pi -e 'my $f=quotemeta($ENV{FROM}); my $n=($_ =~ s/$f/$ENV{TO}/g); die "PATTERN-MISS\n" unless $n==1' "$SRC" || {
    echo "SKIP  $name (Muster nicht eindeutig)"; return
  }
  if node --test quiver.test.mjs >/dev/null 2>&1; then
    echo "LEBT  $name  <-- kein Test fängt das"
  else
    echo "tot   $name"
  fi
}

mutate "M1 unbekannte Marke fällt still auf Harlem" \
  'const brand = WING_BRANDS[brandKey || DEFAULT_WING_BRAND];
    return brand ? Object.keys(brand.sizes)' \
  'const brand = WING_BRANDS[brandKey] || WING_BRANDS[DEFAULT_WING_BRAND];
    return brand ? Object.keys(brand.sizes)'

mutate "M2 leere Materialliste ergibt leeren Quiver" \
  'const list = own.length' \
  'const list = Array.isArray(gear)'

mutate "M3 Angleitschwelle gilt für alle Groessen" \
  'planeKn: w === profileSize ? rider?.planeKn : null,' \
  'planeKn: rider?.planeKn,'

mutate "M4 Quiver unsortiert" \
  '.sort((a, b) => a.wing - b.wing)' \
  '.slice()'

mutate "M5 Profilgewicht ignoriert" \
  'const weight = Number(rider?.weight) || GUEST_RIDER.weight;' \
  'const weight = GUEST_RIDER.weight;'

mutate "M6 bestWingForWind waehlt das schlechteste" \
  'if (!best || rank > best.rank)' \
  'if (!best || rank < best.rank)'

mutate "M7 Mittigkeit als Gleichstandsregel entfernt" \
  'const rank = score * 100 + center * 10;' \
  'const rank = score * 100;'

mutate "M8 Quiver-Score summiert statt Maximum" \
  'const best = bestWingForWind(quiver, windMs);
    return best ? best.score : 0;' \
  'let s = 0; for (const q of quiver || []) s += scoreHour(windMs, q.win); return Math.min(100, s);'

mutate "M9 scorerFor nimmt nur das erste Wing" \
  'return Array.isArray(win) ? (w => scoreHourQuiver(w, win)) : (w => scoreHour(w, win));' \
  'return w => scoreHour(w, Array.isArray(win) ? win[0].win : win);'

mutate "M10 wingAdvice ohne Zusammenfassung" \
  'if (seq[seq.length - 1] !== w.wing) seq.push(w.wing);' \
  'seq.push(w.wing);'

mutate "M11 sessionWings verliert die letzte Stunde" \
  'for (let h = fromHour; h < toHour; h++) {
      const v = winds[start + h];' \
  'for (let h = fromHour; h < toHour - 1; h++) {
      const v = winds[start + h];'

mutate "M12 loadRider ignoriert useGear" \
  'quiver: riderQuiver(rider, useGear ? gear : null)' \
  'quiver: riderQuiver(rider, gear)'
