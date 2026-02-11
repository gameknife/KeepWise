#!/usr/bin/env python3
"""Parse CMB credit-card statement EML files and classify spending."""

from __future__ import annotations

import argparse
import csv
import json
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable


YEAR_MONTH_RE = re.compile(r"您(\d{4})年(\d{1,2})月信用卡账单已出")
HEADER_KEYWORDS = ("交易日", "记账日", "交易摘要", "人民币金额")
STATEMENT_CATEGORIES = {"消费", "还款", "分期", "取现", "费用", "利息", "调账", "其他"}
AMOUNT_RE = re.compile(r"[-+]?\d[\d,]*(?:\.\d+)?")
DATE_MMDD_RE = re.compile(r"^\d{4}$")
RATE_SUFFIX_RE = re.compile(r"\s*汇率\s*\d+(?:\.\d+)?\s*$", re.IGNORECASE)
CHANNEL_PREFIX_RE = re.compile(
    r"^(?:支付宝|财付通|京东支付|云闪付|微信支付|银联|掌上生活|手机银行|美团支付|抖音支付|Apple\.com/bill)"
    r"[-－—_:：\s]*",
    re.IGNORECASE,
)

REPORT_CSS_SOURCE = Path(__file__).resolve().parent / "assets" / "consumption_report.css"


DEFAULT_MERCHANT_MAP = [
    ("肯德基", "餐饮", "0.99", "常见连锁快餐"),
    ("luckincoffee瑞幸咖啡", "餐饮", "0.99", "常见连锁咖啡"),
    ("特来电新能源股份有限公司", "交通出行", "0.98", "新能源充电"),
    ("拼多多平台商户", "购物", "0.98", "电商平台"),
    ("中国电信", "通讯缴费", "0.98", "通讯服务"),
    ("PlayStation Network", "数字娱乐", "0.98", "游戏平台"),
    ("Amazon web services", "云服务/软件", "0.97", "云服务"),
    ("GOOGLE*GOOGLE ONE", "云服务/软件", "0.97", "云存储服务"),
    ("Google CLOUD SJV6BH", "云服务/软件", "0.97", "云服务"),
    ("理想", "购车支出", "0.99", "车辆购置/相关支出"),
    ("贝壳平台商户", "居家物业", "0.98", "居家/房屋相关"),
    ("中国人寿", "保险保障", "0.99", "保险支出"),
    ("利宝保险有限公司四川分公司", "保险保障", "0.99", "保险支出"),
    ("中国石化销售股份有限公司四川", "交通出行", "0.98", "加油支出"),
    ("江苏心电互动汽车销售服务有限", "交通出行", "0.97", "车辆服务"),
    ("携程", "旅行住宿", "0.98", "旅行相关"),
    ("锦江区星辉汽车服务中心", "交通出行", "0.97", "车辆服务"),
    ("Nuvei GS (former Sma", "数字娱乐", "0.88", "海外数字服务通道"),
    ("NUVEI GS", "数字娱乐", "0.88", "海外数字服务通道"),
    ("美团平台商户", "餐饮", "0.94", "本地生活以餐饮为主"),
    ("美团", "餐饮", "0.90", "本地生活以餐饮为主"),
    ("宜泊", "交通出行", "0.98", "停车支出"),
    ("宜信智泊", "交通出行", "0.98", "停车支出"),
    ("四川省财政厅", "行政缴费", "0.97", "政务缴费"),
    ("AYANEO官方商城", "购物", "0.97", "电子产品购物"),
    ("上海盒马网络科技有限公司", "购物", "0.97", "商超购物"),
    ("成都盒马", "购物", "0.95", "商超购物"),
    ("沃尔玛（中国）投资有限公司", "购物", "0.97", "商超购物"),
    ("成都伊藤洋华堂锦华店", "购物", "0.97", "商超购物"),
    ("成都华联SKP百货有限公司", "购物", "0.97", "百货购物"),
    ("上海拉扎斯信息科技有限公司", "餐饮", "0.92", "外卖平台"),
    ("拉扎斯网络科技（上海）有限公", "餐饮", "0.92", "外卖平台"),
    ("山姆自助收银", "购物", "0.96", "商超购物"),
    ("轻巧拿（合肥）科技有限公司", "购物", "0.90", "无人零售"),
    ("淘票票", "数字娱乐", "0.96", "电影票务"),
    ("美年大健康", "医疗健康", "0.97", "体检医疗"),
    ("蜜雪冰城", "餐饮", "0.97", "餐饮消费"),
    ("高德打车", "交通出行", "0.97", "出行服务"),
]


DEFAULT_CATEGORY_RULES = [
    ("10", "contains", "肯德基|瑞幸|luckin|咖啡|奶茶|火锅|餐饮|麦当劳|汉堡|拉扎斯|饿了么|寿司|茶餐厅|牛肉|面|食堂|美团", "餐饮", "0.90", "餐饮关键词"),
    ("20", "contains", "拼多多|京东|淘宝|天猫|商贸|超市|麦德龙|钱大妈|自营旗舰店|盒马|沃尔玛|伊藤|百货|山姆|安踏|商城", "购物", "0.88", "购物关键词"),
    ("30", "contains", "特来电|高速|停车|泊飞|哈啰|理想汽车|理想|滴滴|绿道|环贸|石化|高德打车|宜泊|智泊|通行宝|汽车", "交通出行", "0.86", "交通关键词"),
    ("35", "contains", "人寿|保险|利宝", "保险保障", "0.95", "保险关键词"),
    ("40", "contains", "中国电信|移动|联通|迅雷|宽带|话费|中铁网络", "通讯缴费", "0.88", "通讯关键词"),
    ("50", "contains", "PlayStation|网易云音乐|网易雷火|腾讯|GOOGLE ONE|Google CLOUD|Amazon web services|AWS|Apple|Nuvei|NEXITALLY|Boku|淘票票", "数字娱乐", "0.84", "数字内容关键词"),
    ("60", "contains", "cloud|Google|AWS|amazon|Microsoft", "云服务/软件", "0.80", "云服务关键词"),
    ("70", "contains", "物业|华宇优家|优家|社区|公寓|贝壳|置业", "居家物业", "0.86", "居家物业"),
    ("80", "contains", "学习|教育|课堂|乐读|书画院|中信书店", "教育学习", "0.84", "教育关键词"),
    ("90", "contains", "携程|酒店|旅行社|华程西南", "旅行住宿", "0.90", "旅行关键词"),
    ("95", "contains", "财政厅", "行政缴费", "0.95", "政务缴费"),
    ("100", "contains", "美年", "医疗健康", "0.90", "医疗关键词"),
    ("105", "contains", "理想", "购车支出", "0.92", "购车相关"),
]


CATEGORY_ALIASES = {
    "商超购物": "购物",
    "电商平台": "购物",
    "车辆服务": "交通出行",
    "加油支出": "交通出行",
    "外卖平台": "餐饮",
    "数字服务": "数字娱乐",
}


DEFAULT_ANALYSIS_EXCLUSIONS = [
    (
        "1",
        "exclude-car-purchase",
        "理想",
        "",
        "购车支出",
        "100000",
        "",
        "",
        "",
        "购车大额一次性支出，排除日常消费分析",
    )
]


@dataclass
class Transaction:
    source_file: str
    source_path: str
    statement_year: int
    statement_month: int
    statement_category: str
    trans_date: str
    post_date: str
    description: str
    amount_rmb: Decimal
    card_last4: str
    original_amount: str
    country_area: str

    def as_csv_row(self) -> list[str]:
        return [
            self.source_file,
            self.source_path,
            str(self.statement_year),
            str(self.statement_month),
            self.statement_category,
            self.trans_date,
            self.post_date,
            self.description,
            format_decimal(self.amount_rmb),
            self.card_last4,
            self.original_amount,
            self.country_area,
        ]


@dataclass
class ClassificationRule:
    priority: int
    match_type: str
    pattern: str
    expense_category: str
    confidence: float
    note: str = ""


@dataclass
class AnalysisExclusionRule:
    enabled: bool
    rule_name: str
    merchant_contains: str
    description_contains: str
    expense_category: str
    min_amount: Decimal | None
    max_amount: Decimal | None
    start_date: str
    end_date: str
    reason: str


@dataclass
class ClassifiedTransaction:
    txn: Transaction
    merchant_normalized: str
    expense_category: str
    classify_source: str
    confidence: float
    needs_review: int
    excluded_in_analysis: int
    exclude_reason: str

    def as_csv_row(self) -> list[str]:
        return [
            self.txn.source_file,
            self.txn.source_path,
            str(self.txn.statement_year),
            str(self.txn.statement_month),
            self.txn.statement_category,
            self.txn.trans_date,
            self.txn.post_date,
            self.txn.description,
            self.merchant_normalized,
            format_decimal(self.txn.amount_rmb),
            self.txn.card_last4,
            self.txn.original_amount,
            self.txn.country_area,
            self.expense_category,
            self.classify_source,
            f"{self.confidence:.2f}",
            str(self.needs_review),
            str(self.excluded_in_analysis),
            self.exclude_reason,
        ]


class TableTextExtractor(HTMLParser):
    """Extract HTML table rows as plain text cells."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_td = False
        self.current_cell: list[str] = []
        self.current_row: list[str] = []
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        t = tag.lower()
        if t in ("td", "th"):
            self.in_td = True
            self.current_cell = []
        elif t == "br" and self.in_td:
            self.current_cell.append(" ")

    def handle_data(self, data: str) -> None:
        if self.in_td:
            self.current_cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in ("td", "th") and self.in_td:
            raw = "".join(self.current_cell)
            text = re.sub(r"\s+", " ", raw).strip()
            self.current_row.append(text)
            self.current_cell = []
            self.in_td = False
        elif t == "tr":
            if any(cell.strip() for cell in self.current_row):
                self.rows.append(self.current_row)
            self.current_row = []


def parse_decimal(text: str) -> Decimal | None:
    if not text:
        return None
    m = AMOUNT_RE.search(text.replace("¥", "").replace("￥", ""))
    if not m:
        return None
    try:
        return Decimal(m.group(0).replace(",", ""))
    except InvalidOperation:
        return None


def format_decimal(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


def normalize_mmdd(mmdd: str, statement_year: int, statement_month: int) -> str:
    if not DATE_MMDD_RE.match(mmdd):
        return ""
    month = int(mmdd[:2])
    day = int(mmdd[2:])
    year = statement_year
    if month > statement_month:
        year -= 1
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return ""


def parse_statement_year_month(rows: list[list[str]]) -> tuple[int, int]:
    for row in rows:
        text = " ".join(cell for cell in row if cell)
        match = YEAR_MONTH_RE.search(text)
        if match:
            return int(match.group(1)), int(match.group(2))
    raise ValueError("无法识别账单年月。")


def find_transaction_header_index(rows: list[list[str]]) -> int:
    for idx, row in enumerate(rows):
        line = " ".join(row)
        if all(keyword in line for keyword in HEADER_KEYWORDS):
            return idx
    raise ValueError("未找到交易明细表头。")


def parse_eml(path: Path, root_for_rel: Path) -> list[Transaction]:
    msg = BytesParser(policy=policy.default).parsebytes(path.read_bytes())
    html_part = msg.get_body(preferencelist=("html", "plain"))
    if html_part is None:
        raise ValueError("邮件不包含可解析正文（html/plain）。")
    html = html_part.get_content()

    parser = TableTextExtractor()
    parser.feed(html)
    rows = parser.rows
    statement_year, statement_month = parse_statement_year_month(rows)
    header_idx = find_transaction_header_index(rows)

    transactions: list[Transaction] = []
    current_statement_category = "未分类"

    for row in rows[header_idx + 1 :]:
        non_empty = [c for c in row if c]
        if not non_empty:
            continue

        if len(non_empty) == 1 and non_empty[0] in STATEMENT_CATEGORIES:
            current_statement_category = non_empty[0]
            continue

        line = " ".join(non_empty)
        if "★" in line:
            break

        if len(row) < 7:
            continue

        country = row[-1].strip()
        original_amount = row[-2].strip()
        card_last4 = row[-3].strip()
        amount_text = row[-4].strip()
        description = row[-5].strip()
        post_raw = row[-6].strip()
        trans_raw = row[-7].strip()

        amount_rmb = parse_decimal(amount_text)
        if amount_rmb is None:
            continue

        transactions.append(
            Transaction(
                source_file=path.name,
                source_path=str(path.relative_to(root_for_rel)),
                statement_year=statement_year,
                statement_month=statement_month,
                statement_category=current_statement_category,
                trans_date=normalize_mmdd(trans_raw, statement_year, statement_month),
                post_date=normalize_mmdd(post_raw, statement_year, statement_month),
                description=description,
                amount_rmb=amount_rmb,
                card_last4=card_last4,
                original_amount=original_amount,
                country_area=country,
            )
        )

    return transactions


def normalize_merchant(text: str) -> str:
    merchant = re.sub(r"\s+", " ", text).strip()
    merchant = RATE_SUFFIX_RE.sub("", merchant)
    merchant = re.sub(r"^ULT-", "", merchant, flags=re.IGNORECASE)
    previous = None
    while previous != merchant:
        previous = merchant
        merchant = CHANNEL_PREFIX_RE.sub("", merchant).strip()
    return merchant


def ensure_reference_files(
    merchant_map_path: Path,
    category_rules_path: Path,
    analysis_exclusions_path: Path,
) -> None:
    merchant_map_path.parent.mkdir(parents=True, exist_ok=True)
    category_rules_path.parent.mkdir(parents=True, exist_ok=True)
    analysis_exclusions_path.parent.mkdir(parents=True, exist_ok=True)

    if not merchant_map_path.exists():
        with merchant_map_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["merchant_normalized", "expense_category", "confidence", "note"])
            writer.writerows(DEFAULT_MERCHANT_MAP)
    else:
        existing: set[str] = set()
        with merchant_map_path.open("r", newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                merchant = (row.get("merchant_normalized") or "").strip()
                if merchant:
                    existing.add(merchant)
        missing = [row for row in DEFAULT_MERCHANT_MAP if row[0] not in existing]
        if missing:
            with merchant_map_path.open("a", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerows(missing)

    if not category_rules_path.exists():
        with category_rules_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["priority", "match_type", "pattern", "expense_category", "confidence", "note"])
            writer.writerows(DEFAULT_CATEGORY_RULES)
    else:
        existing_rules: set[tuple[str, str, str, str]] = set()
        with category_rules_path.open("r", newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                key = (
                    (row.get("priority") or "").strip(),
                    (row.get("match_type") or "").strip().lower(),
                    (row.get("pattern") or "").strip(),
                    (row.get("expense_category") or "").strip(),
                )
                if all(key):
                    existing_rules.add(key)
        missing_rules = [
            row
            for row in DEFAULT_CATEGORY_RULES
            if (row[0], row[1], row[2], row[3]) not in existing_rules
        ]
        if missing_rules:
            with category_rules_path.open("a", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerows(missing_rules)

    if not analysis_exclusions_path.exists():
        with analysis_exclusions_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(
                [
                    "enabled",
                    "rule_name",
                    "merchant_contains",
                    "description_contains",
                    "expense_category",
                    "min_amount",
                    "max_amount",
                    "start_date",
                    "end_date",
                    "reason",
                ]
            )
            writer.writerows(DEFAULT_ANALYSIS_EXCLUSIONS)
    else:
        existing_rules: set[str] = set()
        with analysis_exclusions_path.open("r", newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = (row.get("rule_name") or "").strip()
                if name:
                    existing_rules.add(name)
        missing = [row for row in DEFAULT_ANALYSIS_EXCLUSIONS if row[1] not in existing_rules]
        if missing:
            with analysis_exclusions_path.open("a", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerows(missing)


def load_merchant_map(path: Path) -> dict[str, tuple[str, float, str]]:
    mapping: dict[str, tuple[str, float, str]] = {}
    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            merchant = (row.get("merchant_normalized") or "").strip()
            raw_category = (row.get("expense_category") or "").strip()
            raw_confidence = (row.get("confidence") or "").strip()
            raw_note = (row.get("note") or "").strip()
            if not merchant:
                continue

            # Compatibility mode:
            # If users paste rows from merchant_map_suggestions.csv directly,
            # expense_category can accidentally be "1/2/..." and note holds category text.
            category = raw_category
            confidence = 0.95
            note = raw_note
            if re.fullmatch(r"\d+(?:\.\d+)?", raw_category):
                candidate = raw_note
                if (
                    candidate
                    and not re.search(r"(支付宝-|财付通-|京东支付-|云闪付-|http|www\.)", candidate, re.IGNORECASE)
                    and len(candidate) <= 16
                ):
                    category = CATEGORY_ALIASES.get(candidate, candidate)
                    confidence = 0.90
                    note = "auto-fixed from pasted suggestions format"
                else:
                    continue
            else:
                if not category:
                    continue
                try:
                    parsed_conf = float(raw_confidence or "0.95")
                    confidence = parsed_conf if 0 <= parsed_conf <= 1 else 0.95
                except ValueError:
                    confidence = 0.95

            mapping[merchant] = (category, confidence, note)
    return mapping


def load_category_rules(path: Path) -> list[ClassificationRule]:
    rules: list[ClassificationRule] = []
    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                priority = int((row.get("priority") or "999").strip())
                confidence = float((row.get("confidence") or "0.70").strip())
            except ValueError:
                continue
            match_type = (row.get("match_type") or "contains").strip().lower()
            pattern = (row.get("pattern") or "").strip()
            category = (row.get("expense_category") or "").strip()
            note = (row.get("note") or "").strip()
            if not pattern or not category:
                continue
            rules.append(
                ClassificationRule(
                    priority=priority,
                    match_type=match_type,
                    pattern=pattern,
                    expense_category=category,
                    confidence=confidence,
                    note=note,
                )
            )
    return sorted(rules, key=lambda x: x.priority)


def parse_enabled_flag(raw: str) -> bool:
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def parse_optional_decimal(raw: str) -> Decimal | None:
    text = raw.strip()
    if not text:
        return None
    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def load_analysis_exclusion_rules(path: Path) -> list[AnalysisExclusionRule]:
    rules: list[AnalysisExclusionRule] = []
    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            enabled = parse_enabled_flag((row.get("enabled") or "").strip())
            rule = AnalysisExclusionRule(
                enabled=enabled,
                rule_name=(row.get("rule_name") or "").strip(),
                merchant_contains=(row.get("merchant_contains") or "").strip(),
                description_contains=(row.get("description_contains") or "").strip(),
                expense_category=(row.get("expense_category") or "").strip(),
                min_amount=parse_optional_decimal(row.get("min_amount") or ""),
                max_amount=parse_optional_decimal(row.get("max_amount") or ""),
                start_date=(row.get("start_date") or "").strip(),
                end_date=(row.get("end_date") or "").strip(),
                reason=(row.get("reason") or "").strip() or "排除分析",
            )
            if not rule.enabled:
                continue
            rules.append(rule)
    return rules


def in_date_range(post_date: str, start_date: str, end_date: str) -> bool:
    if not post_date:
        return False
    if start_date and post_date < start_date:
        return False
    if end_date and post_date > end_date:
        return False
    return True


def matches_exclusion_rule(rec: ClassifiedTransaction, rule: AnalysisExclusionRule) -> bool:
    if rec.txn.statement_category != "消费":
        return False
    if rule.expense_category and rec.expense_category != rule.expense_category:
        return False
    if rule.merchant_contains and rule.merchant_contains.lower() not in rec.merchant_normalized.lower():
        return False
    if rule.description_contains and rule.description_contains.lower() not in rec.txn.description.lower():
        return False
    if rule.min_amount is not None and rec.txn.amount_rmb < rule.min_amount:
        return False
    if rule.max_amount is not None and rec.txn.amount_rmb > rule.max_amount:
        return False
    if (rule.start_date or rule.end_date) and not in_date_range(rec.txn.post_date, rule.start_date, rule.end_date):
        return False
    return True


def apply_analysis_exclusions(
    records: list[ClassifiedTransaction],
    rules: list[AnalysisExclusionRule],
) -> list[ClassifiedTransaction]:
    if not rules:
        return records
    for rec in records:
        rec.excluded_in_analysis = 0
        rec.exclude_reason = ""
        for rule in rules:
            if matches_exclusion_rule(rec, rule):
                rec.excluded_in_analysis = 1
                rec.exclude_reason = f"{rule.rule_name or 'custom'}: {rule.reason}"
                break
    return records


def match_rule(rule: ClassificationRule, merchant: str) -> bool:
    target = merchant.lower()
    if rule.match_type == "exact":
        return target == rule.pattern.lower()
    if rule.match_type == "prefix":
        return target.startswith(rule.pattern.lower())
    if rule.match_type == "regex":
        return re.search(rule.pattern, merchant, flags=re.IGNORECASE) is not None
    if rule.match_type == "contains":
        parts = [p.strip() for p in rule.pattern.split("|") if p.strip()]
        return any(part.lower() in target for part in parts)
    return False


def classify_transactions(
    records: list[Transaction],
    merchant_map: dict[str, tuple[str, float, str]],
    rules: list[ClassificationRule],
    review_threshold: float,
) -> list[ClassifiedTransaction]:
    classified: list[ClassifiedTransaction] = []
    for txn in records:
        merchant = normalize_merchant(txn.description)
        if txn.statement_category != "消费":
            classified.append(
                ClassifiedTransaction(
                    txn=txn,
                    merchant_normalized=merchant,
                    expense_category=f"非消费/{txn.statement_category}",
                    classify_source="statement_category",
                    confidence=1.0,
                    needs_review=0,
                    excluded_in_analysis=0,
                    exclude_reason="",
                )
            )
            continue

        if merchant in merchant_map:
            category, confidence, _ = merchant_map[merchant]
            classified.append(
                ClassifiedTransaction(
                    txn=txn,
                    merchant_normalized=merchant,
                    expense_category=category,
                    classify_source="merchant_map",
                    confidence=confidence,
                    needs_review=1 if confidence < review_threshold else 0,
                    excluded_in_analysis=0,
                    exclude_reason="",
                )
            )
            continue

        matched = False
        for rule in rules:
            if match_rule(rule, merchant):
                classified.append(
                    ClassifiedTransaction(
                        txn=txn,
                        merchant_normalized=merchant,
                        expense_category=rule.expense_category,
                        classify_source=f"rule:{rule.match_type}:{rule.pattern}",
                        confidence=rule.confidence,
                        needs_review=1 if rule.confidence < review_threshold else 0,
                        excluded_in_analysis=0,
                        exclude_reason="",
                    )
                )
                matched = True
                break

        if matched:
            continue

        classified.append(
            ClassifiedTransaction(
                txn=txn,
                merchant_normalized=merchant,
                expense_category="待分类",
                classify_source="unmatched",
                confidence=0.0,
                needs_review=1,
                excluded_in_analysis=0,
                exclude_reason="",
            )
        )
    return classified


def read_eml_files(input_path: Path, pattern: str, recursive: bool) -> list[Path]:
    if input_path.is_file():
        return [input_path]
    if recursive:
        return sorted(p for p in input_path.rglob(pattern) if p.is_file())
    return sorted(p for p in input_path.glob(pattern) if p.is_file())


def write_transactions_csv(path: Path, records: list[Transaction]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "source_file",
                "source_path",
                "statement_year",
                "statement_month",
                "statement_category",
                "trans_date",
                "post_date",
                "description",
                "amount_rmb",
                "card_last4",
                "original_amount",
                "country_area",
            ]
        )
        for rec in records:
            writer.writerow(rec.as_csv_row())


def write_summary_by_statement(path: Path, records: list[Transaction]) -> None:
    rows: dict[tuple[str, int, int], dict[str, Decimal]] = {}
    for rec in records:
        key = (rec.source_path, rec.statement_year, rec.statement_month)
        bucket = rows.setdefault(
            key,
            {
                "count": Decimal("0"),
                "consume_total": Decimal("0"),
                "repayment_total": Decimal("0"),
                "installment_total": Decimal("0"),
                "all_amount_total": Decimal("0"),
            },
        )
        bucket["count"] += Decimal("1")
        bucket["all_amount_total"] += rec.amount_rmb
        if rec.statement_category == "消费":
            bucket["consume_total"] += rec.amount_rmb
        elif rec.statement_category == "还款":
            bucket["repayment_total"] += rec.amount_rmb
        elif rec.statement_category == "分期":
            bucket["installment_total"] += rec.amount_rmb

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "source_path",
                "statement_year",
                "statement_month",
                "txn_count",
                "consume_total",
                "repayment_total",
                "installment_total",
                "all_amount_total",
            ]
        )
        for key in sorted(rows.keys()):
            source_path, year, month = key
            stat = rows[key]
            writer.writerow(
                [
                    source_path,
                    year,
                    month,
                    str(int(stat["count"])),
                    format_decimal(stat["consume_total"]),
                    format_decimal(stat["repayment_total"]),
                    format_decimal(stat["installment_total"]),
                    format_decimal(stat["all_amount_total"]),
                ]
            )


def write_summary_by_month(path: Path, records: list[Transaction]) -> None:
    rows: dict[tuple[int, int], dict[str, Decimal]] = {}
    for rec in records:
        key = (rec.statement_year, rec.statement_month)
        bucket = rows.setdefault(
            key,
            {
                "consume_total": Decimal("0"),
                "txn_count": Decimal("0"),
                "consume_count": Decimal("0"),
            },
        )
        bucket["txn_count"] += Decimal("1")
        if rec.statement_category == "消费":
            bucket["consume_total"] += rec.amount_rmb
            bucket["consume_count"] += Decimal("1")

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["statement_year", "statement_month", "txn_count", "consume_count", "consume_total"])
        for key in sorted(rows.keys()):
            year, month = key
            stat = rows[key]
            writer.writerow(
                [
                    year,
                    month,
                    str(int(stat["txn_count"])),
                    str(int(stat["consume_count"])),
                    format_decimal(stat["consume_total"]),
                ]
            )


def write_summary_by_month_analysis(path: Path, records: list[ClassifiedTransaction]) -> None:
    rows: dict[tuple[int, int], dict[str, Decimal]] = {}
    for rec in records:
        key = (rec.txn.statement_year, rec.txn.statement_month)
        bucket = rows.setdefault(
            key,
            {
                "raw_consume_count": Decimal("0"),
                "raw_consume_total": Decimal("0"),
                "excluded_count": Decimal("0"),
                "excluded_total": Decimal("0"),
                "included_count": Decimal("0"),
                "included_total": Decimal("0"),
            },
        )
        if rec.txn.statement_category != "消费":
            continue
        bucket["raw_consume_count"] += Decimal("1")
        bucket["raw_consume_total"] += rec.txn.amount_rmb
        if rec.excluded_in_analysis == 1:
            bucket["excluded_count"] += Decimal("1")
            bucket["excluded_total"] += rec.txn.amount_rmb
        else:
            bucket["included_count"] += Decimal("1")
            bucket["included_total"] += rec.txn.amount_rmb

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "statement_year",
                "statement_month",
                "raw_consume_count",
                "raw_consume_total",
                "excluded_count",
                "excluded_total",
                "included_count",
                "included_total",
            ]
        )
        for key in sorted(rows.keys()):
            year, month = key
            stat = rows[key]
            writer.writerow(
                [
                    year,
                    month,
                    str(int(stat["raw_consume_count"])),
                    format_decimal(stat["raw_consume_total"]),
                    str(int(stat["excluded_count"])),
                    format_decimal(stat["excluded_total"]),
                    str(int(stat["included_count"])),
                    format_decimal(stat["included_total"]),
                ]
            )


def write_summary_json(path: Path, records: list[Transaction]) -> None:
    by_category: dict[str, Decimal] = {}
    for rec in records:
        by_category[rec.statement_category] = by_category.get(rec.statement_category, Decimal("0")) + rec.amount_rmb

    payload = {
        "files_count": len({rec.source_path for rec in records}),
        "transactions_count": len(records),
        "consume_total": format_decimal(by_category.get("消费", Decimal("0"))),
        "by_statement_category": {k: format_decimal(v) for k, v in sorted(by_category.items())},
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_classified_transactions_csv(path: Path, records: list[ClassifiedTransaction]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "source_file",
                "source_path",
                "statement_year",
                "statement_month",
                "statement_category",
                "trans_date",
                "post_date",
                "description",
                "merchant_normalized",
                "amount_rmb",
                "card_last4",
                "original_amount",
                "country_area",
                "expense_category",
                "classify_source",
                "confidence",
                "needs_review",
                "excluded_in_analysis",
                "exclude_reason",
            ]
        )
        for rec in records:
            writer.writerow(rec.as_csv_row())


def write_summary_by_expense_category(path: Path, records: list[ClassifiedTransaction]) -> None:
    rows: dict[str, dict[str, Decimal]] = {}
    for rec in records:
        if rec.txn.statement_category != "消费":
            continue
        if rec.excluded_in_analysis == 1:
            continue
        bucket = rows.setdefault(
            rec.expense_category,
            {"count": Decimal("0"), "amount": Decimal("0"), "review_count": Decimal("0")},
        )
        bucket["count"] += Decimal("1")
        bucket["amount"] += rec.txn.amount_rmb
        bucket["review_count"] += Decimal(rec.needs_review)

    sorted_items = sorted(rows.items(), key=lambda x: x[1]["amount"], reverse=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["expense_category", "consume_count", "consume_total", "review_count"])
        for category, stat in sorted_items:
            writer.writerow(
                [
                    category,
                    str(int(stat["count"])),
                    format_decimal(stat["amount"]),
                    str(int(stat["review_count"])),
                ]
            )


def write_summary_by_merchant(path: Path, records: list[ClassifiedTransaction]) -> None:
    rows: dict[tuple[str, str], dict[str, Decimal]] = {}
    for rec in records:
        if rec.txn.statement_category != "消费":
            continue
        if rec.excluded_in_analysis == 1:
            continue
        key = (rec.merchant_normalized, rec.expense_category)
        bucket = rows.setdefault(
            key,
            {"count": Decimal("0"), "amount": Decimal("0"), "review_count": Decimal("0")},
        )
        bucket["count"] += Decimal("1")
        bucket["amount"] += rec.txn.amount_rmb
        bucket["review_count"] += Decimal(rec.needs_review)

    sorted_items = sorted(rows.items(), key=lambda x: x[1]["amount"], reverse=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "merchant_normalized",
                "expense_category",
                "consume_count",
                "consume_total",
                "review_count",
            ]
        )
        for (merchant, category), stat in sorted_items:
            writer.writerow(
                [
                    merchant,
                    category,
                    str(int(stat["count"])),
                    format_decimal(stat["amount"]),
                    str(int(stat["review_count"])),
                ]
            )


def write_needs_review_csv(path: Path, records: list[ClassifiedTransaction]) -> None:
    rows = [
        rec
        for rec in records
        if rec.txn.statement_category == "消费" and rec.needs_review == 1 and rec.excluded_in_analysis == 0
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "source_path",
                "post_date",
                "description",
                "merchant_normalized",
                "amount_rmb",
                "expense_category",
                "classify_source",
                "confidence",
            ]
        )
        for rec in rows:
            writer.writerow(
                [
                    rec.txn.source_path,
                    rec.txn.post_date,
                    rec.txn.description,
                    rec.merchant_normalized,
                    format_decimal(rec.txn.amount_rmb),
                    rec.expense_category,
                    rec.classify_source,
                    f"{rec.confidence:.2f}",
                ]
            )


def write_merchant_suggestions_csv(path: Path, records: list[ClassifiedTransaction]) -> None:
    rows: dict[str, dict[str, Decimal | str]] = {}
    for rec in records:
        if rec.txn.statement_category != "消费":
            continue
        if rec.excluded_in_analysis == 1:
            continue
        if rec.classify_source != "unmatched":
            continue
        key = rec.merchant_normalized or rec.txn.description
        bucket = rows.setdefault(
            key,
            {
                "count": Decimal("0"),
                "amount": Decimal("0"),
                "sample": rec.txn.description,
            },
        )
        bucket["count"] += Decimal("1")
        bucket["amount"] += rec.txn.amount_rmb

    sorted_items = sorted(rows.items(), key=lambda x: x[1]["amount"], reverse=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "merchant_normalized",
                "consume_count",
                "consume_total",
                "sample_description",
                "suggested_expense_category",
            ]
        )
        for merchant, stat in sorted_items:
            writer.writerow(
                [
                    merchant,
                    str(int(stat["count"])),
                    format_decimal(stat["amount"]),
                    str(stat["sample"]),
                    "",
                ]
            )


def write_parse_errors_csv(path: Path, errors: list[tuple[Path, Exception]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["source_path", "error"])
        for src, err in errors:
            writer.writerow([str(src), str(err)])


def decimal_to_float(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01")))


def build_consumption_report_payload(
    classified: list[ClassifiedTransaction],
    eml_count: int,
    failed_count: int,
) -> dict:
    all_consume_rows = [r for r in classified if r.txn.statement_category == "消费"]
    excluded_rows = [r for r in all_consume_rows if r.excluded_in_analysis == 1]
    consume_rows = [r for r in all_consume_rows if r.excluded_in_analysis == 0]
    consume_total = sum((r.txn.amount_rmb for r in consume_rows), Decimal("0"))
    review_count = sum((r.needs_review for r in consume_rows))
    excluded_total = sum((r.txn.amount_rmb for r in excluded_rows), Decimal("0"))

    by_expense: dict[str, dict[str, Decimal | int]] = {}
    by_month: dict[str, dict[str, Decimal | int]] = {}
    by_merchant: dict[str, dict[str, Decimal | int | str]] = {}
    transactions: list[dict] = []

    for rec in consume_rows:
        month = f"{rec.txn.statement_year:04d}-{rec.txn.statement_month:02d}"
        exp_bucket = by_expense.setdefault(
            rec.expense_category,
            {"amount": Decimal("0"), "count": 0, "review_count": 0},
        )
        exp_bucket["amount"] = exp_bucket["amount"] + rec.txn.amount_rmb
        exp_bucket["count"] = int(exp_bucket["count"]) + 1
        exp_bucket["review_count"] = int(exp_bucket["review_count"]) + rec.needs_review

        month_bucket = by_month.setdefault(
            month,
            {"amount": Decimal("0"), "count": 0, "review_count": 0},
        )
        month_bucket["amount"] = month_bucket["amount"] + rec.txn.amount_rmb
        month_bucket["count"] = int(month_bucket["count"]) + 1
        month_bucket["review_count"] = int(month_bucket["review_count"]) + rec.needs_review

        merchant = rec.merchant_normalized or rec.txn.description
        merchant_bucket = by_merchant.setdefault(
            merchant,
            {"amount": Decimal("0"), "count": 0, "category": rec.expense_category},
        )
        merchant_bucket["amount"] = merchant_bucket["amount"] + rec.txn.amount_rmb
        merchant_bucket["count"] = int(merchant_bucket["count"]) + 1

        tx_date = rec.txn.post_date or rec.txn.trans_date or f"{month}-01"
        transactions.append(
            {
                "month": month,
                "date": tx_date,
                "merchant": merchant,
                "description": rec.txn.description,
                "category": rec.expense_category,
                "amount": decimal_to_float(rec.txn.amount_rmb),
                "needs_review": bool(rec.needs_review),
                "confidence": round(rec.confidence, 2),
                "source_path": rec.txn.source_path,
            }
        )

    categories = [
        {
            "category": cat,
            "amount": decimal_to_float(stat["amount"]),  # type: ignore[index]
            "count": int(stat["count"]),  # type: ignore[index]
            "review_count": int(stat["review_count"]),  # type: ignore[index]
        }
        for cat, stat in sorted(
            by_expense.items(),
            key=lambda x: x[1]["amount"],  # type: ignore[index]
            reverse=True,
        )
    ]

    months = [
        {
            "month": month,
            "amount": decimal_to_float(stat["amount"]),  # type: ignore[index]
            "count": int(stat["count"]),  # type: ignore[index]
            "review_count": int(stat["review_count"]),  # type: ignore[index]
        }
        for month, stat in sorted(by_month.items(), key=lambda x: x[0])
    ]

    merchants = [
        {
            "merchant": merchant,
            "amount": decimal_to_float(stat["amount"]),  # type: ignore[index]
            "count": int(stat["count"]),  # type: ignore[index]
            "category": str(stat["category"]),  # type: ignore[index]
        }
        for merchant, stat in sorted(
            by_merchant.items(),
            key=lambda x: x[1]["amount"],  # type: ignore[index]
            reverse=True,
        )[:80]
    ]

    transactions.sort(key=lambda x: (x["date"], x["amount"]), reverse=True)
    top_expense_categories = [
        {"expense_category": item["category"], "amount": f"{item['amount']:.2f}"}
        for item in categories[:10]
    ]

    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "input_files_count": eml_count,
        "failed_files_count": failed_count,
        "consumption_count": len(consume_rows),
        "consumption_total": format_decimal(consume_total),
        "consumption_total_value": decimal_to_float(consume_total),
        "needs_review_count": int(review_count),
        "needs_review_ratio": round(review_count / len(consume_rows), 4) if consume_rows else 0,
        "excluded_consumption_count": len(excluded_rows),
        "excluded_consumption_total": format_decimal(excluded_total),
        "excluded_consumption_total_value": decimal_to_float(excluded_total),
        "raw_consumption_count": len(all_consume_rows),
        "raw_consumption_total": format_decimal(consume_total + excluded_total),
        "raw_consumption_total_value": decimal_to_float(consume_total + excluded_total),
        "top_expense_categories": top_expense_categories,
        "categories": categories,
        "months": months,
        "merchants": merchants,
        "transactions": transactions,
    }


def write_report_json(
    path: Path,
    classified: list[ClassifiedTransaction],
    eml_count: int,
    failed_count: int,
) -> None:
    payload = build_consumption_report_payload(classified, eml_count, failed_count)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_html_report(
    path: Path,
    classified: list[ClassifiedTransaction],
    eml_count: int,
    failed_count: int,
) -> None:
    payload = build_consumption_report_payload(classified, eml_count, failed_count)
    data_json = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    if not REPORT_CSS_SOURCE.exists():
        raise FileNotFoundError(f"缺少报告样式文件：{REPORT_CSS_SOURCE}")
    template = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>年度消费分析报告</title>
  <link rel="stylesheet" href="consumption_report.css">
</head>
<body>
  <main class="shell">
    <section class="hero card">
      <div>
        <span class="badge">消费分析引擎 · 本地生成</span>
        <h1>信用卡年度支出报告</h1>
        <div class="muted" id="heroSubtitle">正在加载报告数据...</div>
      </div>
      <div class="hero-right">
        <button id="privacyToggle" class="privacy-toggle" type="button" aria-pressed="false" title="点击隐藏金额">
          <svg class="eye-icon icon-on" viewBox="0 0 24 24"><path d="M2 12s3.7-6 10-6 10 6 10 6-3.7 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3.2"/></svg>
          <svg class="eye-icon icon-off" viewBox="0 0 24 24"><path d="M2 12s3.7-6 10-6c2.2 0 4.1.7 5.7 1.6M22 12s-3.7 6-10 6c-2.2 0-4.1-.7-5.7-1.6"/><path d="M3 3l18 18"/></svg>
          <span id="privacyToggleLabel">隐藏金额</span>
        </button>
        <div class="links">
          <a class="link" href="../category/summary_by_expense_category.csv">分类汇总 CSV</a>
          <a class="link" href="../category/needs_review.csv">待确认清单 CSV</a>
          <a class="link" href="../category/summary_by_merchant.csv">商户汇总 CSV</a>
        </div>
      </div>
    </section>

    <section class="controls card">
      <div class="control">
        <label for="monthSelect">账单月份</label>
        <select id="monthSelect"></select>
      </div>
      <div class="control">
        <label for="keywordInput">关键词（商户/摘要）</label>
        <input id="keywordInput" type="text" placeholder="例如：肯德基 / 盒马 / 停车">
      </div>
      <label class="control toggle">
        <input id="includePending" type="checkbox">
        显示待确认交易
      </label>
    </section>

    <section class="panel card">
      <h2>已选筛选</h2>
      <div id="filterPills" class="filter-pills"></div>
    </section>

    <section class="panel card">
      <div class="section-head">
        <h2>消费分类（可点击筛选）</h2>
        <div class="filter-actions">
          <button id="categorySelectAll" class="mini-btn" type="button">全选</button>
          <button id="categoryClear" class="mini-btn" type="button">清空</button>
        </div>
      </div>
      <div id="categoryCloud" class="merchant-cloud"></div>
    </section>

    <section class="metrics">
      <article class="metric card">
        <div class="metric-head">
          <svg viewBox="0 0 24 24"><path d="M3 12h18M3 7h18M3 17h18"/></svg>
          筛选后支出
        </div>
        <div id="metricTotal" class="metric-value">¥0.00</div>
        <div class="metric-sub" id="metricTotalSub">0 笔交易</div>
      </article>
      <article class="metric card">
        <div class="metric-head">
          <svg viewBox="0 0 24 24"><path d="M4 19h16M7 15l3-3 3 2 4-5"/></svg>
          单笔均额
        </div>
        <div id="metricAvg" class="metric-value">¥0.00</div>
        <div class="metric-sub">筛选范围内平均值</div>
      </article>
      <article class="metric card">
        <div class="metric-head">
          <svg viewBox="0 0 24 24"><path d="M12 3l8 4v5c0 5-3.4 8-8 9-4.6-1-8-4-8-9V7z"/></svg>
          待确认交易
        </div>
        <div id="metricReview" class="metric-value">0</div>
        <div class="metric-sub" id="metricReviewSub">0.00%</div>
      </article>
      <article class="metric card">
        <div class="metric-head">
          <svg viewBox="0 0 24 24"><path d="M5 5h14v14H5zM9 9h6v6H9z"/></svg>
          覆盖账单
        </div>
        <div id="metricFiles" class="metric-value">0</div>
        <div class="metric-sub" id="metricFilesSub">解析失败 0</div>
      </article>
    </section>

    <section class="grid-two">
      <article class="panel card">
        <h2>月度支出趋势</h2>
        <svg id="trendChart" viewBox="0 0 820 260" preserveAspectRatio="none"></svg>
      </article>
      <article class="panel card">
        <h2>分类占比结构</h2>
        <div class="donut-wrap">
          <div id="donut" class="donut"></div>
          <div id="donutLegend" class="legend"></div>
        </div>
      </article>
    </section>

    <section class="panel card">
      <h2>分类金额排行 <span class="muted" id="resultHint"></span></h2>
      <div id="categoryBars" class="bars"></div>
    </section>

    <section class="panel card">
      <h2>高频商户（可点击筛选）</h2>
      <div id="merchantCloud" class="merchant-cloud"></div>
    </section>

    <section class="panel card">
      <h2>交易明细（点击列头可正序/倒序）</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th><button class="th-sort" data-sort="date">日期 <span class="arrow"></span></button></th>
              <th><button class="th-sort" data-sort="category">分类 <span class="arrow"></span></button></th>
              <th><button class="th-sort" data-sort="merchant">商户 <span class="arrow"></span></button></th>
              <th><button class="th-sort" data-sort="description">摘要 <span class="arrow"></span></button></th>
              <th><button class="th-sort" data-sort="source_path">来源 <span class="arrow"></span></button></th>
              <th><button class="th-sort" data-sort="confidence">置信度 <span class="arrow"></span></button></th>
              <th class="num"><button class="th-sort" data-sort="amount">金额 <span class="arrow"></span></button></th>
            </tr>
          </thead>
          <tbody id="txnBody"></tbody>
        </table>
      </div>
      <div class="foot">
        <span id="footInfo">数据加载中</span>
        <span id="footTime">生成时间：-</span>
      </div>
    </section>
  </main>

  <script>
    const REPORT_DATA = __DATA_JSON__;
    const COLORS = ["#2f8f63","#4aa87c","#77b77b","#9ec36f","#d1a758","#cf8752","#7f9a70","#87a8b4","#7c8dc7","#ab8dbb","#c27f91","#8f9a9a"];
    const state = {
      month: "ALL",
      selectedCategories: new Set(),
      selectedMerchants: new Set(),
      keyword: "",
      includePending: false,
      hideAmounts: false,
      sortField: "date",
      sortDir: "desc",
    };

    const monthSelect = document.getElementById("monthSelect");
    const keywordInput = document.getElementById("keywordInput");
    const includePending = document.getElementById("includePending");
    const filterPills = document.getElementById("filterPills");
    const categoryCloud = document.getElementById("categoryCloud");
    const categorySelectAll = document.getElementById("categorySelectAll");
    const categoryClear = document.getElementById("categoryClear");
    const privacyToggle = document.getElementById("privacyToggle");
    const privacyToggleLabel = document.getElementById("privacyToggleLabel");

    function fmtMoney(value) {
      if (state.hideAmounts) return "***";
      return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value || 0);
    }
    function fmtMoneyCompact(value) {
      if (state.hideAmounts) return "***";
      const abs = Math.abs(value || 0);
      if (abs >= 100000000) return `¥${(value / 100000000).toFixed(2)}亿`;
      if (abs >= 10000) return `¥${(value / 10000).toFixed(1)}万`;
      return `¥${Math.round(value).toLocaleString("zh-CN")}`;
    }
    function fmtPercent(value) {
      return `${(value * 100).toFixed(2)}%`;
    }
    function text(el, value) {
      const node = document.getElementById(el);
      if (node) node.textContent = value;
    }

    function initSelectors() {
      const monthOptions = [{ value: "ALL", label: "全部月份" }].concat(
        REPORT_DATA.months.map((x) => ({ value: x.month, label: x.month }))
      );
      monthSelect.innerHTML = monthOptions.map((x) => `<option value="${x.value}">${x.label}</option>`).join("");
      monthSelect.value = state.month;
    }

    function toggleSetValue(setObj, value) {
      if (!value) return;
      if (setObj.has(value)) setObj.delete(value);
      else setObj.add(value);
    }

    function getFilteredRows(ignoreMerchant = false) {
      const keyword = state.keyword.trim().toLowerCase();
      return REPORT_DATA.transactions.filter((row) => {
        if (state.month !== "ALL" && row.month !== state.month) return false;
        if (state.selectedCategories.size > 0 && !state.selectedCategories.has(row.category)) return false;
        if (!ignoreMerchant && state.selectedMerchants.size > 0 && !state.selectedMerchants.has(row.merchant)) return false;
        if (!state.includePending && row.needs_review) return false;
        if (!keyword) return true;
        const haystack = `${row.merchant} ${row.description}`.toLowerCase();
        return haystack.includes(keyword);
      });
    }

    function aggregateByCategory(rows) {
      const m = new Map();
      for (const row of rows) {
        if (!m.has(row.category)) m.set(row.category, { category: row.category, amount: 0, count: 0, review: 0 });
        const item = m.get(row.category);
        item.amount += row.amount;
        item.count += 1;
        item.review += row.needs_review ? 1 : 0;
      }
      return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
    }

    function aggregateByMonth(rows) {
      const base = new Map(REPORT_DATA.months.map((m) => [m.month, { month: m.month, amount: 0, count: 0 }]));
      for (const row of rows) {
        if (!base.has(row.month)) base.set(row.month, { month: row.month, amount: 0, count: 0 });
        const item = base.get(row.month);
        item.amount += row.amount;
        item.count += 1;
      }
      return Array.from(base.values()).sort((a, b) => a.month.localeCompare(b.month));
    }

    function aggregateByMerchant(rows) {
      const m = new Map();
      for (const row of rows) {
        if (!m.has(row.merchant)) m.set(row.merchant, { merchant: row.merchant, amount: 0, count: 0, category: row.category });
        const item = m.get(row.merchant);
        item.amount += row.amount;
        item.count += 1;
      }
      return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
    }

    function getSortValue(row, field) {
      if (field === "amount") return row.amount || 0;
      if (field === "confidence") return row.confidence || 0;
      if (field === "date") return row.date || "";
      if (field === "category") return row.category || "";
      if (field === "merchant") return row.merchant || "";
      if (field === "description") return row.description || "";
      if (field === "source_path") return row.source_path || "";
      return row.date || "";
    }

    function sortRows(rows) {
      const dir = state.sortDir === "asc" ? 1 : -1;
      const field = state.sortField;
      const sorted = [...rows].sort((a, b) => {
        const av = getSortValue(a, field);
        const bv = getSortValue(b, field);
        if (typeof av === "number" && typeof bv === "number") {
          if (av !== bv) return (av - bv) * dir;
        } else {
          const cmp = String(av).localeCompare(String(bv), "zh-CN", { numeric: true, sensitivity: "base" });
          if (cmp !== 0) return cmp * dir;
        }
        const dateCmp = String(b.date || "").localeCompare(String(a.date || ""));
        if (dateCmp !== 0) return dateCmp;
        return (b.amount || 0) - (a.amount || 0);
      });
      return sorted;
    }

    function updateSortHeaders() {
      document.querySelectorAll(".th-sort").forEach((btn) => {
        const field = btn.getAttribute("data-sort");
        const arrow = btn.querySelector(".arrow");
        const active = field === state.sortField;
        btn.classList.toggle("active", active);
        if (!arrow) return;
        arrow.textContent = active ? (state.sortDir === "asc" ? "▲" : "▼") : "↕";
      });
    }

    function renderMetrics(rows) {
      const total = rows.reduce((s, x) => s + x.amount, 0);
      const count = rows.length;
      const avg = count ? total / count : 0;
      const review = rows.filter((x) => x.needs_review).length;

      text("metricTotal", fmtMoney(total));
      text("metricTotalSub", `${count.toLocaleString()} 笔交易`);
      text("metricAvg", fmtMoney(avg));
      text("metricReview", review.toLocaleString());
      text("metricReviewSub", count ? fmtPercent(review / count) : "0.00%");
      text("metricFiles", REPORT_DATA.input_files_count.toLocaleString());
      text("metricFilesSub", `解析失败 ${REPORT_DATA.failed_files_count}`);
    }

    function renderTrendChart(rows) {
      const svg = document.getElementById("trendChart");
      const data = aggregateByMonth(rows);
      const points = data.filter((x) => x.count > 0);
      if (!points.length) {
        svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="#6f7773" font-size="14">当前筛选无趋势数据</text>`;
        return;
      }
      const w = 820, h = 260, px = 38, py = 34;
      const max = Math.max(...points.map((p) => p.amount), 1);
      const spanX = w - px * 2;
      const spanY = h - py * 2;
      const x = (i) => px + (points.length === 1 ? spanX / 2 : (i * spanX) / (points.length - 1));
      const y = (v) => py + spanY - (v / max) * spanY;

      const grid = [0, 0.25, 0.5, 0.75, 1].map((r) => {
        const gy = y(max * r);
        return `<line x1="${px}" y1="${gy}" x2="${w - px}" y2="${gy}" stroke="#e8eeea" stroke-width="1"/>`;
      }).join("");

      const polyline = points.map((p, i) => `${x(i)},${y(p.amount)}`).join(" ");
      const area = `${px},${h - py} ${polyline} ${x(points.length - 1)},${h - py}`;
      const dots = points.map((p, i) => {
        const cx = x(i), cy = y(p.amount);
        return `<g><circle cx="${cx}" cy="${cy}" r="3.6" fill="#2f8f63"/><title>${p.month} ${fmtMoney(p.amount)}</title></g>`;
      }).join("");
      const valueLabels = points.map((p, i) => {
        const lx = x(i);
        const ly = Math.max(py - 6, y(p.amount) - (i % 2 === 0 ? 10 : 22));
        return `<text x="${lx}" y="${ly}" text-anchor="middle" fill="#2f5f49" font-size="10" font-weight="700" style="paint-order:stroke;stroke:#f8fbf9;stroke-width:3;stroke-linejoin:round">${fmtMoneyCompact(p.amount)}</text>`;
      }).join("");
      const labels = points.map((p, i) => {
        const lx = x(i);
        const show = points.length <= 8 || i % Math.ceil(points.length / 6) === 0 || i === points.length - 1;
        if (!show) return "";
        return `<text x="${lx}" y="${h - 6}" text-anchor="middle" fill="#6b746f" font-size="11">${p.month.slice(5)}</text>`;
      }).join("");

      svg.innerHTML = `
        ${grid}
        <polygon points="${area}" fill="rgba(47,143,99,0.14)"></polygon>
        <polyline points="${polyline}" fill="none" stroke="#2f8f63" stroke-width="2.2" stroke-linecap="round"></polyline>
        ${valueLabels}
        ${dots}
        ${labels}
      `;
    }

    function renderDonut(rows) {
      const donut = document.getElementById("donut");
      const legend = document.getElementById("donutLegend");
      const data = aggregateByCategory(rows).slice(0, 10);
      const total = data.reduce((s, x) => s + x.amount, 0);
      if (!data.length || total <= 0) {
        donut.style.background = "#edf1ee";
        legend.innerHTML = `<div class="empty">暂无分类数据</div>`;
        return;
      }

      let cursor = 0;
      const segments = data.map((item, i) => {
        const pct = item.amount / total;
        const start = cursor * 100;
        cursor += pct;
        const end = cursor * 100;
        const color = COLORS[i % COLORS.length];
        return { ...item, color, start, end, pct };
      });
      donut.style.background = `conic-gradient(${segments.map((s) => `${s.color} ${s.start}% ${s.end}%`).join(",")})`;

      legend.innerHTML = segments.map((s) => `
        <div class="legend-item" data-category="${s.category}">
          <span class="swatch" style="background:${s.color}"></span>
          <span class="legend-title">${s.category}</span>
          <span class="legend-value">${fmtMoney(s.amount)} · ${(s.pct * 100).toFixed(1)}%</span>
        </div>
      `).join("");

      legend.querySelectorAll(".legend-item").forEach((node) => {
        node.addEventListener("click", () => {
          const category = node.getAttribute("data-category");
          toggleSetValue(state.selectedCategories, category);
          render();
        });
      });
    }

    function renderCategoryBars(rows) {
      const holder = document.getElementById("categoryBars");
      const data = aggregateByCategory(rows).slice(0, 9);
      if (!data.length) {
        holder.innerHTML = `<div class="empty">当前筛选无分类排行</div>`;
        return;
      }
      const max = Math.max(...data.map((x) => x.amount), 1);
      holder.innerHTML = data.map((item) => `
        <div class="bar-row">
          <div class="bar-label">${item.category}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${(item.amount / max) * 100}%"></div></div>
          <div class="bar-value">${fmtMoney(item.amount)}</div>
        </div>
      `).join("");
    }

    function renderFilterPills() {
      if (!filterPills) return;
      const items = [];
      if (state.month !== "ALL") items.push({ type: "month", value: state.month, label: `月份: ${state.month}` });
      state.selectedCategories.forEach((v) => items.push({ type: "category", value: v, label: `分类: ${v}` }));
      state.selectedMerchants.forEach((v) => items.push({ type: "merchant", value: v, label: `商户: ${v}` }));
      if (state.keyword.trim()) items.push({ type: "keyword", value: "keyword", label: `关键词: ${state.keyword.trim()}` });
      if (state.includePending) items.push({ type: "pending", value: "pending", label: "显示待确认" });

      if (items.length === 0) {
        filterPills.innerHTML = `<span class="pill-empty">当前无筛选，展示默认分析结果。</span>`;
        return;
      }

      filterPills.innerHTML = `
        ${items
          .map(
            (x) => `<span class="pill" data-type="${x.type}" data-value="${x.value}">
              <span class="txt">${x.label}</span>
              <button type="button" title="移除筛选">×</button>
            </span>`
          )
          .join("")}
        <button class="pill-clear-all" type="button" data-action="clear-all">清空全部筛选 ×</button>
      `;

      filterPills.querySelectorAll(".pill button").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const pill = e.currentTarget.closest(".pill");
          if (!pill) return;
          const type = pill.getAttribute("data-type");
          const value = pill.getAttribute("data-value");
          if (type === "month") {
            state.month = "ALL";
            monthSelect.value = "ALL";
          }
          if (type === "category") state.selectedCategories.delete(value);
          if (type === "merchant") state.selectedMerchants.delete(value);
          if (type === "keyword") {
            state.keyword = "";
            keywordInput.value = "";
          }
          if (type === "pending") {
            state.includePending = false;
            includePending.checked = false;
          }
          render();
        });
      });
      const clearAll = filterPills.querySelector('[data-action="clear-all"]');
      if (clearAll) {
        clearAll.addEventListener("click", () => {
          state.month = "ALL";
          monthSelect.value = "ALL";
          state.selectedCategories.clear();
          state.selectedMerchants.clear();
          state.keyword = "";
          keywordInput.value = "";
          state.includePending = false;
          includePending.checked = false;
          render();
        });
      }
    }

    function renderCategoryCloud() {
      if (!categoryCloud) return;
      const categories = REPORT_DATA.categories.map((x) => x.category);
      if (!categories.length) {
        categoryCloud.innerHTML = `<div class="empty">暂无分类可筛选</div>`;
        return;
      }
      categoryCloud.innerHTML = categories.map((cat) => `
        <button class="chip ${state.selectedCategories.has(cat) ? "active" : ""}" data-category="${cat}">${cat}</button>
      `).join("");
      categoryCloud.querySelectorAll(".chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          const category = btn.getAttribute("data-category");
          toggleSetValue(state.selectedCategories, category);
          render();
        });
      });
    }

    function renderMerchantCloud(rowsForCloud) {
      const holder = document.getElementById("merchantCloud");
      const data = aggregateByMerchant(rowsForCloud).slice(0, 22);
      if (!data.length) {
        holder.innerHTML = `<div class="empty">当前筛选无商户数据</div>`;
        return;
      }
      holder.innerHTML = data.map((item) => `
        <button class="chip ${state.selectedMerchants.has(item.merchant) ? "active" : ""}" data-merchant="${item.merchant}" title="${fmtMoney(item.amount)} · ${item.count}笔">${item.merchant}</button>
      `).join("");
      holder.querySelectorAll(".chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          const merchant = btn.getAttribute("data-merchant");
          toggleSetValue(state.selectedMerchants, merchant);
          render();
        });
      });
    }

    function renderTable(rows) {
      const tbody = document.getElementById("txnBody");
      const sorted = sortRows(rows).slice(0, 160);
      updateSortHeaders();
      if (!sorted.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty">当前筛选无交易记录</td></tr>`;
        return;
      }
      tbody.innerHTML = sorted.map((row) => `
        <tr class="${row.needs_review ? "warn" : ""}">
          <td>${row.date}</td>
          <td>${row.category}</td>
          <td>${row.merchant}</td>
          <td>${row.description}</td>
          <td>${row.source_path}</td>
          <td>${(row.confidence * 100).toFixed(0)}%</td>
          <td class="num">${fmtMoney(row.amount)}</td>
        </tr>
      `).join("");
    }

    function render() {
      const rows = getFilteredRows();
      const rowsForCloud = getFilteredRows(true);
      if (privacyToggle) {
        privacyToggle.classList.toggle("active", state.hideAmounts);
        privacyToggle.setAttribute("aria-pressed", state.hideAmounts ? "true" : "false");
        privacyToggle.setAttribute("title", state.hideAmounts ? "点击显示金额" : "点击隐藏金额");
      }
      if (privacyToggleLabel) privacyToggleLabel.textContent = state.hideAmounts ? "显示金额" : "隐藏金额";
      text(
        "heroSubtitle",
        `覆盖 ${REPORT_DATA.input_files_count} 份账单，分析消费 ${REPORT_DATA.consumption_count} 笔（原始 ${REPORT_DATA.raw_consumption_count} 笔），总额 ${fmtMoney(REPORT_DATA.consumption_total_value)}。`
      );
      renderMetrics(rows);
      renderTrendChart(rows);
      renderDonut(rows);
      renderCategoryCloud();
      renderCategoryBars(rows);
      renderMerchantCloud(rowsForCloud);
      renderFilterPills();
      renderTable(rows);

      text("resultHint", `· 当前筛选命中 ${rows.length.toLocaleString()} 笔`);
      text(
        "footInfo",
        `分析口径总消费 ${fmtMoney(REPORT_DATA.consumption_total_value)}（已排除 ${REPORT_DATA.excluded_consumption_count} 笔 / ${fmtMoney(REPORT_DATA.excluded_consumption_total_value)}），待确认 ${REPORT_DATA.needs_review_count} 笔`
      );
      text("footTime", `生成时间：${REPORT_DATA.generated_at}`);
    }

    function init() {
      initSelectors();

      includePending.checked = state.includePending;
      if (privacyToggle) {
        privacyToggle.addEventListener("click", () => {
          state.hideAmounts = !state.hideAmounts;
          render();
        });
      }
      monthSelect.addEventListener("change", () => {
        const value = monthSelect.value || "ALL";
        state.month = value;
        render();
      });
      if (categorySelectAll) {
        categorySelectAll.addEventListener("click", () => {
          state.selectedCategories = new Set(REPORT_DATA.categories.map((x) => x.category));
          render();
        });
      }
      if (categoryClear) {
        categoryClear.addEventListener("click", () => {
          state.selectedCategories.clear();
          render();
        });
      }
      keywordInput.addEventListener("input", () => {
        state.keyword = keywordInput.value;
        render();
      });
      includePending.addEventListener("change", () => { state.includePending = includePending.checked; render(); });
      document.querySelectorAll(".th-sort").forEach((btn) => {
        btn.addEventListener("click", () => {
          const field = btn.getAttribute("data-sort");
          if (!field) return;
          if (state.sortField === field) {
            state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
          } else {
            state.sortField = field;
            state.sortDir = (field === "date" || field === "amount" || field === "confidence") ? "desc" : "asc";
          }
          render();
        });
      });
      render();
    }
    init();
  </script>
</body>
</html>
"""
    html = template.replace("__DATA_JSON__", data_json)
    path.parent.mkdir(parents=True, exist_ok=True)
    css_path = path.with_name("consumption_report.css")
    css_path.write_text(REPORT_CSS_SOURCE.read_text(encoding="utf-8"), encoding="utf-8")
    path.write_text(html, encoding="utf-8")


def run(
    input_path: Path,
    pattern: str,
    recursive: bool,
    out_root: Path,
    merchant_map_path: Path,
    category_rules_path: Path,
    analysis_exclusions_path: Path,
    review_threshold: float,
) -> dict[str, str]:
    eml_files = read_eml_files(input_path, pattern, recursive)
    if not eml_files:
        raise FileNotFoundError(f"未找到 eml 文件：{input_path} (pattern={pattern}, recursive={recursive})")

    ensure_reference_files(merchant_map_path, category_rules_path, analysis_exclusions_path)
    merchant_map = load_merchant_map(merchant_map_path)
    category_rules = load_category_rules(category_rules_path)
    exclusion_rules = load_analysis_exclusion_rules(analysis_exclusions_path)

    records: list[Transaction] = []
    errors: list[tuple[Path, Exception]] = []
    for eml_file in eml_files:
        try:
            records.extend(parse_eml(eml_file, input_path if input_path.is_dir() else input_path.parent))
        except Exception as exc:
            errors.append((eml_file, exc))

    if not records:
        details = "; ".join(f"{p.name}: {e}" for p, e in errors) or "无可解析交易记录"
        raise RuntimeError(f"未产出任何交易记录。{details}")

    records.sort(key=lambda x: (x.post_date, x.source_path, x.description, x.amount_rmb))

    statements_dir = out_root / "statements"
    category_dir = out_root / "category"
    reports_dir = out_root / "reports"

    tx_path = statements_dir / "transactions.csv"
    stmt_path = statements_dir / "summary_by_statement.csv"
    month_path = statements_dir / "summary_by_month.csv"
    month_analysis_path = reports_dir / "summary_by_month_analysis.csv"
    stmt_json_path = statements_dir / "summary.json"

    write_transactions_csv(tx_path, records)
    write_summary_by_statement(stmt_path, records)
    write_summary_by_month(month_path, records)
    write_summary_json(stmt_json_path, records)

    classified = classify_transactions(records, merchant_map, category_rules, review_threshold)
    classified = apply_analysis_exclusions(classified, exclusion_rules)
    classified_tx_path = category_dir / "classified_transactions.csv"
    expense_summary_path = category_dir / "summary_by_expense_category.csv"
    merchant_summary_path = category_dir / "summary_by_merchant.csv"
    needs_review_path = category_dir / "needs_review.csv"
    merchant_suggestions_path = category_dir / "merchant_map_suggestions.csv"

    write_classified_transactions_csv(classified_tx_path, classified)
    write_summary_by_expense_category(expense_summary_path, classified)
    write_summary_by_merchant(merchant_summary_path, classified)
    write_needs_review_csv(needs_review_path, classified)
    write_merchant_suggestions_csv(merchant_suggestions_path, classified)
    write_summary_by_month_analysis(month_analysis_path, classified)

    report_json_path = reports_dir / "consumption_analysis.json"
    report_html_path = reports_dir / "consumption_report.html"
    parse_errors_path = reports_dir / "parse_errors.csv"
    write_report_json(report_json_path, classified, len(eml_files), len(errors))
    write_html_report(report_html_path, classified, len(eml_files), len(errors))
    write_parse_errors_csv(parse_errors_path, errors)

    consume_count = sum(
        1 for r in classified if r.txn.statement_category == "消费" and r.excluded_in_analysis == 0
    )
    review_count = sum(
        1
        for r in classified
        if r.txn.statement_category == "消费" and r.needs_review == 1 and r.excluded_in_analysis == 0
    )
    excluded_count = sum(1 for r in classified if r.txn.statement_category == "消费" and r.excluded_in_analysis == 1)

    return {
        "input_files_count": str(len(eml_files)),
        "records_count": str(len(records)),
        "consume_count": str(consume_count),
        "needs_review_count": str(review_count),
        "excluded_count": str(excluded_count),
        "failed_files_count": str(len(errors)),
        "transactions_csv": str(tx_path),
        "summary_by_statement_csv": str(stmt_path),
        "summary_by_month_csv": str(month_path),
        "summary_by_month_analysis_csv": str(month_analysis_path),
        "classified_transactions_csv": str(classified_tx_path),
        "summary_by_expense_category_csv": str(expense_summary_path),
        "summary_by_merchant_csv": str(merchant_summary_path),
        "needs_review_csv": str(needs_review_path),
        "merchant_map_suggestions_csv": str(merchant_suggestions_path),
        "consumption_analysis_json": str(report_json_path),
        "consumption_report_html": str(report_html_path),
        "parse_errors_csv": str(parse_errors_path),
        "merchant_map_csv": str(merchant_map_path),
        "category_rules_csv": str(category_rules_path),
        "analysis_exclusions_csv": str(analysis_exclusions_path),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Parse CMB statement EML files and classify spending")
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("data/input/raw/eml/cmb"),
        help="EML file path, or directory containing EML files.",
    )
    parser.add_argument(
        "--glob",
        default="*.eml",
        help="Filename pattern for EML files.",
    )
    parser.add_argument(
        "--recursive",
        action="store_true",
        default=True,
        help="Recursively scan subdirectories for EML files (default: true).",
    )
    parser.add_argument(
        "--no-recursive",
        action="store_false",
        dest="recursive",
        help="Disable recursive directory scanning.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("data/work/processed"),
        help="Root output directory. Script writes statements/category/reports subfolders.",
    )
    parser.add_argument(
        "--merchant-map",
        type=Path,
        default=Path("data/rules/merchant_map.csv"),
        help="Merchant mapping CSV (merchant_normalized -> expense_category).",
    )
    parser.add_argument(
        "--category-rules",
        type=Path,
        default=Path("data/rules/category_rules.csv"),
        help="Category rules CSV for keyword/pattern matching.",
    )
    parser.add_argument(
        "--analysis-exclusions",
        type=Path,
        default=Path("data/rules/analysis_exclusions.csv"),
        help="CSV rules for excluding transactions from analysis while retaining raw data.",
    )
    parser.add_argument(
        "--review-threshold",
        type=float,
        default=0.70,
        help="Mark classification as needs_review when confidence < threshold.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = run(
        input_path=args.input,
        pattern=args.glob,
        recursive=args.recursive,
        out_root=args.out,
        merchant_map_path=args.merchant_map,
        category_rules_path=args.category_rules,
        analysis_exclusions_path=args.analysis_exclusions,
        review_threshold=args.review_threshold,
    )
    print("解析与分类完成：")
    for key, value in result.items():
        print(f"- {key}: {value}")


if __name__ == "__main__":
    main()
