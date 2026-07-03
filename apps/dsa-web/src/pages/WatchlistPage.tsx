import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  FileText,
  GripVertical,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react';
import { agentApi, type SkillInfo } from '../api/agent';
import { analysisApi } from '../api/analysis';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import { historyApi } from '../api/history';
import { decisionSignalsApi } from '../api/decisionSignals';
import {
  stocksApi,
  type StockQuote,
  type WatchlistModelStrategy,
  type WatchlistProfile,
  type WatchlistScheduleMode,
} from '../api/stocks';
import { ApiErrorAlert, AppPage, Button, Card, ConfirmDialog, EmptyState, InlineAlert, PageHeader } from '../components/common';
import { ReportMarkdownDrawer } from '../components/report/ReportMarkdownDrawer';
import { StockAutocomplete } from '../components/StockAutocomplete';
import { useAuth } from '../contexts/AuthContext';
import { useStockIndex } from '../hooks/useStockIndex';
import { useWatchlist } from '../hooks/useWatchlist';
import type { HistoryItem, ReportLanguage } from '../types/analysis';
import type { DecisionSignalItem } from '../types/decisionSignals';
import type { StockIndexItem } from '../types/stockIndex';
import { normalizeStockCode } from '../utils/stockCode';

type WatchlistRow = {
  code: string;
  name?: string | null;
  market: string;
  quote?: StockQuote | null;
  latestHistory?: HistoryItem | null;
  latestSignal?: DecisionSignalItem | null;
  profile?: WatchlistProfile | null;
  error?: string | null;
};

type ReportDrawerState = {
  recordId: number;
  stockCode: string;
  stockName: string;
  reportLanguage?: ReportLanguage;
} | null;

type DeepAnalysisDialogState = {
  row: WatchlistRow;
  skillId: string;
  modelStrategy: WatchlistModelStrategy;
  saveAsDefault: boolean;
} | null;

type ProfileDialogState = {
  row: WatchlistRow;
  defaultSkill: string;
  modelStrategy: WatchlistModelStrategy;
  autoAnalysisEnabled: boolean;
  scheduleMode: WatchlistScheduleMode;
  scheduleTimes: string;
  cooldownMinutes: number;
  maxDailyRuns: number;
} | null;

type TaskBadge = {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | string;
  reportId?: number;
};

const MARKET_LABELS: Record<string, string> = {
  CN: 'A 股',
  HK: '港股',
  US: '美股',
  JP: '日股',
  KR: '韩股',
  TW: '台股',
  BSE: '北交所',
  ETF: 'ETF',
  INDEX: '指数',
};

function formatNumber(value?: number | null, digits = 2): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value);
}

function formatLargeNumber(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 100000000) return `${formatNumber(value / 100000000)}亿`;
  if (abs >= 10000) return `${formatNumber(value / 10000)}万`;
  return formatNumber(value, 0);
}

function formatPercent(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return `${value > 0 ? '+' : ''}${formatNumber(value)}%`;
}

function formatTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getIndexMatch(index: StockIndexItem[], code: string): StockIndexItem | undefined {
  const normalized = normalizeStockCode(code).toUpperCase();
  return index.find((item) => {
    const keys = [item.canonicalCode, item.displayCode].map((value) => normalizeStockCode(value).toUpperCase());
    return keys.includes(normalized);
  });
}

function inferMarket(code: string, indexItem?: StockIndexItem): string {
  if (indexItem?.market) return MARKET_LABELS[indexItem.market] ?? indexItem.market;
  const upper = code.trim().toUpperCase();
  if (upper.startsWith('HK') || upper.endsWith('.HK') || /^\d{5}$/.test(upper)) return '港股';
  if (upper.endsWith('.T')) return '日股';
  if (upper.endsWith('.KS') || upper.endsWith('.KQ')) return '韩股';
  if (upper.endsWith('.TW') || upper.endsWith('.TWO')) return '台股';
  if (/^[A-Z]{1,5}(?:\.US)?$/.test(upper)) return '美股';
  return 'A 股';
}

async function loadWatchlistRow(
  code: string,
  index: StockIndexItem[],
  profile?: WatchlistProfile,
): Promise<WatchlistRow> {
  const indexItem = getIndexMatch(index, code);
  const [quoteResult, historyResult, signalResult] = await Promise.allSettled([
    stocksApi.getQuote(code),
    historyApi.getList({ stockCode: code, page: 1, limit: 1 }),
    decisionSignalsApi.getLatest(code, { limit: 1 }),
  ]);

  const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
  const latestHistory = historyResult.status === 'fulfilled' ? historyResult.value.items[0] ?? null : null;
  const latestSignal = signalResult.status === 'fulfilled' ? signalResult.value.items[0] ?? null : null;
  const error = quoteResult.status === 'rejected' ? '行情暂不可用' : null;

  return {
    code,
    name: quote?.stockName || latestHistory?.stockName || indexItem?.nameZh || null,
    market: inferMarket(code, indexItem),
    quote,
    latestHistory,
    latestSignal,
    profile,
    error,
  };
}

const WatchlistPage: React.FC = () => {
  const { authEnabled, loggedIn } = useAuth();
  const canModify = !authEnabled || loggedIn;
  const { index } = useStockIndex();
  const {
    watchlistCodes,
    isLoading,
    isActioning,
    actionMessage,
    addToWatchlist,
    removeFromWatchlist,
    reorderWatchlist,
    refresh,
  } = useWatchlist();
  const [input, setInput] = useState('');
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [isLoadingRows, setIsLoadingRows] = useState(false);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draggedCode, setDraggedCode] = useState<string | null>(null);
  const [confirmAnalyzeAll, setConfirmAnalyzeAll] = useState(false);
  const [isSubmittingAnalysis, setIsSubmittingAnalysis] = useState(false);
  const [reportDrawer, setReportDrawer] = useState<ReportDrawerState>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [profileDialog, setProfileDialog] = useState<ProfileDialogState>(null);
  const [deepAnalysisDialog, setDeepAnalysisDialog] = useState<DeepAnalysisDialogState>(null);
  const [taskBadges, setTaskBadges] = useState<Record<string, TaskBadge>>({});

  const visibleRows = useMemo(() => {
    const byCode = new Map(rows.map((row) => [row.code, row]));
    return watchlistCodes.map((code) => byCode.get(code) ?? {
      code,
      market: inferMarket(code, getIndexMatch(index, code)),
      name: getIndexMatch(index, code)?.nameZh,
    });
  }, [index, rows, watchlistCodes]);

  const loadRows = useCallback(async () => {
    if (watchlistCodes.length === 0) {
      setRows([]);
      return;
    }
    setIsLoadingRows(true);
    setError(null);
    try {
      const profiles = await stocksApi.getWatchlistProfiles();
      const profilesByCode = new Map(profiles.map((profile) => [normalizeStockCode(profile.stockCode).toUpperCase(), profile]));
      const nextRows = await Promise.all(watchlistCodes.map((code) => loadWatchlistRow(
        code,
        index,
        profilesByCode.get(normalizeStockCode(code).toUpperCase()),
      )));
      setRows(nextRows);
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setIsLoadingRows(false);
    }
  }, [index, watchlistCodes]);

  useEffect(() => {
    document.title = '自选股 - DSA';
  }, []);

  useEffect(() => {
    let active = true;
    agentApi.getSkills()
      .then((response) => {
        if (active) setSkills(response.skills);
      })
      .catch(() => {
        if (active) setSkills([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const persistOrder = useCallback(async (codes: string[]) => {
    if (!canModify) return;
    await reorderWatchlist(codes);
  }, [canModify, reorderWatchlist]);

  const moveCode = useCallback((code: string, direction: -1 | 1) => {
    const indexOfCode = watchlistCodes.indexOf(code);
    const nextIndex = indexOfCode + direction;
    if (indexOfCode < 0 || nextIndex < 0 || nextIndex >= watchlistCodes.length) return;
    const nextCodes = [...watchlistCodes];
    [nextCodes[indexOfCode], nextCodes[nextIndex]] = [nextCodes[nextIndex], nextCodes[indexOfCode]];
    void persistOrder(nextCodes);
  }, [persistOrder, watchlistCodes]);

  const handleDrop = useCallback((targetCode: string) => {
    if (!draggedCode || draggedCode === targetCode || !canModify) return;
    const nextCodes = [...watchlistCodes];
    const from = nextCodes.indexOf(draggedCode);
    const to = nextCodes.indexOf(targetCode);
    if (from < 0 || to < 0) return;
    const [item] = nextCodes.splice(from, 1);
    nextCodes.splice(to, 0, item);
    setDraggedCode(null);
    void persistOrder(nextCodes);
  }, [canModify, draggedCode, persistOrder, watchlistCodes]);

  const handleAdd = useCallback(async (code: string) => {
    if (!canModify || !code.trim()) return;
    await addToWatchlist(code);
    setInput('');
  }, [addToWatchlist, canModify]);

  useEffect(() => {
    const activeTaskIds = Object.values(taskBadges)
      .filter((task) => task.status === 'pending' || task.status === 'processing')
      .map((task) => task.taskId);
    if (activeTaskIds.length === 0) return undefined;

    const timer = window.setInterval(() => {
      activeTaskIds.forEach((taskId) => {
        void analysisApi.getStatus(taskId)
          .then((task) => {
            setTaskBadges((prev) => {
              const entry = Object.entries(prev).find(([, value]) => value.taskId === taskId);
              if (!entry) return prev;
              const [code] = entry;
              const reportId = task.result?.report?.meta?.id ?? prev[code]?.reportId;
              return {
                ...prev,
                [code]: {
                  taskId,
                  status: task.status,
                  reportId,
                },
              };
            });
          })
          .catch(() => {
            setTaskBadges((prev) => {
              const entry = Object.entries(prev).find(([, value]) => value.taskId === taskId);
              if (!entry) return prev;
              const [code] = entry;
              return { ...prev, [code]: { ...prev[code], status: 'failed' } };
            });
          });
      });
    }, 4000);

    return () => window.clearInterval(timer);
  }, [taskBadges]);

  const openProfileDialog = useCallback((row: WatchlistRow) => {
    const profile = row.profile;
    setProfileDialog({
      row,
      defaultSkill: profile?.defaultSkill || '',
      modelStrategy: profile?.modelStrategy || 'auto',
      autoAnalysisEnabled: Boolean(profile?.autoAnalysisEnabled),
      scheduleMode: profile?.scheduleMode || 'manual_only',
      scheduleTimes: (profile?.scheduleTimes || []).join(','),
      cooldownMinutes: profile?.cooldownMinutes || 30,
      maxDailyRuns: profile?.maxDailyRuns || 1,
    });
  }, []);

  const saveProfileDialog = useCallback(async () => {
    if (!profileDialog || !canModify) return;
    const times = profileDialog.scheduleTimes
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (profileDialog.autoAnalysisEnabled && profileDialog.maxDailyRuns > 1) {
      setNotice('盘中多次自动分析可能增加 token 成本和数据源压力，请确认这是你需要的频率。');
    }
    try {
      await stocksApi.updateWatchlistProfile(profileDialog.row.code, {
        market: profileDialog.row.profile?.market,
        enabled: true,
        defaultSkill: profileDialog.defaultSkill || null,
        modelStrategy: profileDialog.modelStrategy,
        autoAnalysisEnabled: profileDialog.autoAnalysisEnabled,
        scheduleMode: profileDialog.scheduleMode,
        scheduleTimes: times,
        cooldownMinutes: profileDialog.cooldownMinutes,
        maxDailyRuns: profileDialog.maxDailyRuns,
      });
      setProfileDialog(null);
      await loadRows();
    } catch (err) {
      setError(getParsedApiError(err));
    }
  }, [canModify, loadRows, profileDialog]);

  const openDeepAnalysisDialog = useCallback((row: WatchlistRow) => {
    setDeepAnalysisDialog({
      row,
      skillId: row.profile?.defaultSkill || '',
      modelStrategy: row.profile?.modelStrategy || 'auto',
      saveAsDefault: false,
    });
  }, []);

  const submitDeepAnalysis = useCallback(async () => {
    if (!deepAnalysisDialog || !canModify) return;
    const { row, skillId, modelStrategy, saveAsDefault } = deepAnalysisDialog;
    setIsSubmittingAnalysis(true);
    try {
      if (saveAsDefault) {
        await stocksApi.updateWatchlistProfile(row.code, {
          market: row.profile?.market,
          enabled: true,
          defaultSkill: skillId || null,
          modelStrategy,
          autoAnalysisEnabled: Boolean(row.profile?.autoAnalysisEnabled),
          scheduleMode: row.profile?.scheduleMode || 'manual_only',
          scheduleTimes: row.profile?.scheduleTimes || [],
          cooldownMinutes: row.profile?.cooldownMinutes || 30,
          maxDailyRuns: row.profile?.maxDailyRuns || 1,
        });
      }
      const task = await analysisApi.analyzeAsync({
        stockCode: row.code,
        stockName: row.name || undefined,
        asyncMode: true,
        reportType: 'detailed',
        originalQuery: row.code,
        selectionSource: 'manual',
        skills: skillId ? [skillId] : undefined,
        temporaryProAnalysis: modelStrategy === 'pro',
      });
      const taskId = 'taskId' in task ? task.taskId : task.accepted?.[0]?.taskId;
      if (taskId) {
        setTaskBadges((prev) => ({ ...prev, [row.code]: { taskId, status: 'pending' } }));
      }
      setNotice(`${row.code} 深度分析任务已提交`);
      setDeepAnalysisDialog(null);
      await loadRows();
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setIsSubmittingAnalysis(false);
    }
  }, [canModify, deepAnalysisDialog, loadRows]);

  const handleAnalyzeAll = useCallback(async () => {
    if (watchlistCodes.length === 0) return;
    setIsSubmittingAnalysis(true);
    setNotice(null);
    try {
      await analysisApi.analyzeAsync({
        stockCodes: watchlistCodes,
        asyncMode: true,
        originalQuery: watchlistCodes.join(','),
        selectionSource: 'manual',
      });
      setNotice(`已提交 ${watchlistCodes.length} 只自选股分析任务`);
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setIsSubmittingAnalysis(false);
      setConfirmAnalyzeAll(false);
    }
  }, [watchlistCodes]);

  const renderSignal = (signal?: DecisionSignalItem | null) => {
    if (!signal) return <span className="text-secondary-text">暂无</span>;
    return (
      <button
        type="button"
        className="min-w-0 text-left hover:text-cyan"
        onClick={() => window.location.assign(`/decision-signals?stockCode=${encodeURIComponent(signal.stockCode)}`)}
      >
        <div className="font-medium text-foreground">{signal.actionLabel || signal.action}</div>
        <div className="truncate text-xs text-secondary-text">
          {[
            signal.confidence !== null && signal.confidence !== undefined ? `置信 ${formatNumber(signal.confidence * 100, 0)}%` : null,
            signal.score !== null && signal.score !== undefined ? `分数 ${signal.score}` : null,
            signal.horizon,
            signal.sourceReportId ? `报告 ${signal.sourceReportId}` : null,
            formatTime(signal.createdAt),
          ].filter(Boolean).join(' · ')}
        </div>
      </button>
    );
  };

  const openDecisionSignal = (stockCode: string) => {
    window.location.assign(`/decision-signals?stockCode=${encodeURIComponent(stockCode)}`);
  };

  const skillName = useCallback((skillId?: string | null) => {
    if (!skillId) return '跟随全局';
    return skills.find((skill) => skill.id === skillId)?.name || skillId;
  }, [skills]);

  const renderTaskState = (row: WatchlistRow) => {
    const task = taskBadges[row.code];
    if (!task) return <span className="text-secondary-text">-</span>;
    const labelMap: Record<string, string> = {
      pending: '排队中',
      processing: '分析中',
      completed: '已完成',
      failed: '失败',
    };
    return (
      <div className="space-y-1">
        <span className="rounded-lg border border-border/70 px-2 py-1 text-xs text-secondary-text">
          {labelMap[task.status] || task.status}
        </span>
        {task.status === 'completed' && task.reportId ? (
          <button
            type="button"
            className="block text-xs text-cyan hover:underline"
            onClick={() => setReportDrawer({
              recordId: task.reportId!,
              stockCode: row.code,
              stockName: row.name || row.code,
            })}
          >
            查看报告
          </button>
        ) : null}
        {task.status === 'completed' && row.latestSignal ? (
          <button
            type="button"
            className="block text-xs text-cyan hover:underline"
            onClick={() => openDecisionSignal(row.code)}
          >
            查看 AI 建议
          </button>
        ) : null}
      </div>
    );
  };

  const renderRowActions = (row: WatchlistRow, indexOfRow: number) => (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Button
        variant="ghost"
        size="xsm"
        title="上移"
        disabled={!canModify || indexOfRow === 0 || isActioning}
        onClick={() => moveCode(row.code, -1)}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="xsm"
        title="下移"
        disabled={!canModify || indexOfRow === watchlistCodes.length - 1 || isActioning}
        onClick={() => moveCode(row.code, 1)}
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="xsm"
        disabled={!canModify || isSubmittingAnalysis}
        onClick={() => openDeepAnalysisDialog(row)}
      >
        <Play className="h-4 w-4" />
        深度分析
      </Button>
      <Button
        variant="secondary"
        size="xsm"
        disabled={!canModify}
        onClick={() => openProfileDialog(row)}
      >
        <Settings2 className="h-4 w-4" />
        配置
      </Button>
      <Button
        variant="ghost"
        size="xsm"
        title="删除"
        disabled={!canModify || isActioning}
        onClick={() => void removeFromWatchlist(row.code)}
      >
        <Trash2 className="h-4 w-4 text-danger" />
      </Button>
    </div>
  );

  return (
    <AppPage>
      <div className="space-y-5">
        <PageHeader
          eyebrow="Watchlist"
          title="自选股"
          description="集中查看和管理 STOCK_LIST 中的股票，支持每股策略、自动深度分析计划、历史报告和最新 AI 建议。"
          actions={(
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={isLoadingRows}
                onClick={() => {
                  void refresh();
                  void loadRows();
                }}
              >
                <RefreshCw className="h-4 w-4" />
                刷新
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={watchlistCodes.length === 0 || isSubmittingAnalysis}
                onClick={() => setConfirmAnalyzeAll(true)}
              >
                <BarChart3 className="h-4 w-4" />
                一键分析全部
              </Button>
            </>
          )}
        />

        {error ? <ApiErrorAlert error={error} /> : null}
        {notice ? <InlineAlert variant="success" title="任务已提交" message={notice} /> : null}
        {actionMessage ? <InlineAlert variant="info" title="自选股" message={actionMessage} /> : null}
        {!canModify ? (
          <InlineAlert
            variant="warning"
            title="只读模式"
            message="当前未登录，只能查看自选股，不能添加、删除或排序。"
          />
        ) : null}
        {watchlistCodes.length > 10 ? (
          <InlineAlert
            variant="warning"
            title="成本提示"
            message="自选股超过 10 只可能增加 token 成本和数据源压力。2核2G 部署建议 MAX_WORKERS=1，每轮最多自动分析 1 只。"
          />
        ) : null}

        <Card padding="md">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="min-w-0 flex-1">
              <StockAutocomplete
                value={input}
                onChange={setInput}
                onSubmit={(code) => void handleAdd(code)}
                disabled={!canModify || isActioning}
                placeholder="输入股票代码或名称添加自选"
              />
            </div>
            <Button
              variant="primary"
              className="md:w-auto"
              disabled={!canModify || !input.trim() || isActioning}
              onClick={() => void handleAdd(input)}
            >
              <Plus className="h-4 w-4" />
              添加股票
            </Button>
          </div>
        </Card>

        {isLoading || isLoadingRows ? (
          <Card padding="lg">
            <div className="flex h-32 items-center justify-center text-sm text-secondary-text">正在加载自选股...</div>
          </Card>
        ) : visibleRows.length === 0 ? (
          <EmptyState
            title="暂无自选股"
            description="添加几只关注的股票后，这里会显示行情、历史分析和 AI 建议。"
          />
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-soft-card lg:block">
              <table className="w-full table-fixed text-left text-sm">
                <thead className="border-b border-border/70 bg-hover/40 text-xs uppercase text-secondary-text">
                  <tr>
                    <th className="w-10 px-3 py-3"></th>
                    <th className="px-3 py-3">股票</th>
                    <th className="px-3 py-3">市场</th>
                    <th className="px-3 py-3">当前价</th>
                    <th className="px-3 py-3">涨跌幅</th>
                    <th className="px-3 py-3">量比/换手</th>
                    <th className="px-3 py-3">深度分析</th>
                    <th className="px-3 py-3">自动计划</th>
                    <th className="px-3 py-3">策略</th>
                    <th className="px-3 py-3">AI 建议</th>
                    <th className="px-3 py-3">任务</th>
                    <th className="px-3 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {visibleRows.map((row, indexOfRow) => (
                    <tr
                      key={row.code}
                      draggable={canModify}
                      onDragStart={() => setDraggedCode(row.code)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => handleDrop(row.code)}
                      className="transition-colors hover:bg-hover/35"
                    >
                      <td className="px-3 py-4 text-secondary-text"><GripVertical className="h-4 w-4" /></td>
                      <td className="px-3 py-4">
                        <div className="font-semibold text-foreground">{row.code}</div>
                        <div className="truncate text-xs text-secondary-text">{row.name || row.error || '-'}</div>
                      </td>
                      <td className="px-3 py-4 text-secondary-text">{row.market}</td>
                      <td className="px-3 py-4 font-medium">{formatNumber(row.quote?.currentPrice)}</td>
                      <td className={row.quote?.changePercent && row.quote.changePercent > 0 ? 'px-3 py-4 text-danger' : 'px-3 py-4 text-success'}>
                        {formatPercent(row.quote?.changePercent)}
                      </td>
                      <td className="px-3 py-4 text-secondary-text">
                        <div>量比 {formatNumber(row.latestHistory?.volumeRatio)}</div>
                        <div className="text-xs">换手 {formatPercent(row.latestHistory?.turnoverRate)}</div>
                      </td>
                      <td className="px-3 py-4">
                        {row.latestHistory?.id ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-cyan hover:underline"
                            onClick={() => setReportDrawer({
                              recordId: row.latestHistory!.id,
                              stockCode: row.latestHistory!.stockCode || row.code,
                              stockName: row.latestHistory!.stockName || row.name || row.code,
                            })}
                          >
                            <FileText className="h-4 w-4" />
                            {formatTime(row.latestHistory.createdAt)}
                          </button>
                        ) : (
                          <span className="text-secondary-text">暂无报告</span>
                        )}
                      </td>
                      <td className="px-3 py-4 text-secondary-text">
                        <div>{row.profile?.autoAnalysisEnabled ? '已启用' : '未启用'}</div>
                        <div className="text-xs">{formatTime(row.profile?.nextAnalysisAt)}</div>
                      </td>
                      <td className="px-3 py-4 text-secondary-text">
                        <div className="truncate">{skillName(row.profile?.defaultSkill)}</div>
                        <div className="text-xs">模型 {row.profile?.modelStrategy || 'auto'}</div>
                      </td>
                      <td className="px-3 py-4">{renderSignal(row.latestSignal)}</td>
                      <td className="px-3 py-4">{renderTaskState(row)}</td>
                      <td className="px-3 py-4">{renderRowActions(row, indexOfRow)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 lg:hidden">
              {visibleRows.map((row, indexOfRow) => (
                <Card key={row.code} padding="md">
                  <div
                    draggable={canModify}
                    onDragStart={() => setDraggedCode(row.code)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => handleDrop(row.code)}
                    className="space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 text-secondary-text" />
                          <h2 className="text-lg font-semibold text-foreground">{row.code}</h2>
                        </div>
                        <p className="mt-1 truncate text-sm text-secondary-text">{row.name || row.error || '-'}</p>
                      </div>
                      <span className="rounded-lg border border-border/70 px-2 py-1 text-xs text-secondary-text">{row.market}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-secondary-text">当前价</div>
                        <div className="font-semibold">{formatNumber(row.quote?.currentPrice)}</div>
                      </div>
                      <div>
                        <div className="text-secondary-text">涨跌幅</div>
                        <div className={row.quote?.changePercent && row.quote.changePercent > 0 ? 'font-semibold text-danger' : 'font-semibold text-success'}>
                          {formatPercent(row.quote?.changePercent)}
                        </div>
                      </div>
                      <div>
                        <div className="text-secondary-text">成交量/额</div>
                        <div>{formatLargeNumber(row.quote?.volume)} / {formatLargeNumber(row.quote?.amount)}</div>
                      </div>
                      <div>
                        <div className="text-secondary-text">换手/量比</div>
                        <div>{formatPercent(row.latestHistory?.turnoverRate)} / {formatNumber(row.latestHistory?.volumeRatio)}</div>
                      </div>
                      <div>
                        <div className="text-secondary-text">默认策略</div>
                        <div>{skillName(row.profile?.defaultSkill)}</div>
                      </div>
                      <div>
                        <div className="text-secondary-text">下次自动分析</div>
                        <div>{row.profile?.autoAnalysisEnabled ? formatTime(row.profile.nextAnalysisAt) : '未启用'}</div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/60 p-3 text-sm">
                      <div className="mb-2 text-xs text-secondary-text">最新 AI 建议</div>
                      {renderSignal(row.latestSignal)}
                    </div>
                    <div className="rounded-xl border border-border/60 p-3 text-sm">
                      <div className="mb-2 text-xs text-secondary-text">深度分析任务</div>
                      {renderTaskState(row)}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {row.latestHistory?.id ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setReportDrawer({
                            recordId: row.latestHistory!.id,
                            stockCode: row.latestHistory!.stockCode || row.code,
                            stockName: row.latestHistory!.stockName || row.name || row.code,
                          })}
                        >
                          <FileText className="h-4 w-4" />
                          最新报告
                        </Button>
                      ) : (
                        <span className="text-sm text-secondary-text">暂无历史报告</span>
                      )}
                      {renderRowActions(row, indexOfRow)}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmAnalyzeAll}
        title="确认分析全部自选股"
        message={`将提交 ${watchlistCodes.length} 只股票的分析任务，可能消耗较多 token。确认继续吗？`}
        confirmText="确认分析"
        confirmDisabled={isSubmittingAnalysis}
        cancelDisabled={isSubmittingAnalysis}
        onConfirm={() => void handleAnalyzeAll()}
        onCancel={() => setConfirmAnalyzeAll(false)}
      />

      {profileDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border/70 bg-elevated p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-foreground">自选股配置 · {profileDialog.row.code}</h3>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-1 text-sm">
                <span className="text-secondary-text">默认分析策略</span>
                <select
                  className="input-surface input-focus-glow h-10 rounded-xl border bg-transparent px-3"
                  value={profileDialog.defaultSkill}
                  onChange={(event) => setProfileDialog({ ...profileDialog, defaultSkill: event.target.value })}
                >
                  <option value="">跟随全局</option>
                  {skills.map((skill) => (
                    <option key={skill.id} value={skill.id}>{skill.name}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-secondary-text">模型策略</span>
                <select
                  className="input-surface input-focus-glow h-10 rounded-xl border bg-transparent px-3"
                  value={profileDialog.modelStrategy}
                  onChange={(event) => setProfileDialog({ ...profileDialog, modelStrategy: event.target.value as WatchlistModelStrategy })}
                >
                  <option value="auto">自动</option>
                  <option value="flash">Flash</option>
                  <option value="pro">Pro</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={profileDialog.autoAnalysisEnabled}
                  onChange={(event) => setProfileDialog({ ...profileDialog, autoAnalysisEnabled: event.target.checked })}
                />
                <span>启用自动深度分析</span>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-secondary-text">计划模式</span>
                <select
                  className="input-surface input-focus-glow h-10 rounded-xl border bg-transparent px-3"
                  value={profileDialog.scheduleMode}
                  onChange={(event) => setProfileDialog({ ...profileDialog, scheduleMode: event.target.value as WatchlistScheduleMode })}
                >
                  <option value="manual_only">只手动分析</option>
                  <option value="daily_close">每日收盘后</option>
                  <option value="intraday">盘中固定时间</option>
                  <option value="custom_times">自定义多个时间点</option>
                  <option value="alert_triggered">告警触发后</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-secondary-text">时间点</span>
                <input
                  className="input-surface input-focus-glow h-10 rounded-xl border bg-transparent px-3"
                  value={profileDialog.scheduleTimes}
                  placeholder="15:10 或 09:45,13:30,14:45"
                  onChange={(event) => setProfileDialog({ ...profileDialog, scheduleTimes: event.target.value })}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="text-secondary-text">冷却分钟</span>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    className="input-surface input-focus-glow h-10 rounded-xl border bg-transparent px-3"
                    value={profileDialog.cooldownMinutes}
                    onChange={(event) => setProfileDialog({ ...profileDialog, cooldownMinutes: Number(event.target.value) })}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="text-secondary-text">每日最多</span>
                  <input
                    type="number"
                    min={1}
                    max={3}
                    className="input-surface input-focus-glow h-10 rounded-xl border bg-transparent px-3"
                    value={profileDialog.maxDailyRuns}
                    onChange={(event) => setProfileDialog({ ...profileDialog, maxDailyRuns: Number(event.target.value) })}
                  />
                </label>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setProfileDialog(null)}>取消</Button>
              <Button variant="primary" onClick={() => void saveProfileDialog()}>保存配置</Button>
            </div>
          </div>
        </div>
      ) : null}

      {deepAnalysisDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border/70 bg-elevated p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-foreground">深度分析 · {deepAnalysisDialog.row.code}</h3>
            <p className="mt-2 text-sm text-secondary-text">提交后任务会进入队列。选择 Pro 可能增加 token 成本。</p>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-1 text-sm">
                <span className="text-secondary-text">分析策略</span>
                <select
                  className="input-surface input-focus-glow h-10 rounded-xl border bg-transparent px-3"
                  value={deepAnalysisDialog.skillId}
                  onChange={(event) => setDeepAnalysisDialog({ ...deepAnalysisDialog, skillId: event.target.value })}
                >
                  <option value="">通用分析 / 跟随全局</option>
                  {skills.map((skill) => (
                    <option key={skill.id} value={skill.id}>{skill.name}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-secondary-text">模型策略</span>
                <select
                  className="input-surface input-focus-glow h-10 rounded-xl border bg-transparent px-3"
                  value={deepAnalysisDialog.modelStrategy}
                  onChange={(event) => setDeepAnalysisDialog({ ...deepAnalysisDialog, modelStrategy: event.target.value as WatchlistModelStrategy })}
                >
                  <option value="auto">自动</option>
                  <option value="flash">Flash</option>
                  <option value="pro">Pro</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={deepAnalysisDialog.saveAsDefault}
                  onChange={(event) => setDeepAnalysisDialog({ ...deepAnalysisDialog, saveAsDefault: event.target.checked })}
                />
                <span>保存为该股票默认策略</span>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" disabled={isSubmittingAnalysis} onClick={() => setDeepAnalysisDialog(null)}>取消</Button>
              <Button variant="primary" isLoading={isSubmittingAnalysis} onClick={() => void submitDeepAnalysis()}>开始分析</Button>
            </div>
          </div>
        </div>
      ) : null}

      {reportDrawer ? (
        <ReportMarkdownDrawer
          recordId={reportDrawer.recordId}
          stockCode={reportDrawer.stockCode}
          stockName={reportDrawer.stockName}
          reportLanguage={reportDrawer.reportLanguage}
          onClose={() => setReportDrawer(null)}
        />
      ) : null}
    </AppPage>
  );
};

export default WatchlistPage;
