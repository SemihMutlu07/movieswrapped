"""ZIP last-12-months window from diary dates."""
from datetime import datetime

import pandas as pd

from app.services.period_window import attach_last_12_months, last_12_month_keys


NOW = datetime(2026, 9, 17)


def test_last_12_month_keys_keep_recent_diary_rows():
    diary = pd.DataFrame({
        "Name": ["Old Film", "New Film"],
        "Year": [1999, 2024],
        "Watched Date": ["2024-01-01", "2026-08-01"],
    })
    keys = last_12_month_keys(diary, now=NOW)
    assert ("new film", 2024) in keys
    assert ("old film", 1999) not in keys


def test_attach_last_12_months_omits_when_diary_empty():
    stats = {"total_films": 2}
    attach_last_12_months(
        stats,
        films_enriched=pd.DataFrame({"title": ["A"], "year": [2020]}),
        films_df=pd.DataFrame({"title": ["A"], "year": [2020]}),
        diary_df=pd.DataFrame(),
        reviews_df=pd.DataFrame(),
        watched_df=pd.DataFrame(),
        now=NOW,
    )
    assert "last_12_months" not in stats


def test_attach_last_12_months_recomputes_counts_for_recent_films():
    films_enriched = pd.DataFrame({
        "title": ["Old Film", "New Film"],
        "letterboxd_title": ["Old Film", "New Film"],
        "year": [1999, 2024],
        "director": ["Old Dir", "New Dir"],
        "cast": [["Old Act"], ["New Act"]],
        "genres": [["Drama"], ["Comedy"]],
        "runtime": [120, 90],
        "poster_path": ["/old.jpg", "/new.jpg"],
    })
    films_df = pd.DataFrame({
        "title": ["Old Film", "New Film"],
        "year": [1999, 2024],
        "rating": [4.0, 5.0],
    })
    diary = pd.DataFrame({
        "Name": ["Old Film", "New Film"],
        "Year": [1999, 2024],
        "Watched Date": ["2024-01-01", "2026-08-01"],
    })
    stats = {
        "total_films": 2,
        "top_directors": [{"name": "New Dir", "profile_path": "/d.jpg", "count": 1}],
        "top_actors": [{"name": "New Act", "profile_path": "/a.jpg", "count": 1}],
    }
    attach_last_12_months(
        stats,
        films_enriched=films_enriched,
        films_df=films_df,
        diary_df=diary,
        reviews_df=pd.DataFrame(),
        watched_df=pd.DataFrame({
            "Name": ["Old Film", "New Film"],
            "Year": [1999, 2024],
            "Date": ["2024-01-01", "2026-08-01"],
        }),
        now=NOW,
    )
    window = stats["last_12_months"]
    assert window["total_films"] == 1
    assert window["top_directors"][0]["name"] == "New Dir"
    assert window["top_directors"][0]["profile_path"] == "/d.jpg"
    assert window["analysis_period"]["key"] == "year"
    assert stats["total_films"] == 2
