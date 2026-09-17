"""饮食工具日期范围：UTC 与北京时间跨日、跨月、跨年。"""

from datetime import datetime
from unittest.mock import AsyncMock

import pytest

from recognition.nutrition import get_diet_history, get_diet_summary, go_client


@pytest.mark.parametrize(("instant", "start", "end"), [
    ("2026-09-16T23:59:00+00:00", "2026-09-11", "2026-09-17"),
    ("2026-09-30T16:00:00+00:00", "2026-09-25", "2026-10-01"),
    ("2026-12-31T16:00:00+00:00", "2026-12-26", "2027-01-01"),
])
async def test_default_summary_includes_today_in_business_timezone(
    monkeypatch, utc_clock, instant, start, end,
):
    utc_clock.instant = datetime.fromisoformat(instant)
    fetch = AsyncMock(return_value=[])
    monkeypatch.setattr(go_client, "get_diet_summaries", fetch)
    result = await get_diet_summary(7)
    fetch.assert_awaited_once_with(7, start, end)
    assert start in result and end in result


async def test_explicit_summary_dates_are_preserved(monkeypatch, utc_clock):
    fetch = AsyncMock(return_value=[])
    monkeypatch.setattr(go_client, "get_diet_summaries", fetch)
    await get_diet_summary(7, "2026-08-01", "2026-08-07")
    fetch.assert_awaited_once_with(7, "2026-08-01", "2026-08-07")


async def test_explicit_history_date_is_preserved(monkeypatch, utc_clock):
    fetch = AsyncMock(return_value=[])
    monkeypatch.setattr(go_client, "get_diet_logs", fetch)
    await get_diet_history(7, "2026-09-16")
    fetch.assert_awaited_once_with(7, "2026-09-16")
