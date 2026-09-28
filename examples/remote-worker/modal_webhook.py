"""On-demand authenticated webhook host. Deploy from the harness repository root."""

import asyncio
import hashlib
import hmac
import json
import os
from pathlib import Path
import tempfile
import time

import modal
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

# Deployment configuration contains references only. Runtime credentials come from Modal Secret.
WORKER_IMAGE = os.environ["HARNESSFILE_WORKER_IMAGE"]
HARNESS_DIRECTORY = Path(os.environ.get("HARNESSFILE_HARNESS_DIRECTORY", ".agents")).resolve()
WEBHOOK_PROVIDER = os.environ.get("HARNESSFILE_WEBHOOK_PROVIDER", "gitlab")
SECRET_NAME = os.environ.get("HARNESSFILE_MODAL_SECRET", "harnessfile-orchestrator")
APP_NAME = os.environ.get("HARNESSFILE_MODAL_APP", "harnessfile-orchestrator")
INDEX_NAME = os.environ.get("HARNESSFILE_RECONCILIATION_INDEX", f"{APP_NAME}-reconciliation")
MAX_BODY = 1024 * 1024

app = modal.App(APP_NAME)
pending_tasks = modal.Dict.from_name(INDEX_NAME, create_if_missing=True)
image = (
    modal.Image.from_registry(WORKER_IMAGE, add_python="3.12", setup_dockerfile_commands=["USER root"])
    .pip_install("fastapi[standard]")
    .run_commands("cd /opt/harnessfile && npm install --omit=dev --no-save modal@0.10.1")
    .env({"HARNESSFILE_WEBHOOK_PROVIDER": WEBHOOK_PROVIDER})
    .add_local_dir(str(HARNESS_DIRECTORY), "/workspace/.agents")
)


def authenticate(body: bytes, headers: dict[str, str], provider: str, secret: str) -> bool:
    if not secret:
        return False
    if provider == "gitlab":
        return hmac.compare_digest(headers.get("x-gitlab-token", ""), secret)
    if provider == "github":
        expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(headers.get("x-hub-signature-256", ""), expected)
    return False


async def index_receipt(receipt: dict):
    """The index stores task keys only; graph state and task contents stay in task memory."""
    for result in receipt.get("results", []):
        key = result.get("threadId")
        if not isinstance(key, str) or not key.startswith("task:"):
            continue
        if result.get("status") == "suspended" and not result.get("resumeToken"):
            await pending_tasks.put.aio(key, 0.0, skip_if_exists=True)
        else:
            await pending_tasks.pop.aio(key, None)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name(SECRET_NAME, required_keys=["HARNESSFILE_WEBHOOK_SECRET"])],
    min_containers=0,
    max_containers=1,
    single_use_containers=True,
    timeout=300,
    retries=modal.Retries(max_retries=6, backoff_coefficient=2.0, initial_delay=5.0, max_delay=120.0),
)
@modal.concurrent(max_inputs=1)
async def process_delivery(envelope: dict, resume: str | None = None):
    """One durable queue job, serialized against other jobs and retried across lease expiry."""
    with tempfile.TemporaryDirectory(prefix="harnessfile-event-") as temporary:
        payload = Path(temporary) / "event.json"
        payload.write_text(json.dumps(envelope), encoding="utf-8")
        output = Path(temporary) / "receipt.json"
        arguments = ["node", "/opt/harnessfile/dist/bin/harnessfile.js", "event", "/workspace", "--input", str(payload)]
        arguments.extend(["--resume", resume] if resume else ["--webhook"])
        with output.open("wb") as receipt_file:
            process = await asyncio.create_subprocess_exec(*arguments, stdout=receipt_file, stderr=asyncio.subprocess.DEVNULL)
            try:
                code = await asyncio.wait_for(process.wait(), timeout=240)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                raise RuntimeError("Event processing timed out; delivery will be retried")
        if output.stat().st_size > 16 * 1024 * 1024:
            raise RuntimeError("Event receipt exceeded its size limit")
        try:
            receipt = json.loads(output.read_text())
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise RuntimeError("Event processing failed before returning a receipt")
        await index_receipt(receipt)
        if code:
            raise RuntimeError("Event processing failed; delivery will be retried")
    return {"processed": True}


@app.function(image=image, min_containers=0, max_containers=1, single_use_containers=True, timeout=120, schedule=modal.Period(minutes=1))
async def reconcile_pending():
    """Wake suspended dispatches to recover lost handoff events and expired workers."""
    pending = [(key, queued_at) async for key, queued_at in pending_tasks.items.aio()]
    for key, _ in sorted(pending, key=lambda item: float(item[1]))[:100]:
        await pending_tasks.put.aio(key, time.time())
        await process_delivery.spawn.aio({}, resume=key)


@app.function(image=image, secrets=[modal.Secret.from_name(SECRET_NAME, required_keys=["HARNESSFILE_WEBHOOK_SECRET"])], min_containers=0, max_containers=10, single_use_containers=True, timeout=30)
@modal.concurrent(max_inputs=1)
@modal.fastapi_endpoint(method="POST", docs=False)
async def webhook(request: Request):
    """Authenticate and acknowledge only after Modal accepts a durable coordinator job."""
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_BODY:
            raise HTTPException(status_code=413, detail="Webhook body is too large")
    headers = {key.lower(): value for key, value in request.headers.items()}
    if not authenticate(bytes(body), headers, os.environ["HARNESSFILE_WEBHOOK_PROVIDER"], os.environ["HARNESSFILE_WEBHOOK_SECRET"]):
        raise HTTPException(status_code=401, detail="Invalid webhook authentication")
    try:
        raw = bytes(body).decode("utf-8", errors="strict")
        json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(status_code=400, detail="Invalid webhook JSON")
    # Forward only provider-authentication/routing headers; the CLI verifies them again.
    allowed = {"x-gitlab-token", "x-gitlab-event", "x-gitlab-event-uuid", "x-gitlab-webhook-uuid", "x-hub-signature-256", "x-github-event", "x-github-delivery"}
    envelope = {"body": raw, "headers": {key: value for key, value in headers.items() if key in allowed}}
    try:
        call = await process_delivery.spawn.aio(envelope)
    except Exception:
        raise HTTPException(status_code=503, detail="Could not accept the delivery; retry it")
    return JSONResponse({"accepted": True, "callId": call.object_id}, status_code=202)
