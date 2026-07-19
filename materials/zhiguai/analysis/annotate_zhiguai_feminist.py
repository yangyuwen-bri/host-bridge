#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable


ROOT = Path("/Users/gsdata/waoowaoo-main/materials/zhiguai")
STORIES_DIR = ROOT / "stories"
OUTPUT_DIR = ROOT / "analysis"
CSV_PATH = OUTPUT_DIR / "zhiguai_feminist_annotations.csv"
JSON_PATH = OUTPUT_DIR / "zhiguai_feminist_annotations.json"
TAXONOMY_PATH = OUTPUT_DIR / "zhiguai_feminist_taxonomy.md"
SUMMARY_PATH = OUTPUT_DIR / "zhiguai_feminist_summary.md"


COLLECTION_BY_PREFIX = {
    "lzz": "聊斋志异",
    "zby": "子不语",
    "xzby": "续子不语",
}

FEMALE_TITLE_TERMS = [
    "女鬼",
    "狐女",
    "狐仙",
    "神女",
    "仙女",
    "龍女",
    "龙女",
    "姑娘",
    "娘子",
    "孝女",
    "貞女",
    "贞女",
    "烈婦",
    "烈妇",
    "俠女",
    "侠女",
    "婦",
    "妻",
    "妾",
    "姬",
    "娘",
    "姑",
    "婆",
    "媪",
    "嫗",
    "婢",
    "姐",
    "妹",
    "母",
    "女",
]

SPECIFIC_FEMALE_TITLE_TERMS = [
    "女鬼",
    "狐女",
    "狐仙",
    "神女",
    "仙女",
    "龍女",
    "龙女",
    "姑娘",
    "娘子",
    "孝女",
    "貞女",
    "贞女",
    "烈婦",
    "烈妇",
    "俠女",
    "侠女",
    "女郎",
    "少女",
    "女子",
    "婢",
    "穩婆",
    "稳婆",
    "奶娘",
]

FEMALE_TEXT_TERMS = FEMALE_TITLE_TERMS + [
    "女子",
    "女郎",
    "少女",
    "婦人",
    "娘子",
    "小姐",
    "寡婦",
    "寡居",
    "新婦",
    "穩婆",
    "稳婆",
    "奶娘",
    "乳母",
]

FEMALE_SPEECH_TERMS = [
    "女曰",
    "婦曰",
    "妻曰",
    "妾曰",
    "女云",
    "婦云",
    "妻云",
    "妾云",
    "娘曰",
    "娘云",
    "媼曰",
    "嫗曰",
    "女子曰",
    "女鬼曰",
    "鬼曰",
]

MALE_GAZE_TERMS = [
    "容色",
    "艷",
    "艳",
    "秀曼",
    "目注",
    "神搖意奪",
    "神摇意夺",
    "狎",
    "抱",
    "猥褻",
    "猥亵",
    "冶",
    "美人",
]

ACTIVE_TERMS = [
    "俠",
    "侠",
    "訴冤",
    "诉冤",
    "告狀",
    "告状",
    "報仇",
    "报仇",
    "索命",
    "討命",
    "讨命",
    "守財",
    "守财",
    "殺",
    "杀",
    "刃",
    "救",
    "拒",
    "逃",
    "顯靈",
    "显灵",
    "自會往報",
    "自会往报",
    "化男",
    "杖擊賊",
    "杖击贼",
]

PASSIVE_TERMS = [
    "和奸",
    "強奸",
    "强奸",
    "受賄",
    "受贿",
    "被害",
    "虐",
    "詬",
    "诟",
    "逼",
    "溺",
    "縊",
    "缢",
    "自經",
    "自经",
    "死",
    "歿",
    "殉",
    "守寡",
    "寡居",
]

DYNASTY_RULES = [
    ("清", ["乾隆", "嘉慶", "嘉庆", "道光", "康熙", "雍正", "順治", "顺治", "國初", "国初", "本朝"]),
    ("明", ["洪武", "永樂", "永乐", "嘉靖", "萬曆", "万历", "崇禎", "崇祯", "明季", "明末"]),
    ("元", ["至元", "元朝", "元時", "元时", "元末"]),
    ("宋", ["南宋", "北宋", "宋朝", "宋時", "宋时", "宋人"]),
    ("唐", ["唐朝", "唐時", "唐时", "唐人", "武后", "開元", "开元", "貞觀", "贞观"]),
    ("魏晋南北朝", ["晉", "晋", "魏", "梁武", "南朝", "北朝", "天監", "天监"]),
    ("秦汉", ["秦", "漢", "汉", "建安"]),
]

PRIMARY_TYPE_RULES = {
    "狐魅叙事": ["狐", "狐仙", "狐女"],
    "鬼魂/冥府": ["鬼", "魂", "冥", "陰司", "阴司", "城隍", "東嶽", "东岳", "閻", "阎"],
    "仙神/龙女": ["仙", "神", "神女", "仙女", "娘娘", "龍女", "龙女", "嫦娥", "玄女", "觀音", "观音"],
    "妖怪/精魅": ["妖", "怪", "精", "魈", "尸", "狼", "蛇", "虎", "蛟", "龍", "龙"],
    "术法/道术": ["道士", "和尚", "僧", "法", "咒", "符", "乩", "卜", "巫"],
    "梦幻/异境": ["夢", "梦", "畫壁", "画壁", "幻", "壁上"],
    "公案/申冤": ["案", "獄", "狱", "訴冤", "诉冤", "告狀", "告状", "太守", "縣令", "县令", "官司"],
    "伦理/报应": ["報", "报", "償命", "偿命", "烈", "孝", "貞", "贞", "戒"],
    "杂志异闻": [],
}

ANGLE_RULES = {
    "婚姻/婚配制度": ["嫁", "婚", "妻", "妾", "婿", "夫", "新婦", "新妇", "寡居", "守寡"],
    "父权家族/宗法": ["父", "母", "翁", "姑", "宗", "嗣", "家門", "家门", "族", "伯", "舅"],
    "贞节规训": ["貞", "贞", "節", "节", "烈", "拒奸", "和奸", "節孝", "节孝"],
    "男性凝视与欲望投射": MALE_GAZE_TERMS,
    "女性复仇/申冤": ["訴冤", "诉冤", "告狀", "告状", "報仇", "报仇", "索命", "討命", "讨命", "守財", "守财"],
    "家庭暴力与虐待": ["虐", "杖", "逼", "殺", "杀", "溺", "縊", "缢", "強奸", "强奸", "攫"],
    "照护劳动/生育责任": ["縫紉", "缝纫", "洗創", "洗创", "奉養", "奉养", "奶娘", "穩婆", "稳婆", "孕", "胎", "產", "产", "乳"],
    "妻妾/婢妾与阶层": ["妾", "婢", "奴", "侍", "奶娘", "穩婆", "稳婆", "老嫗", "老媪"],
    "女性欲望与婚恋自主": ["情緣", "情缘", "私", "相歡", "相欢", "相從", "相从", "招", "不肯", "拒", "求欢", "狎"],
    "女体妖魔化/他者化": ["女鬼", "鬼妻", "狐女", "狐仙", "妖女", "女怪"],
    "性别越界/性别流动": ["女化男", "男妾", "女妝", "女妆", "假女", "作女態", "作女态"],
    "神怪作为女性出口": ["女鬼", "狐女", "狐仙", "神女", "仙女", "龍女", "龙女", "顯靈", "显灵", "成仙", "仙籍"],
    "女性互助/代际支持": ["姊妹", "姐妹", "女伴", "阿母", "周給", "周给", "撫育", "抚育", "扶助", "看護", "看护"],
}

ENDING_RULES = [
    ("伸冤昭雪", ["訴冤", "诉冤", "定案", "昭雪", "雪冤", "旌其女", "節孝祠", "节孝祠"]),
    ("报应惩戒", ["償命", "偿命", "示戒", "责譴", "责谴", "悔恨", "天報", "天报", "報", "报"]),
    ("婚恋团圆", ["為妻", "为妻", "夫妻", "重合", "娶", "納婦", "纳妇", "大喜"]),
    ("超脱成仙", ["仙籍", "成仙", "仙人", "升", "不見", "不见"]),
    ("悲剧/消散", ["死", "歿", "殪", "自刎", "縊", "缢", "溺", "煙然滅", "烟然灭", "卒"]),
    ("惊悚收束", ["駭", "骇", "寒心", "不知何怪", "鬼火", "怪"]),
]

MORAL_RULES = [
    ("礼教嘉奖", ["節孝", "节孝", "貞烈", "贞烈", "烈婦", "烈妇", "孝女", "貞女", "贞女"]),
    ("礼教惩戒", ["淫", "惡", "恶", "示戒", "责譴", "责谴", "無良", "无良"]),
    ("因果报应", ["償命", "偿命", "天報", "天报", "現世報", "现世报", "果卒", "報", "报"]),
    ("同情/赞赏女性主体", ["誰謂女子", "谁谓女子", "奇女子", "可憫", "可怜", "不可比", "叹惋"]),
]

FIGURE_TAG_RULES = {
    "凡间女子": ["女子", "女郎", "姑娘", "娘子", "少女", "小姐"],
    "妻妾/已婚女性": ["妻", "妾", "婦", "妇", "新婦", "新妇", "寡婦", "寡妇", "寡居"],
    "母亲/婆妪": ["母", "媪", "嫗", "老嫗", "老媪", "奶娘"],
    "婢女/侍女": ["婢", "丫鬟", "青衣", "侍女", "奴"],
    "烈女/侠女": ["俠女", "侠女", "烈婦", "烈妇", "孝女", "貞女", "贞女"],
    "女鬼/冤魂": ["女鬼", "鬼妻", "冤魂"],
    "狐女/狐仙": ["狐女", "狐仙", "狐嫁女", "狐妾", "十四娘", "四娘", "花姑子", "宦娘", "恒娘", "恆娘"],
    "神女/仙女/龙女": ["神女", "仙女", "玉女", "玄女", "龍女", "龙女", "嫦娥", "娘娘"],
    "巫妪/婆子": ["巫", "禁魘婆", "神婆", "穩婆", "稳婆", "卜巫"],
    "性别越界者": ["女化男", "男妾", "女妝", "女妆", "假女", "作女態", "作女态"],
}

GENERIC_FIGURE_TAGS = {"凡间女子", "妻妾/已婚女性", "母亲/婆妪", "婢女/侍女"}
SPECIFIC_FIGURE_TAGS = {"烈女/侠女", "女鬼/冤魂", "狐女/狐仙", "神女/仙女/龙女", "巫妪/婆子", "性别越界者"}


def strip_template_markup(text: str) -> str:
    return re.sub(r"\{\{[^|]+\|([^}]+)\}\}", r"\1", text)


def normalize_text(text: str) -> str:
    text = strip_template_markup(text)
    return re.sub(r"\s+", "", text)


def distinct_matches(text: str, patterns: Iterable[str]) -> list[str]:
    return [pattern for pattern in patterns if pattern and pattern in text]


def detect_dynasty(title: str, text: str) -> str:
    head = title + text[:240]
    matches: list[str] = []
    for dynasty, patterns in DYNASTY_RULES:
        if any(pattern in head for pattern in patterns):
            matches.append(dynasty)
    if not matches:
        return "未明"
    unique_matches = list(dict.fromkeys(matches))
    if len(unique_matches) == 1:
        return unique_matches[0]
    return "跨代/杂糅"


def detect_primary_types(title: str, text: str) -> tuple[str, str]:
    scores: dict[str, int] = {}
    for label, patterns in PRIMARY_TYPE_RULES.items():
        if not patterns:
            continue
        title_hits = distinct_matches(title, patterns)
        text_hits = distinct_matches(text, patterns)
        scores[label] = len(title_hits) * 3 + len(text_hits)
    if not scores:
        return "杂志异闻", ""
    ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    primary_label, primary_score = ranked[0]
    if primary_score <= 0:
        return "杂志异闻", ""
    secondary = ""
    if len(ranked) > 1 and ranked[1][1] >= max(2, primary_score - 1):
        secondary = ranked[1][0]
    return primary_label, secondary


def detect_figure_tags(title: str, text: str) -> list[str]:
    tags: list[str] = []
    for label, patterns in FIGURE_TAG_RULES.items():
        title_hits = distinct_matches(title, patterns)
        text_hits = distinct_matches(text, patterns)
        if label in SPECIFIC_FIGURE_TAGS and (title_hits or text_hits):
            tags.append(label)
            continue
        if label == "凡间女子" and (title_hits or len(text_hits) >= 2):
            tags.append(label)
            continue
        if label == "妻妾/已婚女性" and (title_hits or len(text_hits) >= 2):
            tags.append(label)
            continue
        if label == "母亲/婆妪" and (title_hits or len(text_hits) >= 2):
            tags.append(label)
            continue
        if label == "婢女/侍女" and (title_hits or len(text_hits) >= 2):
            tags.append(label)
    if "狐女/狐仙" in tags and "凡间女子" in tags:
        tags.remove("凡间女子")
    if "神女/仙女/龙女" in tags and "凡间女子" in tags:
        tags.remove("凡间女子")
    if "女鬼/冤魂" in tags and "凡间女子" in tags:
        tags.remove("凡间女子")
    return tags


def detect_female_centrality(title: str, text: str, figure_tags: list[str]) -> tuple[str, int]:
    title_hits = distinct_matches(title, FEMALE_TITLE_TERMS)
    specific_title_hits = distinct_matches(title, SPECIFIC_FEMALE_TITLE_TERMS)
    text_hits = distinct_matches(text, FEMALE_TEXT_TERMS)
    generic_tag_count = sum(1 for tag in figure_tags if tag in GENERIC_FIGURE_TAGS)
    specific_tag_count = sum(1 for tag in figure_tags if tag in SPECIFIC_FIGURE_TAGS)
    score = len(specific_title_hits) * 4 + len(title_hits) * 2 + specific_tag_count * 3 + min(len(text_hits), 3)
    if score == 0 and generic_tag_count == 0:
        return "无", score
    if score == 0 and generic_tag_count > 0:
        return ("边缘" if len(text_hits) >= 2 else "无"), score
    if not specific_title_hits and specific_tag_count == 0 and len(title_hits) == 0:
        if generic_tag_count > 0 and len(text_hits) >= 2:
            return "边缘", score
        return "无", score
    if score <= 4:
        return "边缘", score
    if score <= 8:
        return "关键", score
    return "核心", score


def detect_female_perspective(
    title: str,
    text: str,
    centrality: str,
    female_signal: int,
) -> str:
    if centrality == "无":
        return "无明显女性视角"
    speech_hits = distinct_matches(text, FEMALE_SPEECH_TERMS)
    male_gaze_hits = distinct_matches(text, MALE_GAZE_TERMS)
    grievance_hits = distinct_matches(text, ["訴冤", "诉冤", "命不該死", "命不该死", "拒奸", "和奸", "負心", "负心", "討命", "讨命"])
    if speech_hits and grievance_hits and female_signal >= 4:
        return "女性主体表达较强"
    if speech_hits or grievance_hits:
        return "女性经验可见"
    if male_gaze_hits:
        return "男性凝视主导"
    return "男性转述/旁观"


def detect_female_agency(title: str, text: str, centrality: str) -> str:
    if centrality == "无":
        return "无"
    active_score = len(distinct_matches(title, ACTIVE_TERMS)) * 2 + len(distinct_matches(text, ACTIVE_TERMS))
    passive_score = len(distinct_matches(title, PASSIVE_TERMS)) * 2 + len(distinct_matches(text, PASSIVE_TERMS))
    if active_score >= max(3, passive_score + 1):
        return "高"
    if active_score >= 1 and active_score + 1 >= passive_score:
        return "中"
    return "低"


def first_matching_label(text: str, rules: list[tuple[str, list[str]]], fallback: str) -> str:
    for label, patterns in rules:
        if any(pattern in text for pattern in patterns):
            return label
    return fallback


def detect_moral_evaluation(title: str, text: str, figure_tags: list[str]) -> str:
    combined = title + text[-240:]
    explicit = first_matching_label(combined, MORAL_RULES, "")
    if explicit:
        return explicit
    if any(tag in figure_tags for tag in ["女鬼/冤魂", "狐女/狐仙", "神女/仙女/龙女"]):
        if any(term in combined for term in ["愛", "爱", "可憐", "可怜", "大悅", "大悦", "情緣", "情缘"]):
            return "道德暧昧/同情越界"
    return "弱评价/异闻观照"


def detect_angles(title: str, text: str) -> list[str]:
    scores: dict[str, int] = {}
    combined = title + text
    for label, patterns in ANGLE_RULES.items():
        hits = distinct_matches(combined, patterns)
        if hits:
            scores[label] = len(hits)
    ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    return [label for label, _score in ranked[:4]]


def evidence_keywords(
    title: str,
    text: str,
    primary_type: str,
    figure_tags: list[str],
    angles: list[str],
) -> list[str]:
    keywords: list[str] = []
    if primary_type == "狐魅叙事":
        keywords.extend(distinct_matches(title + text, ["狐", "狐仙", "狐女"]))
    if primary_type == "鬼魂/冥府":
        keywords.extend(distinct_matches(title + text, ["鬼", "魂", "城隍", "東嶽", "东岳"]))
    keywords.extend(distinct_matches(title, FEMALE_TITLE_TERMS))
    keywords.extend(distinct_matches(text[-240:], ACTIVE_TERMS + PASSIVE_TERMS))
    if "婚姻/婚配制度" in angles:
        keywords.extend(distinct_matches(title + text, ["嫁", "妻", "妾", "婿"]))
    if "贞节规训" in angles:
        keywords.extend(distinct_matches(title + text, ["貞", "贞", "節", "节", "烈", "和奸", "拒奸"]))
    if any(tag in figure_tags for tag in ["女鬼/冤魂", "狐女/狐仙", "神女/仙女/龙女"]):
        keywords.extend(figure_tags)
    deduped: list[str] = []
    for keyword in keywords:
        if keyword not in deduped:
            deduped.append(keyword)
    return deduped[:10]


def detect_confidence(
    primary_type: str,
    secondary_type: str,
    figure_tags: list[str],
    angles: list[str],
    evidence: list[str],
) -> str:
    score = len(figure_tags) + len(angles) + len(evidence)
    if primary_type != "杂志异闻":
        score += 1
    if secondary_type:
        score += 1
    if score >= 9:
        return "高"
    if score >= 5:
        return "中"
    return "低"


def classify_story(meta: dict[str, str], text: str) -> dict[str, str]:
    title = normalize_text(meta["title"])
    clean_text = normalize_text(text)
    tail = clean_text[-240:]
    local_text_path = meta.get("local_text_path", f"stories/{meta['id']}/source.txt")
    original_text_path = (ROOT / local_text_path).resolve()
    figure_tags = detect_figure_tags(title, clean_text)
    female_centrality, female_signal = detect_female_centrality(title, clean_text, figure_tags)
    primary_type, secondary_type = detect_primary_types(title, clean_text)
    ending_type = first_matching_label(tail, ENDING_RULES, "异闻收束")
    angles = detect_angles(title, clean_text)
    evidence = evidence_keywords(title, clean_text, primary_type, figure_tags, angles)
    row = {
        "id": meta["id"],
        "title": title,
        "collection": COLLECTION_BY_PREFIX.get(meta["id"].split("-")[0], "未知"),
        "volume": meta["volume"],
        "source_volume_url": meta.get("source_volume_url", ""),
        "local_text_path": local_text_path,
        "original_text_link": f"file://{original_text_path}",
        "story_dynasty": detect_dynasty(title, clean_text),
        "story_type_primary": primary_type,
        "story_type_secondary": secondary_type,
        "female_centrality": female_centrality,
        "female_perspective": detect_female_perspective(title, clean_text, female_centrality, female_signal),
        "female_figures": "|".join(figure_tags) if figure_tags else "无显著女性形象",
        "female_agency": detect_female_agency(title, clean_text, female_centrality),
        "ending_type": ending_type,
        "moral_evaluation": detect_moral_evaluation(title, clean_text, figure_tags),
        "feminist_angles": "|".join(angles) if angles else "无明显女性主义切口",
        "evidence_keywords": "|".join(evidence),
        "confidence": detect_confidence(primary_type, secondary_type, figure_tags, angles, evidence),
        "text_char_count": str(meta.get("text_char_count", "")),
    }
    return row


def load_rows() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for story_dir in sorted(STORIES_DIR.iterdir()):
        meta_path = story_dir / "meta.json"
        text_path = story_dir / "source.txt"
        if not meta_path.exists() or not text_path.exists():
            continue
        with meta_path.open(encoding="utf-8") as handle:
            meta = json.load(handle)
        with text_path.open(encoding="utf-8") as handle:
            text = handle.read()
        rows.append(classify_story(meta, text))
    return rows


def top_counter_lines(counter: Counter[str], examples: dict[str, list[str]], limit: int = 8) -> list[str]:
    lines: list[str] = []
    for label, count in counter.most_common(limit):
        sample = "、".join(examples[label][:3])
        lines.append(f"- {label}: {count}，例：{sample}")
    return lines


def update_examples(examples: dict[str, list[str]], label: str, title: str) -> None:
    bucket = examples[label]
    if title not in bucket and len(bucket) < 3:
        bucket.append(title)


def summarize_rows(rows: list[dict[str, str]]) -> str:
    by_collection = Counter(row["collection"] for row in rows)
    collection_rows: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        collection_rows[row["collection"]].append(row)
    female_core_rows = [row for row in rows if row["female_centrality"] in {"关键", "核心"}]
    female_present_rows = [row for row in rows if row["female_centrality"] != "无"]

    centrality_by_collection: dict[str, Counter[str]] = defaultdict(Counter)
    figure_counter = Counter[str]()
    figure_examples: dict[str, list[str]] = defaultdict(list)
    agency_counter = Counter[str]()
    ending_counter = Counter[str]()
    moral_counter = Counter[str]()
    angle_counter = Counter[str]()
    angle_examples: dict[str, list[str]] = defaultdict(list)
    dynasty_counter = Counter(row["story_dynasty"] for row in rows)
    perspective_counter = Counter(row["female_perspective"] for row in female_core_rows)

    for row in rows:
        centrality_by_collection[row["collection"]][row["female_centrality"]] += 1

    for row in female_core_rows:
        agency_counter[row["female_agency"]] += 1
        ending_counter[row["ending_type"]] += 1
        moral_counter[row["moral_evaluation"]] += 1
        for figure in row["female_figures"].split("|"):
            if figure == "无显著女性形象":
                continue
            figure_counter[figure] += 1
            update_examples(figure_examples, figure, row["title"])
        for angle in row["feminist_angles"].split("|"):
            if angle == "无明显女性主义切口":
                continue
            angle_counter[angle] += 1
            update_examples(angle_examples, angle, row["title"])

    lines = [
        "# 志怪故事女性主义标签全库比较",
        "",
        "## 语料概况",
        f"- 总故事数：{len(rows)}",
        f"- 女性显著在场（非“无”）：{len(female_present_rows)}",
        f"- 女性关键/核心：{len(female_core_rows)}",
        f"- 语料来源：{', '.join(f'{name} {count}' for name, count in by_collection.items())}",
        "",
        "## 标签体系使用说明",
        "- `story_dynasty` 标注的是故事内部可明确识别的时代线索；若文本未明示，则记为 `未明`。",
        "- `female_perspective` 是叙事贴近度，不等于作者性别或第一人称。",
        "- 本轮为规则初标，适合做全库检索、比较和二次精修；优先复核 `confidence=低` 的条目。",
        "",
        "## 女性中心性按书目分布",
    ]

    for collection, counter in sorted(centrality_by_collection.items()):
        parts = "，".join(f"{label} {counter[label]}" for label in ["无", "边缘", "关键", "核心"])
        lines.append(f"- {collection}: {parts}")

    lines.extend(
        [
            "",
            "## 分书比较（关键/核心故事）",
        ]
    )
    for collection, items in sorted(collection_rows.items(), key=lambda item: item[0]):
        core_rows = [row for row in items if row["female_centrality"] in {"关键", "核心"}]
        ratio = len(core_rows) / len(items) if items else 0
        figure_counter_local = Counter[str]()
        ending_counter_local = Counter(row["ending_type"] for row in core_rows)
        for row in core_rows:
            for figure in row["female_figures"].split("|"):
                if figure != "无显著女性形象":
                    figure_counter_local[figure] += 1
        figure_summary = "、".join(f"{label} {count}" for label, count in figure_counter_local.most_common(3))
        ending_summary = "、".join(f"{label} {count}" for label, count in ending_counter_local.most_common(3))
        lines.append(
            f"- {collection}: 关键/核心 {len(core_rows)}/{len(items)}（{ratio:.1%}）；常见女性形象 {figure_summary}；常见结局 {ending_summary}"
        )

    lines.extend(
        [
            "",
            "## 显性朝代线索",
            *[f"- {label}: {count}" for label, count in dynasty_counter.most_common(8)],
            "",
            "## 女性形象类型（关键/核心故事）",
            *top_counter_lines(figure_counter, figure_examples),
            "",
            "## 女性行动力（关键/核心故事）",
            *[f"- {label}: {count}" for label, count in agency_counter.most_common()],
            "",
            "## 女性视角贴近度（关键/核心故事）",
            *[f"- {label}: {count}" for label, count in perspective_counter.most_common()],
            "",
            "## 结局类型（关键/核心故事）",
            *[f"- {label}: {count}" for label, count in ending_counter.most_common()],
            "",
            "## 道德评价（关键/核心故事）",
            *[f"- {label}: {count}" for label, count in moral_counter.most_common()],
            "",
            "## 女性主义切口（关键/核心故事）",
            *top_counter_lines(angle_counter, angle_examples, limit=10),
            "",
            "## 整体观察",
            "- 全库里最容易被显性标出的不是“女性第一人称”，而是围绕婚配、贞节、冤屈与报应的结构位置；女性通常在关系与伦理冲突中被凸显。",
            "- 《聊斋志异》的女性谱系更偏狐女、女鬼、神女与才情女性，越界情爱和道德暧昧显著更多。",
            "- 《子不语》与《续子不语》更常把女性放入家庭、官司、报应与奇案结构中，贞节、申冤、虐待和现世惩戒更突出。",
            "- 真正的“女性主体表达较强”条目数量有限，但在诉冤、索命、复仇、拒奸等情节中会短暂出现强主体时刻。",
            "- 许多故事的女性行动力呈现出二重性：在人间秩序内往往受困，在神怪形态中反而拥有说话、复仇或重新分配资源的能力。",
        ]
    )
    return "\n".join(lines) + "\n"


def write_taxonomy() -> None:
    content = """# 志怪故事女性主义标签体系

## 设计原则
- 以志怪短篇的实际可读特征为基础，避免只能靠外部考据才能判定的标签。
- 同时兼顾文类标签与女性主义阅读标签，让同一张表既能检索故事，也能比较女性形象与叙事姿态。
- 允许“低置信度”存在，不用伪造确定性。

## 字段说明
- `story_dynasty`: 故事内部显性朝代线索。枚举：`秦汉`、`魏晋南北朝`、`唐`、`宋`、`元`、`明`、`清`、`跨代/杂糅`、`未明`。
- `story_type_primary`: 主故事类型。枚举：`狐魅叙事`、`鬼魂/冥府`、`仙神/龙女`、`妖怪/精魅`、`术法/道术`、`梦幻/异境`、`公案/申冤`、`伦理/报应`、`杂志异闻`。
- `story_type_secondary`: 次故事类型，允许为空。
- `female_centrality`: 女性在故事结构中的位置。枚举：`无`、`边缘`、`关键`、`核心`。
- `female_perspective`: 叙事是否贴近女性经验。枚举：`无明显女性视角`、`男性转述/旁观`、`男性凝视主导`、`女性经验可见`、`女性主体表达较强`。
- `female_figures`: 女性形象类型，多标签。枚举：`凡间女子`、`妻妾/已婚女性`、`母亲/婆妪`、`婢女/侍女`、`烈女/侠女`、`女鬼/冤魂`、`狐女/狐仙`、`神女/仙女/龙女`、`巫妪/婆子`、`性别越界者`。
- `female_agency`: 女性行动力。枚举：`无`、`低`、`中`、`高`。
- `ending_type`: 结局结构。枚举：`伸冤昭雪`、`报应惩戒`、`婚恋团圆`、`超脱成仙`、`悲剧/消散`、`惊悚收束`、`异闻收束`。
- `moral_evaluation`: 文本显性道德姿态。枚举：`礼教嘉奖`、`礼教惩戒`、`因果报应`、`同情/赞赏女性主体`、`道德暧昧/同情越界`、`弱评价/异闻观照`。
- `feminist_angles`: 可供女性主义阅读的切口，多标签。枚举：
  - `婚姻/婚配制度`
  - `父权家族/宗法`
  - `贞节规训`
  - `男性凝视与欲望投射`
  - `女性复仇/申冤`
  - `家庭暴力与虐待`
  - `照护劳动/生育责任`
  - `妻妾/婢妾与阶层`
  - `女性欲望与婚恋自主`
  - `女体妖魔化/他者化`
  - `性别越界/性别流动`
  - `神怪作为女性出口`
  - `女性互助/代际支持`
- `evidence_keywords`: 触发标签的简短证据词，便于人工复核。
- `confidence`: 规则初标置信度。枚举：`高`、`中`、`低`。
"""
    TAXONOMY_PATH.write_text(content, encoding="utf-8")


def write_outputs(rows: list[dict[str, str]]) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    write_taxonomy()
    fieldnames = [
        "id",
        "title",
        "collection",
        "volume",
        "source_volume_url",
        "local_text_path",
        "original_text_link",
        "story_dynasty",
        "story_type_primary",
        "story_type_secondary",
        "female_centrality",
        "female_perspective",
        "female_figures",
        "female_agency",
        "ending_type",
        "moral_evaluation",
        "feminist_angles",
        "evidence_keywords",
        "confidence",
        "text_char_count",
    ]
    with CSV_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    JSON_PATH.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    SUMMARY_PATH.write_text(summarize_rows(rows), encoding="utf-8")


def main() -> None:
    rows = load_rows()
    write_outputs(rows)
    print(f"wrote {len(rows)} rows to {CSV_PATH}")
    print(f"summary: {SUMMARY_PATH}")
    print(f"taxonomy: {TAXONOMY_PATH}")


if __name__ == "__main__":
    main()
