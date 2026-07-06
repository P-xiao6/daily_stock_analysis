# -*- coding: utf-8 -*-
"""Realtime watch API schemas."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


DynamicAdviceStatus = Literal[
    "震荡观察",
    "放量突破观察",
    "突破但量能不足",
    "缩量回踩观察",
    "跌破关键位",
    "接近止损",
    "接近目标价",
    "高位回落风险",
    "放量下跌风险",
    "需要AI复核",
]

RealtimeModelStrategy = Literal["auto", "flash", "pro"]


class RealtimeWatchProfile(BaseModel):
    """重点盯盘每股规则配置。"""

    stock_code: str
    stock_name: Optional[str] = None
    market: Optional[str] = None
    enabled: bool = True
    resistance_price: Optional[float] = None
    support_price: Optional[float] = None
    stop_loss_price: Optional[float] = None
    target_price: Optional[float] = None
    volume_ratio_threshold: float = Field(2.0, ge=0.1, le=20)
    change_percent_threshold: float = Field(3.0, ge=0.1, le=20)
    auto_ai_review_enabled: bool = False
    ai_review_cooldown_minutes: int = Field(30, ge=1, le=1440)
    max_daily_ai_reviews: int = Field(3, ge=1, le=3)
    default_skill: Optional[str] = None
    last_ai_review_at: Optional[str] = None
    ai_review_count_date: Optional[str] = None
    ai_review_count: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class RealtimeWatchProfileCreateRequest(BaseModel):
    """新增重点盯盘股票。"""

    stock_code: str = Field(..., min_length=1, max_length=32)
    stock_name: Optional[str] = Field(None, max_length=128)
    market: Optional[str] = Field(None, max_length=16)


class RealtimeWatchProfileUpdateRequest(BaseModel):
    """更新重点盯盘规则配置。"""

    stock_name: Optional[str] = Field(None, max_length=128)
    market: Optional[str] = Field(None, max_length=16)
    enabled: bool = True
    resistance_price: Optional[float] = None
    support_price: Optional[float] = None
    stop_loss_price: Optional[float] = None
    target_price: Optional[float] = None
    volume_ratio_threshold: float = Field(2.0, ge=0.1, le=20)
    change_percent_threshold: float = Field(3.0, ge=0.1, le=20)
    auto_ai_review_enabled: bool = False
    ai_review_cooldown_minutes: int = Field(30, ge=1, le=1440)
    max_daily_ai_reviews: int = Field(3, ge=1, le=3)
    default_skill: Optional[str] = Field(None, max_length=64)


class RealtimeQuoteSnapshot(BaseModel):
    """实时盯盘行情快照。"""

    stock_code: str
    stock_name: Optional[str] = None
    current_price: Optional[float] = None
    change: Optional[float] = None
    change_percent: Optional[float] = None
    volume: Optional[float] = None
    amount: Optional[float] = None
    volume_ratio: Optional[float] = None
    turnover_rate: Optional[float] = None
    today_high: Optional[float] = None
    today_low: Optional[float] = None
    yesterday_high: Optional[float] = None
    yesterday_low: Optional[float] = None
    five_day_high: Optional[float] = None
    five_day_low: Optional[float] = None
    twenty_day_high: Optional[float] = None
    ma5: Optional[float] = None
    ma10: Optional[float] = None
    ma20: Optional[float] = None
    source: str = "best_effort"
    quote_time: Optional[str] = None
    stale: bool = False


class DynamicAdvice(BaseModel):
    """行情规则生成的动态建议，不等于 DecisionSignal。"""

    status: DynamicAdviceStatus
    rules: List[str] = Field(default_factory=list)
    severity: Literal["info", "watch", "warning", "danger"] = "info"
    needs_ai_review: bool = False
    message: str = ""


class RealtimeWatchItem(BaseModel):
    profile: RealtimeWatchProfile
    quote: Optional[RealtimeQuoteSnapshot] = None
    dynamic_advice: DynamicAdvice
    latest_ai_signal: Optional[Dict[str, Any]] = None
    conflict_with_ai: bool = False
    conflict_message: Optional[str] = None


class RealtimeWatchSnapshotResponse(BaseModel):
    items: List[RealtimeWatchItem] = Field(default_factory=list)
    refresh_interval_seconds: int = 60
    max_items: int = 5
    message: Optional[str] = None


class RealtimeWatchProfilesResponse(BaseModel):
    profiles: List[RealtimeWatchProfile] = Field(default_factory=list)
    max_items: int = 5


class RealtimeWatchAiReviewRequest(BaseModel):
    """手动 AI 复核请求。"""

    skill_id: Optional[str] = None
    model_strategy: RealtimeModelStrategy = "auto"
    save_as_default: bool = False
    realtime_context: Optional[Dict[str, Any]] = None


class RealtimeWatchAiReviewResponse(BaseModel):
    task_id: str
    stock_code: str
    status: str = "pending"
    message: str
    cooldown_minutes: int = 30
