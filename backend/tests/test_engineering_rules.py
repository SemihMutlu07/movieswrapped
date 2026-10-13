"""Lock the agent rule that allows the residential profile worker."""

from pathlib import Path

RULE = Path(__file__).resolve().parents[2] / ".cursor" / "rules" / "engineering.mdc"


def test_residential_worker_is_the_profile_path():
    text = RULE.read_text(encoding="utf-8").lower()
    assert "desktop/x370 worker and residential html fetch are allowed" in text
    assert "they are the profile path" in text
    assert "safari_worker.py" in text
    assert "grok only" in text
    assert "do not add opus or sonnet" in text


def test_rule_still_forbids_proxies_rss_library_and_fake_datacenter_scrapes():
    text = RULE.read_text(encoding="utf-8").lower()
    assert "paid proxies, scraperapi" in text
    assert "rss-as-library" in text
    assert "presenting a datacenter scrape" in text
    assert "as a working profile fetch" in text


def test_broken_profile_fetch_is_fixed_not_waited_on():
    text = RULE.read_text(encoding="utf-8").lower()
    assert "add a test that fails on the bug" in text
    assert "merge when green" in text
    assert "do not stop and wait" in text
    assert "residential-ip html scraping as a production dependency" not in text
    assert "desktop scrape worker (`/api/worker/*`" not in text
