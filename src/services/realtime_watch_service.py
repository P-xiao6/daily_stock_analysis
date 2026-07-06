# -*- coding: utf-8 -*-
"""Realtime watch profiles, rule signals, and AI review guardrails."""

from __future__ import annotations

import math
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import and_, func, select

from data_provider.base import normalize_stock_code
from src.core.trading_calendar import get_market_for_stock
from src.services.decision_signal_service import DecisionSignalService
from src.services.stock_code_utils import resolve_index_stock_code_for_analysis
from src.services.stock_service import StockService
from src.services.task_queue import DuplicateTaskError, get_task_queue
from src.storage import DatabaseManager, RealtimeWatchProfileRecord

MAX_REALTIME_WATCH_ITEMS = 5
DEFAULT_VOLUME_RATIO_THRESHOLD = 2.0
DEFAULT_CHANGE_PERCENT_THRESHOLD = 3.0
DEFAULT_AI_REVIEW_COOLDOWN_MINUTES = 30
MAX_DAILY_AI_REVIEWS = 3


class RealtimeWatchValidationError(ValueError):
    """Raised when realtime watch input is invalid."""


def _market_from_code(stock_code: str, market: Optional[str] = None) -> str:
    if market:
        return market.lower()
    return get_market_for_stock(stock_code) or "cn"


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        parsed = float(value)
        if math.isnan(parsed) or math.isinf(parsed):
            return None
        return parsed
    except (TypeError, ValueError):
        return None


def _bounded_float(value: Any, default: float, *, minimum: float, maximum: float) -> float:
    parsed = _safe_float(value)
    if parsed is None:
        parsed = default
    return max(minimum, min(parsed, maximum))


def _bounded_int(value: Any, default: int, *, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(parsed, maximum))


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _today_start(now: datetime) -> datetime:
    return datetime.combine(now.date(), time.min)


class RealtimeWatchService:
    """Business service for lightweight realtime watch rules."""

    def __init__(
        self,
        db_manager: Optional[DatabaseManager] = None,
        stock_service: Optional[StockService] = None,
    ):
        self.db = db_manager or DatabaseManager.get_instance()
        self.stock_service = stock_service or StockService()

    def _row_to_dict(self, row: RealtimeWatchProfileRecord) -> Dict[str, Any]:
        return {
            "stock_code": row.stock_code,
            "stock_name": row.stock_name,
            "market": row.market,
            "enabled": bool(row.enabled),
            "resistance_price": row.resistance_price,
            "support_price": row.support_price,
            "stop_loss_price": row.stop_loss_price,
            "target_price": row.target_price,
            "volume_ratio_threshold": row.volume_ratio_threshold or DEFAULT_VOLUME_RATIO_THRESHOLD,
            "change_percent_threshold": row.change_percent_threshold or DEFAULT_CHANGE_PERCENT_THRESHOLD,
            "auto_ai_review_enabled": bool(row.auto_ai_review_enabled),
            "ai_review_cooldown_minutes": row.ai_review_cooldown_minutes or DEFAULT_AI_REVIEW_COOLDOWN_MINUTES,
            "max_daily_ai_reviews": row.max_daily_ai_reviews or MAX_DAILY_AI_REVIEWS,
            "default_skill": row.default_skill,
            "last_ai_review_at": _iso(row.last_ai_review_at),
            "ai_review_count_date": row.ai_review_count_date.isoformat() if row.ai_review_count_date else None,
            "ai_review_count": row.ai_review_count or 0,
            "created_at": _iso(row.created_at),
            "updated_at": _iso(row.updated_at),
        }

    def list_profiles(self, *, enabled_only: bool = False) -> List[Dict[str, Any]]:
        conditions = []
        if enabled_only:
            conditions.append(RealtimeWatchProfileRecord.enabled.is_(True))
        with self.db.get_session() as session:
            query = select(RealtimeWatchProfileRecord)
            if conditions:
                query = query.where(and_(*conditions))
            rows = session.execute(
                query.order_by(RealtimeWatchProfileRecord.created_at, RealtimeWatchProfileRecord.id)
            ).scalars().all()
        return [self._row_to_dict(row) for row in rows]

    def _enabled_count(self, session: Any, *, exclude_stock_code: Optional[str] = None) -> int:
        query = select(func.count(RealtimeWatchProfileRecord.id)).where(
            RealtimeWatchProfileRecord.enabled.is_(True)
        )
        if exclude_stock_code:
            query = query.where(RealtimeWatchProfileRecord.stock_code != exclude_stock_code)
        return int(session.execute(query).scalar() or 0)

    def create_profile(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        stock_code = resolve_index_stock_code_for_analysis(str(payload.get("stock_code") or "").strip())
        if not stock_code:
            raise RealtimeWatchValidationError("股票代码不能为空")
        now = datetime.now()
        with self.db.get_session() as session:
            existing = session.execute(
                select(RealtimeWatchProfileRecord)
                .where(RealtimeWatchProfileRecord.stock_code == stock_code)
                .limit(1)
            ).scalar_one_or_none()
            if existing is not None:
                if not existing.enabled and self._enabled_count(session) >= MAX_REALTIME_WATCH_ITEMS:
                    raise RealtimeWatchValidationError("重点盯盘最多支持 5 只股票，更多股票请使用普通自选股页面")
                existing.enabled = True
                existing.stock_name = str(payload.get("stock_name") or existing.stock_name or "").strip() or None
                existing.market = _market_from_code(stock_code, payload.get("market") or existing.market)
                existing.updated_at = now
                session.commit()
                session.refresh(existing)
                return self._row_to_dict(existing)

            if self._enabled_count(session) >= MAX_REALTIME_WATCH_ITEMS:
                raise RealtimeWatchValidationError("重点盯盘最多支持 5 只股票，更多股票请使用普通自选股页面")

            row = RealtimeWatchProfileRecord(
                stock_code=stock_code,
                stock_name=str(payload.get("stock_name") or "").strip() or None,
                market=_market_from_code(stock_code, payload.get("market")),
                enabled=True,
                volume_ratio_threshold=DEFAULT_VOLUME_RATIO_THRESHOLD,
                change_percent_threshold=DEFAULT_CHANGE_PERCENT_THRESHOLD,
                auto_ai_review_enabled=False,
                ai_review_cooldown_minutes=DEFAULT_AI_REVIEW_COOLDOWN_MINUTES,
                max_daily_ai_reviews=MAX_DAILY_AI_REVIEWS,
                ai_review_count=0,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.commit()
            session.refresh(row)
        return self._row_to_dict(row)

    def update_profile(self, stock_code: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        canonical = resolve_index_stock_code_for_analysis(stock_code)
        now = datetime.now()
        with self.db.get_session() as session:
            row = session.execute(
                select(RealtimeWatchProfileRecord)
                .where(RealtimeWatchProfileRecord.stock_code == canonical)
                .limit(1)
            ).scalar_one_or_none()
            if row is None:
                raise RealtimeWatchValidationError(f"未找到重点盯盘股票: {stock_code}")
            enabled = bool(payload.get("enabled", True))
            if enabled and not row.enabled and self._enabled_count(session, exclude_stock_code=canonical) >= MAX_REALTIME_WATCH_ITEMS:
                raise RealtimeWatchValidationError("重点盯盘最多支持 5 只股票，更多股票请使用普通自选股页面")
            row.stock_name = str(payload.get("stock_name") or "").strip() or None
            row.market = _market_from_code(canonical, payload.get("market"))
            row.enabled = enabled
            row.resistance_price = _safe_float(payload.get("resistance_price"))
            row.support_price = _safe_float(payload.get("support_price"))
            row.stop_loss_price = _safe_float(payload.get("stop_loss_price"))
            row.target_price = _safe_float(payload.get("target_price"))
            row.volume_ratio_threshold = _bounded_float(
                payload.get("volume_ratio_threshold"),
                DEFAULT_VOLUME_RATIO_THRESHOLD,
                minimum=0.1,
                maximum=20,
            )
            row.change_percent_threshold = _bounded_float(
                payload.get("change_percent_threshold"),
                DEFAULT_CHANGE_PERCENT_THRESHOLD,
                minimum=0.1,
                maximum=20,
            )
            row.auto_ai_review_enabled = bool(payload.get("auto_ai_review_enabled", False))
            row.ai_review_cooldown_minutes = _bounded_int(
                payload.get("ai_review_cooldown_minutes"),
                DEFAULT_AI_REVIEW_COOLDOWN_MINUTES,
                minimum=1,
                maximum=1440,
            )
            row.max_daily_ai_reviews = _bounded_int(
                payload.get("max_daily_ai_reviews"),
                MAX_DAILY_AI_REVIEWS,
                minimum=1,
                maximum=MAX_DAILY_AI_REVIEWS,
            )
            row.default_skill = str(payload.get("default_skill") or "").strip() or None
            row.updated_at = now
            session.commit()
            session.refresh(row)
        return self._row_to_dict(row)

    def delete_profile(self, stock_code: str) -> None:
        canonical = resolve_index_stock_code_for_analysis(stock_code)
        with self.db.get_session() as session:
            row = session.execute(
                select(RealtimeWatchProfileRecord)
                .where(RealtimeWatchProfileRecord.stock_code == canonical)
                .limit(1)
            ).scalar_one_or_none()
            if row is not None:
                session.delete(row)
                session.commit()

    def _history_metrics(self, stock_code: str) -> Dict[str, Any]:
        history = self.stock_service.get_history_data(stock_code, days=30)
        bars = history.get("data") or []
        if not bars:
            return {"stock_name": history.get("stock_name")}
        closes = [_safe_float(row.get("close")) for row in bars]
        highs = [_safe_float(row.get("high")) for row in bars]
        lows = [_safe_float(row.get("low")) for row in bars]
        volumes = [_safe_float(row.get("volume")) for row in bars]
        closes = [v for v in closes if v is not None]
        highs_clean = [v for v in highs if v is not None]
        lows_clean = [v for v in lows if v is not None]
        volumes_clean = [v for v in volumes if v is not None]
        latest_volume = volumes_clean[-1] if volumes_clean else None
        prev_volumes = volumes_clean[-6:-1] if len(volumes_clean) >= 6 else volumes_clean[:-1]
        avg_prev_volume = sum(prev_volumes) / len(prev_volumes) if prev_volumes else None
        return {
            "stock_name": history.get("stock_name"),
            "yesterday_high": highs[-2] if len(highs) >= 2 else None,
            "yesterday_low": lows[-2] if len(lows) >= 2 else None,
            "five_day_high": max(highs_clean[-5:]) if highs_clean else None,
            "five_day_low": min(lows_clean[-5:]) if lows_clean else None,
            "twenty_day_high": max(highs_clean[-20:]) if highs_clean else None,
            "ma5": sum(closes[-5:]) / min(5, len(closes)) if closes else None,
            "ma10": sum(closes[-10:]) / min(10, len(closes)) if closes else None,
            "ma20": sum(closes[-20:]) / min(20, len(closes)) if closes else None,
            "volume_ratio": latest_volume / avg_prev_volume if latest_volume and avg_prev_volume else None,
        }

    def build_quote_snapshot(self, profile: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        stock_code = profile["stock_code"]
        quote = self.stock_service.get_realtime_quote(stock_code)
        metrics = self._history_metrics(stock_code)
        if not quote and not metrics:
            return None
        quote = quote or {}
        quote_time = quote.get("update_time") or datetime.now().isoformat()
        stale = False
        try:
            stale = datetime.now() - datetime.fromisoformat(str(quote_time)) > timedelta(minutes=5)
        except Exception:
            stale = bool(not quote.get("current_price"))
        return {
            "stock_code": quote.get("stock_code") or stock_code,
            "stock_name": quote.get("stock_name") or profile.get("stock_name") or metrics.get("stock_name"),
            "current_price": _safe_float(quote.get("current_price")),
            "change": _safe_float(quote.get("change")),
            "change_percent": _safe_float(quote.get("change_percent")),
            "volume": _safe_float(quote.get("volume")),
            "amount": _safe_float(quote.get("amount")),
            "volume_ratio": metrics.get("volume_ratio"),
            "turnover_rate": None,
            "today_high": _safe_float(quote.get("high")),
            "today_low": _safe_float(quote.get("low")),
            "yesterday_high": metrics.get("yesterday_high"),
            "yesterday_low": metrics.get("yesterday_low"),
            "five_day_high": metrics.get("five_day_high"),
            "five_day_low": metrics.get("five_day_low"),
            "twenty_day_high": metrics.get("twenty_day_high"),
            "ma5": metrics.get("ma5"),
            "ma10": metrics.get("ma10"),
            "ma20": metrics.get("ma20"),
            "source": "best_effort",
            "quote_time": quote_time,
            "stale": stale,
        }

    def build_dynamic_advice(self, profile: Dict[str, Any], quote: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        if not quote or quote.get("current_price") is None:
            return {
                "status": "震荡观察",
                "rules": ["行情暂不可用"],
                "severity": "info",
                "needs_ai_review": False,
                "message": "等待行情刷新，不触发 AI。",
            }

        price = _safe_float(quote.get("current_price")) or 0.0
        change_pct = _safe_float(quote.get("change_percent")) or 0.0
        volume_ratio = _safe_float(quote.get("volume_ratio"))
        rules: List[str] = []
        status = "震荡观察"
        severity = "info"
        needs_ai_review = False

        def above(value: Any) -> bool:
            parsed = _safe_float(value)
            return parsed is not None and price > parsed

        def below(value: Any) -> bool:
            parsed = _safe_float(value)
            return parsed is not None and price < parsed

        if above(quote.get("yesterday_high")):
            rules.append("突破昨日高点")
        if below(quote.get("yesterday_low")):
            rules.append("跌破昨日低点")
        if above(quote.get("five_day_high")):
            rules.append("突破近5日高点")
        if below(quote.get("five_day_low")):
            rules.append("跌破近5日低点")
        if above(quote.get("twenty_day_high")):
            rules.append("突破近20日高点")
        if below(quote.get("ma5")):
            rules.append("跌破5日线")
        if below(quote.get("ma10")):
            rules.append("跌破10日线")
        if volume_ratio is not None and volume_ratio > 2:
            rules.append("量比超过2")
        if volume_ratio is not None and volume_ratio > 3:
            rules.append("量比超过3")
        change_threshold = float(profile.get("change_percent_threshold") or DEFAULT_CHANGE_PERCENT_THRESHOLD)
        if change_pct > change_threshold:
            rules.append(f"涨幅超过{change_threshold:g}%")
        if change_pct < -change_threshold:
            rules.append(f"跌幅超过{change_threshold:g}%")
        today_high = _safe_float(quote.get("today_high"))
        if today_high and today_high > 0 and (today_high - price) / today_high * 100 >= 2:
            rules.append("从日内高点回落超过2%")
        stop_loss = _safe_float(profile.get("stop_loss_price"))
        target = _safe_float(profile.get("target_price"))
        support = _safe_float(profile.get("support_price"))
        resistance = _safe_float(profile.get("resistance_price"))
        if stop_loss and price <= stop_loss * 1.01:
            rules.append("接近用户设置止损位")
        if target and price >= target * 0.99:
            rules.append("接近用户设置目标位")
        if support and price < support:
            rules.append("跌破关键支撑位")
        if resistance and price > resistance:
            rules.append("突破关键压力位")

        volume_threshold = float(profile.get("volume_ratio_threshold") or DEFAULT_VOLUME_RATIO_THRESHOLD)
        if stop_loss and price <= stop_loss * 1.01:
            status, severity, needs_ai_review = "接近止损", "danger", True
        elif support and price < support:
            status, severity, needs_ai_review = "跌破关键位", "danger", True
        elif volume_ratio is not None and volume_ratio > volume_threshold and change_pct < -change_threshold:
            status, severity, needs_ai_review = "放量下跌风险", "danger", True
        elif today_high and today_high > 0 and (today_high - price) / today_high * 100 >= 2:
            status, severity, needs_ai_review = "高位回落风险", "warning", True
        elif target and price >= target * 0.99:
            status, severity = "接近目标价", "warning"
        elif any(rule.startswith("突破近20日") or rule.startswith("突破近5日") or rule.startswith("突破昨日") for rule in rules):
            if volume_ratio is not None and volume_ratio >= volume_threshold:
                status, severity = "放量突破观察", "watch"
            else:
                status, severity = "突破但量能不足", "warning"
        elif "跌破5日线" in rules or "跌破10日线" in rules or "跌破昨日低点" in rules:
            status, severity = "缩量回踩观察", "watch"

        if needs_ai_review:
            status = "需要AI复核" if status not in {"接近止损", "跌破关键位", "放量下跌风险"} else status

        return {
            "status": status,
            "rules": rules or ["未触发关键规则"],
            "severity": severity,
            "needs_ai_review": needs_ai_review,
            "message": "实时动态建议由行情规则生成，不等于 AI建议。",
        }

    def _latest_ai_signal(self, stock_code: str, market: Optional[str]) -> Optional[Dict[str, Any]]:
        result = DecisionSignalService().get_latest_active(stock_code=stock_code, market=market, limit=1)
        items = result.get("items") or []
        return items[0] if items else None

    def _conflict_with_ai(self, advice: Dict[str, Any], signal: Optional[Dict[str, Any]]) -> bool:
        if not signal:
            return False
        action = str(signal.get("action") or "").lower()
        status = str(advice.get("status") or "")
        if status in {"跌破关键位", "接近止损", "放量下跌风险", "需要AI复核"} and action in {"buy", "add", "hold"}:
            return True
        if status in {"放量突破观察", "接近目标价"} and action in {"sell", "avoid", "reduce"}:
            return True
        return False

    def snapshot(self, *, refresh_interval_seconds: int = 60) -> Dict[str, Any]:
        profiles = self.list_profiles(enabled_only=True)
        items: List[Dict[str, Any]] = []
        for profile in profiles:
            quote = self.build_quote_snapshot(profile)
            advice = self.build_dynamic_advice(profile, quote)
            latest_signal = self._latest_ai_signal(profile["stock_code"], profile.get("market"))
            conflict = self._conflict_with_ai(advice, latest_signal)
            items.append({
                "profile": profile,
                "quote": quote,
                "dynamic_advice": advice,
                "latest_ai_signal": latest_signal,
                "conflict_with_ai": conflict,
                "conflict_message": "实时状态与上次 AI建议不一致，建议重新 AI复核。旧建议可能失效。" if conflict else None,
            })
        return {
            "items": items,
            "refresh_interval_seconds": refresh_interval_seconds,
            "max_items": MAX_REALTIME_WATCH_ITEMS,
            "message": "自动刷新只更新行情和动态建议，不调用大模型。",
        }

    def submit_ai_review(
        self,
        stock_code: str,
        *,
        skill_id: Optional[str] = None,
        model_strategy: str = "auto",
        save_as_default: bool = False,
        realtime_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        canonical = resolve_index_stock_code_for_analysis(stock_code)
        profile = next((item for item in self.list_profiles() if item["stock_code"] == canonical), None)
        if not profile:
            raise RealtimeWatchValidationError(f"未找到重点盯盘股票: {stock_code}")
        now = datetime.now()
        last_at_raw = profile.get("last_ai_review_at")
        cooldown = int(profile.get("ai_review_cooldown_minutes") or DEFAULT_AI_REVIEW_COOLDOWN_MINUTES)
        if last_at_raw:
            try:
                last_at = datetime.fromisoformat(str(last_at_raw))
                if now - last_at < timedelta(minutes=cooldown):
                    raise RealtimeWatchValidationError(f"AI复核冷却中，请等待 {cooldown} 分钟后再试")
            except RealtimeWatchValidationError:
                raise
            except Exception:
                pass
        count_date = profile.get("ai_review_count_date")
        count = int(profile.get("ai_review_count") or 0) if count_date == now.date().isoformat() else 0
        max_daily = int(profile.get("max_daily_ai_reviews") or MAX_DAILY_AI_REVIEWS)
        if count >= max_daily:
            raise RealtimeWatchValidationError(f"该股票今日 AI复核已达到上限 {max_daily} 次")

        selected_skill = str(skill_id or profile.get("default_skill") or "").strip() or None
        if save_as_default and selected_skill:
            update_payload = dict(profile)
            update_payload["default_skill"] = selected_skill
            self.update_profile(canonical, update_payload)

        context = dict(realtime_context or {})
        context.setdefault("realtime_watch", True)
        context.setdefault("note", "AI复核由用户手动触发，行情刷新不会自动调用 LLM。")
        try:
            task = get_task_queue().submit_task(
                canonical,
                original_query=canonical,
                selection_source="manual",
                query_source="realtime_watch",
                portfolio_context=context,
                report_type="detailed",
                analysis_phase="intraday",
                skills=[selected_skill] if selected_skill else None,
                temporary_pro_analysis=model_strategy == "pro",
            )
        except DuplicateTaskError as exc:
            raise RealtimeWatchValidationError(f"该股票已有分析任务进行中: {exc.existing_task_id}")

        with self.db.get_session() as session:
            row = session.execute(
                select(RealtimeWatchProfileRecord)
                .where(RealtimeWatchProfileRecord.stock_code == canonical)
                .limit(1)
            ).scalar_one()
            row.last_ai_review_at = now
            row.ai_review_count_date = now.date()
            row.ai_review_count = count + 1
            row.updated_at = now
            session.commit()

        return {
            "task_id": task.task_id,
            "stock_code": canonical,
            "status": task.status.value,
            "message": "AI复核任务已加入队列",
            "cooldown_minutes": cooldown,
        }
