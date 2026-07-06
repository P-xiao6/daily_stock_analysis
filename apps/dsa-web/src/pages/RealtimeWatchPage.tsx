import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Play, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { agentApi, type SkillInfo } from '../api/agent';
import { analysisApi } from '../api/analysis';
import { getParsedApiError, type ParsedApiError } from '../api/error';
import {
  realtimeWatchApi,
  type RealtimeModelStrategy,
  type RealtimeWatchItem,
  type RealtimeWatchProfile,
  type RealtimeWatchProfileUpdateRequest,
} from '../api/realtimeWatch';
import { ApiErrorAlert, AppPage, Button, Card, ConfirmDialog, EmptyState, InlineAlert, PageHeader } from '../components/common';
import { useAuth } from '../contexts/AuthContext';
import type { TaskStatus } from '../types/analysis';

type SettingsDialogState = {
  profile: RealtimeWatchProfile;
  stockName: string;
  resistancePrice: string;
  supportPrice: string;
  stopLossPrice: string;
  targetPrice: string;
  volumeRatioThreshold: number;
  changePercentThreshold: number;
  autoAiReviewEnabled: boolean;
  aiReviewCooldownMinutes: number;
  maxDailyAiReviews: number;
  defaultSkill: string;
} | null;

type ReviewDialogState = {
  item: RealtimeWatchItem;
  skillId: string;
  modelStrategy: RealtimeModelStrategy;
  saveAsDefault: boolean;
} | null;

const REFRESH_OPTIONS = [
  { label: '30秒', value: 30 },
  { label: '60秒', value: 60 },
  { label: '3分钟', value: 180 },
  { label: '5分钟', value: 300 },
];

function formatNumber(value?: number | null, digits = 2): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value);
}

function formatPercent(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  return `${value > 0 ? '+' : ''}${formatNumber(value)}%`;
}

function formatLarge(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 100000000) return `${formatNumber(value / 100000000)}亿`;
  if (abs >= 10000) return `${formatNumber(value / 10000)}万`;
  return formatNumber(value, 0);
}

function formatTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function toInputNumber(value?: number | null): string {
  return value === undefined || value === null ? '' : String(value);
}

function parseOptionalNumber(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function severityClass(severity: string): string {
  if (severity === 'danger') return 'border-danger/50 bg-danger/10 text-danger';
  if (severity === 'warning') return 'border-warning/50 bg-warning/10 text-warning';
  if (severity === 'watch') return 'border-cyan/40 bg-cyan/10 text-cyan';
  return 'border-border/70 bg-muted/20 text-secondary-text';
}

function signalText(item: RealtimeWatchItem): string {
  const signal = item.latestAiSignal;
  if (!signal) return '暂无建议';
  const parts = [signal.action, signal.confidence ? `置信 ${signal.confidence}` : null, signal.score !== undefined && signal.score !== null ? `分数 ${signal.score}` : null]
    .filter(Boolean);
  return parts.join(' · ') || '暂无建议';
}

const RealtimeWatchPage: React.FC = () => {
  const { authEnabled, loggedIn } = useAuth();
  const canMutate = !authEnabled || loggedIn;
  const [items, setItems] = useState<RealtimeWatchItem[]>([]);
  const [newCode, setNewCode] = useState('');
  const [refreshInterval, setRefreshInterval] = useState(60);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ParsedApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [settingsDialog, setSettingsDialog] = useState<SettingsDialogState>(null);
  const [reviewDialog, setReviewDialog] = useState<ReviewDialogState>(null);
  const [deleteTarget, setDeleteTarget] = useState<RealtimeWatchItem | null>(null);
  const [taskStatusByCode, setTaskStatusByCode] = useState<Record<string, TaskStatus>>({});

  const loadSnapshot = useCallback(async (silent = false) => {
    if (document.visibilityState === 'hidden') return;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const snapshot = await realtimeWatchApi.getSnapshot(refreshInterval);
      setItems(snapshot.items || []);
      setMessage(snapshot.message || null);
    } catch (err) {
      setError(getParsedApiError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [refreshInterval]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    let active = true;
    agentApi.getSkills()
      .then((result) => {
        if (active) setSkills(result.skills || []);
      })
      .catch(() => {
        if (active) setSkills([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadSnapshot(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadSnapshot(true);
    }, refreshInterval * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [loadSnapshot, refreshInterval]);

  useEffect(() => {
    const taskIds = Object.entries(taskStatusByCode)
      .filter(([, task]) => ['pending', 'processing'].includes(task.status))
      .map(([code, task]) => ({ code, taskId: task.taskId }));
    if (taskIds.length === 0) return;
    const timer = window.setInterval(() => {
      taskIds.forEach(({ code, taskId }) => {
        analysisApi.getStatus(taskId)
          .then((status) => {
            setTaskStatusByCode((prev) => ({ ...prev, [code]: status }));
            if (status.status === 'completed') void loadSnapshot(true);
          })
          .catch(() => undefined);
      });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [taskStatusByCode, loadSnapshot]);

  const addDisabled = useMemo(() => !newCode.trim() || items.length >= 5 || !canMutate, [newCode, items.length, canMutate]);

  const handleAdd = async () => {
    if (addDisabled) return;
    setError(null);
    try {
      await realtimeWatchApi.createProfile(newCode.trim());
      setNewCode('');
      await loadSnapshot(true);
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const openSettings = (profile: RealtimeWatchProfile) => {
    setSettingsDialog({
      profile,
      stockName: profile.stockName || '',
      resistancePrice: toInputNumber(profile.resistancePrice),
      supportPrice: toInputNumber(profile.supportPrice),
      stopLossPrice: toInputNumber(profile.stopLossPrice),
      targetPrice: toInputNumber(profile.targetPrice),
      volumeRatioThreshold: profile.volumeRatioThreshold || 2,
      changePercentThreshold: profile.changePercentThreshold || 3,
      autoAiReviewEnabled: profile.autoAiReviewEnabled,
      aiReviewCooldownMinutes: profile.aiReviewCooldownMinutes || 30,
      maxDailyAiReviews: profile.maxDailyAiReviews || 3,
      defaultSkill: profile.defaultSkill || '',
    });
  };

  const saveSettings = async () => {
    if (!settingsDialog) return;
    const payload: RealtimeWatchProfileUpdateRequest = {
      stockName: settingsDialog.stockName || null,
      market: settingsDialog.profile.market,
      enabled: true,
      resistancePrice: parseOptionalNumber(settingsDialog.resistancePrice),
      supportPrice: parseOptionalNumber(settingsDialog.supportPrice),
      stopLossPrice: parseOptionalNumber(settingsDialog.stopLossPrice),
      targetPrice: parseOptionalNumber(settingsDialog.targetPrice),
      volumeRatioThreshold: settingsDialog.volumeRatioThreshold,
      changePercentThreshold: settingsDialog.changePercentThreshold,
      autoAiReviewEnabled: settingsDialog.autoAiReviewEnabled,
      aiReviewCooldownMinutes: settingsDialog.aiReviewCooldownMinutes,
      maxDailyAiReviews: settingsDialog.maxDailyAiReviews,
      defaultSkill: settingsDialog.defaultSkill || null,
    };
    try {
      await realtimeWatchApi.updateProfile(settingsDialog.profile.stockCode, payload);
      setSettingsDialog(null);
      await loadSnapshot(true);
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const submitReview = async () => {
    if (!reviewDialog) return;
    const { item, skillId, modelStrategy, saveAsDefault } = reviewDialog;
    try {
      const response = await realtimeWatchApi.submitAiReview(item.profile.stockCode, {
        skillId: skillId || null,
        modelStrategy,
        saveAsDefault,
        realtimeContext: {
          quote: item.quote,
          dynamicAdvice: item.dynamicAdvice,
          latestAiSignal: item.latestAiSignal,
          conflictWithAi: item.conflictWithAi,
        },
      });
      setTaskStatusByCode((prev) => ({
        ...prev,
        [item.profile.stockCode]: {
          taskId: response.taskId,
          traceId: response.taskId,
          status: 'pending',
          progress: 0,
          analysisPhase: 'intraday',
        },
      }));
      setReviewDialog(null);
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await realtimeWatchApi.deleteProfile(deleteTarget.profile.stockCode);
      setDeleteTarget(null);
      await loadSnapshot(true);
    } catch (err) {
      setError(getParsedApiError(err));
    }
  };

  const renderActions = (item: RealtimeWatchItem) => {
    const task = taskStatusByCode[item.profile.stockCode];
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!canMutate}
          onClick={() => setReviewDialog({
            item,
            skillId: item.profile.defaultSkill || '',
            modelStrategy: 'auto',
            saveAsDefault: false,
          })}
        >
          <Bot className="h-4 w-4" />
          AI复核
        </Button>
        <Button size="sm" variant="ghost" disabled={!canMutate} onClick={() => openSettings(item.profile)}>
          <Settings2 className="h-4 w-4" />
          规则
        </Button>
        <Button size="sm" variant="danger-subtle" disabled={!canMutate} onClick={() => setDeleteTarget(item)}>
          <Trash2 className="h-4 w-4" />
        </Button>
        {task ? <span className="text-xs text-secondary-text">任务 {task.status}</span> : null}
      </div>
    );
  };

  const renderCard = (item: RealtimeWatchItem) => (
    <Card key={item.profile.stockCode} className="space-y-4 md:hidden">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-foreground">{item.quote?.stockName || item.profile.stockName || item.profile.stockCode}</div>
          <div className="text-sm text-secondary-text">{item.profile.stockCode} · {item.profile.market || '-'}</div>
        </div>
        <span className={`rounded-lg border px-2 py-1 text-xs ${severityClass(item.dynamicAdvice.severity)}`}>
          {item.dynamicAdvice.status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-secondary-text">现价</span><div className="font-semibold">{formatNumber(item.quote?.currentPrice)}</div></div>
        <div><span className="text-secondary-text">涨跌幅</span><div className={item.quote?.changePercent && item.quote.changePercent >= 0 ? 'text-danger' : 'text-success'}>{formatPercent(item.quote?.changePercent)}</div></div>
        <div><span className="text-secondary-text">成交量/额</span><div>{formatLarge(item.quote?.volume)} / {formatLarge(item.quote?.amount)}</div></div>
        <div><span className="text-secondary-text">量比/换手</span><div>{formatNumber(item.quote?.volumeRatio)} / {formatPercent(item.quote?.turnoverRate)}</div></div>
        <div><span className="text-secondary-text">高/低</span><div>{formatNumber(item.quote?.todayHigh)} / {formatNumber(item.quote?.todayLow)}</div></div>
        <div><span className="text-secondary-text">MA5/10/20</span><div>{formatNumber(item.quote?.ma5)} / {formatNumber(item.quote?.ma10)} / {formatNumber(item.quote?.ma20)}</div></div>
      </div>
      <div className="rounded-xl border border-border/70 p-3 text-sm">
        <div className="font-medium text-foreground">{signalText(item)}</div>
        <div className="mt-1 text-xs text-secondary-text">动态规则：{item.dynamicAdvice.rules.join('、')}</div>
        {item.conflictMessage ? <div className="mt-2 text-xs text-danger">{item.conflictMessage}</div> : null}
      </div>
      <div className="flex items-center justify-between text-xs text-secondary-text">
        <span>{item.quote?.source || '-'} · {formatTime(item.quote?.quoteTime)}</span>
        {item.quote?.stale ? <span className="text-warning">stale</span> : <span>最新</span>}
      </div>
      {renderActions(item)}
    </Card>
  );

  return (
    <AppPage className="space-y-5">
      <PageHeader
        eyebrow="Realtime Watch"
        title="重点盯盘"
        description="少量股票实时行情刷新与规则型动态建议；自动刷新不调用大模型，AI复核需手动触发。"
        actions={(
          <>
            <select
              className="h-10 rounded-xl border border-border/70 bg-card px-3 text-sm text-foreground"
              value={refreshInterval}
              onChange={(event) => setRefreshInterval(Number(event.target.value))}
            >
              {REFRESH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => void loadSnapshot(true)} isLoading={refreshing}>
              <RefreshCw className="h-4 w-4" />
              刷新
            </Button>
          </>
        )}
      />

      {message ? <InlineAlert variant="info" title="成本提示" message={`${message} 重点盯盘最多 5 只；Pro 复核成本更高，批量分析请使用普通自选股。`} /> : null}
      {!canMutate ? <InlineAlert variant="warning" title="只读模式" message="未登录用户只能查看，不能添加、删除、修改规则或触发 AI复核。" /> : null}
      {error ? <ApiErrorAlert error={error} /> : null}

      <Card>
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <input
            className="h-11 flex-1 rounded-xl border border-border/70 bg-elevated px-3 text-sm text-foreground outline-none focus:border-cyan/60"
            value={newCode}
            onChange={(event) => setNewCode(event.target.value)}
            placeholder="输入股票代码，例如 600519、HK00700、AAPL"
            disabled={!canMutate}
          />
          <Button onClick={() => void handleAdd()} disabled={addDisabled}>
            <Plus className="h-4 w-4" />
            添加重点盯盘
          </Button>
        </div>
        {items.length >= 5 ? <p className="mt-2 text-xs text-warning">重点盯盘适合少量股票，更多股票请使用普通自选股页面。</p> : null}
      </Card>

      {loading ? (
        <Card><div className="py-10 text-center text-secondary-text">正在加载重点盯盘...</div></Card>
      ) : items.length === 0 ? (
        <EmptyState title="暂无重点盯盘" description="添加 1 到 5 只重点股票后，这里会显示实时行情、动态建议和 AI 建议联动。" />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-border/70 md:block">
            <table className="w-full table-fixed divide-y divide-border/60 text-sm">
              <thead className="bg-card/80 text-left text-xs uppercase text-secondary-text">
                <tr>
                  <th className="px-3 py-3">股票</th>
                  <th className="px-3 py-3">现价/涨跌</th>
                  <th className="px-3 py-3">成交/量比</th>
                  <th className="px-3 py-3">关键价位</th>
                  <th className="px-3 py-3">均线/行情</th>
                  <th className="px-3 py-3">动态建议</th>
                  <th className="px-3 py-3">AI建议</th>
                  <th className="px-3 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50 bg-elevated/60">
                {items.map((item) => (
                  <tr key={item.profile.stockCode}>
                    <td className="px-3 py-4">
                      <div className="font-semibold text-foreground">{item.quote?.stockName || item.profile.stockName || item.profile.stockCode}</div>
                      <div className="text-xs text-secondary-text">{item.profile.stockCode} · {item.profile.market || '-'}</div>
                    </td>
                    <td className="px-3 py-4">
                      <div className="font-semibold">{formatNumber(item.quote?.currentPrice)}</div>
                      <div className={item.quote?.changePercent && item.quote.changePercent >= 0 ? 'text-danger' : 'text-success'}>{formatPercent(item.quote?.changePercent)}</div>
                    </td>
                    <td className="px-3 py-4 text-xs">
                      <div>{formatLarge(item.quote?.volume)} / {formatLarge(item.quote?.amount)}</div>
                      <div>量比 {formatNumber(item.quote?.volumeRatio)} · 换手 {formatPercent(item.quote?.turnoverRate)}</div>
                    </td>
                    <td className="px-3 py-4 text-xs">
                      <div>今高/低 {formatNumber(item.quote?.todayHigh)} / {formatNumber(item.quote?.todayLow)}</div>
                      <div>昨高/低 {formatNumber(item.quote?.yesterdayHigh)} / {formatNumber(item.quote?.yesterdayLow)}</div>
                    </td>
                    <td className="px-3 py-4 text-xs">
                      <div>{formatNumber(item.quote?.ma5)} / {formatNumber(item.quote?.ma10)} / {formatNumber(item.quote?.ma20)}</div>
                      <div>{item.quote?.source || '-'} · {formatTime(item.quote?.quoteTime)} {item.quote?.stale ? '· stale' : ''}</div>
                    </td>
                    <td className="px-3 py-4">
                      <span className={`inline-flex rounded-lg border px-2 py-1 text-xs ${severityClass(item.dynamicAdvice.severity)}`}>{item.dynamicAdvice.status}</span>
                      <div className="mt-1 line-clamp-2 text-xs text-secondary-text">{item.dynamicAdvice.rules.join('、')}</div>
                    </td>
                    <td className="px-3 py-4 text-xs">
                      <div>{signalText(item)}</div>
                      {item.conflictMessage ? <div className="mt-1 text-danger">{item.conflictMessage}</div> : null}
                    </td>
                    <td className="px-3 py-4">{renderActions(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-4 md:hidden">
            {items.map(renderCard)}
          </div>
        </>
      )}

      {settingsDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-border/70 bg-elevated p-5 shadow-2xl">
            <h2 className="text-lg font-semibold text-foreground">规则设置 · {settingsDialog.profile.stockCode}</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {[
                ['股票名称', 'stockName'],
                ['关键压力位', 'resistancePrice'],
                ['关键支撑位', 'supportPrice'],
                ['止损位', 'stopLossPrice'],
                ['目标位', 'targetPrice'],
              ].map(([label, key]) => (
                <label key={key} className="text-sm">
                  <span className="text-secondary-text">{label}</span>
                  <input
                    className="mt-1 h-10 w-full rounded-xl border border-border/70 bg-card px-3 text-foreground"
                    value={String(settingsDialog[key as keyof SettingsDialogState] ?? '')}
                    onChange={(event) => setSettingsDialog((prev) => prev ? { ...prev, [key]: event.target.value } : prev)}
                  />
                </label>
              ))}
              <label className="text-sm">
                <span className="text-secondary-text">量比阈值</span>
                <input type="number" step="0.1" className="mt-1 h-10 w-full rounded-xl border border-border/70 bg-card px-3 text-foreground" value={settingsDialog.volumeRatioThreshold} onChange={(event) => setSettingsDialog((prev) => prev ? { ...prev, volumeRatioThreshold: Number(event.target.value) } : prev)} />
              </label>
              <label className="text-sm">
                <span className="text-secondary-text">涨跌幅提醒阈值</span>
                <input type="number" step="0.1" className="mt-1 h-10 w-full rounded-xl border border-border/70 bg-card px-3 text-foreground" value={settingsDialog.changePercentThreshold} onChange={(event) => setSettingsDialog((prev) => prev ? { ...prev, changePercentThreshold: Number(event.target.value) } : prev)} />
              </label>
              <label className="text-sm">
                <span className="text-secondary-text">AI复核冷却分钟</span>
                <input type="number" min={1} max={1440} className="mt-1 h-10 w-full rounded-xl border border-border/70 bg-card px-3 text-foreground" value={settingsDialog.aiReviewCooldownMinutes} onChange={(event) => setSettingsDialog((prev) => prev ? { ...prev, aiReviewCooldownMinutes: Number(event.target.value) } : prev)} />
              </label>
              <label className="text-sm">
                <span className="text-secondary-text">每日 AI复核上限</span>
                <input type="number" min={1} max={3} className="mt-1 h-10 w-full rounded-xl border border-border/70 bg-card px-3 text-foreground" value={settingsDialog.maxDailyAiReviews} onChange={(event) => setSettingsDialog((prev) => prev ? { ...prev, maxDailyAiReviews: Number(event.target.value) } : prev)} />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="text-secondary-text">默认分析策略</span>
                <select className="mt-1 h-10 w-full rounded-xl border border-border/70 bg-card px-3 text-foreground" value={settingsDialog.defaultSkill} onChange={(event) => setSettingsDialog((prev) => prev ? { ...prev, defaultSkill: event.target.value } : prev)}>
                  <option value="">跟随全局策略</option>
                  {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name || skill.id}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input type="checkbox" checked={settingsDialog.autoAiReviewEnabled} onChange={(event) => setSettingsDialog((prev) => prev ? { ...prev, autoAiReviewEnabled: event.target.checked } : prev)} />
                开启重大规则触发后的自动 AI复核（仍受冷却和每日上限限制）
              </label>
            </div>
            {settingsDialog.autoAiReviewEnabled ? <InlineAlert className="mt-4" variant="warning" title="成本提示" message="盘中多次 AI复核会增加 token 成本；2核2G 建议默认关闭，只手动复核关键时点。" /> : null}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSettingsDialog(null)}>取消</Button>
              <Button onClick={() => void saveSettings()}>保存规则</Button>
            </div>
          </div>
        </div>
      ) : null}

      {reviewDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border/70 bg-elevated p-5 shadow-2xl">
            <h2 className="text-lg font-semibold text-foreground">AI复核 · {reviewDialog.item.profile.stockCode}</h2>
            <InlineAlert className="mt-3" variant="warning" title="确认调用大模型" message="AI复核会进入深度分析队列并消耗 token；同一股票默认冷却 30 分钟，每天最多 3 次。" />
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="text-secondary-text">分析策略</span>
                <select className="mt-1 h-10 w-full rounded-xl border border-border/70 bg-card px-3 text-foreground" value={reviewDialog.skillId} onChange={(event) => setReviewDialog((prev) => prev ? { ...prev, skillId: event.target.value } : prev)}>
                  <option value="">跟随全局策略</option>
                  {skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name || skill.id}</option>)}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-secondary-text">模型策略</span>
                <select className="mt-1 h-10 w-full rounded-xl border border-border/70 bg-card px-3 text-foreground" value={reviewDialog.modelStrategy} onChange={(event) => setReviewDialog((prev) => prev ? { ...prev, modelStrategy: event.target.value as RealtimeModelStrategy } : prev)}>
                  <option value="auto">自动</option>
                  <option value="flash">Flash</option>
                  <option value="pro">Pro</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={reviewDialog.saveAsDefault} onChange={(event) => setReviewDialog((prev) => prev ? { ...prev, saveAsDefault: event.target.checked } : prev)} />
                保存为该股票默认策略
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReviewDialog(null)}>取消</Button>
              <Button onClick={() => void submitReview()}>
                <Play className="h-4 w-4" />
                开始 AI复核
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="删除重点盯盘"
        message={`确认删除 ${deleteTarget?.profile.stockCode || ''} 吗？这不会删除历史报告。`}
        confirmText="删除"
        isDanger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </AppPage>
  );
};

export default RealtimeWatchPage;
