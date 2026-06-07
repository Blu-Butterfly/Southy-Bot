from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
import hashlib
import hmac
import json
import os
import secrets
import shutil
import subprocess
import sys
import threading
import time


ROOT = Path(__file__).resolve().parent
DEFAULT_DB_PATH = Path.home() / "Documents" / "SouthyBot KnowledgeBase.accdb"
DB_PATH = Path(os.environ.get("SOUTHYBOT_DB_PATH", DEFAULT_DB_PATH))
KB_JSON_PATH = Path(os.environ.get("SOUTHYBOT_KB_JSON", ROOT / "knowledge-base.json"))
KB_SOURCE = os.environ.get("SOUTHYBOT_KB_SOURCE", "auto").strip().lower()
READER_SCRIPT = ROOT / "read-knowledge-base.ps1"
AUTH_USERS_PATH = ROOT / "auth-users.json"
PASSWORD_ITERATIONS = 120000
SESSIONS = {}
KB_CACHE = {"signature": None, "rows": None}
KB_CACHE_LOCK = threading.Lock()


class SouthyBotHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        route = urlparse(self.path).path

        if self.is_protected_static_path(route):
            self.send_json({"ok": False, "error": "Route not found"}, status=404)
            return

        if route == "/api/health":
            self.send_json(
                {
                    "ok": DB_PATH.exists(),
                    "databasePath": str(DB_PATH),
                    "jsonPath": str(KB_JSON_PATH),
                    "sourceMode": KB_SOURCE,
                    "readerScript": str(READER_SCRIPT),
                }
            )
            return

        if route == "/api/session":
            self.handle_session()
            return

        if route == "/api/knowledge-base":
            self.handle_knowledge_base()
            return

        super().do_GET()

    def do_POST(self):
        route = urlparse(self.path).path

        if route == "/api/login":
            self.handle_login()
            return

        if route == "/api/logout":
            self.handle_logout()
            return

        self.send_json({"ok": False, "error": "Route not found"}, status=404)

    def handle_knowledge_base(self):
        started_at = time.time()

        try:
            rows = self.read_knowledge_base()
            self.send_json(
                {
                    "ok": True,
                    "source": "knowledge_base",
                    "databasePath": str(DB_PATH),
                    "recordCount": len(rows),
                    "durationMs": round((time.time() - started_at) * 1000),
                    "records": rows,
                }
            )
        except Exception as error:
            self.send_json(
                {
                    "ok": False,
                    "source": "knowledge_base",
                    "databasePath": str(DB_PATH),
                    "error": str(error),
                    "records": [],
                },
                status=500,
            )

    def read_knowledge_base(self):
        source_name, source_path, loader = self.resolve_knowledge_source()
        source_path = Path(source_path)
        signature = (source_name, str(source_path), source_path.stat().st_mtime_ns)

        with KB_CACHE_LOCK:
            if KB_CACHE["rows"] is not None and KB_CACHE["signature"] == signature:
                return KB_CACHE["rows"]

            rows = loader()
            KB_CACHE["signature"] = signature
            KB_CACHE["rows"] = rows
            return rows

    def resolve_knowledge_source(self):
        can_read_access = DB_PATH.exists() and READER_SCRIPT.exists() and shutil.which("powershell")
        can_read_json = KB_JSON_PATH.exists()

        if KB_SOURCE == "access":
            if not can_read_access:
                raise FileNotFoundError(f"Access knowledge source is unavailable: {DB_PATH}")
            return "access", DB_PATH, self.load_knowledge_base_rows

        if KB_SOURCE == "json":
            if not can_read_json:
                raise FileNotFoundError(f"JSON knowledge source is unavailable: {KB_JSON_PATH}")
            return "json", KB_JSON_PATH, self.load_json_knowledge_base_rows

        if can_read_access:
            return "access", DB_PATH, self.load_knowledge_base_rows

        if can_read_json:
            return "json", KB_JSON_PATH, self.load_json_knowledge_base_rows

        raise FileNotFoundError(
            f"No knowledge source available. Checked Access DB {DB_PATH} and JSON export {KB_JSON_PATH}."
        )

    def load_json_knowledge_base_rows(self):
        payload = json.loads(KB_JSON_PATH.read_text(encoding="utf-8-sig"))

        if isinstance(payload, dict):
            payload = payload.get("records", [])

        if not isinstance(payload, list):
            raise ValueError(f"JSON knowledge source must be a list of records: {KB_JSON_PATH}")

        return payload

    def load_knowledge_base_rows(self):
        snapshot_path = ROOT / ".runtime" / f"SouthyBot KnowledgeBase.{secrets.token_hex(8)}.snapshot.accdb"
        command = [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(READER_SCRIPT),
            "-DatabasePath",
            str(DB_PATH),
            "-SnapshotPath",
            str(snapshot_path),
        ]

        try:
            result = subprocess.run(
                command,
                capture_output=True,
                check=False,
                encoding="utf-8-sig",
                errors="replace",
                timeout=15,
            )

            if result.returncode != 0:
                raise RuntimeError((result.stderr or result.stdout or "PowerShell reader failed").strip())

            try:
                return json.loads(result.stdout or "[]")
            except json.JSONDecodeError as error:
                debug_path = ROOT / ".runtime" / "last-reader-output.json"
                debug_path.parent.mkdir(exist_ok=True)
                debug_path.write_text(result.stdout or "", encoding="utf-8", errors="replace")
                snippet_start = max(0, error.pos - 120)
                snippet = (result.stdout or "")[snippet_start : error.pos + 240]
                raise RuntimeError(
                    f"{error}; reader output saved to {debug_path}; near {snippet!r}"
                ) from error
        finally:
            snapshot_path.unlink(missing_ok=True)

    def is_protected_static_path(self, route):
        protected_paths = {
            "/auth-users.json",
            "/read-knowledge-base.ps1",
            "/server.py",
        }

        return route in protected_paths or route.startswith("/.runtime/")

    def handle_login(self):
        try:
            payload = self.read_json_body()
            role = str(payload.get("role", "")).strip().lower()
            username = str(payload.get("username", "")).strip().lower()
            password = str(payload.get("password", ""))

            if not role or not username or not password:
                self.send_json({"ok": False, "error": "Role, username, and password are required."}, status=400)
                return

            user = self.find_user(role, username)

            if not user or not self.verify_password(password, user):
                self.send_json({"ok": False, "error": "Invalid login details."}, status=401)
                return

            token = secrets.token_urlsafe(32)
            expires_at = datetime.now(timezone.utc) + timedelta(hours=8)
            public_user = self.public_user(user)
            SESSIONS[token] = {
                "user": public_user,
                "expiresAt": expires_at.isoformat(),
            }

            self.send_json(
                {
                    "ok": True,
                    "token": token,
                    "expiresAt": expires_at.isoformat(),
                    "user": public_user,
                }
            )
        except Exception as error:
            self.send_json({"ok": False, "error": str(error)}, status=500)

    def handle_session(self):
        token = self.get_bearer_token()
        session = SESSIONS.get(token)

        if not session:
            self.send_json({"ok": False, "error": "No active session."}, status=401)
            return

        expires_at = datetime.fromisoformat(session["expiresAt"])

        if expires_at <= datetime.now(timezone.utc):
            SESSIONS.pop(token, None)
            self.send_json({"ok": False, "error": "Session expired."}, status=401)
            return

        self.send_json({"ok": True, **session})

    def handle_logout(self):
        token = self.get_bearer_token()

        if token:
            SESSIONS.pop(token, None)

        self.send_json({"ok": True})

    def read_json_body(self):
        content_length = int(self.headers.get("Content-Length", 0))

        if content_length <= 0:
            return {}

        raw_body = self.rfile.read(content_length).decode("utf-8")
        return json.loads(raw_body or "{}")

    def load_auth_users(self):
        if not AUTH_USERS_PATH.exists():
            raise FileNotFoundError(f"Auth users file not found: {AUTH_USERS_PATH}")

        return json.loads(AUTH_USERS_PATH.read_text(encoding="utf-8"))

    def find_user(self, role, username):
        for user in self.load_auth_users():
            aliases = {
                str(user.get("username", "")).lower(),
                str(user.get("email", "")).lower(),
                *[str(alias).lower() for alias in user.get("aliases", [])],
            }

            if str(user.get("role", "")).lower() == role and username in aliases:
                return user

        return None

    def verify_password(self, password, user):
        salt = str(user.get("salt", "")).encode("utf-8")
        expected_hash = str(user.get("passwordHash", ""))
        actual_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            PASSWORD_ITERATIONS,
        ).hex()
        return hmac.compare_digest(actual_hash, expected_hash)

    def get_bearer_token(self):
        authorization = self.headers.get("Authorization", "")

        if authorization.lower().startswith("bearer "):
            return authorization[7:].strip()

        return ""

    def public_user(self, user):
        return {
            "id": user.get("id"),
            "role": user.get("role"),
            "username": user.get("username"),
            "email": user.get("email"),
            "displayName": user.get("displayName"),
        }

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    host = os.environ.get("SOUTHYBOT_HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", os.environ.get("SOUTHYBOT_PORT", "4173")))
    server = ThreadingHTTPServer((host, port), SouthyBotHandler)
    print(f"SouthyBot frontend + API running at http://{host}:{port}/")
    print(f"Access database: {DB_PATH}")
    print(f"JSON export: {KB_JSON_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
