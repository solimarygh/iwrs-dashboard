# =============================================================================
# 01 — Retrieve the corpus from OpenAlex
#
# Run from the repository root:   Rscript R/01_fetch_openalex.R
# Needs a free API key in ~/.Renviron:   OPENALEX_API_KEY=your_key
# Output: data/raw/openalex_<date>.rds  (immutable raw snapshot, git-ignored)
# =============================================================================

source("R/00_utils.R")
cfg <- load_config()
dir.create("data/raw", recursive = TRUE, showWarnings = FALSE)

if (!nzchar(Sys.getenv("OPENALEX_API_KEY")))
  message("No OPENALEX_API_KEY found: running on the keyless (smaller) daily budget.")

filter <- base_filter(cfg)
message("Filter: ", filter)
message("Querying each taxon group:")

hits <- list(); group_counts <- list(); queries <- list()
for (g in cfg$taxon_groups) {
  q <- group_query(g, cfg)
  queries[[g$id]] <- q
  res <- fetch_search(q, filter, label = g$label)
  group_counts[[g$id]] <- res$count
  if (nrow(res$works)) hits[[g$id]] <- mutate(res$works, query_group = g$id)
}

all_hits <- bind_rows(hits)

# Which group queries found each work (before regex classification)
found_by <- all_hits |>
  group_by(id) |>
  summarise(found_by = list(sort(unique(query_group))), .groups = "drop")

works <- all_hits |>
  select(-query_group) |>
  distinct(id, .keep_all = TRUE) |>
  left_join(found_by, by = "id")

# Dissertations (partial proxy for the theses indicator)
dissertations <- tibble()
if (isTRUE(cfg$fetch_dissertations)) {
  message("Dissertations (OpenAlex type:dissertation):")
  dfilter <- sprintf("publication_year:%d-%d,type:dissertation",
                     cfg$years$from, cfg$years$to)
  dissertations <- map_dfr(cfg$taxon_groups, \(g) {
    fetch_search(group_query(g, cfg), dfilter, label = g$label)$works
  }) |> distinct(id, .keep_all = TRUE)
}

# Baseline: all articles + reviews indexed per year (to normalise growth)
base <- oa_get(list(filter = filter, group_by = "publication_year"))
baseline <- map_dfr(base$group_by, ~ tibble(year = as.integer(.x$key),
                                            all_works = .x$count)) |>
  arrange(year)

snapshot <- list(
  works        = works,
  dissertations = dissertations,
  baseline     = baseline,
  queries      = queries,
  filter       = filter,
  group_counts = group_counts,
  retrieved_at = format(Sys.time(), "%Y-%m-%d %H:%M %Z"),
  config_version = cfg$version,
  config_md5   = cfg$md5
)

out <- sprintf("data/raw/openalex_%s.rds", format(Sys.Date()))
saveRDS(snapshot, out)
message(sprintf("\n%d unique works saved to %s", nrow(works), out))
