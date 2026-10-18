# =============================================================================
# Shared helpers: config, OpenAlex API, flattening, classification
# =============================================================================

suppressPackageStartupMessages({
  library(httr2); library(jsonlite); library(yaml)
  library(dplyr); library(purrr); library(tidyr)
  library(readr); library(stringr); library(tibble)
})

`%||%` <- function(a, b) if (is.null(a) || length(a) == 0) b else a

# Character set helper: always returns a (possibly empty) sorted character vector
chr_set <- function(x) {
  x <- unlist(x)
  if (is.null(x)) character(0) else sort(unique(as.character(x)))
}

CONFIG_PATH <- "config/query_config.yaml"

load_config <- function(path = CONFIG_PATH) {
  cfg <- yaml::read_yaml(path, fileEncoding = "UTF-8")
  # Folded YAML scalars join lines with a space; remove the spaces that this
  # introduces around "|" so the regexes stay exact.
  clean_rx <- function(x) str_squish(gsub("\\s*\\|\\s*", "|", x))
  cfg$taxon_groups <- map(cfg$taxon_groups, ~ modifyList(.x, list(classify = clean_rx(.x$classify))))
  cfg$themes       <- map(cfg$themes,       ~ modifyList(.x, list(classify = clean_rx(.x$classify))))
  cfg$contexts     <- map(cfg$contexts,     ~ modifyList(.x, list(classify = clean_rx(.x$classify))))
  # OpenAlex rejects wildcards inside quoted phrases in Boolean queries
  all_terms <- c(cfg$state_terms, unlist(map(cfg$taxon_groups, "search")))
  bad <- all_terms[str_detect(all_terms, '^".*[*?].*"$')]
  if (length(bad))
    stop("Wildcards are not allowed inside quoted phrases in query_config.yaml: ",
         paste(bad, collapse = ", "),
         "\nList the singular and plural forms instead, e.g. \"affective state\" OR \"affective states\".")
  cfg$md5 <- unname(tools::md5sum(path))
  cfg
}

# ---- Query building ---------------------------------------------------------
or_join <- function(x) paste(x, collapse = " OR ")

group_query <- function(group, cfg) {
  sprintf("(%s) AND (%s)", or_join(group$search), or_join(cfg$state_terms))
}

base_filter <- function(cfg) {
  f <- c(sprintf("publication_year:%d-%d", cfg$years$from, cfg$years$to),
         paste0("type:", paste(cfg$work_types, collapse = "|")))
  if (isTRUE(cfg$exclude_retracted)) f <- c(f, "is_retracted:false")
  paste(f, collapse = ",")
}

# ---- API --------------------------------------------------------------------
oa_get <- function(params, endpoint = "works") {
  req <- request(paste0("https://api.openalex.org/", endpoint)) |>
    req_url_query(!!!params) |>
    req_user_agent("IWRS-dashboard (R; httr2)") |>
    # Show OpenAlex's own explanation when a request is rejected
    req_error(body = \(resp) tryCatch({
      b <- resp_body_json(resp)
      paste(c(b$error, b$message), collapse = ": ")
    }, error = \(e) tryCatch(resp_body_string(resp), error = \(e2) NULL))) |>
    req_retry(max_tries = 6, backoff = ~ 2^.x,
              is_transient = \(resp) resp_status(resp) %in% c(429, 500, 502, 503))
  key <- Sys.getenv("OPENALEX_API_KEY")
  if (nzchar(key)) req <- req_auth_bearer_token(req, key)
  resp_body_json(req_perform(req), simplifyVector = FALSE)
}

SELECT_FIELDS <- paste(
  "id", "doi", "display_name", "publication_year", "type", "cited_by_count",
  "primary_location", "authorships", "abstract_inverted_index",
  "open_access", "language", "primary_topic", sep = ",")

rebuild_abstract <- function(idx) {
  if (is.null(idx) || length(idx) == 0) return(NA_character_)
  words <- rep(names(idx), lengths(idx))
  paste(words[order(unlist(idx))], collapse = " ")
}

flatten_work <- function(w) {
  auth  <- w$authorships %||% list()
  insts <- do.call(c, map(auth, "institutions"))
  first_ctry <- if (length(auth)) chr_set(auth[[1]]$countries) else character(0)
  tibble(
    id          = sub("https://openalex.org/", "", w$id),
    doi         = tolower(sub("https://doi.org/", "", w$doi %||% NA_character_)),
    title       = w$display_name %||% NA_character_,
    year        = as.integer(w$publication_year %||% NA),
    type        = w$type %||% NA_character_,
    cited_by    = as.integer(w$cited_by_count %||% 0L),
    journal     = w$primary_location$source$display_name %||% NA_character_,
    oa_status   = w$open_access$oa_status %||% NA_character_,
    language    = w$language %||% NA_character_,
    topic       = w$primary_topic$display_name %||% NA_character_,
    field       = w$primary_topic$field$display_name %||% NA_character_,
    countries   = list(chr_set(map(auth, "countries"))),
    institutions= list(chr_set(map(insts, "display_name"))),
    first_country = list(first_ctry %||% character(0)),
    abstract    = rebuild_abstract(w$abstract_inverted_index)
  )
}

# Cursor-paged retrieval of every work matching a search + filter.
fetch_search <- function(query, filter, label = "") {
  cursor <- "*"; out <- list(); total <- NA
  repeat {
    res <- oa_get(list(
      search.title_and_abstract.exact = query,
      filter = filter, select = SELECT_FIELDS,
      per_page = 100, cursor = cursor))
    if (is.na(total)) {
      total <- res$meta$count
      message(sprintf("  %-28s %6d works", label, total))
    }
    out <- c(out, map(res$results, flatten_work))
    cursor <- res$meta$next_cursor
    if (is.null(cursor) || length(res$results) == 0) break
    Sys.sleep(0.15)
  }
  list(works = bind_rows(out), count = total)
}

# ---- Classification ---------------------------------------------------------
# Returns a list-column with the ids of every pattern that matches each text.
classify_multi <- function(text, defs) {
  hits <- map(defs, ~ str_detect(text, regex(.x$classify, ignore_case = TRUE)))
  ids  <- map_chr(defs, "id")
  m <- do.call(cbind, hits)
  if (is.null(dim(m))) m <- matrix(m, ncol = length(defs))
  map(seq_len(nrow(m)), ~ ids[which(m[.x, ])])
}

# ---- Relevance filter -------------------------------------------------------
# Decides whether a retrieved paper is plausibly ABOUT invertebrate welfare/
# sentience/affect. Returns one reason per paper:
#   "title" / "abstract"  -> keep
#   "excluded" / "human-emotion" / "no-proximity" -> drop
make_relevance <- function(rel) {
  esc <- function(x) gsub("([.*+?^${}()|\\[\\]\\\\])", "\\\\\\1", x)
  phrase_rx <- function(p) paste0("\\b(", paste(map_chr(p, \(s) gsub(" ", "\\\\s+", esc(s))), collapse = "|"), ")\\b")
  list(
    window    = rel$window,
    excl      = regex(paste(rel$exclude, collapse = "|"), ignore_case = TRUE),
    excl_title = if (length(rel$exclude_title))
      regex(paste(rel$exclude_title, collapse = "|"), ignore_case = TRUE),
    human     = regex(rel$human_context, ignore_case = TRUE),
    tax_phr   = regex(phrase_rx(rel$taxon_phrases), ignore_case = TRUE),
    st_phr    = regex(phrase_rx(rel$state_phrases), ignore_case = TRUE),
    tax_pre   = paste0("^(", paste(rel$taxon_prefixes, collapse = "|"), ")"),
    tax_not   = paste0("^(", paste(rel$taxon_not_prefixes, collapse = "|"), ")"),
    tax_word  = paste0("^(", paste(rel$taxon_words, collapse = "|"), ")$"),
    tax_inf   = paste(rel$taxon_infixes, collapse = "|"),
    state     = paste0("^(", paste(rel$state_tokens, collapse = "|"), ")$")
  )
}

# Tokenise one sentence; multi-word taxa become "taxon_..." and bias phrases
# "state_..." so they count as single tokens.
rel_tokens <- function(s, R) {
  s <- str_replace_all(s, R$tax_phr, \(m) paste0("taxon_", gsub("\\s+", "_", m)))
  s <- str_replace_all(s, R$st_phr,  \(m) paste0("state_", gsub("\\s+", "_", m)))
  tok <- str_to_lower(str_split(s, "\\s+")[[1]])
  str_replace_all(tok, "[^[:alnum:]_-]", "")
}

rel_positions <- function(tok, R) {
  is_tax <- (str_detect(tok, R$tax_pre) & !str_detect(tok, R$tax_not)) |
            str_detect(tok, R$tax_word) | str_detect(tok, R$tax_inf) |
            startsWith(tok, "taxon_")
  is_st  <- str_detect(tok, R$state) | startsWith(tok, "state_")
  list(tax = which(is_tax), st = which(is_st))
}

relevance_reason <- function(title, abstract, themes, R) {
  title <- coalesce(title, ""); abstract <- coalesce(abstract, "")
  text <- paste(title, abstract, sep = ". ")
  if (str_detect(text, R$excl)) return("excluded")
  if (!is.null(R$excl_title) && str_detect(title, R$excl_title)) return("excluded")
  if (length(themes) && all(themes %in% c("emotion", "affect", "pain")) &&
      str_detect(text, R$human)) return("human-emotion")
  p <- rel_positions(rel_tokens(title, R), R)
  if (length(p$tax) && length(p$st)) return("title")
  for (s in str_split(abstract, "(?<=[.!?])\\s+")[[1]]) {
    p <- rel_positions(rel_tokens(s, R), R)
    if (length(p$tax) && length(p$st) &&
        min(abs(outer(p$tax, p$st, "-"))) <= R$window) return("abstract")
  }
  "no-proximity"
}

journal_group <- function(journal, cfg) {
  j <- str_to_lower(str_squish(journal))
  out <- rep("other", length(j))
  for (g in cfg$journal_groups) {
    out[j %in% str_to_lower(g$names)] <- g$id
  }
  out[is.na(j)] <- "unknown"
  out
}

latest_file <- function(dir, pattern) {
  f <- list.files(dir, pattern = pattern, full.names = TRUE)
  if (!length(f)) stop("No file matching ", pattern, " in ", dir)
  f[order(file.mtime(f), decreasing = TRUE)][1]
}
