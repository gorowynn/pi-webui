#!/usr/bin/env bash
# index-pdf.sh — extract PDFs to Markdown and index them into context-mode's shared scope.
# Shared library: $HOME/.pi/shared-docs/  (searchable from any project session via
#   context-mode search "<terms>" --project "$HOME/.pi/shared-docs")
#
# Two fixes vs. plain pdftotext:
#   1. -enc UTF-8           — correct German umlauts (was Latin-1 -> mojibake)
#   2. numbered-heading pass — promote "4.11 Title" / "11 Title" lines to ##/#
#      markdown headings so context-mode chunks on structure (a 865-page manual
#      otherwise lands as one giant blob).
#
# Usage:
#   ./index-pdf.sh                 # index every *.pdf in the shared dir
#   ./index-pdf.sh doc1.pdf doc2   # index just the named ones (full name or stem)
set -euo pipefail

SHARED="$HOME/.pi/shared-docs"
CLI="$HOME/.pi/agent/npm/node_modules/context-mode/cli.bundle.mjs"

[ -d "$SHARED" ] || { mkdir -p "$SHARED"; echo "created $SHARED"; }
command -v pdftotext >/dev/null || { echo "pdftotext not on PATH (poppler)."; exit 1; }
command -v python   >/dev/null || { echo "python not on PATH."; exit 1; }
[ -f "$CLI" ] || { echo "context-mode CLI not found at $CLI"; exit 1; }

# collect targets: explicit args, else every *.pdf in the shared dir
targets=()
if [ "$#" -gt 0 ]; then
  for a in "$@"; do
    f="${a%.pdf}.pdf"; [ -f "$f" ] || f="$SHARED/${a%.pdf}.pdf"
    [ -f "$f" ] || { echo "skip (not found): $a"; continue; }
    targets+=("$f")
  done
else
  while IFS= read -r f; do targets+=("$f"); done < <(find "$SHARED" -maxdepth 1 -type f -name '*.pdf')
fi
[ "${#targets[@]}" -gt 0 ] || { echo "no PDFs to index in $SHARED"; exit 0; }

for pdf in "${targets[@]}"; do
  stem="$(basename "${pdf%.pdf}")"
  md="$SHARED/$stem.md"
  echo "==> $stem"
  # 1. extract UTF-8 text with layout, 2. promote numbered headings to markdown
  # NOTE: write LF line endings (binary). context-mode's markdown chunker keys
  # headings on ^# with \n — CRLF (Python's Windows default + pdftotext output)
  # defeats it and the whole file lands as one untitled chunk.
  pdftotext -enc UTF-8 -layout "$pdf" - 2>/dev/null | python -c '
import re, sys
# numbered section heading: "4.11 Title", "11 Title", "2.3.4 Foo Bar"
# title must start with a letter (kills NC-code lines like "1 N10"); furniture
# keywords (running page headers/footers) are rejected outright.
h = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){0,4})\s+([A-Za-zÄÖÜäöüß].*)$")
FURN = ("Version:", "TwinCAT 3 CNC", "TF5200 |", "| TwinCAT")
out = []
for line in sys.stdin:
    s = line.rstrip("\r\n")
    if s == "\f":                 # keep page breaks (page-number traceability)
        out.append(""); out.append("\f"); out.append(""); continue
    m = h.match(s)
    if m and len(s) < 80 and not s.endswith((".", ":", ",")) and not any(k in s for k in FURN):
        lvl = min(m.group(1).count(".") + 1, 6)   # 4.11 -> ## , 11 -> #
        out.append("#" * lvl + " " + s)
    else:
        out.append(s)
sys.stdout.buffer.write("\n".join(out).encode("utf-8"))
' > "$md"
  pages=$(( $(grep -c $'\f' "$md") + 1 ))
  node "$CLI" index "$md" --project "$SHARED" --source "pdf:$stem"
  echo "    $pages pages -> $md (source pdf:$stem)"
done

echo "done. search from any project: context-mode search \"<terms>\" --project \"$SHARED\""
