import asyncio
import re
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr

try:
    from TikTokLive import TikTokLiveClient
    from TikTokLive.events import CommentEvent
except Exception:
    TikTokLiveClient = None
    CommentEvent = None


DB_NAME = "numify.db"
SECRET_KEY = "CHANGE_THIS_NUMIFY_SECRET_BEFORE_DEPLOYMENT"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7
PHONE_PATTERN = re.compile(r"(?<!\d)((?:\d[\s\-]?){7}\d)(?!\d)")

app = FastAPI(title="Numify API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")

monitor_running = False
monitor_client = None
monitor_thread = None
monitor_loop = None
monitor_logs = []
monitor_user_id = None
monitor_username = ""
monitor_live_url = ""
monitor_found_numbers = set()
main_loop = None


class RegisterRequest(BaseModel):
    full_name: str
    email: EmailStr
    phone: str
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SubscriptionRequestIn(BaseModel):
    plan_id: int
    phone: str


class AdminDecisionRequest(BaseModel):
    request_id: int


class MonitorStartRequest(BaseModel):
    username: str


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[int, list[WebSocket]] = {}

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.setdefault(user_id, []).append(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket):
        if user_id in self.active_connections and websocket in self.active_connections[user_id]:
            self.active_connections[user_id].remove(websocket)

    async def send_to_user(self, user_id: int, data: dict):
        connections = self.active_connections.get(user_id, [])
        dead = []
        for websocket in connections:
            try:
                await websocket.send_json(data)
            except Exception:
                dead.append(websocket)
        for websocket in dead:
            self.disconnect(user_id, websocket)


manager = ConnectionManager()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_string() -> str:
    return utc_now().strftime("%Y-%m-%d %H:%M:%S")


def get_db():
    conn = sqlite3.connect(DB_NAME, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def row_to_dict(row):
    return dict(row) if row else None


def hash_password(password: str) -> str:
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def normalize_email(email: str) -> str:
    return str(email).strip().lower()


def validate_phone(phone: str):
    if len(phone) != 8 or not phone.isdigit():
        raise HTTPException(status_code=400, detail="Phone must be exactly 8 digits")


def create_access_token(data: dict) -> str:
    payload = data.copy()
    # Keep both formats so old/new frontend tokens do not break during local testing.
    if "sub" in payload and "user_id" not in payload:
        try:
            payload["user_id"] = int(payload["sub"])
        except Exception:
            pass
    if "user_id" in payload and "sub" not in payload:
        payload["sub"] = str(payload["user_id"])
    expire = utc_now() + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    payload.update({"exp": expire, "iat": utc_now()})
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def clean_tiktok_username(value: str) -> str:
    value = value.strip()
    if "tiktok.com" in value:
        match = re.search(r"tiktok\.com/@([^/]+)/live", value)
        if match:
            return match.group(1)
    value = value.replace("@", "").strip()
    value = value.replace("https://www.tiktok.com/", "")
    value = value.replace("https://tiktok.com/", "")
    value = value.replace("/live", "")
    value = value.replace("/", "")
    if not value:
        raise ValueError("Invalid TikTok username or live URL")
    return value


def push_ws(user_id: int, data: dict):
    if main_loop:
        asyncio.run_coroutine_threadsafe(manager.send_to_user(user_id, data), main_loop)


def add_log(message: str, user_id: Optional[int] = None):
    global monitor_logs
    line = f"{datetime.now().strftime('%H:%M:%S')} | {message}"
    monitor_logs.append(line)
    monitor_logs = monitor_logs[-300:]
    if user_id:
        push_ws(user_id, {"type": "log", "line": line})


def init_db():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS subscription_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price_tnd REAL NOT NULL,
            duration_days INTEGER NOT NULL,
            description TEXT,
            is_active INTEGER DEFAULT 1
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS subscription_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            plan_id INTEGER NOT NULL,
            phone TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            plan_id INTEGER NOT NULL,
            starts_at TEXT NOT NULL,
            ends_at TEXT NOT NULL,
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            phone_number TEXT NOT NULL,
            tiktok_username TEXT,
            comment TEXT,
            live_url TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_leads_user ON leads(user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_requests_status ON subscription_requests(status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)")

    cur.execute("SELECT COUNT(*) FROM subscription_plans")
    if cur.fetchone()[0] == 0:
        cur.executemany(
            """
            INSERT INTO subscription_plans (name, price_tnd, duration_days, description)
            VALUES (?, ?, ?, ?)
            """,
            [
                ("Starter", 30, 7, "1 TikTok live · 50 leads · CSV export"),
                ("Basic", 80, 30, "5 TikTok lives · 500 leads · CSV export"),
                ("Pro", 200, 90, "Unlimited lives · Unlimited leads · Priority support"),
            ],
        )

    cur.execute("SELECT COUNT(*) FROM users WHERE role = 'admin'")
    if cur.fetchone()[0] == 0:
        cur.execute(
            """
            INSERT INTO users (full_name, email, phone, password_hash, role, is_active)
            VALUES (?, ?, ?, ?, 'admin', 1)
            """,
            ("Admin", "admin@numify.com", "00000000", hash_password("admin123")),
        )

    conn.commit()
    conn.close()


def get_user_by_id(user_id: int):
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    conn.close()
    return row_to_dict(user)


def get_user_by_email(email: str):
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE email = ?", (normalize_email(email),)).fetchone()
    conn.close()
    return row_to_dict(user)


async def get_current_user(token: str = Depends(oauth2_scheme)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        raw_user_id = payload.get("sub") or payload.get("user_id")
        user_id = int(raw_user_id)
    except (JWTError, TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if int(user.get("is_active", 1)) != 1:
        raise HTTPException(status_code=403, detail="Account disabled")
    return user


async def get_admin_user(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def expire_old_subscriptions():
    conn = get_db()
    conn.execute(
        "UPDATE subscriptions SET status = 'expired' WHERE status = 'active' AND ends_at < ?",
        (utc_string(),),
    )
    conn.commit()
    conn.close()


def get_active_subscription(user_id: int):
    expire_old_subscriptions()
    conn = get_db()
    row = conn.execute(
        """
        SELECT s.*, p.name AS plan_name, p.price_tnd, p.duration_days
        FROM subscriptions s
        JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.user_id = ? AND s.status = 'active' AND s.ends_at >= ?
        ORDER BY s.ends_at DESC
        LIMIT 1
        """,
        (user_id, utc_string()),
    ).fetchone()
    conn.close()
    return row_to_dict(row)


def save_lead(user_id: int, phone: str, username: str, comment: str, live_url: str):
    conn = get_db()
    exists = conn.execute(
        "SELECT id FROM leads WHERE user_id = ? AND phone_number = ?",
        (user_id, phone),
    ).fetchone()
    if exists:
        conn.close()
        return None

    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO leads (user_id, phone_number, tiktok_username, comment, live_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, phone, username, comment, live_url, utc_string()),
    )
    lead_id = cur.lastrowid
    conn.commit()

    row = conn.execute(
        """
        SELECT l.*, u.full_name, u.email
        FROM leads l
        JOIN users u ON u.id = l.user_id
        WHERE l.id = ?
        """,
        (lead_id,),
    ).fetchone()
    conn.close()
    return row_to_dict(row)


@app.on_event("startup")
async def startup():
    global main_loop
    main_loop = asyncio.get_running_loop()
    init_db()


@app.get("/")
def health():
    return {"app": "Numify", "status": "Backend is working"}


@app.get("/plans")
def get_plans():
    conn = get_db()
    rows = conn.execute("SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY price_tnd ASC").fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.post("/register")
def register(data: RegisterRequest):
    validate_phone(data.phone)
    email = normalize_email(data.email)

    conn = get_db()
    if conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Email already registered")

    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO users (full_name, email, phone, password_hash, role, is_active, created_at)
        VALUES (?, ?, ?, ?, 'user', 1, ?)
        """,
        (data.full_name.strip(), email, data.phone, hash_password(data.password), utc_string()),
    )
    conn.commit()
    conn.close()
    return {"message": "Account created successfully"}


@app.post("/login")
def login(data: LoginRequest):
    user = get_user_by_email(data.email)
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if int(user.get("is_active", 1)) != 1:
        raise HTTPException(status_code=403, detail="Account disabled")

    token = create_access_token({"user_id": user["id"], "sub": str(user["id"]), "email": user["email"], "role": user["role"]})
    safe_user = {
        "id": user["id"],
        "full_name": user["full_name"],
        "email": user["email"],
        "phone": user["phone"],
        "role": user["role"],
    }
    return {"access_token": token, "token_type": "bearer", "user": safe_user}


@app.get("/me")
def me(current_user: dict = Depends(get_current_user)):
    subscription = get_active_subscription(current_user["id"])
    safe_user = {
        "id": current_user["id"],
        "full_name": current_user["full_name"],
        "email": current_user["email"],
        "phone": current_user["phone"],
        "role": current_user["role"],
    }
    return {
        "user": safe_user,
        "has_access": current_user["role"] == "admin" or bool(subscription),
        "subscription": subscription,
    }


@app.post("/subscription-request")
def create_subscription_request(data: SubscriptionRequestIn, current_user: dict = Depends(get_current_user)):
    validate_phone(data.phone)
    conn = get_db()
    plan = conn.execute("SELECT * FROM subscription_plans WHERE id = ? AND is_active = 1", (data.plan_id,)).fetchone()
    if not plan:
        conn.close()
        raise HTTPException(status_code=404, detail="Plan not found")

    existing = conn.execute(
        """
        SELECT id FROM subscription_requests
        WHERE user_id = ? AND status = 'pending'
        """,
        (current_user["id"],),
    ).fetchone()
    if existing:
        conn.close()
        raise HTTPException(status_code=400, detail="You already have a pending subscription request")

    conn.execute(
        """
        INSERT INTO subscription_requests (user_id, plan_id, phone, status, created_at)
        VALUES (?, ?, ?, 'pending', ?)
        """,
        (current_user["id"], data.plan_id, data.phone, utc_string()),
    )
    conn.commit()
    conn.close()
    return {"message": "Subscription request sent"}


@app.get("/my-subscription-requests")
def my_subscription_requests(current_user: dict = Depends(get_current_user)):
    conn = get_db()
    rows = conn.execute(
        """
        SELECT sr.*, p.name AS plan_name, p.price_tnd, p.duration_days
        FROM subscription_requests sr
        JOIN subscription_plans p ON p.id = sr.plan_id
        WHERE sr.user_id = ?
        ORDER BY sr.created_at DESC
        """,
        (current_user["id"],),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.get("/leads")
def get_leads(current_user: dict = Depends(get_current_user)):
    conn = get_db()
    if current_user["role"] == "admin":
        rows = conn.execute(
            """
            SELECT l.*, u.full_name, u.email
            FROM leads l
            JOIN users u ON u.id = l.user_id
            ORDER BY l.created_at DESC
            """
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM leads WHERE user_id = ? ORDER BY created_at DESC",
            (current_user["id"],),
        ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.post("/leads/clear")
async def clear_leads(current_user: dict = Depends(get_current_user)):
    conn = get_db()
    conn.execute("DELETE FROM leads WHERE user_id = ?", (current_user["id"],))
    conn.commit()
    conn.close()
    push_ws(current_user["id"], {"type": "clear_leads"})
    return {"message": "Leads cleared"}


@app.delete("/leads/{lead_id}")
async def delete_lead(lead_id: int, current_user: dict = Depends(get_current_user)):
    conn = get_db()
    if current_user["role"] == "admin":
        row = conn.execute("SELECT user_id FROM leads WHERE id = ?", (lead_id,)).fetchone()
        if not row:
            conn.close()
            raise HTTPException(status_code=404, detail="Lead not found")
        owner_id = row["user_id"]
        conn.execute("DELETE FROM leads WHERE id = ?", (lead_id,))
    else:
        row = conn.execute("SELECT user_id FROM leads WHERE id = ? AND user_id = ?", (lead_id, current_user["id"])).fetchone()
        if not row:
            conn.close()
            raise HTTPException(status_code=404, detail="Lead not found")
        owner_id = current_user["id"]
        conn.execute("DELETE FROM leads WHERE id = ? AND user_id = ?", (lead_id, current_user["id"]))
    conn.commit()
    conn.close()
    push_ws(owner_id, {"type": "delete_lead", "lead_id": lead_id})
    return {"message": "Lead deleted"}


@app.get("/admin/requests")
def admin_requests(_: dict = Depends(get_admin_user)):
    conn = get_db()
    rows = conn.execute(
        """
        SELECT sr.*, u.full_name, u.email, p.name AS plan_name, p.price_tnd, p.duration_days
        FROM subscription_requests sr
        JOIN users u ON u.id = sr.user_id
        JOIN subscription_plans p ON p.id = sr.plan_id
        ORDER BY sr.created_at DESC
        """
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.post("/admin/approve")
def approve_request(data: AdminDecisionRequest, _: dict = Depends(get_admin_user)):
    conn = get_db()
    req = conn.execute(
        """
        SELECT sr.*, p.duration_days
        FROM subscription_requests sr
        JOIN subscription_plans p ON p.id = sr.plan_id
        WHERE sr.id = ?
        """,
        (data.request_id,),
    ).fetchone()
    if not req:
        conn.close()
        raise HTTPException(status_code=404, detail="Request not found")
    if req["status"] != "pending":
        conn.close()
        raise HTTPException(status_code=400, detail="Request already processed")

    starts = utc_now()
    current_sub = get_active_subscription(req["user_id"])
    if current_sub:
        current_end = datetime.strptime(current_sub["ends_at"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        starts = max(starts, current_end)

    ends = starts + timedelta(days=int(req["duration_days"]))

    conn.execute("UPDATE subscription_requests SET status = 'approved' WHERE id = ?", (data.request_id,))
    conn.execute(
        """
        INSERT INTO subscriptions (user_id, plan_id, starts_at, ends_at, status, created_at)
        VALUES (?, ?, ?, ?, 'active', ?)
        """,
        (
            req["user_id"],
            req["plan_id"],
            starts.strftime("%Y-%m-%d %H:%M:%S"),
            ends.strftime("%Y-%m-%d %H:%M:%S"),
            utc_string(),
        ),
    )
    conn.commit()
    conn.close()
    return {"message": "Subscription approved"}


@app.post("/admin/reject")
def reject_request(data: AdminDecisionRequest, _: dict = Depends(get_admin_user)):
    conn = get_db()
    conn.execute("UPDATE subscription_requests SET status = 'rejected' WHERE id = ? AND status = 'pending'", (data.request_id,))
    conn.commit()
    conn.close()
    return {"message": "Subscription rejected"}


@app.get("/admin/users")
def admin_users(_: dict = Depends(get_admin_user)):
    conn = get_db()
    rows = conn.execute(
        """
        SELECT
            u.id, u.full_name, u.email, u.phone, u.role, u.is_active, u.created_at,
            COALESCE(p.name, '-') AS plan_name,
            COALESCE(s.status, 'none') AS status,
            COUNT(l.id) AS leads
        FROM users u
        LEFT JOIN subscriptions s ON s.id = (
            SELECT id FROM subscriptions
            WHERE user_id = u.id
            ORDER BY ends_at DESC
            LIMIT 1
        )
        LEFT JOIN subscription_plans p ON p.id = s.plan_id
        LEFT JOIN leads l ON l.user_id = u.id
        GROUP BY u.id
        ORDER BY u.created_at DESC
        """
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.patch("/admin/users/{user_id}/disable")
def disable_user(user_id: int, admin: dict = Depends(get_admin_user)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="You cannot disable your own admin account")
    conn = get_db()
    conn.execute("UPDATE users SET is_active = 0 WHERE id = ? AND role != 'admin'", (user_id,))
    conn.commit()
    conn.close()
    return {"message": "User disabled"}


@app.patch("/admin/users/{user_id}/enable")
def enable_user(user_id: int, _: dict = Depends(get_admin_user)):
    conn = get_db()
    conn.execute("UPDATE users SET is_active = 1 WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return {"message": "User enabled"}


@app.delete("/admin/users/{user_id}")
def delete_user(user_id: int, admin: dict = Depends(get_admin_user)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="You cannot delete your own admin account")
    conn = get_db()
    user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not user:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found")
    if user["role"] == "admin":
        conn.close()
        raise HTTPException(status_code=400, detail="Admin users cannot be deleted")

    conn.execute("DELETE FROM leads WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM subscriptions WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM subscription_requests WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return {"message": "User deleted"}


@app.get("/admin/leads")
def admin_leads(_: dict = Depends(get_admin_user)):
    conn = get_db()
    rows = conn.execute(
        """
        SELECT l.*, u.full_name, u.email
        FROM leads l
        JOIN users u ON u.id = l.user_id
        ORDER BY l.created_at DESC
        """
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.get("/admin/stats")
def admin_stats(_: dict = Depends(get_admin_user)):
    expire_old_subscriptions()
    conn = get_db()

    total_users = conn.execute("SELECT COUNT(*) FROM users WHERE role = 'user'").fetchone()[0]
    active_users = conn.execute("SELECT COUNT(*) FROM users WHERE role = 'user' AND is_active = 1").fetchone()[0]
    disabled_users = conn.execute("SELECT COUNT(*) FROM users WHERE role = 'user' AND is_active = 0").fetchone()[0]

    pending = conn.execute("SELECT COUNT(*) FROM subscription_requests WHERE status = 'pending'").fetchone()[0]
    approved = conn.execute("SELECT COUNT(*) FROM subscription_requests WHERE status = 'approved'").fetchone()[0]
    rejected = conn.execute("SELECT COUNT(*) FROM subscription_requests WHERE status = 'rejected'").fetchone()[0]

    active_subs = conn.execute("SELECT COUNT(*) FROM subscriptions WHERE status = 'active'").fetchone()[0]
    expired_subs = conn.execute("SELECT COUNT(*) FROM subscriptions WHERE status = 'expired'").fetchone()[0]

    total_leads = conn.execute("SELECT COUNT(*) FROM leads").fetchone()[0]
    today = utc_now().strftime("%Y-%m-%d")
    month = utc_now().strftime("%Y-%m")
    today_leads = conn.execute("SELECT COUNT(*) FROM leads WHERE created_at LIKE ?", (f"{today}%",)).fetchone()[0]
    month_leads = conn.execute("SELECT COUNT(*) FROM leads WHERE created_at LIKE ?", (f"{month}%",)).fetchone()[0]

    revenue = conn.execute(
        """
        SELECT COALESCE(SUM(p.price_tnd), 0)
        FROM subscription_requests sr
        JOIN subscription_plans p ON p.id = sr.plan_id
        WHERE sr.status = 'approved'
        """
    ).fetchone()[0]

    conn.close()
    return {
        "users": {"total": total_users, "active": active_users, "disabled": disabled_users},
        "requests": {"pending": pending, "approved": approved, "rejected": rejected},
        "subscriptions": {"active": active_subs, "expired": expired_subs},
        "leads": {"total": total_leads, "today": today_leads, "month": month_leads},
        "revenue": {"total_tnd": revenue},
        "monitor": {"running": monitor_running, "username": monitor_username},
    }


def run_monitor(user_id: int, username: str):
    global monitor_running, monitor_client, monitor_loop, monitor_username, monitor_live_url, monitor_found_numbers

    if TikTokLiveClient is None:
        add_log("TikTokLive package is not installed.", user_id)
        monitor_running = False
        push_ws(user_id, {"type": "status", "running": False, "username": ""})
        return

    monitor_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(monitor_loop)

    monitor_username = username
    monitor_live_url = f"https://www.tiktok.com/@{username}/live"
    monitor_found_numbers = set()

    client = TikTokLiveClient(unique_id=username)
    monitor_client = client

    @client.on(CommentEvent)
    async def on_comment(event):
        if not monitor_running:
            return

        comment = getattr(event, "comment", "") or ""
        user_obj = getattr(event, "user", None)
        user_name = getattr(user_obj, "unique_id", None) or getattr(user_obj, "nickname", None) or "unknown"

        matches = PHONE_PATTERN.findall(comment)
        for raw in matches:
            phone = re.sub(r"\D", "", raw)
            if len(phone) != 8:
                continue
            if phone in monitor_found_numbers:
                continue

            monitor_found_numbers.add(phone)
            lead = save_lead(user_id, phone, user_name, comment, monitor_live_url)
            if lead:
                # Send the new lead to the frontend table first for instant display.
                push_ws(user_id, {"type": "lead", "lead": lead})
                add_log(f"[PHONE] {phone} | User: {user_name} | Comment: {comment}", user_id)

    async def main():
        global monitor_running
        try:
            add_log(f"Connecting to @{username} live...", user_id)
            if hasattr(client, "connect"):
                await client.connect()
            else:
                await client.start()
        except Exception as exc:
            add_log(f"Monitor stopped: {exc}", user_id)
        finally:
            monitor_running = False
            push_ws(user_id, {"type": "status", "running": False, "username": ""})

    try:
        monitor_loop.run_until_complete(main())
    finally:
        try:
            monitor_loop.close()
        except Exception:
            pass


@app.post("/monitor/start")
def start_monitor(data: MonitorStartRequest, current_user: dict = Depends(get_current_user)):
    global monitor_running, monitor_thread, monitor_user_id

    if current_user["role"] != "admin" and not get_active_subscription(current_user["id"]):
        raise HTTPException(status_code=403, detail="Active subscription required")

    if monitor_running:
        raise HTTPException(status_code=400, detail="A monitor is already running. Stop it first.")

    username = clean_tiktok_username(data.username)
    monitor_running = True
    monitor_user_id = current_user["id"]
    monitor_logs.clear()

    monitor_thread = threading.Thread(target=run_monitor, args=(current_user["id"], username), daemon=True)
    monitor_thread.start()

    add_log(f"Monitor started for @{username}", current_user["id"])
    push_ws(current_user["id"], {"type": "status", "running": True, "username": username})

    return {"message": "Monitor started", "username": username}


@app.post("/monitor/stop")
def stop_monitor(current_user: dict = Depends(get_current_user)):
    global monitor_running, monitor_client

    if not monitor_running:
        return {"message": "Monitor already stopped"}

    monitor_running = False

    try:
        if monitor_client:
            stop = getattr(monitor_client, "stop", None)
            disconnect = getattr(monitor_client, "disconnect", None)
            if callable(disconnect) and monitor_loop:
                asyncio.run_coroutine_threadsafe(disconnect(), monitor_loop)
            elif callable(stop):
                stop()
    except Exception:
        pass

    add_log("Monitor stop requested", current_user["id"])
    push_ws(current_user["id"], {"type": "status", "running": False, "username": ""})
    return {"message": "Monitor stopped"}


@app.get("/monitor/logs")
def get_monitor_logs(current_user: dict = Depends(get_current_user)):
    return {
        "logs": monitor_logs[-300:],
        "running": monitor_running and monitor_user_id == current_user["id"],
        "username": monitor_username if monitor_user_id == current_user["id"] else "",
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close()
        return

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        raw_user_id = payload.get("sub") or payload.get("user_id")
        user_id = int(raw_user_id)
        user = get_user_by_id(user_id)
        if not user or int(user.get("is_active", 1)) != 1:
            await websocket.close(code=1008)
            return
    except Exception:
        await websocket.close(code=1008)
        return

    await manager.connect(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(user_id, websocket)
