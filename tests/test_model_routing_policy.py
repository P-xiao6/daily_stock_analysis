# -*- coding: utf-8 -*-
"""Tests for DeepSeek model routing policies."""

from src.services.model_routing_policy import (
    DEEPSEEK_FLASH_MODEL,
    DEEPSEEK_PRO_MODEL,
    expand_model_routing_updates,
    get_model_routing_policy,
)


def test_cost_policy_generates_flash_config():
    policy = get_model_routing_policy("cost")

    assert policy.as_env_updates() == {
        "LITELLM_MODEL": DEEPSEEK_FLASH_MODEL,
        "AGENT_LITELLM_MODEL": DEEPSEEK_FLASH_MODEL,
        "LITELLM_FALLBACK_MODELS": "",
    }


def test_balanced_policy_generates_flash_plus_pro_config():
    policy = get_model_routing_policy("balanced")

    assert policy.as_env_updates() == {
        "LITELLM_MODEL": DEEPSEEK_FLASH_MODEL,
        "AGENT_LITELLM_MODEL": DEEPSEEK_PRO_MODEL,
        "LITELLM_FALLBACK_MODELS": DEEPSEEK_PRO_MODEL,
    }


def test_deep_policy_generates_pro_config():
    policy = get_model_routing_policy("deep")

    assert policy.as_env_updates() == {
        "LITELLM_MODEL": DEEPSEEK_PRO_MODEL,
        "AGENT_LITELLM_MODEL": DEEPSEEK_PRO_MODEL,
        "LITELLM_FALLBACK_MODELS": DEEPSEEK_FLASH_MODEL,
    }


def test_expand_model_routing_updates_replaces_runtime_model_keys():
    expanded = expand_model_routing_updates(
        [
            {"key": "MODEL_ROUTING_POLICY", "value": "balanced"},
            {"key": "LITELLM_MODEL", "value": "deepseek/old"},
        ]
    )

    expanded_map = {item["key"]: item["value"] for item in expanded}
    assert expanded_map["MODEL_ROUTING_POLICY"] == "balanced"
    assert expanded_map["LITELLM_MODEL"] == DEEPSEEK_FLASH_MODEL
    assert expanded_map["AGENT_LITELLM_MODEL"] == DEEPSEEK_PRO_MODEL
    assert expanded_map["LITELLM_FALLBACK_MODELS"] == DEEPSEEK_PRO_MODEL
