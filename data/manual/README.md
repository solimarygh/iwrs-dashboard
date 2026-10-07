# Manually curated indicators

These indicators can't be pulled from OpenAlex. Add one row per item to the CSV
files here, commit, and re-run `R/02_build_records.R`: the dashboard's
**Annual indicators** table picks them up automatically. Leave a file with only
its header row until you have data; the dashboard then shows the indicator as
"pending".

Keep `url` and `source` filled in for every row, so each number can be traced.

| File | One row per | Indicator(s) in the IWRS brief |
|---|---|---|
| `conference_items.csv` | talk, symposium, workshop or panel | Talks at major conferences; dedicated symposia/workshops/panels |
| `events.csv` | academic event of any kind | Academic events on invertebrate sentience or welfare |
| `theses.csv` | PhD dissertation or Master's thesis | Theses (added to the OpenAlex dissertations, deduplicated by title) |
| `grants.csv` | grant | Number and USD value of grants by non-EA funders |
| `media.csv` | media item, or a yearly count from a media database | Media mentions |

## Allowed values

- `conference_items.csv` → `item_type`: `talk`, `symposium`, `workshop`, `panel`.
  `conference`: use one consistent name per meeting, e.g. `ESA`, `ICE`, `IFF`.
- `events.csv` → `event_type`: free text (`seminar`, `workshop`, `conference`, `webinar`, …).
- `theses.csv` → `degree`: `PhD` or `Masters`.
- `grants.csv` → `funder_type`: `non-EA` or `EA`. Only `non-EA` rows count toward the
  indicator; `EA` rows are kept for transparency. `amount_usd`: number only, converted
  to USD at the award year's average rate (note the rate in `source` when converting).
  Decide and document which funders count as EA before coding (e.g. Open Philanthropy,
  EA Animal Welfare Fund) so the split is reproducible.
- `media.csv` → `count`: `1` for a single article; use a yearly total when the row comes
  from an aggregate source such as Media Cloud (then `headline` can describe the query).
  `terms`: which search terms matched (e.g. `insect welfare; IWRS`).

## Suggested sources

- **Talks / symposia:** ESA annual meeting programs (Confex archive), ICE programs
  (2016 Orlando, 2020/2022 Helsinki, 2024 Kyoto), Insects to Feed the World / IFF programs.
- **Theses:** ProQuest Dissertations & Theses, NDLTD, DART-Europe, BDTD (Brazil),
  EThOS (UK), theses.fr.
- **Grants:** NIH RePORTER, NSF Award Search, USDA NIFA (CRIS/REEIS), UKRI Gateway to
  Research, CORDIS, FAPESP Virtual Library.
- **Media:** Media Cloud (US collections for the US-focused series), Factiva/Nexis Uni.
