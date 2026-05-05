#!/usr/bin/env python3
"""Generate the curated Pumpkin Book LLPAB gold supplement.

This script materializes a 10-page subset PDF and an LLPA-style bundle that
LLPAB can import with `llpab import llpa-reference`.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pypdf import PdfReader, PdfWriter


SELECTED_ORIGINAL_PAGES = [1, 2, 3, 16, 17, 21, 22, 40, 80, 160]
DPI = 200


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


@dataclass(frozen=True)
class PageSpec:
    subset_page: int
    original_page: int
    classification: str
    markdown: str
    qa_pairs: list[dict[str, str]]
    layout: list[dict[str, Any]]
    tables: list[dict[str, Any]]
    formulas: list[dict[str, Any]]
    figures: list[dict[str, Any]]
    charts: list[dict[str, Any]]


def base_provenance(note: str) -> dict[str, Any]:
    return {
        "source": "manual_view_image",
        "annotator": "codex",
        "confidence": 0.92,
        "note": note,
    }


def layout(element_id: str, page: int, label: str, bbox: list[float], text: str, order: int) -> dict[str, Any]:
    return {
        "element_id": element_id,
        "page": page,
        "label": label,
        "bbox": bbox,
        "text": text,
        "markdown": text,
        "reading_order": order,
        "content_list_index": element_id,
        "provenance": base_provenance("manual layout region from rendered page"),
    }


def formula(element_id: str, page: int, bbox: list[float], latex: str, caption: str, order: int) -> dict[str, Any]:
    return {
        "element_id": element_id,
        "page": page,
        "bbox": bbox,
        "latex": latex,
        "latex_wrapped": f"$$\n{latex}\n$$",
        "text": caption,
        "markdown": f"$$\n{latex}\n$$",
        "reading_order": order,
        "content_list_index": element_id,
        "provenance": base_provenance("manual formula transcription from rendered page"),
    }


def make_specs() -> list[PageSpec]:
    return [
        PageSpec(
            subset_page=1,
            original_page=1,
            classification="cover",
            markdown="# 南瓜书 PUMPKIN BOOK\n\n谢文睿 秦州 贾彬彬\n\n版本号: 2.0.0\n发布日期: 2023.11\n",
            qa_pairs=[
                {"question": "这本书封面上的中文书名是什么？", "answer": "南瓜书。"},
                {"question": "封面上的英文标题是什么？", "answer": "PUMPKIN BOOK。"},
                {"question": "封面列出的版本号是什么？", "answer": "2.0.0。"},
                {"question": "封面列出的发布日期是什么？", "answer": "2023.11。"},
            ],
            layout=[
                layout("p001-title-block", 1, "title", [0.16, 0.23, 0.84, 0.55], "南瓜书 / PUMPKIN BOOK", 1),
                layout("p001-authors", 1, "text", [0.35, 0.52, 0.65, 0.58], "谢文睿 秦州 贾彬彬", 2),
                layout("p001-version", 1, "footer", [0.35, 0.91, 0.66, 0.97], "版本号: 2.0.0；发布日期: 2023.11", 3),
            ],
            tables=[],
            formulas=[],
            figures=[
                {
                    "element_id": "p001-cover-figure",
                    "page": 1,
                    "bbox": [0.0, 0.0, 1.0, 0.60],
                    "title": "南瓜书封面视觉",
                    "caption": "封面包含橙色南瓜装饰和中央书名框。",
                    "description": "Large decorative cover with pumpkin-like orange shapes at top and title frame in center.",
                    "image_path": "pages/page-0001.png",
                    "provenance": base_provenance("cover visual manually identified"),
                }
            ],
            charts=[],
        ),
        PageSpec(
            subset_page=2,
            original_page=2,
            classification="mixed",
            markdown=(
                "# 前言\n\n"
                "页面介绍《南瓜书》的写作背景、使用说明、配套视频教程、在线阅读地址、最新版 PDF 获取地址、编委会和致谢。\n\n"
                "## 使用说明\n\n"
                "- 南瓜书内容按西瓜书章节顺序组织。\n"
                "- 对初学者不建议深究第 1 章和第 2 章公式。\n"
                "- 每个公式解析和推导均尽量补充数学细节。\n"
                "- 发现问题可通过 GitHub Issues 反馈。\n\n"
                "页面下方有读者交流群二维码和版权声明。\n"
            ),
            qa_pairs=[
                {"question": "前言页的主要标题是什么？", "answer": "前言。"},
                {"question": "使用说明中提到问题反馈可以通过哪个平台？", "answer": "GitHub Issues。"},
                {"question": "前言页下方包含什么二维码？", "answer": "南瓜书读者交流群二维码。"},
                {"question": "页面列出的最新 PDF 获取地址属于哪个平台？", "answer": "GitHub。"},
            ],
            layout=[
                layout("p002-title", 2, "title", [0.44, 0.07, 0.56, 0.10], "前言", 1),
                layout("p002-preface", 2, "text", [0.12, 0.12, 0.88, 0.27], "前言正文段落", 2),
                layout("p002-usage", 2, "text", [0.11, 0.28, 0.89, 0.50], "使用说明项目列表", 3),
                layout("p002-links", 2, "text", [0.11, 0.50, 0.88, 0.59], "配套视频教程、在线阅读地址、PDF 获取地址", 4),
                layout("p002-committee", 2, "text", [0.11, 0.61, 0.88, 0.70], "编委会与致谢", 5),
                layout("p002-qr", 2, "figure", [0.42, 0.75, 0.58, 0.86], "读者交流群二维码", 6),
                layout("p002-license", 2, "footer", [0.28, 0.90, 0.75, 0.94], "版权声明", 7),
            ],
            tables=[],
            formulas=[],
            figures=[
                {
                    "element_id": "p002-qr-code",
                    "page": 2,
                    "bbox": [0.42, 0.75, 0.58, 0.86],
                    "caption": "南瓜书读者交流群二维码",
                    "description": "QR code placed near the bottom center of the foreword page.",
                    "image_path": "pages/page-0002.png",
                    "provenance": base_provenance("QR code manually identified"),
                }
            ],
            charts=[],
        ),
        PageSpec(
            subset_page=3,
            original_page=3,
            classification="toc",
            markdown=(
                "# 目录\n\n"
                "- 第 1 章 绪论 ...... 1\n"
                "- 第 2 章 模型评估与选择 ...... 5\n"
                "- 第 3 章 线性模型 ...... 18\n"
                "- 3.3 对数几率回归 ...... 23\n"
            ),
            qa_pairs=[
                {"question": "目录页中第 1 章的标题是什么？", "answer": "绪论。"},
                {"question": "目录页显示第 2 章从哪一页开始？", "answer": "第 5 页。"},
                {"question": "目录页显示第 3 章的标题是什么？", "answer": "线性模型。"},
                {"question": "目录页的条目使用什么视觉方式连接标题与页码？", "answer": "点状引导线。"},
            ],
            layout=[
                layout("p003-header", 3, "header", [0.07, 0.02, 0.93, 0.06], "欢迎选择纸质版南瓜书《机器学习公式详解 第 2 版》", 1),
                layout("p003-title", 3, "title", [0.45, 0.08, 0.55, 0.12], "目录", 2),
                layout("p003-toc", 3, "text", [0.09, 0.13, 0.92, 0.92], "目录条目、点状引导线和页码", 3),
                layout("p003-footer", 3, "footer", [0.07, 0.94, 0.93, 0.98], "配套视频教程链接", 4),
            ],
            tables=[],
            formulas=[],
            figures=[],
            charts=[],
        ),
        PageSpec(
            subset_page=4,
            original_page=16,
            classification="table",
            markdown=(
                "## 1.3 假设空间\n\n"
                "页面用“房价预测”示例说明假设空间和版本空间。\n\n"
                "表 1-1 房价预测\n\n"
                "| 年份 | 学校数量 | 房价 |\n"
                "| --- | --- | --- |\n"
                "| 2020 | 1 所 | 1 万/m² |\n"
                "| 2021 | 2 所 | 4 万/m² |\n\n"
                "基于表中数据，可以学习到一元一次函数或一元二次函数等不同假设空间中的模型。\n"
            ),
            qa_pairs=[
                {"question": "本页表 1-1 的标题是什么？", "answer": "房价预测。"},
                {"question": "表 1-1 中 2020 年学校数量是多少？", "answer": "1 所。"},
                {"question": "表 1-1 中 2021 年房价是多少？", "answer": "4 万/m²。"},
                {"question": "本页 1.3 节讨论的核心概念是什么？", "answer": "假设空间。"},
            ],
            layout=[
                layout("p004-text-top", 4, "text", [0.10, 0.05, 0.90, 0.28], "分布解释与 1.3 假设空间开头", 1),
                layout("p004-section", 4, "title", [0.10, 0.28, 0.34, 0.32], "1.3 假设空间", 2),
                layout("p004-table", 4, "table", [0.34, 0.35, 0.66, 0.47], "表 1-1 房价预测", 3),
                layout("p004-text-bottom", 4, "text", [0.10, 0.49, 0.90, 0.90], "表格后的假设空间和归纳偏好说明", 4),
            ],
            tables=[
                {
                    "element_id": "p004-table-1-1",
                    "page": 4,
                    "bbox": [0.34, 0.35, 0.66, 0.47],
                    "caption": "表 1-1 房价预测",
                    "html_table": "<table><thead><tr><th>年份</th><th>学校数量</th><th>房价</th></tr></thead><tbody><tr><td>2020</td><td>1 所</td><td>1 万/m²</td></tr><tr><td>2021</td><td>2 所</td><td>4 万/m²</td></tr></tbody></table>",
                    "rows": [
                        ["年份", "学校数量", "房价"],
                        ["2020", "1 所", "1 万/m²"],
                        ["2021", "2 所", "4 万/m²"],
                    ],
                    "content_list_index": "p004-table",
                    "provenance": base_provenance("manual table transcription"),
                }
            ],
            formulas=[],
            figures=[],
            charts=[],
        ),
        PageSpec(
            subset_page=5,
            original_page=17,
            classification="formula_heavy",
            markdown=(
                "## 1.4.1 式（1.1）和式（1.2）的解释\n\n"
                "页面展示期望错误相关的多行推导，并解释从 ① 到 ⑤ 的变形步骤。\n\n"
                "$$\\sum_f E_{ote}(\\mathcal{L}_a|X,f)=\\sum_f\\sum_h\\sum_{x\\in\\mathcal{X}-X}P(x)\\mathbb{I}(h(x)\\ne f(x))P(h|X,\\mathcal{L}_a)$$\n"
            ),
            qa_pairs=[
                {"question": "本页小节标题是什么？", "answer": "1.4.1 式（1.1）和式（1.2）的解释。"},
                {"question": "本页主公式的推导使用了哪些编号标记？", "answer": "使用了 ①、②、③、④、⑤。"},
                {"question": "页面下半部分列出了几个可能的真实目标函数？", "answer": "四个，记为 f1、f2、f3、f4。"},
            ],
            layout=[
                layout("p005-section", 5, "title", [0.10, 0.12, 0.50, 0.16], "1.4.1 式（1.1）和式（1.2）的解释", 1),
                layout("p005-formula-main", 5, "formula", [0.16, 0.17, 0.86, 0.47], "式（1.1）和式（1.2）的多行推导", 2),
                layout("p005-formula-secondary", 5, "formula", [0.20, 0.50, 0.70, 0.63], "① 到 ② 的展开推导", 3),
                layout("p005-text", 5, "text", [0.10, 0.64, 0.90, 0.90], "公式编号步骤说明和真实目标函数列表", 4),
            ],
            tables=[],
            formulas=[
                formula("p005-formula-1", 5, [0.16, 0.17, 0.86, 0.47], r"\sum_f E_{ote}(\mathcal{L}_a|X,f)=\sum_f\sum_h\sum_{x\in\mathcal{X}-X}P(x)\mathbb{I}(h(x)\ne f(x))P(h|X,\mathcal{L}_a)", "式（1.1）和式（1.2）的主推导", 2),
                formula("p005-formula-2", 5, [0.20, 0.50, 0.70, 0.63], r"\sum_f\sum_h\sum_{x\in\mathcal{X}-X}P(x)\mathbb{I}(h(x)\ne f(x))P(h|X,\mathcal{L}_a)", "① 到 ② 的局部展开", 3),
            ],
            figures=[],
            charts=[],
        ),
        PageSpec(
            subset_page=6,
            original_page=21,
            classification="formula_heavy",
            markdown=(
                "## 2.3.7 式（2.18）和式（2.19）的解释\n\n"
                "页面定义真正例率 TPR、假正例率 FPR，并补充 TNR 与 FNR：\n\n"
                "$$TNR=\\frac{TN}{FP+TN},\\qquad FNR=\\frac{FN}{TP+FN}$$\n\n"
                "随后进入 2.3.8 式（2.20）的推导，说明 ROC 曲线的绘制过程。\n"
            ),
            qa_pairs=[
                {"question": "本页给出的 TNR 公式是什么？", "answer": "TNR = TN / (FP + TN)。"},
                {"question": "本页给出的 FNR 公式是什么？", "answer": "FNR = FN / (TP + FN)。"},
                {"question": "本页 2.3.8 小节要推导哪个式子？", "answer": "式（2.20）。"},
            ],
            layout=[
                layout("p006-text-top", 6, "text", [0.10, 0.05, 0.90, 0.38], "macro-F1 与 micro-F1 说明", 1),
                layout("p006-section-237", 6, "title", [0.10, 0.38, 0.60, 0.42], "2.3.7 式（2.18）和式（2.19）的解释", 2),
                layout("p006-formula-tnr-fnr", 6, "formula", [0.38, 0.52, 0.62, 0.61], "TNR 与 FNR 公式", 3),
                layout("p006-section-238", 6, "title", [0.10, 0.65, 0.42, 0.69], "2.3.8 式（2.20）的推导", 4),
                layout("p006-text-bottom", 6, "text", [0.10, 0.70, 0.90, 0.92], "ROC 曲线绘制过程说明", 5),
            ],
            tables=[],
            formulas=[
                formula("p006-formula-tnr", 6, [0.38, 0.52, 0.62, 0.56], r"TNR=\frac{TN}{FP+TN}", "真负例率 TNR", 3),
                formula("p006-formula-fnr", 6, [0.38, 0.57, 0.62, 0.61], r"FNR=\frac{FN}{TP+FN}", "假反例率 FNR", 4),
            ],
            figures=[],
            charts=[],
        ),
        PageSpec(
            subset_page=7,
            original_page=22,
            classification="diagram_chart",
            markdown=(
                "图 2-1 ROC 曲线示意\n\n"
                "图中横轴为 x，纵轴为 y；绿色线段表示新增真正例，红色线段表示新增假正例，蓝色线段表示既新增真正例也新增假正例。\n\n"
                "页面解释 AUC 是 ROC 曲线下由绿色和蓝色线段围成的面积。随后推导 l_rank 与 ROC 曲线面积之间的关系。\n"
            ),
            qa_pairs=[
                {"question": "本页图 2-1 的标题是什么？", "answer": "ROC 曲线示意。"},
                {"question": "图 2-1 中绿色线段表示什么？", "answer": "新增真正例。"},
                {"question": "图 2-1 中红色线段表示什么？", "answer": "新增假正例。"},
                {"question": "页面说明 AUC 与什么面积有关？", "answer": "ROC 曲线下方由绿色线段和蓝色线段与坐标轴围成的面积。"},
            ],
            layout=[
                layout("p007-chart", 7, "chart", [0.32, 0.06, 0.66, 0.28], "图 2-1 ROC 曲线示意", 1),
                layout("p007-caption", 7, "text", [0.38, 0.28, 0.62, 0.33], "图 2-1 ROC 曲线示意", 2),
                layout("p007-text", 7, "text", [0.10, 0.34, 0.90, 0.68], "ROC 曲线和 AUC 解释", 3),
                layout("p007-formula", 7, "formula", [0.18, 0.70, 0.86, 0.91], "l_rank 公式变形", 4),
            ],
            tables=[],
            formulas=[
                formula("p007-formula-lrank", 7, [0.18, 0.70, 0.86, 0.91], r"\ell_{rank}=\frac{1}{m^+m^-}\sum_{x^+\in D^+}\sum_{x^-\in D^-}\left(\mathbb{I}(f(x^+)<f(x^-))+\frac{1}{2}\mathbb{I}(f(x^+)=f(x^-))\right)", "l_rank 与 ROC 面积关系推导", 4),
            ],
            figures=[],
            charts=[
                {
                    "element_id": "p007-chart-roc",
                    "page": 7,
                    "bbox": [0.32, 0.06, 0.66, 0.28],
                    "caption": "图 2-1 ROC 曲线示意",
                    "description": "ROC curve schematic with x/y axes, dashed grid, black points, and colored red/green/blue line segments.",
                    "labels": ["x", "y", "红", "绿", "蓝"],
                    "data_points": [
                        {"x_label": "0", "y_label": "0", "role": "origin"},
                        {"x_label": "1/m^-", "y_label": "1/m^+", "role": "step marker"},
                    ],
                    "structured_graph_json": {
                        "chart_type": "roc_curve_schematic",
                        "semantic_segments": {
                            "green": "新增真正例",
                            "red": "新增假正例",
                            "blue": "既新增真正例也新增假正例",
                        },
                    },
                    "content_list_index": "p007-chart",
                    "provenance": base_provenance("manual ROC chart annotation"),
                }
            ],
        ),
        PageSpec(
            subset_page=8,
            original_page=40,
            classification="formula_heavy",
            markdown=(
                "## 3.3.6 式（3.31）的推导\n\n"
                "页面推导对数几率回归中二阶导数/Hessian 相关表达式，并在底部进入 3.4 线性判别分析。\n\n"
                "$$\\frac{\\partial^2\\ell(\\beta)}{\\partial\\beta\\partial\\beta^T}=\\sum_{i=1}^m \\hat{x}_i\\hat{x}_i^T \\cdot \\frac{e^{\\beta^T\\hat{x}_i}}{1+e^{\\beta^T\\hat{x}_i}}\\cdot \\frac{1}{1+e^{\\beta^T\\hat{x}_i}}$$\n"
            ),
            qa_pairs=[
                {"question": "本页 3.3.6 小节推导的是哪个式子？", "answer": "式（3.31）。"},
                {"question": "页面底部进入了哪个新小节？", "answer": "3.4 线性判别分析。"},
                {"question": "本页核心公式涉及哪个参数？", "answer": "涉及参数 β。"},
            ],
            layout=[
                layout("p008-formula-top", 8, "formula", [0.25, 0.05, 0.78, 0.20], "上一页公式续写", 1),
                layout("p008-section", 8, "title", [0.10, 0.24, 0.55, 0.29], "3.3.6 式（3.31）的推导", 2),
                layout("p008-formula-main", 8, "formula", [0.18, 0.30, 0.84, 0.75], "式（3.31）多行推导", 3),
                layout("p008-section-bottom", 8, "title", [0.10, 0.82, 0.40, 0.86], "3.4 线性判别分析", 4),
            ],
            tables=[],
            formulas=[
                formula("p008-formula-hessian", 8, [0.18, 0.30, 0.84, 0.75], r"\frac{\partial^2\ell(\beta)}{\partial\beta\partial\beta^T}=\sum_{i=1}^m \hat{x}_i\hat{x}_i^T p_1(\hat{x}_i;\beta)(1-p_1(\hat{x}_i;\beta))", "式（3.31）Hessian 推导", 3),
            ],
            figures=[],
            charts=[],
        ),
        PageSpec(
            subset_page=9,
            original_page=80,
            classification="formula_heavy",
            markdown=(
                "页面推导 Dirichlet 分布与后验概率，并进入 7.4 半朴素贝叶斯分类器。\n\n"
                "$$P(\\theta|D)=\\frac{\\prod_{i=1}^k \\theta_i^{\\alpha_i+y_i-1}}{\\sum_{\\theta}\\prod_{i=1}^k \\theta_i^{\\alpha_i+y_i-1}}=P(\\theta;\\alpha+y)$$\n\n"
                "$$\\theta_i=\\frac{\\alpha_i+y_i}{\\sum_{j=1}^k\\alpha_j+m}$$\n"
            ),
            qa_pairs=[
                {"question": "本页后验概率 P(θ|D) 被写成什么分布形式？", "answer": "写成 P(θ; α + y)，即参数为 α + y 的 Dirichlet 分布。"},
                {"question": "本页给出的 θ_i 估计式分母是什么？", "answer": "分母是所有 α_j 的和加 m，即 Σα_j + m。"},
                {"question": "页面底部进入哪个小节？", "answer": "7.4 半朴素贝叶斯分类器。"},
            ],
            layout=[
                layout("p009-formula-dirichlet", 9, "formula", [0.20, 0.05, 0.85, 0.42], "Dirichlet 后验概率推导", 1),
                layout("p009-text", 9, "text", [0.10, 0.44, 0.90, 0.62], "后验概率和拉普拉斯修正说明", 2),
                layout("p009-formula-theta", 9, "formula", [0.35, 0.63, 0.66, 0.78], "theta_i 估计式", 3),
                layout("p009-section", 9, "title", [0.10, 0.81, 0.48, 0.85], "7.4 半朴素贝叶斯分类器", 4),
                layout("p009-text-bottom", 9, "text", [0.10, 0.86, 0.90, 0.94], "7.4.1 式（7.21）的解释开头", 5),
            ],
            tables=[],
            formulas=[
                formula("p009-formula-posterior", 9, [0.20, 0.05, 0.85, 0.42], r"P(\theta|D)=\frac{\prod_{i=1}^k \theta_i^{\alpha_i+y_i-1}}{\sum_{\theta}\prod_{i=1}^k \theta_i^{\alpha_i+y_i-1}}=P(\theta;\alpha+y)", "Dirichlet 后验概率", 1),
                formula("p009-formula-theta", 9, [0.35, 0.63, 0.66, 0.78], r"\theta_i=\frac{\alpha_i+y_i}{\sum_{j=1}^k\alpha_j+m}", "theta_i 的后验均值估计", 3),
            ],
            figures=[],
            charts=[],
        ),
        PageSpec(
            subset_page=10,
            original_page=160,
            classification="formula_heavy",
            markdown=(
                "页面估计 E_Z[Φ(Z)] 的上界，并进入 12.6 定理 12.6 的解释。\n\n"
                "$$E_Z[\\Phi(Z)]\\leq 2\\mathbb{E}_{\\sigma,Z}\\left[\\sup_{f\\in\\mathcal{F}}\\frac{1}{m}\\sum_{i=1}^m\\sigma_i f(z_i)\\right]=2R_m(\\mathcal{F})$$\n\n"
                "第二行等式利用了对服从分布 D 的示例集 Z' 求期望。\n"
            ),
            qa_pairs=[
                {"question": "本页最终把 E_Z[Φ(Z)] 上界到哪个复杂度量？", "answer": "上界到 2R_m(𝓕)。"},
                {"question": "本页底部进入哪个定理的解释？", "answer": "定理 12.6 的解释。"},
                {"question": "页面说明第一行等式是对什么求期望？", "answer": "对服从分布 D 的示例集 Z' 求期望。"},
            ],
            layout=[
                layout("p010-text-top", 10, "text", [0.10, 0.05, 0.90, 0.09], "即书中式 12.44 的结论引入", 1),
                layout("p010-formula-main", 10, "formula", [0.18, 0.10, 0.82, 0.49], "E_Z Phi(Z) 上界推导", 2),
                layout("p010-text-mid", 10, "text", [0.10, 0.50, 0.90, 0.70], "逐行解释推导理由", 3),
                layout("p010-section", 10, "title", [0.10, 0.73, 0.45, 0.77], "12.6 定理 12.6 的解释", 4),
                layout("p010-text-bottom", 10, "text", [0.10, 0.79, 0.90, 0.94], "定理 12.6 条件和解释", 5),
            ],
            tables=[],
            formulas=[
                formula("p010-formula-rademacher", 10, [0.18, 0.10, 0.82, 0.49], r"E_Z[\Phi(Z)]\leq 2\mathbb{E}_{\sigma,Z}\left[\sup_{f\in\mathcal{F}}\frac{1}{m}\sum_{i=1}^m\sigma_i f(z_i)\right]=2R_m(\mathcal{F})", "Rademacher 复杂度上界", 2),
            ],
            figures=[],
            charts=[],
        ),
    ]


def make_subset_pdf(source_pdf: Path, target_pdf: Path, selected_pages: list[int]) -> None:
    reader = PdfReader(str(source_pdf))
    writer = PdfWriter()
    for page_number in selected_pages:
        writer.add_page(reader.pages[page_number - 1])
    target_pdf.parent.mkdir(parents=True, exist_ok=True)
    with target_pdf.open("wb") as handle:
        writer.write(handle)


def render_pages(pdf_path: Path, pages_dir: Path) -> list[dict[str, Any]]:
    import fitz  # type: ignore[import-not-found]

    pages_dir.mkdir(parents=True, exist_ok=True)
    page_index: list[dict[str, Any]] = []
    zoom = DPI / 72
    with fitz.open(pdf_path) as document:
        for index, page in enumerate(document, start=1):
            pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            image_name = f"page-{index:04d}.png"
            image_path = pages_dir / image_name
            pixmap.save(image_path)
            rect = page.rect
            page_index.append(
                {
                    "page": index,
                    "original_pdf_page": SELECTED_ORIGINAL_PAGES[index - 1],
                    "image_path": f"pages/{image_name}",
                    "width_pt": float(rect.width),
                    "height_pt": float(rect.height),
                    "width_px": int(pixmap.width),
                    "height_px": int(pixmap.height),
                    "dpi": DPI,
                    "render_source": "pymupdf",
                }
            )
    return page_index


def make_document_json(specs: list[PageSpec], page_index: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "kind": "pumpkin-book-llpab-manual-document/v1",
        "created_at": now_iso(),
        "selected_original_pages": SELECTED_ORIGINAL_PAGES,
        "pages": [
            {
                "page": spec.subset_page,
                "original_pdf_page": spec.original_page,
                "classification": spec.classification,
                "markdown": spec.markdown,
                "page_asset": page_index[spec.subset_page - 1],
                "element_counts": {
                    "layout": len(spec.layout),
                    "tables": len(spec.tables),
                    "formulas": len(spec.formulas),
                    "figures": len(spec.figures),
                    "charts": len(spec.charts),
                },
            }
            for spec in specs
        ],
    }


def materialize_gold_bundle(root: Path, source_pdf: Path, subset_pdf: Path, source_sha: str, page_index: list[dict[str, Any]]) -> None:
    specs = make_specs()
    bundle = root / "gold_bundle"
    for subdir in ("input", "final", "pages", "page_markdown", "normalized", "manual-eval", "annotations"):
        (bundle / subdir).mkdir(parents=True, exist_ok=True)

    (bundle / "input" / "source.sha256").write_text(f"{source_sha}  source/pumpkin_book_10p.pdf\n", encoding="utf-8")
    write_json(
        bundle / "manifest.json",
        {
            "candidate_id": "pumpkin-book-manual-gold",
            "run_id": "pumpkin-manual-gold-v0",
            "source_path": str(subset_pdf),
            "source_sha256": source_sha,
            "created_at": now_iso(),
            "selected_original_pages": SELECTED_ORIGINAL_PAGES,
        },
    )

    document_md = "\n\n---\n\n".join(f"<!-- page:{spec.subset_page} original:{spec.original_page} -->\n\n{spec.markdown.strip()}" for spec in specs) + "\n"
    (bundle / "final" / "document.md").write_text(document_md, encoding="utf-8")
    write_json(bundle / "final" / "document.json", make_document_json(specs, page_index))
    write_jsonl(bundle / "pages" / "page-index.jsonl", page_index)

    for row in page_index:
        src = root / row["image_path"]
        dst = bundle / row["image_path"]
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(src.read_bytes())

    all_layout: list[dict[str, Any]] = []
    all_tables: list[dict[str, Any]] = []
    all_formulas: list[dict[str, Any]] = []
    all_figures: list[dict[str, Any]] = []
    all_charts: list[dict[str, Any]] = []
    structure_rows: list[dict[str, Any]] = []
    provenance_rows: list[dict[str, Any]] = []

    for spec in specs:
        (bundle / "page_markdown" / f"page-{spec.subset_page:04d}.md").write_text(spec.markdown, encoding="utf-8")
        annotation = {
            "kind": "pumpkin-page-manual-annotation/v1",
            "page": spec.subset_page,
            "original_pdf_page": spec.original_page,
            "source_pdf": "source/pumpkin_book_10p.pdf",
            "source_image": f"pages/page-{spec.subset_page:04d}.png",
            "baseline_md_refs": baseline_refs_for_original_page(spec.original_page),
            "page_classification": spec.classification,
            "layout_regions": spec.layout,
            "tables": spec.tables,
            "formulas": spec.formulas,
            "figures": spec.figures,
            "charts": spec.charts,
            "manual_self_check": {
                "source": "manual_view_image",
                "status": "reviewed",
                "confidence": 0.9,
                "notes": "Annotated from rendered page image and aligned to existing Pumpkin Book Markdown baseline where applicable.",
            },
        }
        write_json(bundle / "annotations" / f"page-{spec.subset_page:04d}.annotation.json", annotation)
        all_layout.extend(spec.layout)
        all_tables.extend(spec.tables)
        all_formulas.extend(spec.formulas)
        all_figures.extend(spec.figures)
        all_charts.extend(spec.charts)
        structure_rows.append(
            {
                "page": spec.subset_page,
                "original_pdf_page": spec.original_page,
                "classification": spec.classification,
                "layout_count": len(spec.layout),
                "table_count": len(spec.tables),
                "formula_count": len(spec.formulas),
                "figure_count": len(spec.figures),
                "chart_count": len(spec.charts),
                "status": "manual_gold_ready",
            }
        )
        for element in [*spec.layout, *spec.tables, *spec.formulas, *spec.figures, *spec.charts]:
            provenance_rows.append(
                {
                    "element_id": element.get("element_id"),
                    "page": spec.subset_page,
                    "original_pdf_page": spec.original_page,
                    "source": element.get("provenance", {}),
                }
            )

    write_jsonl(bundle / "normalized" / "blocks.jsonl", all_layout)
    write_jsonl(bundle / "normalized" / "tables.jsonl", all_tables)
    write_jsonl(bundle / "normalized" / "formulas.jsonl", all_formulas)
    write_jsonl(bundle / "normalized" / "figures.jsonl", all_figures)
    write_jsonl(bundle / "normalized" / "charts.jsonl", all_charts)
    write_jsonl(bundle / "normalized" / "provenance.jsonl", provenance_rows)
    write_jsonl(bundle / "manual-eval" / "structure-audit.jsonl", structure_rows)
    write_json(
        bundle / "manual-eval" / "judge-summary.json",
        {
            "kind": "pumpkin-book-manual-gold-summary/v1",
            "status": "gold_human_seed",
            "created_at": now_iso(),
            "page_count": len(specs),
            "selected_original_pages": SELECTED_ORIGINAL_PAGES,
            "surface_counts": {
                "layout": len(all_layout),
                "tables": len(all_tables),
                "formulas": len(all_formulas),
                "figures": len(all_figures),
                "charts": len(all_charts),
            },
            "review_method": "manual view_image inspection plus Pumpkin Book markdown baseline alignment",
        },
    )

    exported_files = [
        "manifest.json",
        "input/source.sha256",
        "final/document.md",
        "final/document.json",
        "pages/page-index.jsonl",
        "normalized/blocks.jsonl",
        "normalized/tables.jsonl",
        "normalized/formulas.jsonl",
        "normalized/figures.jsonl",
        "normalized/charts.jsonl",
        *[f"page_markdown/page-{spec.subset_page:04d}.md" for spec in specs],
    ]
    write_json(
        bundle / "llpab-export-manifest.json",
        {
            "kind": "llpa-reference-bundle/v1",
            "format": "llpab",
            "candidate_dir": str(bundle),
            "output_dir": str(bundle),
            "source_sha256": source_sha,
            "exported_files": exported_files,
            "synthesized_files": ["normalized/charts.jsonl"],
            "optional_files": ["manual-eval/judge-summary.json", "manual-eval/structure-audit.jsonl"],
            "referenced_asset_files": [f"pages/page-{spec.subset_page:04d}.png" for spec in specs],
        },
    )


def baseline_refs_for_original_page(original_page: int) -> list[dict[str, Any]]:
    mapping = {
        1: [{"path": "md/index.md", "note": "book landing metadata"}],
        2: [{"path": "md/index.md", "note": "foreword/frontmatter is PDF-only in current baseline"}],
        3: [{"path": "md/index.md", "note": "table of contents is PDF-only in current baseline"}],
        16: [{"path": "md/chapter1/chapter1.md", "line_hint": "表1-1 房价预测"}],
        17: [{"path": "md/chapter1/chapter1.md", "line_hint": "式（1.1）和式（1.2）的解释"}],
        21: [{"path": "md/chapter2/chapter2.md", "line_hint": "式（2.18）和式（2.19）的解释"}],
        22: [{"path": "md/chapter2/chapter2.md", "line_hint": "图2-1 ROC曲线示意"}],
        40: [{"path": "md/chapter3/chapter3.md", "line_hint": "式（3.31）的推导"}],
        80: [{"path": "md/chapter7/chapter7.md", "line_hint": "Dirichlet 分布与半朴素贝叶斯"}],
        160: [{"path": "md/chapter12/chapter12.md", "line_hint": "Rademacher 复杂度与定理 12.6"}],
    }
    return mapping.get(original_page, [])


def materialize_dataset_eval(root: Path, subset_pdf: Path) -> None:
    specs = make_specs()
    data_dir = root / "dataset_eval_utils" / "data"
    gt_dir = root / "dataset_eval_utils" / "ground_truth"
    data_dir.mkdir(parents=True, exist_ok=True)
    gt_dir.mkdir(parents=True, exist_ok=True)
    reader = PdfReader(str(subset_pdf))
    for spec in specs:
        stem = f"pumpkin_book_p{spec.subset_page:03d}"
        writer = PdfWriter()
        writer.add_page(reader.pages[spec.subset_page - 1])
        with (data_dir / f"{stem}.pdf").open("wb") as handle:
            writer.write(handle)
        write_json(
            gt_dir / f"{stem}.json",
            {
                "has_text": True,
                "document_type": "other",
                "layout_complexity": "complex" if spec.classification in {"toc", "table", "formula_heavy", "diagram_chart", "mixed"} else "simple",
                "qa_pairs": spec.qa_pairs,
                "metadata": {
                    "subset_page": spec.subset_page,
                    "original_pdf_page": spec.original_page,
                    "classification": spec.classification,
                },
            },
        )


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    original_pdf = repo_root / "test_case_multimodal_document_lossless_parse" / "pumpkin_book" / "raw_pdf" / "pumpkin_book.pdf"
    root = repo_root / "test_case_multimodal_document_lossless_parse" / "pumpkin_book" / "gold" / "llpab_manual_pages"
    source_dir = root / "source"
    subset_pdf = source_dir / "pumpkin_book_10p.pdf"
    source_dir.mkdir(parents=True, exist_ok=True)

    make_subset_pdf(original_pdf, subset_pdf, SELECTED_ORIGINAL_PAGES)
    source_sha = sha256_file(subset_pdf)
    write_json(
        source_dir / "selected-pages.json",
        {
            "kind": "pumpkin-book-selected-pages/v1",
            "source_pdf": str(original_pdf),
            "subset_pdf": str(subset_pdf),
            "source_sha256": source_sha,
            "dpi": DPI,
            "selected_original_pages": SELECTED_ORIGINAL_PAGES,
            "selected_pages": [
                {"subset_page": index, "original_pdf_page": page}
                for index, page in enumerate(SELECTED_ORIGINAL_PAGES, start=1)
            ],
        },
    )
    page_index = render_pages(subset_pdf, root / "pages")
    materialize_gold_bundle(root, original_pdf, subset_pdf, source_sha, page_index)
    materialize_dataset_eval(root, subset_pdf)
    print(json.dumps({"ok": True, "root": str(root), "subset_pdf": str(subset_pdf), "source_sha256": source_sha}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
