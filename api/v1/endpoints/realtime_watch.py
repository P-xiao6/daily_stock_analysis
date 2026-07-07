# -*- coding: utf-8 -*-
"""Realtime watch endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from api.v1.schemas.common import ErrorResponse
from api.v1.schemas.realtime_watch import (
    RealtimeWatchAiReviewRequest,
    RealtimeWatchAiReviewResponse,
    RealtimeWatchProfile,
    RealtimeWatchProfileCreateRequest,
    RealtimeWatchProfilesResponse,
    RealtimeWatchProfileUpdateRequest,
    RealtimeWatchSnapshotResponse,
)
from src.services.realtime_watch_service import (
    MAX_REALTIME_WATCH_ITEMS,
    RealtimeWatchService,
    RealtimeWatchValidationError,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _validation_error(exc: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail={"error": "validation_error", "message": str(exc)})


def _internal_error(message: str, exc: Exception) -> HTTPException:
    logger.error("%s: %s", message, exc, exc_info=True)
    return HTTPException(status_code=500, detail={"error": "internal_error", "message": message})


@router.get(
    "/profiles",
    response_model=RealtimeWatchProfilesResponse,
    responses={500: {"model": ErrorResponse, "description": "查询失败"}},
    summary="获取重点盯盘配置",
    description="返回重点盯盘股票和每股规则配置，不返回 API Key、Webhook、Token 等敏感配置。",
)
def list_profiles() -> RealtimeWatchProfilesResponse:
    try:
        profiles = RealtimeWatchService().list_profiles()
        return RealtimeWatchProfilesResponse(
            profiles=[RealtimeWatchProfile(**item) for item in profiles],
            max_items=MAX_REALTIME_WATCH_ITEMS,
        )
    except Exception as exc:
        raise _internal_error("获取重点盯盘配置失败", exc)


@router.post(
    "/profiles",
    response_model=RealtimeWatchProfile,
    responses={
        400: {"model": ErrorResponse, "description": "参数错误或超过 5 只限制"},
        500: {"model": ErrorResponse, "description": "新增失败"},
    },
    summary="新增重点盯盘股票",
    description="新增 1 只重点盯盘股票；重点盯盘最多 5 只，更多请使用普通自选股页面。",
)
def create_profile(request: RealtimeWatchProfileCreateRequest) -> RealtimeWatchProfile:
    try:
        return RealtimeWatchProfile(**RealtimeWatchService().create_profile(request.model_dump()))
    except RealtimeWatchValidationError as exc:
        raise _validation_error(exc)
    except Exception as exc:
        raise _internal_error("新增重点盯盘股票失败", exc)


@router.put(
    "/profiles/{stock_code}",
    response_model=RealtimeWatchProfile,
    responses={
        400: {"model": ErrorResponse, "description": "参数错误"},
        500: {"model": ErrorResponse, "description": "更新失败"},
    },
    summary="更新重点盯盘规则",
    description="更新关键位、阈值、AI复核冷却时间和默认策略。",
)
def update_profile(
    stock_code: str,
    request: RealtimeWatchProfileUpdateRequest,
) -> RealtimeWatchProfile:
    try:
        return RealtimeWatchProfile(**RealtimeWatchService().update_profile(stock_code, request.model_dump()))
    except RealtimeWatchValidationError as exc:
        raise _validation_error(exc)
    except Exception as exc:
        raise _internal_error("更新重点盯盘规则失败", exc)


@router.delete(
    "/profiles/{stock_code}",
    responses={
        200: {"description": "已删除"},
        500: {"model": ErrorResponse, "description": "删除失败"},
    },
    summary="删除重点盯盘股票",
)
def delete_profile(stock_code: str) -> dict:
    try:
        RealtimeWatchService().delete_profile(stock_code)
        return {"message": f"已删除 {stock_code}"}
    except Exception as exc:
        raise _internal_error("删除重点盯盘股票失败", exc)


@router.get(
    "/snapshot",
    response_model=RealtimeWatchSnapshotResponse,
    responses={500: {"model": ErrorResponse, "description": "查询失败"}},
    summary="获取重点盯盘快照",
    description="刷新行情和动态建议；不会触发完整 AI 分析或调用 LLM。",
)
def get_snapshot(
    refresh_interval_seconds: int = Query(60, ge=30, le=300),
) -> RealtimeWatchSnapshotResponse:
    try:
        return RealtimeWatchSnapshotResponse(
            **RealtimeWatchService().snapshot(refresh_interval_seconds=refresh_interval_seconds)
        )
    except Exception as exc:
        raise _internal_error("获取重点盯盘快照失败", exc)


@router.post(
    "/profiles/{stock_code}/ai-review",
    response_model=RealtimeWatchAiReviewResponse,
    responses={
        400: {"model": ErrorResponse, "description": "冷却中或参数错误"},
        500: {"model": ErrorResponse, "description": "提交失败"},
    },
    summary="手动提交 AI复核任务",
    description="AI复核进入现有分析任务队列；行情自动刷新不会调用该接口。",
)
def submit_ai_review(
    stock_code: str,
    request: RealtimeWatchAiReviewRequest,
) -> RealtimeWatchAiReviewResponse:
    try:
        return RealtimeWatchAiReviewResponse(
            **RealtimeWatchService().submit_ai_review(
                stock_code,
                skill_id=request.skill_id,
                model_strategy=request.model_strategy,
                save_as_default=request.save_as_default,
                realtime_context=request.realtime_context,
            )
        )
    except RealtimeWatchValidationError as exc:
        raise _validation_error(exc)
    except Exception as exc:
        raise _internal_error("提交 AI复核任务失败", exc)
