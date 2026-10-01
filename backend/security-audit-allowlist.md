# Dependency audit exceptions

Starlette ignores below are the only pip-audit exceptions. Do not add anyio
advisories to CI `--ignore-vuln` flags; pin a patched anyio instead.

## AnyIO 4.14.2

`CVE-2026-63374` (TLS hostname IDNA 2003 matching) and `CVE-2026-64847`
(process-pool stderr deadlock) affect anyio `<=4.14.1`. FastAPI 0.139 /
Starlette 0.49.3 allow `anyio>=3.6.2,<5`, so the backend pin is `anyio==4.14.2`
(first patched 4.x that does not also require `typing_extensions>=4.16`).

## Starlette 0.49.3

`PYSEC-2026-161`, `PYSEC-2026-249`, `PYSEC-2026-248`,
`PYSEC-2026-2281`, and `PYSEC-2026-2280` currently require Starlette 1.x.
FastAPI 0.139 constrains Starlette to `<1.0`, so the fixed versions cannot be
installed together yet. Dependabot remains enabled; remove these exceptions as
soon as FastAPI supports the fixed Starlette line. Review by 2026-08-15.
