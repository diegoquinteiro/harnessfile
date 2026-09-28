"""Offline host authentication checks; no Modal deployment or SDK installation required."""

import ast
import hashlib
import hmac
import json
import os
import time
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

source = ast.parse(Path(__file__).with_name("modal_webhook.py").read_text())
functions = [node for node in source.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in {"authenticate", "webhook", "index_receipt", "reconcile_pending"}]
for function in functions:
    function.decorator_list = []


class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        super().__init__(detail)


namespace = {"hashlib": hashlib, "hmac": hmac, "os": os, "json": json, "time": time, "MAX_BODY": 1024 * 1024,
             "Request": object, "HTTPException": HTTPException,
             "JSONResponse": lambda body, status_code: SimpleNamespace(body=body, status_code=status_code)}
exec(compile(ast.Module(body=functions, type_ignores=[]), "modal_webhook.py", "exec"), namespace)
authenticate = namespace["authenticate"]


class AuthenticationTests(unittest.TestCase):
    def test_github_authenticates_exact_raw_body(self):
        body = b'{"event":"issue"}'
        signature = "sha256=" + hmac.new(b"secret", body, hashlib.sha256).hexdigest()
        self.assertTrue(authenticate(body, {"x-hub-signature-256": signature}, "github", "secret"))
        self.assertFalse(authenticate(body + b"\n", {"x-hub-signature-256": signature}, "github", "secret"))

    def test_gitlab_and_missing_configuration(self):
        self.assertTrue(authenticate(b"{}", {"x-gitlab-token": "secret"}, "gitlab", "secret"))
        self.assertFalse(authenticate(b"{}", {"x-gitlab-token": "wrong"}, "gitlab", "secret"))
        self.assertFalse(authenticate(b"{}", {}, "gitlab", ""))
        self.assertFalse(authenticate(b"{}", {}, "unknown", "secret"))


class HostingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.spawn = AsyncMock(return_value=SimpleNamespace(object_id="call-1"))
        namespace["process_delivery"] = SimpleNamespace(spawn=SimpleNamespace(aio=self.spawn))
        self.put = AsyncMock()
        self.pop = AsyncMock()
        namespace["pending_tasks"] = SimpleNamespace(put=SimpleNamespace(aio=self.put), pop=SimpleNamespace(aio=self.pop))

    def request(self, token="secret"):
        async def stream():
            yield b'{"event":"issue"}'
        return SimpleNamespace(stream=stream, headers={"x-gitlab-token": token, "x-gitlab-event": "Issue Hook"})

    async def test_invalid_auth_never_spawns(self):
        with patch.dict(os.environ, {"HARNESSFILE_WEBHOOK_PROVIDER": "gitlab", "HARNESSFILE_WEBHOOK_SECRET": "secret"}):
            with self.assertRaises(HTTPException) as caught:
                await namespace["webhook"](self.request("invalid"))
        self.assertEqual(caught.exception.status_code, 401)
        self.spawn.assert_not_awaited()

    async def test_returns_202_after_durable_acceptance_and_503_if_unaccepted(self):
        with patch.dict(os.environ, {"HARNESSFILE_WEBHOOK_PROVIDER": "gitlab", "HARNESSFILE_WEBHOOK_SECRET": "secret"}):
            response = await namespace["webhook"](self.request())
            self.assertEqual(response.status_code, 202)
            self.assertEqual(response.body["callId"], "call-1")
            self.spawn.assert_awaited_once()
            self.spawn.side_effect = RuntimeError("acceptance failed")
            with self.assertRaises(HTTPException) as caught:
                await namespace["webhook"](self.request())
            self.assertEqual(caught.exception.status_code, 503)

    async def test_receipts_keep_only_pending_dispatches(self):
        await namespace["index_receipt"]({"results": [
            {"threadId": "task:pending", "status": "suspended"},
            {"threadId": "task:gate", "status": "suspended", "resumeToken": "approval"},
            {"threadId": "task:done", "status": "completed"},
            {"threadId": "task:failed", "status": "failed"},
        ]})
        self.put.assert_awaited_once_with("task:pending", 0.0, skip_if_exists=True)
        self.assertEqual([call.args[0] for call in self.pop.await_args_list], ["task:gate", "task:done", "task:failed"])

    async def test_scheduler_wakes_keys_without_task_contents(self):
        async def items():
            yield "task:later", 50.0
            yield "task:first", 0.0
        namespace["pending_tasks"].items = SimpleNamespace(aio=items)
        await namespace["reconcile_pending"]()
        self.assertEqual([call.kwargs["resume"] for call in self.spawn.await_args_list], ["task:first", "task:later"])
        self.assertTrue(all(call.args == ({},) for call in self.spawn.await_args_list))

    async def test_receipt_replay_preserves_scheduling_order_beyond_one_batch(self):
        values = {f"task:{index:03d}": 0.0 for index in range(101)}
        async def put(key, value, skip_if_exists=False):
            if not skip_if_exists or key not in values:
                values[key] = value
        async def items():
            for item in list(values.items()):
                yield item
        namespace["pending_tasks"].put = SimpleNamespace(aio=put)
        namespace["pending_tasks"].items = SimpleNamespace(aio=items)
        async def spawn(_envelope, resume):
            self.assertGreater(values[resume], 0.0)
            await namespace["index_receipt"]({"results": [{"threadId": resume, "status": "suspended"}]})
        self.spawn.side_effect = spawn
        await namespace["reconcile_pending"]()
        self.assertEqual(self.spawn.await_count, 100)
        await namespace["reconcile_pending"]()
        self.assertEqual(self.spawn.await_args_list[100].kwargs["resume"], "task:100")


if __name__ == "__main__":
    unittest.main()
