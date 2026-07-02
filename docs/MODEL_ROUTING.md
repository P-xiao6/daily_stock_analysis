# Model Routing

This project can switch DeepSeek Flash/Pro usage from the Web settings page without manually editing model names each time.

## Policies

- Cost mode: regular analysis, ask-stock Agent, and AI suggestions default to `deepseek/deepseek-v4-flash`.
- Balanced mode: regular analysis, daily reports, and AI suggestions use `deepseek/deepseek-v4-flash`; ask-stock Agent, deep analysis, and backtest summaries use `deepseek/deepseek-v4-pro`.
- Deep mode: all analysis defaults to `deepseek/deepseek-v4-pro`.

Balanced mode is the recommended default.

## Saved Config

Saving `MODEL_ROUTING_POLICY` expands these runtime keys:

| Policy | `LITELLM_MODEL` | `AGENT_LITELLM_MODEL` | `LITELLM_FALLBACK_MODELS` |
| --- | --- | --- | --- |
| `cost` | `deepseek/deepseek-v4-flash` | `deepseek/deepseek-v4-flash` | empty |
| `balanced` | `deepseek/deepseek-v4-flash` | `deepseek/deepseek-v4-pro` | `deepseek/deepseek-v4-pro` |
| `deep` | `deepseek/deepseek-v4-pro` | `deepseek/deepseek-v4-pro` | `deepseek/deepseek-v4-flash` |

The policy does not write API keys, base URLs, or channel secrets.

## Temporary Pro

The Home page provides a "Use Pro once" switch. It only affects the current stock analysis or market review request. It does not change `MODEL_ROUTING_POLICY`, `.env`, or Web settings.

## Compatibility

Existing priority remains unchanged:

1. `LITELLM_CONFIG`
2. `LLM_CHANNELS`
3. legacy provider configuration

The model policy only updates model selection keys. It does not remove or migrate existing channel, YAML, or legacy provider settings.

If Docker Compose `environment` explicitly injects `LITELLM_MODEL`, `AGENT_LITELLM_MODEL`, `LITELLM_FALLBACK_MODELS`, `LLM_CHANNELS`, or `LITELLM_CONFIG`, a container restart may override values saved from the Web settings page. Prefer putting mutable production settings in the runtime `.env` file instead of hardcoding them in Compose.

## Cost Guidance

Pro is more capable but more expensive. Avoid making Pro the default for batch analysis unless the batch is small and the higher cost is intentional. Use balanced mode for daily operation and the temporary Pro switch for one-off deep checks.
