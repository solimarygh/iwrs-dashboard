# =============================================================================
# 02 — Classify the corpus and build the dashboard dataset + summary tables
#
# Run from the repository root:   Rscript R/02_build_records.R
# Input : latest data/raw/openalex_*.rds
#         data/validation/validation_summary.json (optional, from 03)
# Output: dashboard/app/data/records.json   (what the dashboard loads)
#         data/processed/*.csv               (tables for the report)
# =============================================================================

source("R/00_utils.R")
cfg  <- load_config()
snap <- readRDS(latest_file("data/raw", "^openalex_.*\\.rds$"))
if (!identical(snap$config_md5, cfg$md5))
  warning("query_config.yaml changed since this snapshot was fetched. ",
          "Re-run 01_fetch_openalex.R if the search terms changed.")

dir.create("data/processed", recursive = TRUE, showWarnings = FALSE)
dir.create("dashboard/app/data", recursive = TRUE, showWarnings = FALSE)

w <- snap$works
text <- str_to_lower(paste(w$title, coalesce(w$abstract, "")))

# ---- Classification ---------------------------------------------------------
specific <- keep(cfg$taxon_groups, ~ .x$id != "general")
general  <- detect(cfg$taxon_groups, ~ .x$id == "general")

w$taxa     <- classify_multi(text, specific)
gen_hit    <- str_detect(text, regex(general$classify, ignore_case = TRUE))
w$taxa     <- map2(w$taxa, gen_hit, \(t, g) if (g || !length(t)) c(t, "general") else t)

w$themes   <- classify_multi(text, cfg$themes)
w$contexts <- classify_multi(text, cfg$contexts)

w <- w |>
  mutate(
    noci_only   = map_lgl(themes, ~ identical(.x, "pain")),
    no_theme    = lengths(themes) == 0,          # matched only via search stemming/keywords
    us_any      = map_lgl(countries, ~ "US" %in% .x),
    us_first    = map_lgl(first_country, ~ "US" %in% .x),
    jgroup      = journal_group(journal, cfg),
    has_abstract = !is.na(abstract)
  )

# ---- Summary tables ---------------------------------------------------------
long_count <- function(df, col, name) {
  df |> select(year, all_of(col)) |> unnest_longer(all_of(col), values_to = name) |>
    count(year, across(all_of(name))) |>
    pivot_wider(names_from = all_of(name), values_from = n, values_fill = 0)
}

core <- filter(w, !noci_only)   # default view in the dashboard

annual <- core |> count(year, name = "works") |>
  left_join(snap$baseline, by = "year") |>
  mutate(per_100k = works / all_works * 1e5,
         partial_year = year == max(cfg$years$to))
write_csv(annual, "data/processed/annual_totals.csv")
write_csv(long_count(core, "themes", "theme"),    "data/processed/annual_by_theme.csv")
write_csv(long_count(core, "taxa", "taxon"),      "data/processed/annual_by_taxon.csv")
write_csv(long_count(core, "contexts", "context"),"data/processed/annual_by_context.csv")

core |> count(year, jgroup) |>
  pivot_wider(names_from = jgroup, values_from = n, values_fill = 0) |>
  write_csv("data/processed/annual_by_journal_group.csv")

core |> count(journal, jgroup, sort = TRUE) |>
  write_csv("data/processed/journal_ranking.csv")

core |> unnest_longer(countries, values_to = "country") |>
  count(country, sort = TRUE) |>
  write_csv("data/processed/country_ranking.csv")

core |> arrange(desc(cited_by)) |> slice_head(n = 50) |>
  transmute(title, year, journal, cited_by, doi,
            taxa = map_chr(taxa, paste, collapse = ";"),
            themes = map_chr(themes, paste, collapse = ";")) |>
  write_csv("data/processed/top50_cited.csv")

# Full corpus with abstracts (for coding / sharing; not shipped to the browser)
w |> mutate(across(c(countries, institutions, first_country, found_by,
                     taxa, themes, contexts), ~ map_chr(.x, paste, collapse = ";"))) |>
  write_csv("data/processed/corpus_full.csv")

# ---- Non-OpenAlex indicators (data/manual/*.csv) + OpenAlex dissertations ---
yrs <- seq(cfg$years$from, cfg$years$to)
read_manual <- function(f) {
  p <- file.path("data/manual", f)
  if (!file.exists(p)) return(tibble())
  read_csv(p, show_col_types = FALSE, col_types = cols(.default = "c")) |>
    mutate(year = suppressWarnings(as.integer(year))) |>
    filter(!is.na(year))
}
# Named per-year vector (all years present, 0 where no rows) or NULL if no data
per_year <- function(df, value = NULL) {
  if (!nrow(df)) return(NULL)
  v <- if (is.null(value)) df |> count(year) else
    df |> group_by(year) |> summarise(n = sum(.data[[value]], na.rm = TRUE), .groups = "drop")
  out <- setNames(as.list(rep(0, length(yrs))), yrs)
  for (i in seq_len(nrow(v))) if (as.character(v$year[i]) %in% names(out)) out[[as.character(v$year[i])]] <- v$n[i]
  out
}

conf   <- read_manual("conference_items.csv") |> mutate(item_type = str_to_lower(item_type))
events <- read_manual("events.csv")
theses <- read_manual("theses.csv") |> mutate(degree = str_to_lower(degree))
grants <- read_manual("grants.csv") |>
  mutate(amount_usd = suppressWarnings(as.numeric(gsub("[^0-9.]", "", amount_usd))),
         nonEA = str_to_lower(str_trim(funder_type)) == "non-ea") |> filter(nonEA)
media  <- read_manual("media.csv") |>
  mutate(count = coalesce(suppressWarnings(as.numeric(count)), 1))

# OpenAlex dissertations: classify with the same rules, drop nociception-only,
# and remove titles already listed in theses.csv
diss <- snap$dissertations %||% tibble()
if (nrow(diss)) {
  dtext <- str_to_lower(paste(diss$title, coalesce(diss$abstract, "")))
  diss$themes <- classify_multi(dtext, cfg$themes)
  diss <- diss |> filter(!map_lgl(themes, ~ identical(.x, "pain")))
  norm_title <- function(x) str_to_lower(gsub("[^[:alnum:]]", "", x))
  if (nrow(theses)) diss <- filter(diss, !norm_title(title) %in% norm_title(theses$title))
  diss |> transmute(id, year, title, institutions = map_chr(institutions, paste, collapse = ";")) |>
    write_csv("data/processed/openalex_dissertations.csv")
}

manual <- list(
  talks      = per_year(filter(conf, item_type == "talk")),
  sessions   = per_year(filter(conf, item_type %in% c("symposium", "workshop", "panel"))),
  events     = per_year(events),
  theses_phd = per_year(filter(theses, degree == "phd")),
  theses_ms  = per_year(filter(theses, degree %in% c("masters", "master", "msc", "ms", "ma"))),
  theses_openalex = per_year(diss),
  grants_n   = per_year(grants),
  grants_usd = per_year(filter(grants, !is.na(amount_usd)), "amount_usd"),
  media      = per_year(media, "count")
)

# Annual indicator table for the report (mirrors the dashboard)
pub_by_theme <- long_count(core, "themes", "theme")
ind <- tibble(year = yrs) |>
  left_join(count(core, year, name = "publications"), by = "year") |>
  left_join(pub_by_theme, by = "year") |>
  left_join(core |> count(year, jgroup) |>
              pivot_wider(names_from = jgroup, values_from = n, values_fill = 0,
                          names_prefix = "journals_"), by = "year")
for (k in names(manual)) {
  ind[[k]] <- if (is.null(manual[[k]])) NA_real_ else unlist(manual[[k]])[as.character(yrs)]
}
# OpenAlex-based columns: missing = 0. Manual columns: missing = not collected (blank).
ind |>
  mutate(across(c(publications, any_of(map_chr(cfg$themes, "id")), starts_with("journals_")),
                ~ replace_na(.x, 0L))) |>
  write_csv("data/processed/annual_indicators.csv", na = "")

# ---- Dashboard dataset (compact keys keep the file small) -------------------
records <- pmap(
  list(w$id, w$doi, w$title, w$year, w$journal, w$jgroup, w$type, w$cited_by,
       w$oa_status, w$language, w$topic, w$countries, w$institutions,
       w$taxa, w$themes, w$contexts, w$noci_only, w$us_first),
  \(id, doi, t, y, j, jg, ty, c, oa, l, tp, co, ins, tx, th, cx, n, uf) list(
    i = id, d = doi, t = t, y = y, j = j, jg = jg, ty = ty, c = c,
    oa = oa, l = l, tp = tp, co = I(co), ins = I(head(ins, 15)),
    tx = I(tx), th = I(th), cx = I(cx), n = n, uf = uf))

lab <- function(defs) setNames(map(defs, "label"), map_chr(defs, "id"))

val_path <- "data/validation/validation_summary.json"
validation <- if (file.exists(val_path)) read_json(val_path) else NULL

meta <- list(
  demo = FALSE,
  title = "Invertebrate Welfare Science Dashboard",
  retrieved_at = snap$retrieved_at,
  n_records = nrow(w),
  years = cfg$years,
  provenance = list(config_version = snap$config_version,
                    config_md5 = snap$config_md5,
                    filter = snap$filter,
                    queries = snap$queries,
                    group_counts = snap$group_counts,
                    state_terms = cfg$state_terms),
  labels = list(taxa = lab(cfg$taxon_groups), themes = lab(cfg$themes),
                contexts = lab(cfg$contexts),
                jgroups = c(lab(cfg$journal_groups),
                            list(other = "Other journals", unknown = "No source"))),
  focal_journals = cfg$focal_journals,
  baseline = snap$baseline,
  validation = validation,
  manual = manual
)

write_json(list(meta = meta, records = records),
           "dashboard/app/data/records.json",
           auto_unbox = TRUE, na = "null", null = "null", digits = NA)

message(sprintf("records.json: %d works (%d nociception-only, hidden by default)",
                nrow(w), sum(w$noci_only)))
message("Tables written to data/processed/")
