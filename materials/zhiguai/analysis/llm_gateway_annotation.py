#!/usr/bin/env python3
import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple


ROOT = Path("/Users/gsdata/waoowaoo-main/materials/zhiguai")
STORIES_DIR = ROOT / "stories"
RUNS_DIR = ROOT / "analysis" / "llm_runs"
GATEWAY_URL = "https://aifuturekey.xyz/v1/chat/completions"

SYSTEM_PROMPT = """你是中文古典志怪故事女性主义标注助手。
只依据用户提供的故事原文完成结构化标注。
不要补外部知识，不要解释，不要输出任何 JSON 之外的内容。
如果证据不足，必须保守判断，并把 confidence 调低。
证据引用必须短，单条不超过24个汉字。
"""

USER_PROMPT_TEMPLATE = """请对下面这篇志怪故事做结构化标注。

要求：
1. 只依据原文判断。
2. 所有解释型字段都必须有原文证据。
3. feminist_angles 最多选4个，宁缺毋滥。
4. 如果证据不足，使用更保守的标签。
5. 只输出 JSON。

允许枚举：
- story_dynasty: ["先秦两汉","魏晋南北朝","唐","宋","元","明","清","未明","跨代/杂糅"]
- story_type_primary: ["狐魅叙事","鬼魂/冥府","仙神/龙女","妖怪/精魅","梦幻/异境","公案/申冤","伦理/报应","杂志异闻"]
- female_centrality: ["无","边缘","关键","核心"]
- female_perspective: ["无明显女性视角","男性转述/旁观","男性凝视主导","女性经验可见","女性主体表达较强"]
- female_figures: ["凡间女子","妻妾/已婚女性","母亲/婆妪","婢女/侍女","烈女/侠女","女鬼/冤魂","狐女/狐仙","神女/仙女/龙女","巫妪/婆子","性别越界者"]
- female_agency: ["无","低","中","高"]
- ending_type: ["伸冤昭雪","报应惩戒","婚恋团圆","超脱成仙","悲剧/消散","惊悚收束","异闻收束"]
- moral_evaluation: ["礼教嘉奖","礼教惩戒","因果报应","同情/赞赏女性主体","道德暧昧/同情越界","弱评价/异闻观照"]
- feminist_angles: ["婚姻/婚配制度","父权家族/宗法","贞节规训","男性凝视与欲望投射","女性复仇/申冤","家庭暴力与虐待","照护劳动/生育责任","妻妾/婢妾与阶层","女性欲望与婚恋自主","女体妖魔化/他者化","性别越界/性别流动","神怪作为女性出口","女性互助/代际支持"]
- confidence: ["高","中","低"]

输出 JSON schema：
{{
  "story_id": "string",
  "title": "string",
  "labels": {{
    "story_dynasty": "one enum",
    "story_type_primary": "one enum",
    "female_centrality": "one enum",
    "female_perspective": "one enum",
    "female_figures": ["0..N enums"],
    "female_agency": "one enum",
    "ending_type": "one enum",
    "moral_evaluation": "one enum",
    "feminist_angles": ["0..4 enums"]
  }},
  "evidence": [
    {{"quote": "原文短句", "supports": ["label key"]}}
  ],
  "summary": "80字内概括",
  "review_note": "有歧义则写明，没有则为空字符串",
  "confidence": "高/中/低"
}}

story_id: {story_id}
title: {title}
collection: {collection}
volume: {volume}

story_text:
{story_text}
"""

ENUMS = {
    "story_dynasty": {"先秦两汉", "魏晋南北朝", "唐", "宋", "元", "明", "清", "未明", "跨代/杂糅"},
    "story_type_primary": {"狐魅叙事", "鬼魂/冥府", "仙神/龙女", "妖怪/精魅", "梦幻/异境", "公案/申冤", "伦理/报应", "杂志异闻"},
    "female_centrality": {"无", "边缘", "关键", "核心"},
    "female_perspective": {"无明显女性视角", "男性转述/旁观", "男性凝视主导", "女性经验可见", "女性主体表达较强"},
    "female_figures": {"凡间女子", "妻妾/已婚女性", "母亲/婆妪", "婢女/侍女", "烈女/侠女", "女鬼/冤魂", "狐女/狐仙", "神女/仙女/龙女", "巫妪/婆子", "性别越界者"},
    "female_agency": {"无", "低", "中", "高"},
    "ending_type": {"伸冤昭雪", "报应惩戒", "婚恋团圆", "超脱成仙", "悲剧/消散", "惊悚收束", "异闻收束"},
    "moral_evaluation": {"礼教嘉奖", "礼教惩戒", "因果报应", "同情/赞赏女性主体", "道德暧昧/同情越界", "弱评价/异闻观照"},
    "feminist_angles": {"婚姻/婚配制度", "父权家族/宗法", "贞节规训", "男性凝视与欲望投射", "女性复仇/申冤", "家庭暴力与虐待", "照护劳动/生育责任", "妻妾/婢妾与阶层", "女性欲望与婚恋自主", "女体妖魔化/他者化", "性别越界/性别流动", "神怪作为女性出口", "女性互助/代际支持"},
    "confidence": {"高", "中", "低"},
}

DEFAULT_MODEL_CONFIGS = {
    "gpt-4.1-mini": {"key_slots": [1, 2, 3, 4, 5]},
    "gemini-2.5-pro": {"key_slots": [2, 3, 4, 1, 5]},
    "claude-3-5-sonnet-20241022": {"key_slots": [1, 2, 3, 4, 5]},
}


def load_env(path: Path) -> Dict[str, str]:
    env = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def load_gateway_keys() -> List[str]:
    env = load_env(Path("/Users/gsdata/waoowaoo-main/.env.local"))
    raw = ",".join([env.get("GOOGLE_API_KEYS", ""), env.get("GOOGLE_API_KEY", "")])
    keys = []
    for part in raw.replace("\n", ",").split(","):
        part = part.strip()
        if part and part not in keys:
            keys.append(part)
    if not keys:
        raise RuntimeError("NO_GATEWAY_KEYS")
    return keys


def call_model(model: str, api_key: str, prompt: str, timeout: int = 60) -> Dict[str, object]:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0,
        "max_tokens": 1400,
        "response_format": {"type": "json_object"},
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        GATEWAY_URL,
        method="POST",
        headers={
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
        data=data,
    )
    started_at = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8", "replace")
            latency = round(time.time() - started_at, 2)
            outer = json.loads(text)
            content = outer["choices"][0]["message"]["content"]
            return {
                "status": resp.getcode(),
                "latency_s": latency,
                "raw": text,
                "content": content,
            }
    except urllib.error.HTTPError as exc:
        return {
            "status": exc.code,
            "latency_s": round(time.time() - started_at, 2),
            "raw": exc.read().decode("utf-8", "replace"),
            "content": None,
        }
    except Exception as exc:
        return {
            "status": None,
            "latency_s": round(time.time() - started_at, 2),
            "raw": str(exc),
            "content": None,
        }


def normalize_key_slots(key_slots: List[int], key_count: int) -> List[int]:
    normalized = []
    for slot in key_slots:
        if 1 <= slot <= key_count and slot not in normalized:
            normalized.append(slot)
    for slot in range(1, key_count + 1):
        if slot not in normalized:
            normalized.append(slot)
    return normalized


def strip_code_fence(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def validate_annotation(obj: Dict[str, object]):
    issues = []
    if not isinstance(obj, dict):
        return False, ["not_object"]
    labels = obj.get("labels")
    if not isinstance(labels, dict):
        return False, ["missing_labels"]
    for field in [
        "story_dynasty",
        "story_type_primary",
        "female_centrality",
        "female_perspective",
        "female_agency",
        "ending_type",
        "moral_evaluation",
    ]:
        if labels.get(field) not in ENUMS[field]:
            issues.append("invalid_" + field)
    for field in ["female_figures", "feminist_angles"]:
        value = labels.get(field)
        if not isinstance(value, list):
            issues.append("invalid_" + field)
            continue
        invalid = [item for item in value if item not in ENUMS[field]]
        if invalid:
            issues.append("invalid_" + field)
    if obj.get("confidence") not in ENUMS["confidence"]:
        issues.append("invalid_confidence")
    evidence = obj.get("evidence")
    if not isinstance(evidence, list) or len(evidence) == 0:
        issues.append("missing_evidence")
    return len(issues) == 0, issues


def load_stories(limit: Optional[int] = None, offset: int = 0) -> List[Dict[str, str]]:
    stories = []
    story_dirs = sorted(path for path in STORIES_DIR.iterdir() if path.is_dir())
    for story_dir in story_dirs[offset:]:
        meta_path = story_dir / "meta.json"
        text_path = story_dir / "source.txt"
        if not meta_path.exists() or not text_path.exists():
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        story_text = text_path.read_text(encoding="utf-8").strip()
        stories.append(
            {
                "story_id": meta["id"],
                "title": meta["title"],
                "collection": meta["volume"].split("·")[0],
                "volume": meta["volume"],
                "story_text": story_text,
            }
        )
        if limit is not None and len(stories) >= limit:
            break
    return stories


def make_run_dir(tag: str) -> Path:
    run_dir = RUNS_DIR / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{tag}"
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def write_progress(
    run_dir: Path,
    per_model_records: Dict[str, list],
    consensus_records: list,
    summary_counter: Counter,
) -> None:
    for model, records in per_model_records.items():
        (run_dir / f"{model}.json").write_text(
            json.dumps(records, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    (run_dir / "consensus.json").write_text(
        json.dumps(consensus_records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (run_dir / "summary.json").write_text(
        json.dumps({"counts": {str(k): v for k, v in summary_counter.items()}}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def resolve_model_configs(model_names: List[str], key_count: int) -> Dict[str, Dict[str, List[int]]]:
    configs = {}
    for model in model_names:
        clean = model.strip()
        if not clean:
            continue
        if clean not in DEFAULT_MODEL_CONFIGS:
            raise RuntimeError("UNSUPPORTED_MODEL:" + clean)
        configs[clean] = {
            "key_slots": normalize_key_slots(DEFAULT_MODEL_CONFIGS[clean]["key_slots"], key_count),
        }
    if not configs:
        raise RuntimeError("NO_MODELS_SELECTED")
    return configs


def load_json_if_exists(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def load_existing_run_state(
    run_dir: Path,
    model_names: List[str],
) -> Tuple[Dict[str, list], list, Counter]:
    per_model_records = {}
    for model in model_names:
        per_model_records[model] = load_json_if_exists(run_dir / f"{model}.json", [])
    consensus_records = load_json_if_exists(run_dir / "consensus.json", [])
    summary_payload = load_json_if_exists(run_dir / "summary.json", {"counts": {}})
    summary_counter = Counter(summary_payload.get("counts", {}))
    return per_model_records, consensus_records, summary_counter


def determine_issues(result: Dict[str, object], parsed: Optional[Dict[str, object]], issues: List[str]) -> List[str]:
    if parsed is not None:
        return issues
    if result["content"]:
        return ["invalid_json"]
    if result["status"] == 200:
        return ["empty_content"]
    return ["no_content"]


def should_retry(status: Optional[int], issues: List[str]) -> bool:
    retryable_statuses = {None, 408, 409, 429, 500, 502, 503, 504}
    retryable_issues = {"empty_content", "no_content", "invalid_json"}
    return status in retryable_statuses or any(issue in retryable_issues for issue in issues)


def annotate_with_rotation(
    model: str,
    key_slots: List[int],
    keys: List[str],
    prompt: str,
    timeout: int,
) -> Dict[str, object]:
    attempts = []
    final_record = None
    for attempt_index, slot in enumerate(key_slots, start=1):
        result = call_model(model, keys[slot - 1], prompt, timeout=timeout)
        parsed = None
        valid = False
        issues = []
        if result["content"]:
            try:
                parsed = json.loads(strip_code_fence(result["content"]))
                valid, issues = validate_annotation(parsed)
            except Exception:
                parsed = None
                valid = False
                issues = ["invalid_json"]
        issues = determine_issues(result, parsed, issues)
        attempts.append(
            {
                "attempt": attempt_index,
                "key_slot": slot,
                "status": result["status"],
                "latency_s": result["latency_s"],
                "valid": valid,
                "issues": issues,
            }
        )
        final_record = {
            "status": result["status"],
            "latency_s": result["latency_s"],
            "valid": valid,
            "issues": issues,
            "output": parsed,
            "raw_content": result["content"],
            "raw_response": result["raw"][:3000],
            "key_slot": slot,
            "attempts": list(attempts),
        }
        if valid:
            break
        if attempt_index >= len(key_slots):
            break
        if not should_retry(result["status"], issues):
            break
        time.sleep(1)
    return final_record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--tag", default="pilot")
    parser.add_argument("--models", default="gpt-4.1-mini,claude-3-5-sonnet-20241022")
    parser.add_argument("--timeout", type=int, default=45)
    parser.add_argument("--run-dir", default="")
    args = parser.parse_args()

    keys = load_gateway_keys()
    model_configs = resolve_model_configs(args.models.split(","), len(keys))
    run_dir = Path(args.run_dir) if args.run_dir else make_run_dir(args.tag)
    run_dir.mkdir(parents=True, exist_ok=True)

    if args.run_dir:
        per_model_records, consensus_records, summary_counter = load_existing_run_state(run_dir, list(model_configs.keys()))
        completed_count = len(consensus_records)
    else:
        per_model_records = {model: [] for model in model_configs}
        consensus_records = []
        summary_counter = Counter()
        completed_count = 0

    remaining_limit = max(args.limit - completed_count, 0)
    stories = load_stories(limit=remaining_limit, offset=args.offset + completed_count)

    (run_dir / "prompt_system.txt").write_text(SYSTEM_PROMPT, encoding="utf-8")
    (run_dir / "prompt_user_template.txt").write_text(USER_PROMPT_TEMPLATE, encoding="utf-8")
    if not (run_dir / "stories.json").exists():
        all_stories = load_stories(limit=args.limit, offset=args.offset)
        (run_dir / "stories.json").write_text(json.dumps(all_stories, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "run_dir": str(run_dir),
                "stories_completed": completed_count,
                "stories_remaining": len(stories),
                "models": list(model_configs.keys()),
                "timeout": args.timeout,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )

    total_target = completed_count + len(stories)

    for index, story in enumerate(stories, start=completed_count + 1):
        prompt = USER_PROMPT_TEMPLATE.format(**story)
        per_story = {}
        print(
            f"[story {index}/{total_target}] {story['story_id']} {story['title']}",
            flush=True,
        )
        for model, config in model_configs.items():
            print(f"  -> calling {model} with key rotation {config['key_slots']}", flush=True)
            result = annotate_with_rotation(model, config["key_slots"], keys, prompt, timeout=args.timeout)
            record = {
                "story_id": story["story_id"],
                "title": story["title"],
                "model": model,
                "status": result["status"],
                "latency_s": result["latency_s"],
                "valid": result["valid"],
                "issues": result["issues"],
                "output": result["output"],
                "raw_content": result["raw_content"],
                "raw_response": result["raw_response"],
                "key_slot": result["key_slot"],
                "attempts": result["attempts"],
            }
            per_model_records[model].append(record)
            per_story[model] = record
            summary_counter[(model, result["status"], result["valid"])] += 1
            print(
                f"  <- {model} status={result['status']} latency={result['latency_s']} valid={result['valid']} key_slot={result['key_slot']} issues={result['issues']}",
                flush=True,
            )

        model_names = list(model_configs.keys())
        left = per_story[model_names[0]]
        right = per_story[model_names[1]] if len(model_names) > 1 else None
        qc_status = "review_required"
        consensus = None
        if right and left["valid"] and right["valid"]:
            if left["output"]["labels"] == right["output"]["labels"]:
                qc_status = "agreed"
                consensus = left["output"]
            else:
                qc_status = "disagreed"
        elif right and (left["valid"] or right["valid"]):
            qc_status = "single_valid"
            consensus = left["output"] if left["valid"] else right["output"]
        elif not right:
            qc_status = "single_model"
            consensus = left["output"] if left["valid"] else None
        else:
            qc_status = "both_invalid"

        consensus_records.append(
            {
                "story_id": story["story_id"],
                "title": story["title"],
                "qc_status": qc_status,
                "consensus": consensus,
                "left_model": model_names[0],
                "right_model": model_names[1] if right else None,
                "left_valid": left["valid"],
                "right_valid": right["valid"] if right else None,
                "left_issues": left["issues"],
                "right_issues": right["issues"] if right else [],
                "models": model_names,
            }
        )
        summary_counter[("qc", qc_status)] += 1
        write_progress(run_dir, per_model_records, consensus_records, summary_counter)

    print(json.dumps({
        "run_dir": str(run_dir),
        "stories": total_target,
        "summary": {str(k): v for k, v in summary_counter.items()},
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
