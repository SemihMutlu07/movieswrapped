"""ZIP export extraction: nested folders, OS path separators, junk subfolders."""
import io
import zipfile
from pathlib import Path

from app.routes.analyze import (
    _find_csv_files,
    _safe_extract_letterboxd_zip,
    _username_from_profile,
)


WATCHED = b"Date,Name,Year,Letterboxd URI\n2024-01-01,Inception,2010,https://boxd.it/2b0k\n"
REVIEWS_ROOT = "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n2024-01-01,Inception,2010,https://boxd.it/abc,5,,root review,,2024-01-01\n"
REVIEWS_DELETED = "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n2024-01-01,Inception,2010,https://boxd.it/abc,5,,deleted review,,2024-01-01\n"
PROFILE = "Date Joined,Username,Given Name,Family Name\n2023-01-08,anlaki,Semih,Mutlu\n"


def _zip_bytes(entries: dict[str, str | bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in entries.items():
            data = content.encode("utf-8") if isinstance(content, str) else content
            zf.writestr(name, data)
    return buf.getvalue()


def test_extract_nested_folder_and_skips_junk(tmp_path: Path):
    payload = _zip_bytes({
        "letterboxd-anlaki-2026-02-13-14-29-utc/watched.csv": WATCHED.decode(),
        "letterboxd-anlaki-2026-02-13-14-29-utc/reviews.csv": REVIEWS_ROOT,
        "letterboxd-anlaki-2026-02-13-14-29-utc/deleted/reviews.csv": REVIEWS_DELETED,
        "letterboxd-anlaki-2026-02-13-14-29-utc/likes/films.csv": "Date,Name,Year,Letterboxd URI\n2024-01-01,Liked Film,1999,https://boxd.it/x\n",
        "letterboxd-anlaki-2026-02-13-14-29-utc/profile.csv": PROFILE,
        "__MACOSX/._watched.csv": b"junk",
    })
    _safe_extract_letterboxd_zip(io.BytesIO(payload), tmp_path)
    found = _find_csv_files(tmp_path)
    assert "films.csv" not in found
    assert "watched.csv" in found
    assert "reviews.csv" in found
    reviews = Path(found["reviews.csv"]).read_text(encoding="utf-8")
    assert "root review" in reviews
    assert "deleted review" not in reviews
    assert _username_from_profile(found) == "anlaki"


def test_extract_windows_backslash_paths(tmp_path: Path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        info = zipfile.ZipInfo("letterboxd-user\\watched.csv")
        zf.writestr(info, WATCHED)
        info = zipfile.ZipInfo("letterboxd-user\\reviews.csv")
        zf.writestr(info, REVIEWS_ROOT.encode("utf-8"))
    _safe_extract_letterboxd_zip(io.BytesIO(buf.getvalue()), tmp_path)
    found = _find_csv_files(tmp_path)
    assert set(found) >= {"watched.csv", "reviews.csv"}


def test_username_from_profile_utf8_bom(tmp_path: Path):
    profile = tmp_path / "profile.csv"
    profile.write_bytes("\ufeff".encode("utf-8") + PROFILE.encode("utf-8"))
    assert _username_from_profile({"profile.csv": str(profile)}) == "anlaki"
