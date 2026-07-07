import apiClient from './index';
import { toCamelCase } from './utils';
import type { DecisionSignalItem } from '../types/decisionSignals';

export type DynamicAdviceStatus =
  | '震荡观察'
  | '放量突破观察'
  | '突破但量能不足'
  | '缩量回踩观察'
  | '跌破关键位'
  | '接近止损'
  | '接近目标价'
  | '高位回落风险'
  | '放量下跌风险'
  | '需要AI复核';

export type RealtimeModelStrategy = 'auto' | 'flash' | 'pro';

export type RealtimeWatchProfile = {
  stockCode: string;
  stockName?: string | null;
  market?: string | null;
  enabled: boolean;
  resistancePrice?: number | null;
  supportPrice?: number | null;
  stopLossPrice?: number | null;
  targetPrice?: number | null;
  volumeRatioThreshold: number;
  changePercentThreshold: number;
  autoAiReviewEnabled: boolean;
  aiReviewCooldownMinutes: number;
  maxDailyAiReviews?: number | null;
  defaultSkill?: string | null;
  lastAiReviewAt?: string | null;
  aiReviewCountDate?: string | null;
  aiReviewCount: number;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type RealtimeQuoteSnapshot = {
  stockCode: string;
  stockName?: string | null;
  currentPrice?: number | null;
  change?: number | null;
  changePercent?: number | null;
  volume?: number | null;
  amount?: number | null;
  volumeRatio?: number | null;
  turnoverRate?: number | null;
  todayHigh?: number | null;
  todayLow?: number | null;
  yesterdayHigh?: number | null;
  yesterdayLow?: number | null;
  fiveDayHigh?: number | null;
  fiveDayLow?: number | null;
  twentyDayHigh?: number | null;
  ma5?: number | null;
  ma10?: number | null;
  ma20?: number | null;
  source: string;
  quoteTime?: string | null;
  stale: boolean;
};

export type DynamicAdvice = {
  status: DynamicAdviceStatus;
  rules: string[];
  severity: 'info' | 'watch' | 'warning' | 'danger';
  needsAiReview: boolean;
  message: string;
};

export type RealtimeWatchItem = {
  profile: RealtimeWatchProfile;
  quote?: RealtimeQuoteSnapshot | null;
  dynamicAdvice: DynamicAdvice;
  latestAiSignal?: DecisionSignalItem | null;
  conflictWithAi: boolean;
  conflictMessage?: string | null;
};

export type RealtimeWatchSnapshotResponse = {
  items: RealtimeWatchItem[];
  refreshIntervalSeconds: number;
  maxItems: number;
  message?: string | null;
};

export type RealtimeWatchProfileUpdateRequest = {
  stockName?: string | null;
  market?: string | null;
  enabled: boolean;
  resistancePrice?: number | null;
  supportPrice?: number | null;
  stopLossPrice?: number | null;
  targetPrice?: number | null;
  volumeRatioThreshold: number;
  changePercentThreshold: number;
  autoAiReviewEnabled: boolean;
  aiReviewCooldownMinutes: number;
  defaultSkill?: string | null;
};

function toSnakeProfilePayload(payload: RealtimeWatchProfileUpdateRequest): Record<string, unknown> {
  return {
    stock_name: payload.stockName,
    market: payload.market,
    enabled: payload.enabled,
    resistance_price: payload.resistancePrice,
    support_price: payload.supportPrice,
    stop_loss_price: payload.stopLossPrice,
    target_price: payload.targetPrice,
    volume_ratio_threshold: payload.volumeRatioThreshold,
    change_percent_threshold: payload.changePercentThreshold,
    auto_ai_review_enabled: payload.autoAiReviewEnabled,
    ai_review_cooldown_minutes: payload.aiReviewCooldownMinutes,
    default_skill: payload.defaultSkill,
  };
}

export const realtimeWatchApi = {
  async listProfiles(): Promise<{ profiles: RealtimeWatchProfile[]; maxItems: number }> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/realtime-watch/profiles');
    return toCamelCase(response.data);
  },

  async createProfile(stockCode: string, stockName?: string | null): Promise<RealtimeWatchProfile> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/realtime-watch/profiles', {
      stock_code: stockCode,
      stock_name: stockName,
    });
    return toCamelCase(response.data);
  },

  async updateProfile(
    stockCode: string,
    payload: RealtimeWatchProfileUpdateRequest,
  ): Promise<RealtimeWatchProfile> {
    const response = await apiClient.put<Record<string, unknown>>(
      `/api/v1/realtime-watch/profiles/${encodeURIComponent(stockCode)}`,
      toSnakeProfilePayload(payload),
    );
    return toCamelCase(response.data);
  },

  async deleteProfile(stockCode: string): Promise<void> {
    await apiClient.delete(`/api/v1/realtime-watch/profiles/${encodeURIComponent(stockCode)}`);
  },

  async getSnapshot(refreshIntervalSeconds = 60): Promise<RealtimeWatchSnapshotResponse> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/realtime-watch/snapshot', {
      params: { refresh_interval_seconds: refreshIntervalSeconds },
    });
    return toCamelCase(response.data);
  },

  async submitAiReview(
    stockCode: string,
    payload: {
      skillId?: string | null;
      modelStrategy: RealtimeModelStrategy;
      saveAsDefault: boolean;
      realtimeContext?: Record<string, unknown>;
    },
  ): Promise<{ taskId: string; stockCode: string; status: string; message: string; cooldownMinutes: number }> {
    const response = await apiClient.post<Record<string, unknown>>(
      `/api/v1/realtime-watch/profiles/${encodeURIComponent(stockCode)}/ai-review`,
      {
        skill_id: payload.skillId,
        model_strategy: payload.modelStrategy,
        save_as_default: payload.saveAsDefault,
        realtime_context: payload.realtimeContext,
      },
      { validateStatus: (status) => status === 200 || status === 400 || status === 409 },
    );
    if (response.status >= 400) {
      const detail = response.data?.detail;
      const message = detail && typeof detail === 'object' && 'message' in detail
        ? String((detail as { message?: unknown }).message || '')
        : 'AI复核提交失败';
      throw new Error(message);
    }
    return toCamelCase(response.data);
  },
};
