"""Bitrix24 voximplant.statistic.get API client with pagination and rate-limiting."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

log = logging.getLogger(__name__)

_PAGE_SIZE  = 50      # Bitrix24 max records per request
_MIN_DELAY  = 0.5     # seconds between pages (stay under 2 req/s limit)
_MAX_DELAY  = 30.0    # exponential backoff ceiling
_MAX_TRIES  = 6


class BitrixError(Exception):
    """Raised when Bitrix24 returns an error payload inside HTTP 200."""

    def __init__(self, code: str, description: str) -> None:
        self.code = code
        self.description = description
        super().__init__(f"Bitrix24 error [{code}]: {description}")


def _build_url(portal: str, user_id: str, webhook: str, method: str) -> str:
    return f"https://{portal}/rest/{user_id}/{webhook}/{method}"


async def _post_with_retry(
    client: httpx.AsyncClient,
    url: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    """POST once with exponential backoff on 429 / 5xx / network errors."""
    delay = _MIN_DELAY
    last_exc: Exception = RuntimeError("No attempts made")

    for attempt in range(1, _MAX_TRIES + 1):
        try:
            resp = await client.post(url, json=body, timeout=30.0)

            if resp.status_code == 429:
                log.warning("Rate-limited (429), waiting %.1fs", delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, _MAX_DELAY)
                continue

            resp.raise_for_status()
            data: dict[str, Any] = resp.json()

            # Bitrix24 embeds errors inside HTTP 200 responses
            if "error" in data:
                raise BitrixError(
                    data["error"],
                    data.get("error_description", ""),
                )

            return data

        except (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError) as exc:
            last_exc = exc
            log.warning("Network error (attempt %d/%d): %s", attempt, _MAX_TRIES, exc)
            if attempt == _MAX_TRIES:
                break
            await asyncio.sleep(delay)
            delay = min(delay * 2, _MAX_DELAY)

        except httpx.HTTPStatusError as exc:
            last_exc = exc
            if exc.response.status_code < 500:
                raise  # 4xx — not retryable (except 429 handled above)
            log.warning("Server error %d (attempt %d/%d)", exc.response.status_code, attempt, _MAX_TRIES)
            if attempt == _MAX_TRIES:
                break
            await asyncio.sleep(delay)
            delay = min(delay * 2, _MAX_DELAY)

    raise last_exc


async def fetch_all_calls(
    portal: str,
    user_id: str,
    webhook: str,
    date_from: str,
    date_to: str,
) -> list[dict[str, Any]]:
    """
    Fetch every voximplant call record in [date_from, date_to].

    Handles pagination automatically (`start` = 0, 50, 100 …).
    Stops when `next` is absent from the response or all records collected.
    """
    url = _build_url(portal, user_id, webhook, "voximplant.statistic.get")

    all_records: list[dict[str, Any]] = []
    start = 0

    async with httpx.AsyncClient() as client:
        while True:
            body: dict[str, Any] = {
                "FILTER": {
                    ">=CALL_START_DATE": f"{date_from}T00:00:00",
                    "<=CALL_START_DATE": f"{date_to}T23:59:59",
                },
                "SORT":  "CALL_START_DATE",
                "ORDER": "DESC",
                "start": start,
            }

            data = await _post_with_retry(client, url, body)

            page: list[dict] = data.get("result") or []
            all_records.extend(page)

            total = int(data.get("total") or 0)
            log.debug(
                "Fetched %d / %d records (start=%d)",
                len(all_records), total, start,
            )

            next_start = data.get("next")
            if not next_start or len(all_records) >= total:
                break

            start = int(next_start)
            await asyncio.sleep(_MIN_DELAY)  # respect rate limit between pages

    log.info("Fetched %d total call records", len(all_records))
    return all_records
