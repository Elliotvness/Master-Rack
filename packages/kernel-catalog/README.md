# @rms/kernel-catalog

The catalog: releases, part revisions, the published capacity tables, and the
projection the BOM references.

## content_sha256 is Python-canonical

`content_sha256` is Python-canonical. Python's JSON serializer emits `4.0` for
floats that JavaScript serializes as `4`, so the hash is semantically correct
but **not cross-language reproducible**. Do not re-base approved releases for
serialization differences. *(EL, 2026-09-03.)*
