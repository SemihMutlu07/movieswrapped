"""Suspect films for the poster eval.

Ids are TMDB movie ids. Letterboxd's ``/tmdb/{id}`` redirect is the identity
check. 498229, 493922, and 626332 are other films and must not be used for
Burning, Shoplifters, or Decision to Leave.
"""

from __future__ import annotations

SUSPECT_FILMS: list[tuple[int, str, str]] = [
    (129, "ja", "Spirited Away"),
    (128, "ja", "Princess Mononoke"),
    (372058, "ja", "Your Name"),
    (149, "ja", "Akira"),
    (10494, "ja", "Perfect Blue"),
    (9323, "ja", "Ghost in the Shell"),
    (496243, "ko", "Parasite"),
    (670, "ko", "Oldboy"),
    (290098, "ko", "The Handmaiden"),
    (11423, "ko", "Memories of Murder"),
    (705996, "ko", "Decision to Leave"),
    (491584, "ko", "Burning"),
    (531428, "fr", "Portrait of a Lady on Fire"),
    (194, "fr", "Amelie"),
    (1417, "es", "Pan's Labyrinth"),
    (598, "pt", "City of God"),
    (843, "zh", "In the Mood for Love"),
    (11104, "zh", "Chungking Express"),
    (1398, "ru", "Stalker"),
    (25237, "ru", "Come and See"),
    (346, "ja", "Seven Samurai"),
    (429, "it", "The Good, the Bad and the Ugly"),
    (103663, "da", "The Hunt"),
    (580175, "da", "Another Round"),
    (758866, "ja", "Drive My Car"),
    (505192, "ja", "Shoplifters"),
    (915935, "fr", "Anatomy of a Fall"),
    (64690, "en", "Drive"),
    (503919, "en", "The Lighthouse"),
    (550, "en", "Fight Club"),
    (603, "en", "The Matrix"),
    (238, "en", "The Godfather"),
    (244786, "en", "Whiplash"),
    (545611, "en", "Everything Everywhere All at Once"),
    (438631, "en", "Dune"),
    (335984, "en", "Blade Runner 2049"),
]
