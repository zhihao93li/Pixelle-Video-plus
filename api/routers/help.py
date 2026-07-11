"""Help and FAQ API routes backed by the canonical user documentation."""

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter(prefix="/help", tags=["help"])


class FaqSection(BaseModel):
    question: str
    answer: str


class FaqResponse(BaseModel):
    language: str
    content: str
    sections: list[FaqSection]


@router.get("/faq", response_model=FaqResponse)
async def get_faq(language: str = Query(default="zh_CN")):
    faq_path = _faq_path(language)
    if not faq_path.exists():
        raise HTTPException(status_code=404, detail=f"FAQ file not found: {faq_path.name}")

    try:
        content = faq_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return FaqResponse(
        language="zh_CN" if language.startswith("zh") else "en_US",
        content=content,
        sections=[
            FaqSection(question=question, answer=answer)
            for question, answer in _parse_faq_sections(content)
        ],
    )


def _faq_path(language: str) -> Path:
    project_root = Path(__file__).resolve().parents[2]
    if language.startswith("zh"):
        return project_root / "docs" / "zh" / "faq.md"
    return project_root / "docs" / "en" / "faq.md"


def _parse_faq_sections(content: str) -> list[tuple[str, str]]:
    lines = content.split("\n")
    if lines and lines[0].startswith("#") and not lines[0].startswith("##"):
        content = "\n".join(lines[1:])

    sections: list[tuple[str, str]] = []
    current_question: str | None = None
    current_answer_lines: list[str] = []

    for line in content.split("\n"):
        match = re.match(r"^###\s+(.+?)$", line)
        if match:
            if current_question is not None:
                sections.append((current_question, "\n".join(current_answer_lines).strip()))
            current_question = match.group(1).strip()
            current_answer_lines = []
        else:
            current_answer_lines.append(line)

    if current_question is not None:
        sections.append((current_question, "\n".join(current_answer_lines).strip()))

    return sections
