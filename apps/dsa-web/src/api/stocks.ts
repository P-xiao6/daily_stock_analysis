import apiClient from './index';
import { toCamelCase } from './utils';

export type ExtractItem = {
  code?: string | null;
  name?: string | null;
  confidence: string;
};

export type ExtractFromImageResponse = {
  codes: string[];
  items?: ExtractItem[];
  rawText?: string;
};

export type StockQuote = {
  stockCode: string;
  stockName?: string | null;
  currentPrice: number;
  change?: number | null;
  changePercent?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  prevClose?: number | null;
  volume?: number | null;
  amount?: number | null;
  updateTime?: string | null;
};

export type WatchlistModelStrategy = 'auto' | 'flash' | 'pro';
export type WatchlistScheduleMode = 'manual_only' | 'daily_close' | 'intraday' | 'custom_times' | 'alert_triggered';

export type WatchlistProfile = {
  stockCode: string;
  market?: string | null;
  enabled: boolean;
  defaultSkill?: string | null;
  modelStrategy: WatchlistModelStrategy;
  autoAnalysisEnabled: boolean;
  scheduleMode: WatchlistScheduleMode;
  scheduleTimes: string[];
  cooldownMinutes: number;
  maxDailyRuns: number;
  lastAnalysisAt?: string | null;
  nextAnalysisAt?: string | null;
  lastReportId?: number | null;
  lastDecisionSignalId?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type WatchlistProfileUpdateRequest = {
  market?: string | null;
  enabled: boolean;
  defaultSkill?: string | null;
  modelStrategy: WatchlistModelStrategy;
  autoAnalysisEnabled: boolean;
  scheduleMode: WatchlistScheduleMode;
  scheduleTimes: string[];
  cooldownMinutes: number;
  maxDailyRuns: number;
};

function toSnakeProfilePayload(payload: WatchlistProfileUpdateRequest): Record<string, unknown> {
  return {
    market: payload.market,
    enabled: payload.enabled,
    default_skill: payload.defaultSkill,
    model_strategy: payload.modelStrategy,
    auto_analysis_enabled: payload.autoAnalysisEnabled,
    schedule_mode: payload.scheduleMode,
    schedule_times: payload.scheduleTimes,
    cooldown_minutes: payload.cooldownMinutes,
    max_daily_runs: payload.maxDailyRuns,
  };
}

export const stocksApi = {
  async extractFromImage(file: File): Promise<ExtractFromImageResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const headers: { [key: string]: string | undefined } = { 'Content-Type': undefined };
    const response = await apiClient.post(
      '/api/v1/stocks/extract-from-image',
      formData,
      {
        headers,
        timeout: 60000, // Vision API can be slow; 60s
      },
    );

    const data = response.data as { codes?: string[]; items?: ExtractItem[]; raw_text?: string };
    return {
      codes: data.codes ?? [],
      items: data.items,
      rawText: data.raw_text,
    };
  },

  async parseImport(file?: File, text?: string): Promise<ExtractFromImageResponse> {
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      const headers: { [key: string]: string | undefined } = { 'Content-Type': undefined };
      const response = await apiClient.post('/api/v1/stocks/parse-import', formData, { headers });
      const data = response.data as { codes?: string[]; items?: ExtractItem[] };
      return { codes: data.codes ?? [], items: data.items };
    }
    if (text) {
      const response = await apiClient.post('/api/v1/stocks/parse-import', { text });
      const data = response.data as { codes?: string[]; items?: ExtractItem[] };
      return { codes: data.codes ?? [], items: data.items };
    }
    throw new Error('请提供文件或粘贴文本');
  },

  async getQuote(stockCode: string): Promise<StockQuote> {
    const response = await apiClient.get<Record<string, unknown>>(
      `/api/v1/stocks/${encodeURIComponent(stockCode)}/quote`,
    );
    return toCamelCase<StockQuote>(response.data);
  },

  async getWatchlistProfiles(): Promise<WatchlistProfile[]> {
    const response = await apiClient.get<Record<string, unknown>>('/api/v1/stocks/watchlist/profiles');
    const data = toCamelCase<{ profiles: WatchlistProfile[] }>(response.data);
    return data.profiles || [];
  },

  async updateWatchlistProfile(
    stockCode: string,
    payload: WatchlistProfileUpdateRequest,
  ): Promise<WatchlistProfile> {
    const response = await apiClient.put<Record<string, unknown>>(
      `/api/v1/stocks/watchlist/profiles/${encodeURIComponent(stockCode)}`,
      toSnakeProfilePayload(payload),
    );
    return toCamelCase<WatchlistProfile>(response.data);
  },

  async runDueWatchlistAutoAnalysis(limit = 1): Promise<{
    submitted: Array<Record<string, unknown>>;
    skipped: Array<Record<string, unknown>>;
    limit: number;
  }> {
    const response = await apiClient.post<Record<string, unknown>>('/api/v1/stocks/watchlist/auto-analysis/run-due', {
      limit,
    });
    return toCamelCase(response.data);
  },
};
