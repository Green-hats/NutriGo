"""
日志结构化 — 给每条日志带上 request_id / user_id / session_id / 耗时

request_id 通过 contextvars 传递，asyncio.create_task 会自动复制 context，
因此 agent 循环作为子任务运行时也能读到同一 request_id。
"""

import contextvars
import logging
import sys
import uuid

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


def new_request_id() -> str:
    return uuid.uuid4().hex[:8]


def get_request_id() -> str:
    return request_id_var.get()


class RequestIdFilter(logging.Filter):
    """从 contextvars 提取 request_id 注入日志记录"""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True


def configure_logging(level: str = "INFO") -> None:
    """配置根日志格式，让所有 logger（含 uvicorn）带 [request_id]"""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s [%(request_id)s] %(name)s - %(message)s",
            datefmt="%H:%M:%S",
        )
    )
    handler.addFilter(RequestIdFilter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
