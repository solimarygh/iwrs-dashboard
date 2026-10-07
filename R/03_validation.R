# =============================================================================
# 03 — Validation: recall (gold set) and precision + study type (coded sample)
#
# Run from the repository root:   Rscript R/03_validation.R
#
# Step A (first run): writes a blinded coding sheet of 200 random records to
#   data/validation/coding_sheet.csv  — two people code it independently, saving
#   their copies as coding_sheet_coder1.csv and coding_sheet_coder2.csv.
#   Columns to fill:
#     relevant   : y / n   (is this invertebrate welfare/sentience research?)
#     study_type : empirical / conceptual / review / methodological
#
# Step B (after coding): run again. Computes recall, precision, the
#   conceptual:empirical ratio and Cohen's kappa, and writes
#   data/validation/validation_summary.json. Then re-run 02 so the
#   dashboard shows the results.
# =============================================================================

source("R/00_utils.R")
cfg <- load_config()
vdir <- "data/validation"
dir.create(vdir, recursive = TRUE, showWarnings = FALSE)

corpus <- read_csv("data/processed/corpus_full.csv", show_col_types = FALSE)
summary_out <- list(generated_at = format(Sys.time(), "%Y-%m-%d"))

# ---- Recall against the gold set --------------------------------------------
gold_path <- file.path(vdir, "gold_set.csv")
if (file.exists(gold_path)) {
  gold <- read_csv(gold_path, show_col_types = FALSE) |>
    filter(!is.na(doi), doi != "") |>
    mutate(doi = tolower(sub("^https?://(dx\\.)?doi.org/", "", str_trim(doi))),
           retrieved = doi %in% corpus$doi)
  if (nrow(gold)) {
    write_csv(gold, file.path(vdir, "gold_check.csv"))
    summary_out$recall <- list(n = nrow(gold), found = sum(gold$retrieved),
                               value = mean(gold$retrieved),
                               missed = gold$doi[!gold$retrieved])
    message(sprintf("Recall: %d / %d (%.0f%%)", sum(gold$retrieved), nrow(gold),
                    100 * mean(gold$retrieved)))
    if (any(!gold$retrieved))
      message("Missed (check why — taxon term? state term? not in OpenAlex?):\n  ",
              paste(gold$doi[!gold$retrieved], collapse = "\n  "))
  }
} else message("No gold_set.csv yet — recall not computed.")

# ---- Coding sheet (Step A) --------------------------------------------------
sheet_path <- file.path(vdir, "coding_sheet.csv")
if (!file.exists(sheet_path)) {
  set.seed(2026)
  corpus |>
    filter(!noci_only) |>
    slice_sample(n = min(200, sum(!corpus$noci_only))) |>
    transmute(id, title, year, journal, abstract,
              relevant = "", study_type = "", notes = "") |>
    write_csv(sheet_path)
  message("Coding sheet written: ", sheet_path,
          "\nCode it independently (two coders), save as coding_sheet_coder1.csv / coder2.csv, then re-run.")
}

# ---- Precision, study type and agreement (Step B) ---------------------------
coded <- list.files(vdir, "^coding_sheet_coder\\d+\\.csv$", full.names = TRUE)
norm_rel  <- function(x) case_when(str_to_lower(str_trim(x)) %in% c("y","yes","1","s","sim","si") ~ "y",
                                   str_to_lower(str_trim(x)) %in% c("n","no","0","nao","não") ~ "n",
                                   TRUE ~ NA_character_)
norm_type <- function(x) str_to_lower(str_trim(x))

cohen_kappa <- function(a, b) {
  ok <- !is.na(a) & !is.na(b); a <- a[ok]; b <- b[ok]
  lv <- union(a, b); tab <- table(factor(a, lv), factor(b, lv))
  po <- sum(diag(tab)) / sum(tab)
  pe <- sum(rowSums(tab) * colSums(tab)) / sum(tab)^2
  if (pe == 1) return(NA_real_)
  (po - pe) / (1 - pe)
}

wilson <- function(k, n, z = 1.96) {
  if (n == 0) return(c(NA, NA))
  p <- k / n; d <- 1 + z^2 / n
  c((p + z^2/(2*n) - z*sqrt(p*(1-p)/n + z^2/(4*n^2))) / d,
    (p + z^2/(2*n) + z*sqrt(p*(1-p)/n + z^2/(4*n^2))) / d)
}

if (length(coded)) {
  sheets <- map(coded, ~ read_csv(.x, show_col_types = FALSE) |>
                  mutate(relevant = norm_rel(relevant), study_type = norm_type(study_type)))
  names(sheets) <- sub("\\.csv$", "", basename(coded))

  if (length(sheets) >= 2) {
    a <- sheets[[1]]; b <- sheets[[2]] |> select(id, rel2 = relevant, type2 = study_type)
    ab <- inner_join(a, b, by = "id")
    summary_out$agreement <- list(
      kappa_relevant   = cohen_kappa(ab$relevant, ab$rel2),
      kappa_study_type = cohen_kappa(ab$study_type, ab$type2),
      n = nrow(ab))
    message(sprintf("Cohen's kappa — relevance: %.2f | study type: %.2f",
                    summary_out$agreement$kappa_relevant,
                    summary_out$agreement$kappa_study_type))
    # Disagreements go to an adjudication sheet; the consensus file wins if present
    ab |> filter(relevant != rel2 | study_type != type2) |>
      write_csv(file.path(vdir, "to_adjudicate.csv"))
  }

  consensus_path <- file.path(vdir, "coding_consensus.csv")
  final <- if (file.exists(consensus_path)) {
    read_csv(consensus_path, show_col_types = FALSE) |>
      mutate(relevant = norm_rel(relevant), study_type = norm_type(study_type))
  } else sheets[[1]]

  rel <- filter(final, !is.na(relevant))
  k <- sum(rel$relevant == "y"); n <- nrow(rel)
  summary_out$precision <- list(n = n, relevant = k, value = k / n,
                                ci95 = wilson(k, n),
                                source = if (file.exists(consensus_path)) "consensus" else names(sheets)[1])
  message(sprintf("Precision: %d / %d (%.0f%%)", k, n, 100 * k / n))

  types <- final |> filter(relevant == "y", study_type != "") |>
    mutate(period = if_else(year <= 2020, "2016-2020", "2021-2026"),
           group = if_else(study_type == "empirical", "empirical",
                           "conceptual/theoretical/methodological/review"))
  summary_out$study_type <- list(
    overall = as.list(table(types$group)),
    by_period = types |> count(period, group) |> split(~period) |>
      map(~ setNames(as.list(.x$n), .x$group)))
}

write_json(summary_out, file.path(vdir, "validation_summary.json"),
           auto_unbox = TRUE, pretty = TRUE, digits = 4)
message("Saved ", file.path(vdir, "validation_summary.json"),
        " — re-run R/02_build_records.R to show it on the dashboard.")
