import pandas as pd
import pytest

from app.services.review_analysis import (
    _select_longest_review_entry,
    _word_count,
    compute_review_metrics,
    enrich_scraped_reviews,
    recompute_longest_review,
)


def test_longest_review_uses_readable_character_count_not_likes_or_url_length():
    reviews = pd.DataFrame(
        [
            {
                "Name": "Most Liked",
                "Year": 2025,
                "Likes": 99,
                "Review": f"kısa yorum https://example.com/{'x' * 500}",
            },
            {
                "Name": "Zulu",
                "Year": 2025,
                "Likes": 0,
                "Review": "İstanbul’da geçen bu film kalbimde uzun süre yaşayacak",
            },
            {
                "Name": "Alpha",
                "Year": 2024,
                "Likes": 0,
                "Review": "İstanbul’da geçen bu film kalbimde uzun süre yaşayacak",
            },
            {
                "Name": "Beta URL Tie",
                "Year": 2024,
                "Likes": 0,
                "Review": f"İstanbul’da geçen bu film kalbimde uzun süre yaşayacak HTTPS://EXAMPLE.COM/{'y' * 500}",
            },
            {
                "Name": "Combining",
                "Year": 2023,
                "Likes": 0,
                "Review": "nai\u0308ve <a href=\"https://example.com/path\">harika</a>",
            },
        ]
    )

    metrics = compute_review_metrics(reviews)

    assert metrics["longest_review"] == {
        "title": "Alpha",
        "year": "2024",
        "length": 54,
        "unit": "characters",
    }
    by_title = {review["title"]: review for review in metrics["reviews"]}
    assert by_title["Most Liked"]["word_count"] == 2
    assert len(metrics["reviews"]) == len(reviews)
    assert by_title["Alpha"]["word_count"] == 8
    assert by_title["Beta URL Tie"]["word_count"] == 8
    assert by_title["Combining"]["word_count"] == 2
    assert by_title["Most Liked"]["char_length"] == 10


def test_review_metrics_handle_duplicate_dataframe_indices():
    reviews = pd.DataFrame(
        [
            {"Name": "Long", "Year": 2025, "Review": "üç kelimelik yorum"},
            {"Name": "Brief", "Year": 2024, "Review": "kısa"},
        ],
        index=[7, 7],
    )

    metrics = compute_review_metrics(reviews)

    assert metrics["longest_review"]["title"] == "Long"
    assert metrics["shortest_review"]["title"] == "Brief"


def test_longest_review_short_vs_long():
    metrics = compute_review_metrics(
        pd.DataFrame(
            [
                {"Name": "Brief", "Year": 2024, "Review": "ok"},
                {"Name": "Epic", "Year": 2024, "Review": "one two three four five six seven"},
            ]
        )
    )
    assert metrics["longest_review"]["title"] == "Epic"
    assert metrics["longest_review"]["unit"] == "characters"
    assert metrics["longest_review"]["length"] == 33


def test_longest_review_strips_html_and_newlines():
    html_review = "line one\nline two<p>hidden</p>line three"
    metrics = compute_review_metrics(
        pd.DataFrame([{"Name": "HTML Film", "Year": 2024, "Review": html_review}])
    )
    assert "hidden" in metrics["reviews"][0]["normalized_text"]
    assert "<p>" not in metrics["reviews"][0]["normalized_text"]
    assert metrics["reviews"][0]["word_count"] == 7
    assert metrics["longest_review"]["length"] == 35


def test_longest_review_unicode_turkish_word_count():
    text = "İstanbul’da geçen bu film kalbimde uzun süre yaşayacak"
    assert _word_count(text) == 8
    metrics = compute_review_metrics(pd.DataFrame([{"Name": "TR", "Year": 2024, "Review": text}]))
    assert metrics["longest_review"]["length"] == 54


def test_longest_review_tie_breaks_by_title_not_likes():
    tie_text = "İstanbul’da geçen bu film kalbimde uzun süre yaşayacak"
    metrics = compute_review_metrics(
        pd.DataFrame(
            [
                {"Name": "Zulu", "Year": 2025, "Likes": 50, "Review": tie_text},
                {"Name": "Alpha", "Year": 2024, "Likes": 0, "Review": tie_text},
            ]
        )
    )
    assert metrics["longest_review"]["title"] == "Alpha"


def test_longest_review_skips_missing_text():
    picked = _select_longest_review_entry(
        [
            {"title": "Empty", "year": 2024, "text": "   "},
            {"title": "Real", "year": 2024, "text": "two words"},
        ]
    )
    assert picked["title"] == "Real"


def test_bare_share_urls_do_not_inflate_word_count():
    with_url = (
        "İstanbul’da geçen bu film kalbimde uzun süre yaşayacak "
        "prnt.sc/abc123 open.spotify.com/track/xyz"
    )
    plain = "İstanbul’da geçen bu film kalbimde uzun süre yaşayacak"
    assert _word_count(with_url) == _word_count(plain)


def test_enrich_picks_longer_duplicate_scrape_and_recomputes_longest():
    analysis = {
        "reviews": [
            {"title": "The Life of Chuck", "year": 2024, "text": "short excerpt", "likes": 1},
            {"title": "Blow-Up", "year": 1966, "text": "medium length review here", "likes": 0},
        ],
        "longest_review": {"title": "The Life of Chuck", "year": "2024", "length": 13, "unit": "characters"},
    }
    scraped = [
        {
            "title": "The Life of Chuck",
            "year": 2024,
            "review_text": "short excerpt",
            "review_path": "/u/x/film/chuck/1/",
            "likers": [],
            "likers_complete": True,
        },
        {
            "title": "Blow-Up",
            "year": 1966,
            "review_text": " ".join(["word"] * 120),
            "review_path": "/u/x/film/blow-up/2/",
            "likers": [],
            "likers_complete": True,
        },
    ]
    enrich_scraped_reviews(analysis, scraped, [])
    assert analysis["longest_review"]["title"] == "Blow-Up"
    assert analysis["longest_review"]["length"] == 599
    assert analysis["longest_review"]["unit"] == "characters"
    blow = next(r for r in analysis["reviews"] if r["title"] == "Blow-Up")
    assert blow["text"] == scraped[1]["review_text"]
    assert blow["word_count"] == 120


def test_recompute_longest_review_from_reviews_list():
    analysis = {
        "reviews": [
            {"title": "A", "year": 2020, "text": "one"},
            {"title": "B", "year": 2021, "text": "one two three", "word_count": 3},
        ]
    }
    recompute_longest_review(analysis)
    assert analysis["longest_review"] == {
        "title": "B",
        "year": "2021",
        "length": 13,
        "unit": "characters",
    }
