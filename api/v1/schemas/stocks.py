# -*- coding: utf-8 -*-
"""
===================================
股票数据相关模型
===================================

职责：
1. 定义股票实时行情模型
2. 定义历史 K 线数据模型
"""

from typing import Optional, List, Literal

from pydantic import BaseModel, ConfigDict, Field


class StockQuote(BaseModel):
    """股票实时行情"""
    
    stock_code: str = Field(..., description="股票代码")
    stock_name: Optional[str] = Field(None, description="股票名称")
    current_price: float = Field(..., description="当前价格")
    change: Optional[float] = Field(None, description="涨跌额")
    change_percent: Optional[float] = Field(None, description="涨跌幅 (%)")
    open: Optional[float] = Field(None, description="开盘价")
    high: Optional[float] = Field(None, description="最高价")
    low: Optional[float] = Field(None, description="最低价")
    prev_close: Optional[float] = Field(None, description="昨收价")
    volume: Optional[float] = Field(None, description="成交量（股）")
    amount: Optional[float] = Field(None, description="成交额（元）")
    update_time: Optional[str] = Field(None, description="更新时间")
    
    model_config = ConfigDict(json_schema_extra={
        "example": {
            "stock_code": "600519",
            "stock_name": "贵州茅台",
            "current_price": 1800.00,
            "change": 15.00,
            "change_percent": 0.84,
            "open": 1785.00,
            "high": 1810.00,
            "low": 1780.00,
            "prev_close": 1785.00,
            "volume": 10000000,
            "amount": 18000000000,
            "update_time": "2024-01-01T15:00:00"
        }
    })


class KLineData(BaseModel):
    """K 线数据点"""
    
    date: str = Field(..., description="日期")
    open: float = Field(..., description="开盘价")
    high: float = Field(..., description="最高价")
    low: float = Field(..., description="最低价")
    close: float = Field(..., description="收盘价")
    volume: Optional[float] = Field(None, description="成交量")
    amount: Optional[float] = Field(None, description="成交额")
    change_percent: Optional[float] = Field(None, description="涨跌幅 (%)")
    
    model_config = ConfigDict(json_schema_extra={
        "example": {
            "date": "2024-01-01",
            "open": 1785.00,
            "high": 1810.00,
            "low": 1780.00,
            "close": 1800.00,
            "volume": 10000000,
            "amount": 18000000000,
            "change_percent": 0.84
        }
    })


class ExtractItem(BaseModel):
    """单条提取结果（代码、名称、置信度）"""

    code: Optional[str] = Field(None, description="股票代码，None 表示解析失败")
    name: Optional[str] = Field(None, description="股票名称（如有）")
    confidence: str = Field("medium", description="置信度：high/medium/low")


class ExtractFromImageResponse(BaseModel):
    """图片股票代码提取响应"""

    codes: List[str] = Field(..., description="提取的股票代码（已去重，向后兼容）")
    items: List[ExtractItem] = Field(default_factory=list, description="提取结果明细（代码+名称+置信度）")
    raw_text: Optional[str] = Field(None, description="原始 LLM 响应（调试用）")


class StockHistoryResponse(BaseModel):
    """股票历史行情响应"""
    
    stock_code: str = Field(..., description="股票代码")
    stock_name: Optional[str] = Field(None, description="股票名称")
    period: str = Field(..., description="K 线周期")
    data: List[KLineData] = Field(default_factory=list, description="K 线数据列表")
    
    model_config = ConfigDict(json_schema_extra={
        "example": {
            "stock_code": "600519",
            "stock_name": "贵州茅台",
            "period": "daily",
            "data": []
        }
    })


ScheduleMode = Literal["manual_only", "daily_close", "intraday", "custom_times", "alert_triggered"]
ModelStrategy = Literal["auto", "flash", "pro"]


class WatchlistProfile(BaseModel):
    """每股自选股策略与自动分析配置"""

    stock_code: str = Field(..., description="股票代码")
    market: Optional[str] = Field(None, description="市场")
    enabled: bool = Field(True, description="是否启用该自选 profile")
    default_skill: Optional[str] = Field(None, description="默认策略 Skill ID")
    model_strategy: ModelStrategy = Field("auto", description="模型策略：auto/flash/pro")
    auto_analysis_enabled: bool = Field(False, description="是否启用自动深度分析")
    schedule_mode: ScheduleMode = Field("manual_only", description="自动分析计划模式")
    schedule_times: List[str] = Field(default_factory=list, description="HH:MM 时间点列表")
    cooldown_minutes: int = Field(30, ge=1, le=1440, description="冷却时间，分钟")
    max_daily_runs: int = Field(1, ge=1, le=3, description="每天最多自动运行次数")
    last_analysis_at: Optional[str] = Field(None, description="最近一次深度分析时间")
    next_analysis_at: Optional[str] = Field(None, description="下一次自动分析时间")
    last_report_id: Optional[int] = Field(None, description="最近报告 ID")
    last_decision_signal_id: Optional[int] = Field(None, description="最近 DecisionSignal ID")
    created_at: Optional[str] = Field(None, description="创建时间")
    updated_at: Optional[str] = Field(None, description="更新时间")


class WatchlistProfilesResponse(BaseModel):
    """自选股 profile 列表响应"""

    profiles: List[WatchlistProfile] = Field(default_factory=list)


class WatchlistProfileUpdateRequest(BaseModel):
    """更新单只自选股 profile"""

    market: Optional[str] = None
    enabled: bool = True
    default_skill: Optional[str] = None
    model_strategy: ModelStrategy = "auto"
    auto_analysis_enabled: bool = False
    schedule_mode: ScheduleMode = "manual_only"
    schedule_times: List[str] = Field(default_factory=list)
    cooldown_minutes: int = Field(30, ge=1, le=1440)
    max_daily_runs: int = Field(1, ge=1, le=3)


class WatchlistAutoRunRequest(BaseModel):
    """触发到期自动深度分析扫描"""

    limit: int = Field(1, ge=1, le=10, description="本轮最多提交任务数")


class WatchlistAutoRunResponse(BaseModel):
    """到期自动深度分析扫描结果"""

    submitted: List[dict] = Field(default_factory=list)
    skipped: List[dict] = Field(default_factory=list)
    limit: int = 1
