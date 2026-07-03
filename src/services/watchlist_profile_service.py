# -*- coding: utf-8 -*-
"""Watchlist profile persistence and auto-analysis scheduling helpers."""

from __future__ import annotations

import json
import re
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List, Optional, Union

from sqlalchemy import and_, desc, func, select

from data_provider.base import normalize_stock_code
from src.core.trading_calendar import get_market_for_stock, is_market_open
from src.services.stock_code_utils import resolve_index_stock_code_for_analysis
from src.storage import (
    AnalysisHistory,
    DatabaseManager,
    DecisionSignalRecord,
    WatchlistProfileRecord,
)

SCHEDULE_MODES = {"manual_only", "daily_close", "intraday", "custom_times", "alert_triggered"}
MODEL_STRATEGIES = {"auto", "flash", "pro"}
DEFAULT_COOLDOWN_MINUTES = 30
DEFAULT_MAX_DAILY_RUNS = 1
MAX_DAILY_RUNS_LIMIT = 3
DEFAULT_DAILY_CLOSE_TIME = "15:10"
DEFAULT_INTRADAY_TIME = "13:30"
_TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


class WatchlistProfileValidationError(ValueError):
    """Raised when a watchlist profile payload is invalid."""


def normalize_schedule_times(raw_times: Optional[Union[List[str], str]]) -> List[str]:
    if raw_times is None:
        return []
    if isinstance(raw_times, str):
        parts = raw_times.split(",")
    else:
        parts = raw_times
    result: List[str] = []
    for item in parts:
        text = str(item or "").strip()
        if not text:
            continue
        if not _TIME_RE.match(text):
            raise WatchlistProfileValidationError(f"无效时间格式: {text}，请使用 HH:MM")
        if text not in result:
            result.append(text)
    return result


def _parse_times(raw_json: Optional[str]) -> List[str]:
    if not raw_json:
        return []
    try:
        value = json.loads(raw_json)
    except Exception:
        return []
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item or "").strip()]


def _safe_int(value: Any, default: int, *, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(parsed, maximum))


def _market_from_code(stock_code: str, market: Optional[str] = None) -> str:
    if market:
        return market.lower()
    return get_market_for_stock(stock_code) or "cn"


def _combine_date_time(day: date, hhmm: str) -> datetime:
    parsed_time = time.fromisoformat(hhmm)
    return datetime.combine(day, parsed_time)


class WatchlistProfileService:
    """Service for per-stock watchlist profile configuration."""

    def __init__(self, db_manager: Optional[DatabaseManager] = None):
        self.db = db_manager or DatabaseManager.get_instance()

    def _latest_history(self, stock_code: str) -> Optional[AnalysisHistory]:
        code = normalize_stock_code(stock_code)
        with self.db.get_session() as session:
            return session.execute(
                select(AnalysisHistory)
                .where(AnalysisHistory.code == code)
                .order_by(desc(AnalysisHistory.created_at), desc(AnalysisHistory.id))
                .limit(1)
            ).scalar_one_or_none()

    def _latest_signal(self, stock_code: str, market: Optional[str]) -> Optional[DecisionSignalRecord]:
        code = normalize_stock_code(stock_code)
        conditions = [
            DecisionSignalRecord.stock_code == code,
            DecisionSignalRecord.status == "active",
        ]
        if market:
            conditions.append(DecisionSignalRecord.market == market)
        with self.db.get_session() as session:
            return session.execute(
                select(DecisionSignalRecord)
                .where(and_(*conditions))
                .order_by(desc(DecisionSignalRecord.created_at), desc(DecisionSignalRecord.id))
                .limit(1)
            ).scalar_one_or_none()

    def _count_today_runs(self, stock_code: str, now: datetime) -> int:
        start = datetime.combine(now.date(), time.min)
        end = start + timedelta(days=1)
        code = normalize_stock_code(stock_code)
        with self.db.get_session() as session:
            return int(session.execute(
                select(func.count(AnalysisHistory.id)).where(
                    and_(
                        AnalysisHistory.code == code,
                        AnalysisHistory.created_at >= start,
                        AnalysisHistory.created_at < end,
                    )
                )
            ).scalar() or 0)

    def compute_next_analysis_at(
        self,
        *,
        market: str,
        auto_analysis_enabled: bool,
        schedule_mode: str,
        schedule_times: List[str],
        now: Optional[datetime] = None,
    ) -> Optional[datetime]:
        now = now or datetime.now()
        if not auto_analysis_enabled or schedule_mode in {"manual_only", "alert_triggered"}:
            return None

        if schedule_mode == "daily_close":
            times = schedule_times or [DEFAULT_DAILY_CLOSE_TIME]
        elif schedule_mode == "intraday":
            times = schedule_times or [DEFAULT_INTRADAY_TIME]
        elif schedule_mode == "custom_times":
            times = schedule_times
        else:
            times = []
        if not times:
            return None

        for day_offset in range(0, 15):
            candidate_date = now.date() + timedelta(days=day_offset)
            if not is_market_open(market, candidate_date):
                continue
            for hhmm in sorted(times):
                candidate = _combine_date_time(candidate_date, hhmm)
                if candidate > now:
                    return candidate
        return None

    def _row_to_dict(self, row: WatchlistProfileRecord) -> Dict[str, Any]:
        latest_history = self._latest_history(row.stock_code)
        latest_signal = self._latest_signal(row.stock_code, row.market)
        last_analysis_at = latest_history.created_at if latest_history else row.last_analysis_at
        last_report_id = latest_history.id if latest_history else row.last_report_id
        last_signal_id = latest_signal.id if latest_signal else row.last_decision_signal_id
        return {
            "stock_code": row.stock_code,
            "market": row.market,
            "enabled": bool(row.enabled),
            "default_skill": row.default_skill,
            "model_strategy": row.model_strategy or "auto",
            "auto_analysis_enabled": bool(row.auto_analysis_enabled),
            "schedule_mode": row.schedule_mode or "manual_only",
            "schedule_times": _parse_times(row.schedule_times),
            "cooldown_minutes": row.cooldown_minutes or DEFAULT_COOLDOWN_MINUTES,
            "max_daily_runs": row.max_daily_runs or DEFAULT_MAX_DAILY_RUNS,
            "last_analysis_at": last_analysis_at.isoformat() if last_analysis_at else None,
            "next_analysis_at": row.next_analysis_at.isoformat() if row.next_analysis_at else None,
            "last_report_id": last_report_id,
            "last_decision_signal_id": last_signal_id,
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }

    def get_or_create(self, stock_code: str, *, market: Optional[str] = None) -> Dict[str, Any]:
        canonical = resolve_index_stock_code_for_analysis(stock_code)
        resolved_market = _market_from_code(canonical, market)
        now = datetime.now()
        with self.db.get_session() as session:
            row = session.execute(
                select(WatchlistProfileRecord).where(WatchlistProfileRecord.stock_code == canonical).limit(1)
            ).scalar_one_or_none()
            if row is None:
                row = WatchlistProfileRecord(
                    stock_code=canonical,
                    market=resolved_market,
                    enabled=True,
                    model_strategy="auto",
                    auto_analysis_enabled=False,
                    schedule_mode="manual_only",
                    schedule_times="[]",
                    cooldown_minutes=DEFAULT_COOLDOWN_MINUTES,
                    max_daily_runs=DEFAULT_MAX_DAILY_RUNS,
                    created_at=now,
                    updated_at=now,
                )
                session.add(row)
                session.commit()
                session.refresh(row)
            elif market and row.market != resolved_market:
                row.market = resolved_market
                row.updated_at = now
                session.commit()
                session.refresh(row)
        return self._row_to_dict(row)

    def list_profiles(self, stock_codes: List[str]) -> List[Dict[str, Any]]:
        return [self.get_or_create(code) for code in stock_codes]

    def update_profile(self, stock_code: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        canonical = resolve_index_stock_code_for_analysis(stock_code)
        schedule_mode = str(payload.get("schedule_mode", "manual_only") or "manual_only")
        if schedule_mode not in SCHEDULE_MODES:
            raise WatchlistProfileValidationError(f"不支持的 schedule_mode: {schedule_mode}")
        model_strategy = str(payload.get("model_strategy", "auto") or "auto")
        if model_strategy not in MODEL_STRATEGIES:
            raise WatchlistProfileValidationError(f"不支持的 model_strategy: {model_strategy}")
        schedule_times = normalize_schedule_times(payload.get("schedule_times"))
        cooldown = _safe_int(
            payload.get("cooldown_minutes"),
            DEFAULT_COOLDOWN_MINUTES,
            minimum=1,
            maximum=1440,
        )
        max_daily_runs = _safe_int(
            payload.get("max_daily_runs"),
            DEFAULT_MAX_DAILY_RUNS,
            minimum=1,
            maximum=MAX_DAILY_RUNS_LIMIT,
        )
        market = _market_from_code(canonical, payload.get("market"))
        auto_enabled = bool(payload.get("auto_analysis_enabled", False))
        now = datetime.now()
        next_at = self.compute_next_analysis_at(
            market=market,
            auto_analysis_enabled=auto_enabled,
            schedule_mode=schedule_mode,
            schedule_times=schedule_times,
            now=now,
        )
        with self.db.get_session() as session:
            row = session.execute(
                select(WatchlistProfileRecord).where(WatchlistProfileRecord.stock_code == canonical).limit(1)
            ).scalar_one_or_none()
            if row is None:
                row = WatchlistProfileRecord(stock_code=canonical, created_at=now)
                session.add(row)
            row.market = market
            row.enabled = bool(payload.get("enabled", True))
            row.default_skill = str(payload.get("default_skill") or "").strip() or None
            row.model_strategy = model_strategy
            row.auto_analysis_enabled = auto_enabled
            row.schedule_mode = schedule_mode
            row.schedule_times = json.dumps(schedule_times, ensure_ascii=False)
            row.cooldown_minutes = cooldown
            row.max_daily_runs = max_daily_runs
            row.next_analysis_at = next_at
            row.updated_at = now
            session.commit()
            session.refresh(row)
        return self._row_to_dict(row)

    def record_analysis_submission(
        self,
        stock_code: str,
        *,
        report_id: Optional[int] = None,
        decision_signal_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        profile = self.get_or_create(stock_code)
        now = datetime.now()
        schedule_times = profile.get("schedule_times") or []
        next_at = self.compute_next_analysis_at(
            market=profile.get("market") or _market_from_code(stock_code),
            auto_analysis_enabled=bool(profile.get("auto_analysis_enabled")),
            schedule_mode=profile.get("schedule_mode") or "manual_only",
            schedule_times=schedule_times,
            now=now,
        )
        canonical = resolve_index_stock_code_for_analysis(stock_code)
        with self.db.get_session() as session:
            row = session.execute(
                select(WatchlistProfileRecord).where(WatchlistProfileRecord.stock_code == canonical).limit(1)
            ).scalar_one()
            row.last_analysis_at = now
            row.last_report_id = report_id or row.last_report_id
            row.last_decision_signal_id = decision_signal_id or row.last_decision_signal_id
            row.next_analysis_at = next_at
            row.updated_at = now
            session.commit()
            session.refresh(row)
        return self._row_to_dict(row)

    def defer_next_analysis(self, stock_code: str, *, now: Optional[datetime] = None) -> Dict[str, Any]:
        profile = self.get_or_create(stock_code)
        now = now or datetime.now()
        next_at = self.compute_next_analysis_at(
            market=profile.get("market") or _market_from_code(stock_code),
            auto_analysis_enabled=bool(profile.get("auto_analysis_enabled")),
            schedule_mode=profile.get("schedule_mode") or "manual_only",
            schedule_times=profile.get("schedule_times") or [],
            now=now,
        )
        canonical = resolve_index_stock_code_for_analysis(stock_code)
        with self.db.get_session() as session:
            row = session.execute(
                select(WatchlistProfileRecord).where(WatchlistProfileRecord.stock_code == canonical).limit(1)
            ).scalar_one()
            row.next_analysis_at = next_at
            row.updated_at = now
            session.commit()
            session.refresh(row)
        return self._row_to_dict(row)

    def run_due_auto_analysis(self, *, limit: int = 1) -> Dict[str, Any]:
        from src.services.task_queue import DuplicateTaskError, get_task_queue

        now = datetime.now()
        safe_limit = max(1, min(int(limit or 1), 10))
        submitted: List[Dict[str, Any]] = []
        skipped: List[Dict[str, Any]] = []
        with self.db.get_session() as session:
            rows = session.execute(
                select(WatchlistProfileRecord)
                .where(
                    and_(
                        WatchlistProfileRecord.enabled.is_(True),
                        WatchlistProfileRecord.auto_analysis_enabled.is_(True),
                        WatchlistProfileRecord.next_analysis_at.is_not(None),
                        WatchlistProfileRecord.next_analysis_at <= now,
                    )
                )
                .order_by(WatchlistProfileRecord.next_analysis_at, WatchlistProfileRecord.id)
                .limit(safe_limit)
            ).scalars().all()

        task_queue = get_task_queue()
        for row in rows:
            profile = self._row_to_dict(row)
            market = profile.get("market") or _market_from_code(profile["stock_code"])
            if not is_market_open(market, now.date()):
                skipped.append({"stock_code": profile["stock_code"], "reason": "non_trading_day"})
                self.update_profile(profile["stock_code"], profile)
                continue
            last_at_raw = profile.get("last_analysis_at")
            if last_at_raw:
                last_at = datetime.fromisoformat(last_at_raw)
                if now - last_at < timedelta(minutes=int(profile["cooldown_minutes"])):
                    skipped.append({"stock_code": profile["stock_code"], "reason": "cooldown"})
                    self.defer_next_analysis(profile["stock_code"], now=now)
                    continue
            if self._count_today_runs(profile["stock_code"], now) >= int(profile["max_daily_runs"]):
                skipped.append({"stock_code": profile["stock_code"], "reason": "max_daily_runs"})
                self.defer_next_analysis(profile["stock_code"], now=now)
                continue
            skills = [profile["default_skill"]] if profile.get("default_skill") else None
            try:
                task = task_queue.submit_task(
                    profile["stock_code"],
                    original_query=profile["stock_code"],
                    selection_source="manual",
                    query_source="watchlist_auto",
                    report_type="detailed",
                    skills=skills,
                    temporary_pro_analysis=profile.get("model_strategy") == "pro",
                )
                self.record_analysis_submission(profile["stock_code"])
                submitted.append({"stock_code": profile["stock_code"], "task_id": task.task_id})
            except DuplicateTaskError as exc:
                skipped.append({"stock_code": profile["stock_code"], "reason": "duplicate", "task_id": exc.existing_task_id})
            except Exception as exc:  # noqa: BLE001
                skipped.append({"stock_code": profile["stock_code"], "reason": str(exc)})

        return {"submitted": submitted, "skipped": skipped, "limit": safe_limit}
