# -*- coding: utf-8 -*-

from src.services.realtime_watch_service import RealtimeWatchService


def _service() -> RealtimeWatchService:
    return RealtimeWatchService.__new__(RealtimeWatchService)


def test_dynamic_advice_detects_volume_breakout_without_llm():
    service = _service()
    advice = service.build_dynamic_advice(
        {
            "volume_ratio_threshold": 2.0,
            "change_percent_threshold": 3.0,
        },
        {
            "current_price": 12.5,
            "change_percent": 3.5,
            "volume_ratio": 2.6,
            "yesterday_high": 12.0,
            "five_day_high": 12.4,
            "twenty_day_high": 12.45,
            "today_high": 12.6,
        },
    )

    assert advice["status"] == "放量突破观察"
    assert "突破昨日高点" in advice["rules"]
    assert "量比超过2" in advice["rules"]
    assert advice["needs_ai_review"] is False


def test_dynamic_advice_flags_stop_loss_and_ai_review():
    service = _service()
    advice = service.build_dynamic_advice(
        {
            "stop_loss_price": 10.0,
            "support_price": 10.2,
            "volume_ratio_threshold": 2.0,
            "change_percent_threshold": 3.0,
        },
        {
            "current_price": 9.95,
            "change_percent": -3.4,
            "volume_ratio": 1.2,
            "ma5": 10.5,
            "ma10": 10.7,
        },
    )

    assert advice["status"] in {"接近止损", "跌破关键位"}
    assert advice["severity"] == "danger"
    assert advice["needs_ai_review"] is True
    assert "接近用户设置止损位" in advice["rules"]


def test_conflict_detects_stale_bullish_ai_signal():
    service = _service()
    assert service._conflict_with_ai(
        {"status": "跌破关键位"},
        {"action": "hold"},
    ) is True
    assert service._conflict_with_ai(
        {"status": "放量突破观察"},
        {"action": "hold"},
    ) is False
