# 🧚 Fairy 2.1 + MEDUZA HTF LONG

Ready-to-upload replacement for the current GitHub Pages repo:

`medussa1995-sys/golden-trio-fairy-20`

## What changed

The current Fairy logic is preserved.

A causal HTF LONG gate is added:

- HYPE LONG — HTF ALLOW (no filter)
- PENDLE LONG — WR5:
  block new Entry1 when nearest causal confirmed weekly resistance is <=5% above live reference price
- POPCAT LONG — R40:
  block new Entry1 when 0.40 < prior-180d range position <= 1.00
  breakout above prior 180d high (>1.00) is ALLOW
- POPCAT SHORT — untouched, no HTF

Final decision shown by the page:

`ENTRY1_ALLOW = FAIRY_ALLOW && HTF_ALLOW`

The gate never closes or modifies an already-open position.

## Causality

PENDLE weekly pivots:
- complete Mon-Sun weeks only
- 2-left / 2-right pivot
- pivot becomes usable only after both right weeks fully close
- nearest confirmed resistance is searched only in the prior 365d window

POPCAT R40:
- high/low from the previous 180 fully closed UTC daily candles
- current live price is only the reference price; no future bar data is used

## Deployment

Replace these files in the existing repository:
- index.html
- app.js
- style.css
- config.json
- FROZEN_CONFIG.json

Keep the existing `popcat_ratio_history.csv` unchanged.

GitHub Pages will continue to serve from the same URL.
`?v=2.1.0` cache-busting is already added for JS/CSS.
