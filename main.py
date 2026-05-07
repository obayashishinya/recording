import re
import os
import json
import sqlite3
import asyncio
import subprocess
import urllib.request
import urllib.error
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

CLAUDE_CLI = "/Users/obayashishinya/.local/bin/claude"

app = FastAPI()
DB_PATH = "meetings.db"

SUMMARY_PROMPT = """以下のミーティングの文字起こしを分析して、構造化された要約を作成してください。

{context}文字起こし:
{transcript}

以下のJSON形式のみで回答してください（説明文・コードブロック不要）:
{{
  "title": "ミーティングのタイトル（内容から推測）",
  "overview": "ミーティング全体の概要（3〜5文）",
  "topics": ["議題1", "議題2"],
  "decisions": ["決定事項1", "決定事項2"],
  "action_items": [
    {{"task": "タスク内容", "owner": "担当者（不明なら空文字）", "deadline": "期限（不明なら空文字）"}}
  ],
  "next_steps": ["次のステップ1", "次のステップ2"]
}}"""


def build_context(meeting_type: str, participants: str, agenda: str) -> str:
    lines = []
    if meeting_type:
        lines.append(f"ミーティング種別: {meeting_type}")
    if participants:
        lines.append(f"参加者: {participants}")
    if agenda:
        lines.append(f"議題・目的: {agenda}")
    if not lines:
        return ""
    return "【ミーティング情報】\n" + "\n".join(lines) + "\n\n"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS meetings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            transcript TEXT NOT NULL,
            summary TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


init_db()


class SummarizeRequest(BaseModel):
    transcript: str
    meeting_type: str = ""
    participants: str = ""
    agenda: str = ""


class SaveTranscriptRequest(BaseModel):
    transcript: str
    title: str = ""


class NotionExportRequest(BaseModel):
    meeting_id: int
    notion_token: str
    parent_page_id: str


async def call_claude(prompt: str) -> str:
    loop = asyncio.get_event_loop()

    def run():
        env = os.environ.copy()
        env.pop("ANTHROPIC_API_KEY", None)
        return subprocess.run(
            [CLAUDE_CLI, "--print"],
            input=prompt.encode("utf-8"),
            capture_output=True,
            timeout=120,
            env=env,
        )

    result = await loop.run_in_executor(None, run)
    if result.returncode != 0:
        err = result.stderr.decode().strip() or result.stdout.decode().strip()
        raise RuntimeError(err or f"claude CLI終了コード {result.returncode}")
    return result.stdout.decode().strip()


def build_notion_blocks(summary: dict, transcript: str) -> list:
    blocks = []

    def heading2(text):
        return {"object": "block", "type": "heading_2",
                "heading_2": {"rich_text": [{"text": {"content": text}}]}}

    def bullet(text):
        return {"object": "block", "type": "bulleted_list_item",
                "bulleted_list_item": {"rich_text": [{"text": {"content": text[:2000]}}]}}

    def todo(text):
        return {"object": "block", "type": "to_do",
                "to_do": {"rich_text": [{"text": {"content": text[:2000]}}], "checked": False}}

    def paragraph(text):
        return {"object": "block", "type": "paragraph",
                "paragraph": {"rich_text": [{"text": {"content": text[:2000]}}]}}

    if summary.get("overview"):
        blocks.append(heading2("📋 概要"))
        blocks.append(paragraph(summary["overview"]))

    if summary.get("topics"):
        blocks.append(heading2("🗂️ 議題"))
        for t in summary["topics"]:
            blocks.append(bullet(t))

    if summary.get("decisions"):
        blocks.append(heading2("✅ 決定事項"))
        for d in summary["decisions"]:
            blocks.append(bullet(d))

    if summary.get("action_items"):
        blocks.append(heading2("📌 アクションアイテム"))
        for item in summary["action_items"]:
            text = item.get("task", "")
            if item.get("owner"):
                text += f"　担当: {item['owner']}"
            if item.get("deadline"):
                text += f"　期限: {item['deadline']}"
            blocks.append(todo(text))

    if summary.get("next_steps"):
        blocks.append(heading2("🚀 次のステップ"))
        for s in summary["next_steps"]:
            blocks.append(bullet(s))

    if transcript:
        blocks.append(heading2("📝 文字起こし"))
        # Notionブロックは2000文字制限なので分割
        for i in range(0, len(transcript), 1900):
            blocks.append(paragraph(transcript[i:i + 1900]))

    return blocks


def notion_create_page(token: str, parent_page_id: str, title: str, blocks: list) -> dict:
    # page_id をハイフンなしUUID形式に正規化
    pid = parent_page_id.strip().replace("-", "")
    if len(pid) == 32:
        pid = f"{pid[:8]}-{pid[8:12]}-{pid[12:16]}-{pid[16:20]}-{pid[20:]}"

    payload = json.dumps({
        "parent": {"page_id": pid},
        "properties": {
            "title": {"title": [{"text": {"content": title}}]}
        },
        "children": blocks[:100],  # Notion API は一度に100ブロックまで
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.notion.com/v1/pages",
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Notion-Version": "2022-06-28",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        raise ValueError(f"Notion APIエラー ({e.code}): {body}")


@app.post("/api/summarize")
async def summarize(req: SummarizeRequest):
    if not req.transcript.strip():
        raise HTTPException(status_code=400, detail="文字起こしが空です")

    context = build_context(req.meeting_type, req.participants, req.agenda)
    try:
        raw = await call_claude(SUMMARY_PROMPT.format(context=context, transcript=req.transcript))
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="タイムアウトしました。もう一度お試しください。")
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise HTTPException(status_code=500, detail=f"要約の解析に失敗しました。応答: {raw[:300]}")

    try:
        summary = json.loads(match.group())
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"JSON解析エラー: {e}")

    title = summary.get("title") or "ミーティング"
    now = datetime.now().isoformat()

    conn = get_db()
    cursor = conn.execute(
        "INSERT INTO meetings (title, transcript, summary, created_at) VALUES (?, ?, ?, ?)",
        (title, req.transcript, json.dumps(summary, ensure_ascii=False), now),
    )
    meeting_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return {"id": meeting_id, "summary": summary}


@app.post("/api/transcripts")
async def save_transcript(req: SaveTranscriptRequest):
    if not req.transcript.strip():
        raise HTTPException(status_code=400, detail="文字起こしが空です")

    title = req.title.strip() or req.transcript.strip()[:30] or "ミーティング"
    now = datetime.now().isoformat()

    conn = get_db()
    cursor = conn.execute(
        "INSERT INTO meetings (title, transcript, summary, created_at) VALUES (?, ?, ?, ?)",
        (title, req.transcript, "{}", now),
    )
    meeting_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return {"id": meeting_id}


@app.post("/api/meetings/{meeting_id}/summarize")
async def summarize_existing(meeting_id: int):
    conn = get_db()
    row = conn.execute(
        "SELECT transcript FROM meetings WHERE id = ?", (meeting_id,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="見つかりません")

    transcript = row["transcript"]
    try:
        raw = await call_claude(SUMMARY_PROMPT.format(context="", transcript=transcript))
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="タイムアウトしました。もう一度お試しください。")
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise HTTPException(status_code=500, detail=f"要約の解析に失敗しました。応答: {raw[:300]}")

    try:
        summary = json.loads(match.group())
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"JSON解析エラー: {e}")

    title = summary.get("title") or "ミーティング"
    conn = get_db()
    conn.execute(
        "UPDATE meetings SET title = ?, summary = ? WHERE id = ?",
        (title, json.dumps(summary, ensure_ascii=False), meeting_id),
    )
    conn.commit()
    conn.close()

    return {"id": meeting_id, "summary": summary}


@app.post("/api/export/notion")
async def export_notion(req: NotionExportRequest):
    conn = get_db()
    row = conn.execute(
        "SELECT title, transcript, summary FROM meetings WHERE id = ?",
        (req.meeting_id,),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="見つかりません")

    summary = json.loads(row["summary"])
    blocks = build_notion_blocks(summary, row["transcript"])

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            lambda: notion_create_page(req.notion_token, req.parent_page_id, row["title"], blocks),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"url": result.get("url", ""), "id": result.get("id", "")}


@app.get("/api/meetings")
async def list_meetings():
    conn = get_db()
    rows = conn.execute(
        "SELECT id, title, created_at FROM meetings ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [{"id": r["id"], "title": r["title"], "created_at": r["created_at"]} for r in rows]


@app.get("/api/meetings/{meeting_id}")
async def get_meeting(meeting_id: int):
    conn = get_db()
    row = conn.execute(
        "SELECT id, title, transcript, summary, created_at FROM meetings WHERE id = ?",
        (meeting_id,),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="見つかりません")
    return {
        "id": row["id"],
        "title": row["title"],
        "transcript": row["transcript"],
        "summary": json.loads(row["summary"]),
        "created_at": row["created_at"],
    }


@app.delete("/api/meetings/{meeting_id}")
async def delete_meeting(meeting_id: int):
    conn = get_db()
    conn.execute("DELETE FROM meetings WHERE id = ?", (meeting_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


app.mount("/", StaticFiles(directory="static", html=True), name="static")
