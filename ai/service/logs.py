"""Structured logs: one JSON object per line, on stderr, so a host can filter them by field.

Only the fields in FIELDS are added to a line: pseudonymous ids and a few result codes. Never audio or item text.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime

FIELDS = ("event", "user", "item_id", "session_id", "decision", "skills", "construct", "instrument_id",
          "licence_status")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        entry |= {name: getattr(record, name) for name in FIELDS if hasattr(record, name)}
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False, default=str)


def configure_logging(level: str = "INFO") -> None:
    """Send everything through the JSON handler, including uvicorn's own loggers."""
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter())
    logging.basicConfig(level=level, handlers=[handler], force=True)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        server_log = logging.getLogger(name)
        server_log.handlers.clear()
        server_log.propagate = True
