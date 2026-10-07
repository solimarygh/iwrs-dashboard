# Invertebrate Welfare Science Dashboard

An open, reproducible dashboard of the invertebrate welfare and sentience research
landscape, 2016–2026, built for the [Insect Welfare Research Society](https://www.insectwelfare.com/).

It answers the annual statistics in the IWRS brief:

| Indicator | Source | Status |
|---|---|---|
| Peer-reviewed publications, with sentience / emotion / affect / consciousness / welfare break-out | OpenAlex | automated |
| Conceptual : empirical ratio | Hand-coded random sample (`R/03_validation.R`) | after coding |
| Distribution across animal welfare, entomology and high-impact journals | OpenAlex | automated |
| Talks at major conferences (ESA, ICE, IFF) | `data/manual/conference_items.csv` | curated |
| Dedicated symposia, workshops, panels | `data/manual/conference_items.csv` | curated |
| Academic events on invertebrate sentience or welfare | `data/manual/events.csv` | curated |
| PhD dissertations and Master's theses | `data/manual/theses.csv` + OpenAlex dissertations (floor) | curated + automated |
| Number and USD value of grants from non-EA funders | `data/manual/grants.csv` | curated |
| Media mentions | `data/manual/media.csv` | curated |

## Scope

Insects, plus the other invertebrates in the IWRS mission: arachnids and horseshoe crabs,
myriapods, gastropods, crustaceans (shrimp, prawns, crabs, lobsters, crayfish) and
cephalopods. Each paper is tagged with every group it mentions. Papers whose only theme is
pain/nociception are flagged and hidden by default, because nociception on its own is not
evidence of sentience or of a welfare focus. The full definition is in
[`config/query_config.yaml`](config/query_config.yaml).

## Run it

Requirements: R ≥ 4.1 and

```r
install.packages(c("httr2", "jsonlite", "yaml", "dplyr", "purrr", "tidyr",
                   "readr", "stringr", "tibble"))
```

Get a free OpenAlex API key at <https://openalex.org/settings/api> and add it to `~/.Renviron`:

```
OPENALEX_API_KEY=your_key
```

Then, from the repository root:

```bash
Rscript R/01_fetch_openalex.R    # raw snapshot  -> data/raw/openalex_<date>.rds
Rscript R/02_build_records.R     # dashboard data -> dashboard/app/data/records.json
                                 # report tables  -> data/processed/*.csv
Rscript R/03_validation.R        # gold-set recall + coding sheet for precision
```

After two people code `data/validation/coding_sheet.csv` (saved as
`coding_sheet_coder1.csv` and `coding_sheet_coder2.csv`), run `03_validation.R` again to get
precision, Cohen's kappa and the conceptual : empirical ratio, then `02_build_records.R` again
to show them on the dashboard.

To view the dashboard locally:

```bash
cd dashboard/app && python3 -m http.server 8000   # open http://localhost:8000
```

The `records.json` shipped in this repo until the first real run is **synthetic demo data**
(`node scripts/make_demo_data.js`); the dashboard shows a banner while it is in use.

## Key outputs for the report

- `data/processed/annual_indicators.csv`: every indicator by year (blank = not collected yet)
- `data/processed/annual_by_theme.csv`, `annual_by_taxon.csv`, `annual_by_journal_group.csv`
- `data/processed/top50_cited.csv`: pick the top 10 by hand from here
- `data/processed/journal_ranking.csv`: check for journals missing from the groups

## Validation

- **Recall**: list 30–50 papers you know belong in the field in
  `data/validation/gold_set.csv` (column `doi`). The script reports which were missed.
- **Precision**: two coders mark 200 random records as relevant or not.
- **Study type**: the same coders classify relevant records as empirical, conceptual,
  review or methodological; this gives the conceptual : empirical ratio.

## Publish on GitHub Pages

Push to `main`; `.github/workflows/deploy-dashboard.yml` deploys `dashboard/app`. In the
repository settings, set **Pages → Source** to **GitHub Actions** once.

## Credit

Dashboard design inspired by the
[Canadian Metaresearch Dashboard](https://github.com/esantos2ua/metaResearchDataChallenge)
(COSSEE / SORTEE Canada, MIT licence), itself inspired by the
[COKI Open Access Dashboard](https://open.coki.ac/). Data: [OpenAlex](https://openalex.org/) (CC0).
