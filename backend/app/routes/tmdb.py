from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from app.services.tmdb_client import pick_movie_result_id, tmdb_get
from app.security import enforce_rate_limit

router = APIRouter()


@router.get("/api/tmdb/person/search")
async def search_tmdb_person(request: Request, name: str, role: str | None = None):
    """Search TMDB for a person and return their profile image URL."""
    enforce_rate_limit(request, "tmdb_search", limit=60, window=60)
    if not name:
        raise HTTPException(status_code=400, detail="Name parameter is required")

    session = request.app.state.aiohttp_session
    try:
        person_data = await tmdb_get(session, "search/person", {"query": name, "include_adult": "false"})

        if not person_data or not person_data.get("results"):
            return {"found": False, "message": "No person found"}

        person = person_data["results"][0]

        if role and len(person_data["results"]) > 1:
            dept_map = {"director": "Directing", "actor": "Acting"}
            target_dept = dept_map.get(role.lower())
            if target_dept:
                for result in person_data["results"]:
                    if result.get("known_for_department") == target_dept:
                        person = result
                        break

        profile_path = person.get("profile_path")
        if profile_path:
            return {
                "found": True,
                "person_id": person.get("id"),
                "profile_path": profile_path,
                "name": person.get("name"),
                "known_for_department": person.get("known_for_department"),
                "url": f"https://image.tmdb.org/t/p/w300{profile_path}",
            }
        return {
            "found": False,
            "person_id": person.get("id"),
            "name": person.get("name"),
            "message": "No profile image available",
        }

    except Exception as exc:
        raise HTTPException(status_code=502, detail="TMDB lookup failed") from exc


@router.get("/api/tmdb/movie/search")
async def search_tmdb_movie(request: Request, title: str, year: int | None = None):
    """Search TMDB for a movie by title (and optional year) and return its poster image URL."""
    enforce_rate_limit(request, "tmdb_search", limit=60, window=60)
    if not title:
        raise HTTPException(status_code=400, detail="Title parameter is required")

    session = request.app.state.aiohttp_session
    try:
        # Ranking uses year; TMDB year= hides off-by-one hits (Split 2016/2017).
        movie_data = await tmdb_get(
            session, "search/movie", {"query": title, "include_adult": "false"}
        )
        results = movie_data.get("results", []) if movie_data else []

        if not results:
            return {"found": False, "message": "No movie found"}

        tmdb_id = pick_movie_result_id(results, year, title)
        movie = next((item for item in results if item.get("id") == tmdb_id), results[0])
        poster_path = movie.get("poster_path")
        if poster_path:
            return {
                "found": True,
                "movie_id": movie.get("id"),
                "title": movie.get("title"),
                "poster_path": poster_path,
                "url": f"https://image.tmdb.org/t/p/w300{poster_path}",
            }
        return {
            "found": False,
            "movie_id": movie.get("id"),
            "title": movie.get("title"),
            "message": "No poster image available",
        }

    except Exception as exc:
        raise HTTPException(status_code=502, detail="TMDB lookup failed") from exc


@router.get("/tmdb-proxy/{path:path}")
async def tmdb_proxy(path: str, request: Request):
    """Proxy TMDB images to avoid CORS issues."""
    enforce_rate_limit(request, "tmdb_proxy", limit=120, window=60)
    if not re.fullmatch(r"t/p/(?:w\d+|h\d+|original)/[A-Za-z0-9._-]+", path):
        raise HTTPException(status_code=400, detail="Invalid TMDB image path")
    session = request.app.state.aiohttp_session
    try:
        async with session.get(f"https://image.tmdb.org/{path}") as resp:
            if resp.status != 200:
                raise HTTPException(status_code=404, detail="Image not found")
            if int(resp.headers.get("Content-Length", "0") or 0) > 10 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Image is too large")
            data = await resp.read()
            if len(data) > 10 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Image is too large")
            media_type = resp.headers.get("Content-Type", "")
            if not media_type.startswith("image/"):
                raise HTTPException(status_code=502, detail="Upstream response was not an image")
            return Response(
                content=data,
                media_type=media_type,
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Range, Accept",
                    "Access-Control-Expose-Headers": "Content-Length, Content-Range",
                    "Cache-Control": "public, max-age=31536000, immutable",
                },
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail="TMDB image proxy failed") from exc


@router.options("/tmdb-proxy/{path:path}")
async def tmdb_proxy_options(path: str):
    """Handle CORS preflight for TMDB proxy."""
    return Response(
        status_code=204,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Range, Accept",
            "Access-Control-Expose-Headers": "Content-Length, Content-Range",
        },
    )
