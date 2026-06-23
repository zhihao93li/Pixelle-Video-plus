"""SQLite persistence for the minimal Pixelle operations loop."""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ops.models import ExperimentStage

DEFAULT_DB_PATH = Path("data/ops.db")


def default_db_path() -> Path:
    return Path(os.environ.get("PIXELLE_OPS_DB_PATH", DEFAULT_DB_PATH))


class OpsStore:
    def __init__(self, db_path: str | Path | None = None):
        self.db_path = Path(db_path) if db_path is not None else default_db_path()

    def init_db(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS operating_projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    product TEXT NOT NULL,
                    channel TEXT NOT NULL,
                    description TEXT,
                    source_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS operation_cycles (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    goal TEXT NOT NULL,
                    starts_on TEXT,
                    ends_on TEXT,
                    source_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(project_id) REFERENCES operating_projects(id)
                );

                CREATE TABLE IF NOT EXISTS channel_accounts (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    account_name TEXT NOT NULL,
                    account_handle TEXT,
                    external_account_id TEXT,
                    status TEXT NOT NULL,
                    credential_ref_json TEXT NOT NULL,
                    source_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(project_id) REFERENCES operating_projects(id)
                );

                CREATE TABLE IF NOT EXISTS content_experiments (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    cycle_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    hypothesis TEXT NOT NULL,
                    stage TEXT NOT NULL,
                    source_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(project_id) REFERENCES operating_projects(id),
                    FOREIGN KEY(cycle_id) REFERENCES operation_cycles(id)
                );

                CREATE TABLE IF NOT EXISTS content_items (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    cycle_id TEXT NOT NULL,
                    experiment_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL,
                    asset_ref_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(project_id) REFERENCES operating_projects(id),
                    FOREIGN KEY(cycle_id) REFERENCES operation_cycles(id),
                    FOREIGN KEY(experiment_id) REFERENCES content_experiments(id)
                );

                CREATE TABLE IF NOT EXISTS ops_events (
                    id TEXT PRIMARY KEY,
                    operating_project_id TEXT NOT NULL,
                    operation_cycle_id TEXT NOT NULL,
                    content_experiment_id TEXT NOT NULL,
                    content_item_id TEXT,
                    event_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    source_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(operating_project_id) REFERENCES operating_projects(id),
                    FOREIGN KEY(operation_cycle_id) REFERENCES operation_cycles(id),
                    FOREIGN KEY(content_experiment_id) REFERENCES content_experiments(id),
                    FOREIGN KEY(content_item_id) REFERENCES content_items(id)
                );
                """
            )
            self._migrate_legacy_social_accounts(conn)

    def create_project(
        self,
        *,
        name: str,
        product: str,
        channel: str,
        source: dict[str, Any],
        description: str | None = None,
    ) -> dict[str, Any]:
        row = {
            "id": _new_id("op"),
            "name": name,
            "product": product,
            "channel": channel,
            "description": description,
            "source_json": _to_json(source),
            "created_at": _now(),
        }
        self._insert("operating_projects", row)
        return _decode(row)

    def list_projects(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM operating_projects
                ORDER BY created_at ASC, id ASC
                """
            ).fetchall()
        return [_decode(dict(row)) for row in rows]

    def create_channel_account(
        self,
        *,
        project_id: str,
        platform: str,
        account_name: str,
        source: dict[str, Any],
        account_handle: str | None = None,
        external_account_id: str | None = None,
        status: str = "configured",
        credential_ref: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        row = {
            "id": _new_id("acct"),
            "project_id": project_id,
            "platform": platform,
            "account_name": account_name,
            "account_handle": account_handle,
            "external_account_id": external_account_id,
            "status": status,
            "credential_ref_json": _to_json(credential_ref or {}),
            "source_json": _to_json(source),
            "created_at": _now(),
        }
        self._insert("channel_accounts", row)
        return _decode(row)

    def create_social_account(self, **kwargs: Any) -> dict[str, Any]:
        return self.create_channel_account(**kwargs)

    def update_channel_account(
        self,
        *,
        channel_account_id: str,
        platform: str,
        account_name: str,
        source: dict[str, Any],
        account_handle: str | None = None,
        external_account_id: str | None = None,
        status: str = "configured",
        credential_ref: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE channel_accounts
                SET
                    platform = ?,
                    account_name = ?,
                    account_handle = ?,
                    external_account_id = ?,
                    status = ?,
                    credential_ref_json = ?,
                    source_json = ?
                WHERE id = ?
                """,
                (
                    platform,
                    account_name,
                    account_handle,
                    external_account_id,
                    status,
                    _to_json(credential_ref or {}),
                    _to_json(source),
                    channel_account_id,
                ),
            )
        return self.get_channel_account(channel_account_id)

    def list_channel_accounts(self, project_id: str | None = None) -> list[dict[str, Any]]:
        sql = """
            SELECT * FROM channel_accounts
            ORDER BY created_at ASC, id ASC
        """
        params: tuple[Any, ...] = ()
        if project_id:
            sql = """
                SELECT * FROM channel_accounts
                WHERE project_id = ?
                ORDER BY created_at ASC, id ASC
            """
            params = (project_id,)
        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [_decode(dict(row)) for row in rows]

    def list_social_accounts(self, project_id: str | None = None) -> list[dict[str, Any]]:
        return self.list_channel_accounts(project_id=project_id)

    def create_cycle(
        self,
        *,
        project_id: str,
        name: str,
        goal: str,
        source: dict[str, Any],
        starts_on: str | None = None,
        ends_on: str | None = None,
    ) -> dict[str, Any]:
        row = {
            "id": _new_id("cyc"),
            "project_id": project_id,
            "name": name,
            "goal": goal,
            "starts_on": starts_on,
            "ends_on": ends_on,
            "source_json": _to_json(source),
            "created_at": _now(),
        }
        self._insert("operation_cycles", row)
        return _decode(row)

    def create_experiment(
        self,
        *,
        project_id: str,
        cycle_id: str,
        title: str,
        hypothesis: str,
        source: dict[str, Any],
    ) -> dict[str, Any]:
        now = _now()
        row = {
            "id": _new_id("exp"),
            "project_id": project_id,
            "cycle_id": cycle_id,
            "title": title,
            "hypothesis": hypothesis,
            "stage": ExperimentStage.DRAFT.value,
            "source_json": _to_json(source),
            "created_at": now,
            "updated_at": now,
        }
        self._insert("content_experiments", row)
        return _decode(row)

    def create_content_item(
        self,
        *,
        project_id: str,
        cycle_id: str,
        experiment_id: str,
        kind: str,
        title: str,
        status: str,
        asset_ref: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        row = {
            "id": _new_id("item"),
            "project_id": project_id,
            "cycle_id": cycle_id,
            "experiment_id": experiment_id,
            "kind": kind,
            "title": title,
            "status": status,
            "asset_ref_json": _to_json(asset_ref or {}),
            "created_at": _now(),
        }
        self._insert("content_items", row)
        return _decode(row)

    def append_event(
        self,
        *,
        project_id: str,
        cycle_id: str,
        experiment_id: str,
        event_type: str,
        payload: dict[str, Any],
        source: dict[str, Any],
        content_item_id: str | None = None,
    ) -> dict[str, Any]:
        row = {
            "id": _new_id("evt"),
            "operating_project_id": project_id,
            "operation_cycle_id": cycle_id,
            "content_experiment_id": experiment_id,
            "content_item_id": content_item_id,
            "event_type": event_type,
            "payload_json": _to_json(payload),
            "source_json": _to_json(source),
            "created_at": _now(),
        }
        self._insert("ops_events", row)
        return _decode(row)

    def update_experiment_stage(self, experiment_id: str, stage: str) -> None:
        with self._connect() as conn:
            conn.execute(
                "UPDATE content_experiments SET stage = ?, updated_at = ? WHERE id = ?",
                (stage, _now(), experiment_id),
            )

    def get_project(self, project_id: str) -> dict[str, Any] | None:
        return self._fetch_one("SELECT * FROM operating_projects WHERE id = ?", (project_id,))

    def get_channel_account(self, channel_account_id: str) -> dict[str, Any] | None:
        return self._fetch_one("SELECT * FROM channel_accounts WHERE id = ?", (channel_account_id,))

    def get_social_account(self, account_id: str) -> dict[str, Any] | None:
        return self.get_channel_account(account_id)

    def get_cycle(self, cycle_id: str) -> dict[str, Any] | None:
        return self._fetch_one("SELECT * FROM operation_cycles WHERE id = ?", (cycle_id,))

    def get_experiment(self, experiment_id: str) -> dict[str, Any] | None:
        return self._fetch_one("SELECT * FROM content_experiments WHERE id = ?", (experiment_id,))

    def list_cycles_for_project(self, project_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM operation_cycles
                WHERE project_id = ?
                ORDER BY created_at DESC, id DESC
                """,
                (project_id,),
            ).fetchall()
        return [_decode(dict(row)) for row in rows]

    def list_experiments_for_cycle(self, cycle_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM content_experiments
                WHERE cycle_id = ?
                ORDER BY created_at DESC, id DESC
                """,
                (cycle_id,),
            ).fetchall()
        return [_decode(dict(row)) for row in rows]

    def list_events_for_experiment(self, experiment_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM ops_events
                WHERE content_experiment_id = ?
                ORDER BY created_at ASC, id ASC
                """,
                (experiment_id,),
            ).fetchall()
        return [_decode(dict(row)) for row in rows]

    def list_content_items_for_experiment(self, experiment_id: str) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM content_items
                WHERE experiment_id = ?
                ORDER BY created_at ASC, id ASC
                """,
                (experiment_id,),
            ).fetchall()
        return [_decode(dict(row)) for row in rows]

    def get_current_view(
        self,
        *,
        project_id: str | None = None,
        channel_account_id: str | None = None,
        account_id: str | None = None,
    ) -> dict[str, Any]:
        effective_account_id = channel_account_id or account_id
        account = self.get_channel_account(effective_account_id) if effective_account_id else None
        effective_project_id = account["project_id"] if account else project_id
        if effective_project_id:
            project = self.get_project(effective_project_id)
            selection = "explicit_channel_account" if account else "explicit_project"
        else:
            project = self._fetch_one(
                "SELECT * FROM operating_projects ORDER BY created_at DESC, id DESC LIMIT 1"
            )
            selection = "latest_project" if project else "empty"
        cycle = None
        experiment = None
        events: list[dict[str, Any]] = []
        items: list[dict[str, Any]] = []
        channel_accounts: list[dict[str, Any]] = []
        if project:
            channel_accounts = self.list_channel_accounts(project_id=project["id"])
            cycle = self._fetch_one(
                """
                SELECT * FROM operation_cycles
                WHERE project_id = ?
                ORDER BY created_at DESC, id DESC LIMIT 1
                """,
                (project["id"],),
            )
        if cycle:
            experiment = self._fetch_one(
                """
                SELECT * FROM content_experiments
                WHERE cycle_id = ?
                ORDER BY created_at DESC, id DESC LIMIT 1
                """,
                (cycle["id"],),
            )
        if experiment:
            events = self.list_events_for_experiment(experiment["id"])
            items = self.list_content_items_for_experiment(experiment["id"])
        return {
            "project": project,
            "cycle": cycle,
            "experiment": experiment,
            "content_items": items,
            "events": events,
            "channel_accounts": channel_accounts,
            "selected_channel_account": account,
            "social_accounts": channel_accounts,
            "selected_social_account": account,
            "context": {
                "project_id": project["id"] if project else None,
                "channel_account_id": account["id"] if account else effective_account_id,
                "account_id": account["id"] if account else account_id,
                "selection": selection,
            },
        }

    def _migrate_legacy_social_accounts(self, conn: sqlite3.Connection) -> None:
        legacy = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'social_accounts'"
        ).fetchone()
        if not legacy:
            return
        conn.execute(
            """
            INSERT OR IGNORE INTO channel_accounts (
                id,
                project_id,
                platform,
                account_name,
                account_handle,
                external_account_id,
                status,
                credential_ref_json,
                source_json,
                created_at
            )
            SELECT
                id,
                project_id,
                platform,
                account_name,
                account_handle,
                external_account_id,
                status,
                credential_ref_json,
                source_json,
                created_at
            FROM social_accounts
            """
        )

    def _fetch_one(self, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(sql, params).fetchone()
        return _decode(dict(row)) if row else None

    def _insert(self, table: str, row: dict[str, Any]) -> None:
        columns = ", ".join(row)
        values = ", ".join(f":{column}" for column in row)
        with self._connect() as conn:
            conn.execute(f"INSERT INTO {table} ({columns}) VALUES ({values})", row)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _to_json(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _decode(row: dict[str, Any]) -> dict[str, Any]:
    decoded = dict(row)
    for key in ("source_json", "payload_json", "asset_ref_json", "credential_ref_json"):
        if key in decoded:
            decoded[key.removesuffix("_json")] = json.loads(decoded.pop(key) or "{}")
    return decoded
