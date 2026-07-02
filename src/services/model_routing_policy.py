# -*- coding: utf-8 -*-
"""DeepSeek Flash/Pro model routing policy helpers."""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Dict, Iterable, List, Mapping, Tuple


MODEL_ROUTING_POLICY_KEY = "MODEL_ROUTING_POLICY"
MODEL_ROUTING_ENV_KEYS = (
    "LITELLM_MODEL",
    "AGENT_LITELLM_MODEL",
    "LITELLM_FALLBACK_MODELS",
)

DEEPSEEK_FLASH_MODEL = "deepseek/deepseek-v4-flash"
DEEPSEEK_PRO_MODEL = "deepseek/deepseek-v4-pro"
DEFAULT_MODEL_ROUTING_POLICY = "balanced"


@dataclass(frozen=True)
class ModelRoutingPolicy:
    value: str
    label: str
    litellm_model: str
    agent_litellm_model: str
    fallback_models: Tuple[str, ...]
    description: str

    def as_env_updates(self) -> Dict[str, str]:
        return {
            "LITELLM_MODEL": self.litellm_model,
            "AGENT_LITELLM_MODEL": self.agent_litellm_model,
            "LITELLM_FALLBACK_MODELS": ",".join(self.fallback_models),
        }


MODEL_ROUTING_POLICIES: Dict[str, ModelRoutingPolicy] = {
    "cost": ModelRoutingPolicy(
        value="cost",
        label="省钱模式",
        litellm_model=DEEPSEEK_FLASH_MODEL,
        agent_litellm_model=DEEPSEEK_FLASH_MODEL,
        fallback_models=(),
        description="普通分析、问股 Agent 和 AI 建议默认使用 Flash。",
    ),
    "balanced": ModelRoutingPolicy(
        value="balanced",
        label="平衡模式",
        litellm_model=DEEPSEEK_FLASH_MODEL,
        agent_litellm_model=DEEPSEEK_PRO_MODEL,
        fallback_models=(DEEPSEEK_PRO_MODEL,),
        description="普通分析、日报和 AI 建议使用 Flash；问股 Agent、深度分析和回测总结使用 Pro。",
    ),
    "deep": ModelRoutingPolicy(
        value="deep",
        label="深度模式",
        litellm_model=DEEPSEEK_PRO_MODEL,
        agent_litellm_model=DEEPSEEK_PRO_MODEL,
        fallback_models=(DEEPSEEK_FLASH_MODEL,),
        description="所有分析默认使用 Pro；成本更高，不建议批量分析默认启用。",
    ),
}


def normalize_model_routing_policy(value: str | None) -> str:
    normalized = (value or DEFAULT_MODEL_ROUTING_POLICY).strip().lower().replace("-", "_")
    return normalized if normalized in MODEL_ROUTING_POLICIES else DEFAULT_MODEL_ROUTING_POLICY


def get_model_routing_policy(value: str | None) -> ModelRoutingPolicy:
    return MODEL_ROUTING_POLICIES[normalize_model_routing_policy(value)]


def expand_model_routing_updates(items: Iterable[Mapping[str, str]]) -> List[Dict[str, str]]:
    """Return update items with runtime model keys expanded from MODEL_ROUTING_POLICY."""
    expanded: List[Dict[str, str]] = [
        {"key": str(item["key"]).upper(), "value": str(item.get("value", ""))}
        for item in items
    ]
    selected_policy = None
    for item in expanded:
        if item["key"] == MODEL_ROUTING_POLICY_KEY:
            selected_policy = get_model_routing_policy(item["value"])
            item["value"] = selected_policy.value
            break

    if selected_policy is None:
        return expanded

    env_updates = selected_policy.as_env_updates()
    existing_indexes = {item["key"]: index for index, item in enumerate(expanded)}
    for key, value in env_updates.items():
        if key in existing_indexes:
            expanded[existing_indexes[key]]["value"] = value
        else:
            expanded.append({"key": key, "value": value})
    return expanded


def apply_temporary_pro_analysis_config(config):
    """Return a request-scoped config copy that routes this task through Pro."""
    scoped_config = copy.copy(config)
    scoped_config.litellm_model = DEEPSEEK_PRO_MODEL
    scoped_config.agent_litellm_model = DEEPSEEK_PRO_MODEL
    scoped_config.litellm_fallback_models = [
        model
        for model in [DEEPSEEK_FLASH_MODEL, *list(getattr(config, "litellm_fallback_models", []) or [])]
        if model and model != DEEPSEEK_PRO_MODEL
    ]
    return scoped_config
