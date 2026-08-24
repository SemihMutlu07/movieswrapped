"""
Review text analysis for Letterboxd Wrapped.

Parses reviews.csv from Letterboxd export and computes text-based metrics:
word frequency, bigram frequency, review length by rating, language mix,
volume over time, and other linguistic stats.

Phase 1 — CSV path only (HTML scrape path comes in Phase 2).
"""

from __future__ import annotations

import html
import math
import re
import unicodedata
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

# ---------------------------------------------------------------------------
# Turkish + English stopwords (common function words to exclude from frequency)
# ---------------------------------------------------------------------------
_TURKISH_STOPWORDS: set[str] = {
    "acaba", "altı", "altında", "ama", "ancak", "anda", "arada", "artık",
    "asıl", "aslında", "az", "bana", "bazen", "bazı", "ben", "bence",
    "beni", "benim", "beri", "beş", "bile", "bin", "bir", "birçok",
    "biri", "birinde", "birisi", "biz", "bize", "bizi", "bizim", "boş",
    "bu", "buna", "bunda", "bundan", "bunlar", "bunları", "bunların",
    "bunu", "bunun", "da", "daha", "dahi", "de", "defa", "değil",
    "diğer", "diye", "dolayı", "dört", "dörtte", "ediyor", "eğer",
    "elbette", "en", "etmek", "etti", "ettiği", "eyle", "falan", "fazla",
    "filan", "gene", "gibi", "göre", "güzel", "hala", "halde", "hande",
    "hangi", "hangisi", "hani", "harici", "hatta", "hatır", "hem",
    "henüz", "hep", "hepsi", "her", "herhangi", "herkes", "herkesin",
    "hiç", "hiçbir", "hiçbiri", "için", "içinde", "iken", "iki",
    "ila", "ile", "ilgili", "ilk", "illa", "insan", "ise", "işte",
    "itibaren", "itibariyle", "iyi", "iyice", "kadar", "karşı",
    "kat", "kendi", "kendine", "kendini", "kendisi", "kez", "kim",
    "kimse", "ki", "lakin", "madem", "mi", "mı", "mu", "mü",
    "nasıl", "ne", "neden", "nedenle", "nerde", "nerede", "nereye",
    "niye", "niçin", "o", "olan", "olarak", "oldu", "olduğu",
    "olduğunu", "oldukça", "olmak", "olması", "olmayan", "olmaz",
    "olsa", "olsun", "olur", "oluyor", "ona", "onlar", "onlara",
    "onları", "onların", "onu", "onun", "orada", "otuz", "oysa",
    "pek", "rağmen", "sade", "sadece", "sanki", "sana", "sen",
    "senden", "seni", "senin", "siz", "sizden", "sizi", "sizin",
    "şey", "şeyden", "şeye", "şeyi", "şeyler", "şu", "şuna",
    "şunda", "şundan", "şunlar", "şunu", "tabi", "tabii", "tam",
    "tamam", "tüm", "üzere", "var", "ve", "veya", "vefat", "veyahut",
    "ya", "yani", "yapacak", "yapılan", "yapmak", "yaptı", "yaptığı",
    "yaptığını", "yaptıkları", "yedi", "yer", "yine", "yok", "yoksa",
    "yoluyla", "yüz", "zaten", "çok", "çünkü", "önce", "öte",
    "öyle", "ürzere", "şöyle", "şimdi", "şu",
}

_ENGLISH_STOPWORDS: set[str] = {
    "a", "about", "above", "after", "again", "against", "all", "am",
    "an", "and", "any", "are", "arent", "as", "at", "be", "because",
    "been", "before", "being", "below", "between", "both", "but",
    "by", "cant", "cannot", "could", "couldnt", "did", "didnt", "do",
    "does", "doesnt", "doing", "dont", "down", "during", "each",
    "few", "for", "from", "further", "had", "hadnt", "has", "hasnt",
    "have", "havent", "having", "he", "hed", "hell", "hes", "her",
    "here", "heres", "hers", "herself", "him", "himself", "his",
    "how", "hows", "i", "id", "ill", "im", "ive", "if", "in",
    "into", "is", "isnt", "it", "its", "itself", "lets", "me",
    "more", "most", "mustnt", "my", "myself", "no", "nor", "not",
    "of", "off", "on", "once", "only", "or", "other", "ought",
    "our", "ours", "ourselves", "out", "over", "own", "same", "shant",
    "she", "shed", "shell", "shes", "should", "shouldnt", "so",
    "some", "such", "than", "that", "thats", "the", "their",
    "theirs", "them", "themselves", "then", "there", "theres",
    "these", "they", "theyd", "theyll", "theyre", "theyve",
    "this", "those", "through", "to", "too", "under", "until",
    "up", "very", "was", "wasnt", "we", "wed", "well", "were",
    "weve", "were", "werent", "what", "whats", "when", "whens",
    "where", "wheres", "which", "while", "who", "whos", "whom",
    "why", "whys", "with", "wont", "would", "wouldnt", "you",
    "youd", "youll", "youre", "youve", "your", "yours", "yourself",
    "yourselves",
}

# Movie-review noise: ultra-common content words that drown out interesting
# vocabulary like 'sinematografi', 'ekspresyonizm'. Filtering them surfaces
# the words that actually characterize a viewer's voice.
_REVIEW_NOISE: set[str] = {
    # TR — film references
    "film", "filmi", "filme", "filmde", "filmin", "filmler", "filmleri",
    "filmlerin", "filmlerde", "sinema", "sinemanın", "sinemayı",
    # TR — viewing verbs / generic descriptors
    "izledim", "izledik", "izledi", "izleyin", "izlerken", "izleyip", "izlerken",
    "gördüm", "baktım", "anlatıyor", "anlatıyordu", "yapıyor", "yapıyordu",
    "söylüyor", "söylüyordu", "diyor", "diyordu",
    # TR — generic praise/critique words that everyone uses
    "iyi", "kötü", "güzel", "harika", "fena", "süper", "berbat",
    # EN — same shapes that show up in mixed-language reviews
    "film", "films", "movie", "movies", "watch", "watched", "watching",
    "scene", "scenes", "actor", "actors", "actress", "director",
    "really", "very", "just", "even", "still", "thing", "things",
}

STOPWORDS = _TURKISH_STOPWORDS | _ENGLISH_STOPWORDS | _REVIEW_NOISE

# Turkish-specific Unicode characters for language-origin detection
_TURKISH_CHARS = set("ığüşöçİĞÜŞÖÇ")

# Regex to strip HTML tags
_HTML_TAG_RE = re.compile(r"<[^>]+>")
# URLs are noise for readable review metrics, regardless of scheme casing.
_URL_RE = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
# Bare share links pasted without a scheme (common on Letterboxd reviews).
_BARE_SHARE_URL_RE = re.compile(
    r"(?<![/\w@])(?:prnt\.sc/\S+|open\.spotify\.com/\S+|letterboxd\.com/\S+|"
    r"eksisozluk\.com/\S+|twitter\.com/\S+|x\.com/\S+)",
    re.IGNORECASE,
)
# Legacy tokenization keeps its curated language behavior for word clouds.
_WORD_RE = re.compile(r"[a-zA-ZğüşıöçĞÜŞİÖÇ']+(?:'[a-zA-ZğüşıöçĞÜŞİÖÇ]+)?")

# Letterboxd boilerplate injected before spoiler-flagged reviews — strip before word analysis
_SPOILER_DISCLAIMER = "This review may contain spoilers. I can handle the truth."


def _strip_html(text: str) -> str:
    """Remove HTML tags without joining words that lived in separate nodes."""
    return _HTML_TAG_RE.sub(" ", text)


def _strip_urls(text: str) -> str:
    """Remove URLs from review text."""
    without_schemes = _URL_RE.sub(" ", text)
    return _BARE_SHARE_URL_RE.sub(" ", without_schemes)


def _clean_readable_text(text: str) -> str:
    without_boilerplate = text.replace(_SPOILER_DISCLAIMER, "")
    without_markup = _strip_html(without_boilerplate)
    return unicodedata.normalize("NFC", html.unescape(_strip_urls(without_markup)))


def _count_readable_words(text: str) -> int:
    count = 0
    in_word = False
    for index, character in enumerate(text):
        category = unicodedata.category(character)
        if category[0] in {"L", "N"}:
            if not in_word:
                count += 1
            in_word = True
        elif category[0] == "M" and in_word:
            continue
        elif (
            character in {"'", "’"}
            and in_word
            and index + 1 < len(text)
            and unicodedata.category(text[index + 1])[0] in {"L", "N"}
        ):
            continue
        else:
            in_word = False
    return count


def _word_count(text: str) -> int:
    """Count readable Unicode words without treating pasted URLs as prose."""
    return _count_readable_words(_clean_readable_text(text))


def _char_length(text: str) -> int:
    """Count readable characters after stripping markup/URLs and squeezing whitespace."""
    normalized = re.sub(r"\s+", " ", _clean_readable_text(text)).strip()
    return len(normalized)


def _tokenize(text: str) -> list[str]:
    """Tokenize text into lowercase words, filtering stopwords and short tokens."""
    cleaned = _clean_readable_text(text)
    words = _WORD_RE.findall(cleaned)
    return [
        w.lower() for w in words
        if len(w) > 2 and w.lower() not in STOPWORDS
    ]


def _compute_bigrams(tokens: list[str]) -> list[tuple[str, str]]:
    """Generate bigrams from a token list."""
    return [(tokens[i], tokens[i + 1]) for i in range(len(tokens) - 1)]


def _guess_language(text: str) -> str:
    """
    Simple language-origin heuristic based on Turkish-specific characters.

    Returns 'tr', 'en', or 'mixed'.
    """
    cleaned = _strip_html(_strip_urls(text))
    turkish_char_count = sum(1 for c in cleaned if c in _TURKISH_CHARS)
    total_alpha = sum(1 for c in cleaned if c.isalpha())
    if total_alpha == 0:
        return "en"  # default
    ratio = turkish_char_count / total_alpha
    if ratio > 0.03:
        return "tr"
    return "en"


def _title_key(title: Any) -> str:
    # NFC-normalize before casefolding: accented titles ("Amélie", "Léon") can
    # reach this function pre-composed from one source (TMDB JSON) and
    # decomposed (base char + combining accent) from another (scraped HTML),
    # which look identical but fail a plain casefold() comparison.
    normalized = unicodedata.normalize("NFC", str(title or ""))
    return normalized.strip().casefold()


def _year_key(year: Any) -> Optional[str]:
    try:
        return str(int(float(year)))
    except (TypeError, ValueError):
        return None


def _review_sort_key(review: dict) -> tuple:
    """Deterministic longest-review ordering: characters desc, then title/year/text."""
    text = str(review.get("text") or review.get("text_preview") or "")
    normalized = str(review.get("normalized_text") or _clean_readable_text(text))
    char_length = int(review.get("char_length") if review.get("char_length") is not None else _char_length(text))
    return (
        -char_length,
        _title_key(review.get("title")),
        str(review.get("year") or ""),
        normalized,
        str(review.get("review_path") or ""),
    )


def _select_longest_review_entry(reviews: list[dict]) -> Optional[dict]:
    """Pick the review with the highest readable character length."""
    candidates: list[dict] = []
    for review in reviews:
        text = review.get("text") or review.get("text_preview") or ""
        if not str(text).strip() and not review.get("normalized_text"):
            continue
        candidates.append(review)
    if not candidates:
        return None
    position = min(range(len(candidates)), key=lambda index: _review_sort_key(candidates[index]))
    return candidates[position]


def _longest_review_summary(review: dict) -> dict:
    text = str(review.get("text") or review.get("text_preview") or "")
    char_length = int(
        review.get("char_length") if review.get("char_length") is not None else _char_length(text)
    )
    summary = {
        "title": str(review.get("title", "")),
        "year": str(review.get("year", "")),
        "length": char_length,
        "unit": "characters",
    }
    review_path = review.get("review_path")
    if isinstance(review_path, str) and review_path:
        summary["review_path"] = review_path
    return summary


def recompute_longest_review(review_analysis: Dict[str, Any]) -> None:
    """Refresh longest_review from enriched review rows (scrape path)."""
    picked = _select_longest_review_entry(review_analysis.get("reviews") or [])
    if picked:
        review_analysis["longest_review"] = _longest_review_summary(picked)


def _apply_review_text_fields(review: dict, text: str) -> None:
    review["text"] = text
    review["normalized_text"] = _clean_readable_text(text)
    review["char_length"] = _char_length(text)
    review["word_count"] = _word_count(text)


def enrich_scraped_reviews(
    review_analysis: Dict[str, Any],
    scraped_reviews: list[dict],
    all_films: list[dict],
) -> Dict[str, Any]:
    """Merge scraped liker identities and poster paths into the review payload.

    Mutates, for every entry in review_analysis['reviews'] and
    ['top_liked_reviews']: poster_path (matched from all_films by normalized
    title+year — no new TMDB call), likers, likers_complete, review_path,
    normalized_text, char_length, word_count, and syncs `text` from the scrape.
    Recomputes longest_review from the enriched rows. An unmatched review keeps
    an empty, complete liker set (there is nothing to crawl) and a blank poster_path.
    """
    scraped_by_ty: dict[tuple, list] = {}
    scraped_by_t: dict[str, list] = {}
    for r in scraped_reviews:
        t = _title_key(r.get("title"))
        scraped_by_ty.setdefault((t, _year_key(r.get("year"))), []).append(r)
        scraped_by_t.setdefault(t, []).append(r)

    def _pick_scraped(title_key: str, year_key: Optional[str]) -> Optional[dict]:
        keyed = scraped_by_ty.get((title_key, year_key)) or []
        if len(keyed) == 1:
            return keyed[0]
        if len(keyed) > 1:
            return max(keyed, key=lambda row: _word_count(str(row.get("review_text") or "")))
        titled = scraped_by_t.get(title_key) or []
        if len(titled) == 1:
            return titled[0]
        if len(titled) > 1:
            return max(titled, key=lambda row: _word_count(str(row.get("review_text") or "")))
        return None

    poster_by_ty: dict = {}
    poster_by_t: dict = {}
    for f in all_films:
        path = f.get("poster_path")
        if not isinstance(path, str) or not path:
            continue
        t = _title_key(f.get("title"))
        poster_by_ty.setdefault((t, _year_key(f.get("year"))), path)
        poster_by_t.setdefault(t, path)

    def _enrich(review: dict) -> None:
        t = _title_key(review.get("title"))
        y = _year_key(review.get("year"))
        scraped = _pick_scraped(t, y)
        existing = str(review.get("text") or review.get("text_preview") or "")
        scraped_text = str(scraped.get("review_text") or "") if scraped else ""
        if scraped_text and (
            not existing
            or len(scraped_text) > len(existing)
            or _word_count(scraped_text) > _word_count(existing)
        ):
            text = scraped_text
        else:
            text = existing or scraped_text
        _apply_review_text_fields(review, text)
        if scraped:
            review["review_path"] = scraped.get("review_path", "")
            review["likers"] = scraped.get("likers", [])
            review["likers_complete"] = scraped.get("likers_complete", True)
        else:
            review["likers"] = []
            review["likers_complete"] = True
        review["poster_path"] = poster_by_ty.get((t, y)) or poster_by_t.get(t) or ""

    for review in review_analysis.get("reviews", []):
        _enrich(review)
    for review in review_analysis.get("top_liked_reviews", []):
        _enrich(review)
    recompute_longest_review(review_analysis)
    return review_analysis



def compute_review_metrics(reviews_df: pd.DataFrame) -> Dict[str, Any]:
    """
    Compute text analysis metrics from a Letterboxd reviews.csv DataFrame.

    Expected columns: Date, Name, Year, Rating, Rewatch, Review, Tags, Watched Date.
    Only 'Review' (text), 'Rating', 'Date', 'Rewatch', 'Name', 'Year' are used.

    Returns a dict suitable for inclusion in the stats response.
    """
    if reviews_df.empty:
        return {"total_reviews": 0, "reviews_with_text": 0}

    # --- Normalize columns ---
    df = reviews_df.copy()
    df.columns = df.columns.str.strip()

    # Rename to match internal convention
    rename_map = {}
    if "Name" in df.columns:
        rename_map["Name"] = "title"
    if "Year" in df.columns:
        rename_map["Year"] = "year"
    if "Review" in df.columns:
        rename_map["Review"] = "review"
    if "Rating" in df.columns:
        rename_map["Rating"] = "rating"
    if "Date" in df.columns:
        rename_map["Date"] = "date"
    if "Rewatch" in df.columns:
        rename_map["Rewatch"] = "rewatch"
    if "Likes" in df.columns:
        rename_map["Likes"] = "like_count"
    if "Slug" in df.columns:
        rename_map["Slug"] = "slug"

    df = df.rename(columns=rename_map)

    # Convert year to string (pandas reads 4-digit years as float)
    if "year" in df.columns:
        df["year"] = df["year"].fillna("").astype(str).str.replace(r"\.0$", "", regex=True)

    # Ensure review column exists
    if "review" not in df.columns:
        return {"total_reviews": len(df), "reviews_with_text": 0}

    # Drop rows with no review text
    df["review"] = df["review"].fillna("").astype(str).str.strip()
    with_text = df[df["review"] != ""].copy()
    total_reviews = len(df)
    reviews_with_text = len(with_text)


    if reviews_with_text == 0:
        return {
            "total_reviews": total_reviews,
            "reviews_with_text": 0,
            "review_rate": 0.0,
            "reviews": [],
        }

    # --- Tokenize all review text ---
    with_text["tokens"] = with_text["review"].apply(_tokenize)
    with_text["readable_text"] = with_text["review"].apply(_clean_readable_text)
    with_text["char_length"] = with_text["review"].apply(_char_length)
    with_text["word_count"] = with_text["review"].apply(_word_count)
    with_text["language"] = with_text["review"].apply(_guess_language)

    # --- Word frequency ---
    all_tokens: list[str] = []
    for tokens in with_text["tokens"]:
        all_tokens.extend(tokens)

    word_counts = Counter(all_tokens)
    top_words = [{"word": w, "count": c} for w, c in word_counts.most_common(50)]

    # --- Bigram frequency ---
    all_bigrams: list[tuple[str, str]] = []
    for tokens in with_text["tokens"]:
        all_bigrams.extend(_compute_bigrams(tokens))

    bigram_counter: Counter[str] = Counter()
    for w1, w2 in all_bigrams:
        if w1 in STOPWORDS or w2 in STOPWORDS:
            continue
        bigram_counter[f"{w1} {w2}"] += 1

    top_bigrams = [
        {"phrase": p, "count": c}
        for p, c in bigram_counter.most_common(20)
    ]

    # --- Review length by rating ---
    length_by_rating: list[dict] = []
    if "rating" in with_text.columns:
        rating_groups = with_text[with_text["rating"].notna()].groupby("rating")
        for rating_val, group in sorted(rating_groups):
            length_by_rating.append({
                "rating": float(rating_val),
                "avg_chars": round(float(group["char_length"].mean()), 1),
                "avg_words": round(float(group["word_count"].mean()), 1),
                "count": int(len(group)),
            })

    # --- Language mix ---
    lang_counts = with_text["language"].value_counts()
    total_lang = int(lang_counts.sum())
    language_mix = {}
    for lang in ["tr", "en", "mixed"]:
        count = int(lang_counts.get(lang, 0))
        if total_lang > 0:
            language_mix[lang] = {
                "count": count,
                "percentage": round((count / total_lang) * 100, 1),
            }
        else:
            language_mix[lang] = {"count": 0, "percentage": 0.0}

    # --- Review volume over time ---
    volume_by_year: list[dict] = []
    if "date" in with_text.columns:
        with_text["date"] = pd.to_datetime(with_text["date"], errors="coerce")
        yearly = with_text.dropna(subset=["date"])
        if not yearly.empty:
            yearly["year_str"] = yearly["date"].dt.year.astype(str)
            yearly_counts = yearly["year_str"].value_counts().sort_index()
            volume_by_year = [
                {"year": year, "count": int(count)}
                for year, count in yearly_counts.items()
            ]

    # --- Average length over time ---
    length_over_time: list[dict] = []
    if "date" in with_text.columns and not yearly.empty:
        yearly["month_str"] = yearly["date"].dt.strftime("%Y-%m")
        monthly_groups = yearly.groupby("month_str")
        for month_str, group in sorted(monthly_groups):
            count = len(group)
            if count >= 3:
                length_over_time.append({
                    "month": month_str,
                    "avg_chars": round(float(group["char_length"].mean()), 1),
                    "avg_words": round(float(group["word_count"].mean()), 1),
                    "count": count,
                })


    # --- Longest / shortest ---
    # Character count is the product contract. Title, year, and readable text make
    # ties deterministic without allowing likes, URL length, or HTML to win.
    longest_review = None
    longest_row = _select_longest_review_entry(
        [
            {
                "title": row.get("title"),
                "year": row.get("year"),
                "text": row.get("review"),
                "word_count": int(row["word_count"]),
                "normalized_text": str(row.get("readable_text") or ""),
                "review_path": str(row.get("slug") or ""),
            }
            for _, row in with_text.iterrows()
        ]
    )
    if longest_row:
        longest_review = _longest_review_summary(longest_row)

    shortest_positions = [
        position
        for position in range(len(with_text))
        if int(with_text.iloc[position]["char_length"]) > 0
    ]
    if shortest_positions:
        shortest_position = min(
            shortest_positions,
            key=lambda position: int(with_text.iloc[position]["char_length"]),
        )
        row = with_text.iloc[shortest_position]
        shortest_review = {
            "title": str(row.get("title", "")),
            "year": str(row.get("year", "")),
            "length": int(row["char_length"]),
        }

    # --- Rewatch reviews ---
    rewatch_count = 0
    if "rewatch" in with_text.columns:
        rewatch_count = int(with_text["rewatch"].fillna("").astype(str).str.lower()
                            .eq("yes").sum())

    # --- Top 3 most-reviewed films ---
    title_year_counts: Counter[str] = Counter()
    for _, row in with_text.iterrows():
        key = f"{row.get('title', '?')} ({row.get('year', '?')})"
        title_year_counts[key] += 1

    most_reviewed = [
        {"film": f, "count": c}
        for f, c in title_year_counts.most_common(3)
    ]

    # --- Summary stats ---
    total_words = int(with_text["word_count"].sum())
    avg_chars = round(float(with_text["char_length"].mean()), 1)
    avg_words = round(float(with_text["word_count"].mean()), 1)

    # Estimate vocab richness: unique tokens / total tokens
    vocab_richness = round(len(word_counts) / total_words, 4) if total_words > 0 else 0.0

    # --- Individual reviews for frontend filtering ---
    reviews_list: list[dict] = []
    for _, row in with_text.iterrows():
        raw_text = str(row.get("review", ""))
        reviews_list.append({
            "title": str(row.get("title", "")),
            "year": int(float(row.get("year", 0))) if pd.notna(row.get("year")) and str(row.get("year", "")).replace(".", "", 1).isdigit() else None,
            "text": raw_text,
            "normalized_text": str(row.get("readable_text") or _clean_readable_text(raw_text)),
            "likes": int(row.get("like_count", 0)) if pd.notna(row.get("like_count")) else 0,
            "rating": float(row["rating"]) if "rating" in row and pd.notna(row.get("rating")) else None,
            "char_length": int(row["char_length"]),
            "word_count": int(row["word_count"]),
            "review_path": str(row.get("slug") or ""),
        })

    # --- Top liked reviews + total likes (scraped HTML path only) ---
    # The 'like_count' column holds, per row, the count of people who liked
    # that specific review (parsed from each card's LikeComponent[data-count]).
    # The sum is therefore likes RECEIVED on the user's reviews — never likes
    # this user has given to other people's reviews (that lives on a different
    # Letterboxd surface and is not scraped here).
    top_liked_reviews: list[dict] = []
    total_review_likes: Optional[int] = None
    reviews_with_likes_data: Optional[int] = None
    if "like_count" in with_text.columns:
        likes_series = pd.to_numeric(with_text["like_count"], errors="coerce")
        liked = with_text.assign(_likes=likes_series).dropna(subset=["_likes"])
        if not liked.empty:
            total_review_likes = int(liked["_likes"].sum())
            reviews_with_likes_data = int(len(liked))
            ranked = liked.sort_values("_likes", ascending=False).head(3)
            for _, row in ranked.iterrows():
                preview = str(row.get("review", ""))[:240]
                top_liked_reviews.append({
                    "title": str(row.get("title", "")),
                    "year": str(row.get("year", "")),
                    "slug": str(row.get("slug", "")),
                    "like_count": int(row["_likes"]),
                    "rating": (float(row["rating"]) if "rating" in row and pd.notna(row.get("rating")) else None),
                    "review_date": (
                        row["date"].isoformat() if "date" in row and isinstance(row.get("date"), pd.Timestamp)
                        else str(row.get("date", ""))
                    ),
                    "text_preview": preview,
                })

    return {
        "total_reviews": total_reviews,
        "reviews_with_text": reviews_with_text,
        "review_rate": round((reviews_with_text / total_reviews) * 100, 1) if total_reviews > 0 else 0.0,
        "total_words_written": total_words,
        "avg_review_length_chars": avg_chars,
        "avg_review_length_words": avg_words,
        "unique_words_used": len(word_counts),
        "vocab_richness": vocab_richness,
        "longest_review": longest_review,
        "shortest_review": shortest_review,
        "rewatch_reviews": rewatch_count,
        "word_frequency": top_words,
        "bigram_frequency": top_bigrams,
        "avg_length_by_rating": length_by_rating,
        "language_mix": language_mix,
        "review_volume_by_year": volume_by_year,
        "avg_length_over_time": length_over_time,
        "most_reviewed_films": most_reviewed,
        "reviews": reviews_list,
        "top_liked_reviews": top_liked_reviews,
        "total_review_likes": total_review_likes,
        "reviews_with_likes_data": reviews_with_likes_data,
    }
