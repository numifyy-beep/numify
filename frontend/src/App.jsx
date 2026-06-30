import { BrowserRouter, Routes, Route, Link, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import "./App.css";

const API_URL = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const WS_URL = `${API_URL.replace(/^https:/, "wss:").replace(/^http:/, "ws:")}/ws`;
const BRAND = "Numify";

function getToken() {
  return localStorage.getItem("token");
}

function authHeaders() {
  return { headers: { Authorization: `Bearer ${getToken()}` } };
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

function logout() {
  localStorage.clear();
  window.location.href = "/login";
}

function formatDate(value) {
  if (!value) return "-";
  const safeValue = String(value).replace(" ", "T");
  const date = new Date(safeValue);
  if (Number.isNaN(date.getTime())) return String(value).replace("T", " ").slice(0, 16);

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:${min}`;
}

function Toast({ message }) {
  if (!message) return null;
  return <div className="toast">{message}</div>;
}

function Sidebar({ active }) {
  return (
    <aside className="sidebar">
      <Link className="sidebar-logo" to="/">{BRAND}</Link>
      <Link className={`sidebar-link ${active === "dashboard" ? "active" : ""}`} to="/dashboard">Dashboard</Link>
      <Link className={`sidebar-link ${active === "subscription" ? "active" : ""}`} to="/pricing">Subscription</Link>
      <Link className={`sidebar-link ${active === "approval" ? "active" : ""}`} to="/waiting-approval">Approval Status</Link>
      <button className="sidebar-link sidebar-button" onClick={logout}>Logout</button>
    </aside>
  );
}

function AdminSidebar({ active, setActive, clearSearch }) {
  function changeTab(tab) {
    clearSearch();
    setActive(tab);
  }

  return (
    <aside className="sidebar">
      <Link className="sidebar-logo" to="/">{BRAND}</Link>
      <button className={`sidebar-link ${active === "requests" ? "active" : ""}`} onClick={() => changeTab("requests")}>Subscription Requests</button>
      <button className={`sidebar-link ${active === "users" ? "active" : ""}`} onClick={() => changeTab("users")}>Users</button>
      <button className={`sidebar-link ${active === "leads" ? "active" : ""}`} onClick={() => changeTab("leads")}>Leads</button>
      <button className="sidebar-link sidebar-button" onClick={logout}>Logout</button>
    </aside>
  );
}

function Home() {
  return (
    <div className="app">
      <nav className="navbar">
        <Link to="/" className="logo">{BRAND}</Link>
        <div className="nav-links">
          <Link to="/">Home</Link>
          <Link to="/pricing">Pricing</Link>
          <Link to="/login">Login</Link>
        </div>
        <Link to="/register" className="nav-btn">Get Started</Link>
      </nav>

      <section className="hero">
        <div className="badge">TikTok Lead Automation Platform</div>
        <h1>Capture TikTok Leads<br />Automatically</h1>
        <p>{BRAND} helps TikTok Live sellers collect customer phone numbers, organize leads, and manage subscriptions from one professional dashboard.</p>
        <div className="hero-buttons">
          <Link to="/register" className="primary-btn">Start Free</Link>
          <Link to="/pricing" className="secondary-btn">View Pricing</Link>
        </div>
      </section>
    </div>
  );
}

function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="auth-page">
      <Link to="/" className="auth-logo">{BRAND}</Link>
      <div className="auth-card">
        <h1>{title}</h1>
        <p>{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");

    try {
      const res = await axios.post(`${API_URL}/login`, form);
      localStorage.setItem("token", res.data.access_token);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      navigate(res.data.user.role === "admin" ? "/admin" : "/dashboard");
    } catch (err) {
      setError(err.response?.data?.detail || "Login failed");
    }
  }

  return (
    <AuthLayout title="Welcome back" subtitle={`Login to your ${BRAND} dashboard`}>
      <form className="auth-form" onSubmit={submit}>
        {error && <div className="error-box">{error}</div>}
        <input type="email" placeholder="Email address" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <button type="submit">Login</button>
      </form>
      <div className="auth-footer">No account? <Link to="/register">Create one</Link></div>
    </AuthLayout>
  );
}

function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");

    try {
      await axios.post(`${API_URL}/register`, form);
      navigate("/login");
    } catch (err) {
      setError(err.response?.data?.detail || "Register failed");
    }
  }

  return (
    <AuthLayout title="Create your account" subtitle="Start capturing TikTok leads professionally">
      <form className="auth-form" onSubmit={submit}>
        {error && <div className="error-box">{error}</div>}
        <input placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
        <input type="email" placeholder="Email address" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input placeholder="Phone number - 8 digits" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
        <input type="password" placeholder="Password - minimum 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        <button type="submit">Create account</button>
      </form>
      <div className="auth-footer">Already have an account? <Link to="/login">Login</Link></div>
    </AuthLayout>
  );
}

function Pricing() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    axios.get(`${API_URL}/plans`).then((res) => setPlans(res.data));
    const user = getStoredUser();
    if (user?.phone) setPhone(user.phone);
  }, []);

  async function choosePlan(planId) {
    setError("");

    if (!getToken()) {
      navigate("/register");
      return;
    }

    if (!phone || phone.length !== 8 || !/^\d+$/.test(phone)) {
      setError("Please enter a valid 8-digit phone number.");
      return;
    }

    try {
      await axios.post(`${API_URL}/subscription-request`, { plan_id: planId, phone }, authHeaders());
      navigate("/waiting-approval");
    } catch (err) {
      setError(err.response?.data?.detail || "Subscription request failed");
    }
  }

  return (
    <div className="app">
      <nav className="navbar">
        <Link to="/" className="logo">{BRAND}</Link>
        <div className="nav-links">
          <Link to="/">Home</Link>
          <Link to="/login">Login</Link>
        </div>
        <Link to="/dashboard" className="nav-btn">Dashboard</Link>
      </nav>

      <section className="pricing-section">
        <div className="badge">Manual Payment · TND</div>
        <h1>Choose your subscription</h1>
        <p>Choose a plan. Your request will be sent to admin, then we contact you manually for payment.</p>

        {error && <div className="pricing-error">{error}</div>}

        {getToken() && (
          <div className="phone-box">
            <label>Your contact phone number</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="8-digit phone number" />
          </div>
        )}

        <div className="pricing-grid">
          {plans.map((plan) => (
            <div className="pricing-card" key={plan.id}>
              <h2>{plan.name}</h2>
              <div className="price">{plan.price_tnd} TND</div>
              <p>{plan.description}</p>
              <div className="duration">{plan.duration_days} days access</div>
              <button onClick={() => choosePlan(plan.id)} className="primary-btn full">Choose {plan.name}</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function WaitingApproval() {
  const [requests, setRequests] = useState([]);

  useEffect(() => {
    if (!getToken()) return;
    axios.get(`${API_URL}/my-subscription-requests`, authHeaders()).then((res) => setRequests(res.data)).catch(() => {});
  }, []);

  return (
    <div className="auth-page">
      <Link to="/" className="auth-logo">{BRAND}</Link>
      <div className="auth-card wide">
        <div className="success-icon">✓</div>
        <h1>Request sent</h1>
        <p>Your subscription request was sent successfully. Admin will contact you by phone. After manual payment, your dashboard access will be activated.</p>

        <div className="timeline">
          <div className="timeline-step done">Request sent</div>
          <div className="timeline-step active">Waiting payment</div>
          <div className="timeline-step">Admin approval</div>
          <div className="timeline-step">Dashboard unlocked</div>
        </div>

        <div className="request-list">
          {requests.map((req) => (
            <div className="request-item" key={req.id}>
              <div>
                <strong>{req.plan_name}</strong>
                <span>{req.price_tnd} TND · {req.duration_days} days · {formatDate(req.created_at)}</span>
              </div>
              <span className={`status ${req.status}`}>{req.status}</span>
            </div>
          ))}
        </div>

        <div className="hero-buttons vertical">
          <Link to="/dashboard" className="primary-btn full">Check Dashboard</Link>
          <Link to="/pricing" className="secondary-btn full">Back to Pricing</Link>
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const wsRef = useRef(null);
  const consoleRef = useRef(null);

  const [me, setMe] = useState(null);
  const [leads, setLeads] = useState([]);
  const [error, setError] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [logs, setLogs] = useState([]);
  const [monitorRunning, setMonitorRunning] = useState(false);
  const [monitorUsername, setMonitorUsername] = useState("");
  const [monitorError, setMonitorError] = useState("");
  const [loadingMonitor, setLoadingMonitor] = useState(false);
  const [leadSearch, setLeadSearch] = useState("");
  const [toast, setToast] = useState("");

  const filteredLeads = useMemo(() => {
    const q = leadSearch.toLowerCase().trim();
    if (!q) return leads;
    return leads.filter((lead) =>
      String(lead.phone_number || "").toLowerCase().includes(q) ||
      String(lead.tiktok_username || "").toLowerCase().includes(q) ||
      String(lead.comment || "").toLowerCase().includes(q) ||
      String(lead.created_at || "").toLowerCase().includes(q)
    );
  }, [leads, leadSearch]);

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(""), 2200);
  }

  async function loadDashboard() {
    try {
      const res = await axios.get(`${API_URL}/me`, authHeaders());
      setMe(res.data);

      if (!res.data.has_access) {
        setError("No active subscription yet. Please wait for admin approval.");
        return;
      }

      const leadsRes = await axios.get(`${API_URL}/leads`, authHeaders());
      setLeads(leadsRes.data);

      const logsRes = await axios.get(`${API_URL}/monitor/logs`, authHeaders());
      setLogs(logsRes.data.logs || []);
      setMonitorRunning(logsRes.data.running || false);
      setMonitorUsername(logsRes.data.username || "");

      connectWebSocket();
    } catch {
      localStorage.clear();
      navigate("/login");
    }
  }

  function connectWebSocket() {
    const token = getToken();
    if (!token) return;

    if (wsRef.current) wsRef.current.close();

    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === "log") setLogs((prev) => [...prev, data.line].slice(-300));

      if (data.type === "lead") {
        setLeads((prev) => {
          const exists = prev.some((lead) => lead.id === data.lead.id);
          if (exists) return prev;
          return [data.lead, ...prev];
        });
        showToast(`New lead: ${data.lead.phone_number}`);
      }

      if (data.type === "delete_lead") setLeads((prev) => prev.filter((lead) => lead.id !== data.lead_id));
      if (data.type === "clear_leads") setLeads([]);
      if (data.type === "status") {
        setMonitorRunning(data.running);
        setMonitorUsername(data.username || "");
      }
    };

    ws.onclose = () => {
      setTimeout(() => {
        if (getToken()) connectWebSocket();
      }, 2000);
    };
  }

  async function startMonitor() {
    setMonitorError("");

    if (!liveUrl.trim()) {
      setMonitorError("Enter a TikTok Live URL or @username first.");
      return;
    }

    try {
      setLoadingMonitor(true);
      const res = await axios.post(`${API_URL}/monitor/start`, { username: liveUrl }, authHeaders());
      setMonitorRunning(true);
      setMonitorUsername(res.data.username || "");
      showToast("Monitor started");
    } catch (err) {
      setMonitorError(err.response?.data?.detail || "Cannot start monitor");
    } finally {
      setLoadingMonitor(false);
    }
  }

  async function stopMonitor() {
    setMonitorError("");

    try {
      setLoadingMonitor(true);
      await axios.post(`${API_URL}/monitor/stop`, {}, authHeaders());
      setMonitorRunning(false);
      showToast("Monitor stopped");
    } catch (err) {
      setMonitorError(err.response?.data?.detail || "Cannot stop monitor");
    } finally {
      setLoadingMonitor(false);
    }
  }

  async function clearLeads() {
    const yes = confirm("This will permanently delete your leads. Continue?");
    if (!yes) return;

    try {
      await axios.post(`${API_URL}/leads/clear`, {}, authHeaders());
      setLeads([]);
      setLeadSearch("");
      showToast("Leads cleared");
    } catch (err) {
      alert(err.response?.data?.detail || "Clear leads failed");
    }
  }

  async function deleteLead(id) {
    const yes = confirm("Delete this lead?");
    if (!yes) return;

    try {
      await axios.delete(`${API_URL}/leads/${id}`, authHeaders());
      setLeads((prev) => prev.filter((lead) => lead.id !== id));
      showToast("Lead deleted");
    } catch (err) {
      alert(err.response?.data?.detail || "Delete failed");
    }
  }

  async function copyPhone(phone) {
    try {
      await navigator.clipboard.writeText(phone);
      showToast(`Copied ${phone}`);
    } catch {
      alert(phone);
    }
  }

  function openWhatsApp(phone) {
    window.open(`https://wa.me/216${phone}`, "_blank", "noopener,noreferrer");
  }

  function clearConsole() {
    setLogs([]);
    showToast("Console cleared");
  }

  function exportCSV() {
    if (filteredLeads.length === 0) {
      alert("No leads to export.");
      return;
    }

    const header = ["Phone", "TikTok User", "Comment", "Date"];
    const rows = filteredLeads.map((lead) => [
      lead.phone_number || "",
      lead.tiktok_username || "",
      lead.comment || "",
      formatDate(lead.created_at),
    ]);

    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "numify-leads.csv";
    link.click();
    URL.revokeObjectURL(url);
    showToast("CSV exported");
  }

  useEffect(() => {
    loadDashboard();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="dashboard-layout">
      <Toast message={toast} />
      <Sidebar active="dashboard" />

      <main className="dashboard-main">
        <div className="dashboard-header">
          <div>
            <h1>Welcome back{me?.user?.full_name ? `, ${me.user.full_name}` : ""} 👋</h1>
            <p>Monitor TikTok Lives and collect phone numbers instantly.</p>
          </div>

          {me?.has_access && (
            <div className="monitor-status-pill">
              <span className={monitorRunning ? "dot live" : "dot"}></span>
              {monitorRunning ? `Monitoring @${monitorUsername}` : "Monitor stopped"}
            </div>
          )}
        </div>

        {error && (
          <div className="locked-card">
            <h2>Subscription required</h2>
            <p>{error}</p>
            <Link to="/pricing" className="primary-btn">Choose Plan</Link>
          </div>
        )}

        {me?.has_access && (
          <>
            <div className="simple-info-grid">
              <div className="stat-card"><span>Subscription</span><strong>Active</strong></div>
              <div className="stat-card"><span>Expires</span><strong className="date-value">{me.subscription?.ends_at?.slice(0, 10) || "Admin"}</strong></div>
              <div className="stat-card"><span>Total Leads</span><strong>{leads.length}</strong></div>
            </div>

            <div className="admin-card">
              <div className="card-header-row">
                <div>
                  <h2>TikTok Monitor</h2>
                  <p className="muted">Enter a TikTok Live URL or username. {BRAND} detects 8-digit phone numbers automatically.</p>
                </div>
                <span className={`status ${monitorRunning ? "active" : "pending"}`}>{monitorRunning ? "running" : "stopped"}</span>
              </div>

              {monitorError && <div className="error-box">{monitorError}</div>}

              <div className="monitor-row">
                <input className="dashboard-input" placeholder="https://www.tiktok.com/@username/live or @username" value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} />

                {!monitorRunning ? (
                  <button className="primary-btn monitor-btn" onClick={startMonitor} disabled={loadingMonitor}>{loadingMonitor ? "Starting..." : "Start Monitoring"}</button>
                ) : (
                  <button className="danger-btn monitor-btn" onClick={stopMonitor} disabled={loadingMonitor}>{loadingMonitor ? "Stopping..." : "Stop"}</button>
                )}
              </div>

              <div className="console-actions">
                <span className="muted">Live Console</span>
                <button className="mini-btn" onClick={clearConsole}>Clear Console</button>
              </div>

              <div className="console-box" ref={consoleRef}>
                {logs.length === 0 ? (
                  <div className="console-line muted">Live console is empty. Start monitoring to see logs here.</div>
                ) : (
                  logs.map((line, index) => <div key={index} className="console-line">{line}</div>)
                )}
              </div>
            </div>

            <div className="admin-card margin-top">
              <div className="card-header-row">
                <div>
                  <h2>Your Leads</h2>
                  <p className="muted">Phone numbers detected from TikTok Live comments.</p>
                </div>
                <div className="lead-main-actions">
                  <button className="danger-btn compact" onClick={clearLeads}>Clear Leads</button>
                  <button className="secondary-btn" onClick={exportCSV}>Export CSV</button>
                </div>
              </div>

              <div className="lead-tools">
                <input className="search-input" placeholder="Search by phone, TikTok user, comment, or date..." value={leadSearch} onChange={(e) => setLeadSearch(e.target.value)} />
                <span className="muted lead-count">Showing {filteredLeads.length} of {leads.length}</span>
              </div>

              <div className="table-wrap">
                <table className="lead-table">
                  <thead>
                    <tr>
                      <th>Phone</th>
                      <th>TikTok User</th>
                      <th>Comment</th>
                      <th>Date</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeads.length === 0 ? (
                      <tr><td colSpan="5" className="empty-cell">No leads found.</td></tr>
                    ) : (
                      filteredLeads.map((lead) => (
                        <tr key={lead.id}>
                          <td className="phone-cell">{lead.phone_number}</td>
                          <td title={lead.tiktok_username || "Unknown"}>{lead.tiktok_username || "Unknown"}</td>
                          <td title={lead.comment || "-"}>{lead.comment || "-"}</td>
                          <td className="date-cell">{formatDate(lead.created_at)}</td>
                          <td>
                            <div className="row-actions">
                              <button className="small-btn" onClick={() => copyPhone(lead.phone_number)}>Copy</button>
                              <button className="small-btn whatsapp" onClick={() => openWhatsApp(lead.phone_number)}>WhatsApp</button>
                              <button className="small-btn danger" onClick={() => deleteLead(lead.id)}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Admin() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("requests");
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState(null);

  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(""), 2200);
  }

  async function loadAdmin(showMessage = false) {
    try {
      setError("");
      setRefreshing(true);

      const [requestsRes, usersRes, leadsRes, statsRes] = await Promise.all([
        axios.get(`${API_URL}/admin/requests`, authHeaders()),
        axios.get(`${API_URL}/admin/users`, authHeaders()),
        axios.get(`${API_URL}/admin/leads`, authHeaders()),
        axios.get(`${API_URL}/admin/stats`, authHeaders()),
      ]);

      setRequests(requestsRes.data || []);
      setUsers(usersRes.data || []);
      setLeads(leadsRes.data || []);
      setStats(statsRes.data || null);

      if (showMessage) showToast("Admin data refreshed");
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        localStorage.clear();
        navigate("/login");
        return;
      }
      setError(err.response?.data?.detail || "Failed to load admin data");
    } finally {
      setRefreshing(false);
    }
  }

  async function approveRequest(id) {
    try {
      await axios.post(`${API_URL}/admin/approve`, { request_id: id }, authHeaders());
      await loadAdmin();
      showToast("Subscription approved");
    } catch (err) {
      alert(err.response?.data?.detail || "Approve failed");
    }
  }

  async function rejectRequest(id) {
    const yes = confirm("Reject this subscription request?");
    if (!yes) return;

    try {
      await axios.post(`${API_URL}/admin/reject`, { request_id: id }, authHeaders());
      await loadAdmin();
      showToast("Subscription rejected");
    } catch (err) {
      alert(err.response?.data?.detail || "Reject failed");
    }
  }

  async function toggleUser(user) {
    const active = Number(user.is_active ?? 1) === 1;
    const action = active ? "disable" : "enable";
    const yes = confirm(`${active ? "Disable" : "Enable"} this user?`);
    if (!yes) return;

    try {
      await axios.patch(`${API_URL}/admin/users/${user.id}/${action}`, {}, authHeaders());
      await loadAdmin();
      showToast(`User ${active ? "disabled" : "enabled"}`);
    } catch (err) {
      alert(err.response?.data?.detail || `Could not ${action} user`);
    }
  }

  async function deleteUser(user) {
    const yes = confirm(`Delete user ${user.email || user.full_name}? This also deletes their leads.`);
    if (!yes) return;

    try {
      await axios.delete(`${API_URL}/admin/users/${user.id}`, authHeaders());
      await loadAdmin();
      showToast("User deleted");
    } catch (err) {
      alert(err.response?.data?.detail || "Delete user failed");
    }
  }

  function viewUserLeads(user) {
    setActiveTab("leads");
    setSearch(user.email || user.full_name || String(user.id || ""));
    showToast("Showing selected user leads");
  }

  async function deleteLead(id) {
    const yes = confirm("Delete this lead?");
    if (!yes) return;

    try {
      await axios.delete(`${API_URL}/leads/${id}`, authHeaders());
      setLeads((prev) => prev.filter((lead) => lead.id !== id));
      showToast("Lead deleted");
    } catch (err) {
      alert(err.response?.data?.detail || "Delete failed");
    }
  }

  function exportAdminLeads() {
    if (filteredLeads.length === 0) {
      alert("No leads to export.");
      return;
    }

    const header = ["Owner", "Email", "Phone", "TikTok User", "Comment", "Date"];
    const rows = filteredLeads.map((lead) => [
      lead.full_name || "",
      lead.email || "",
      lead.phone_number || "",
      lead.tiktok_username || "",
      lead.comment || "",
      formatDate(lead.created_at),
    ]);

    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "numify-admin-leads.csv";
    link.click();
    URL.revokeObjectURL(url);
    showToast("Admin leads exported");
  }

  const filteredRequests = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return requests;
    return requests.filter((r) =>
      String(r.full_name || "").toLowerCase().includes(q) ||
      String(r.email || "").toLowerCase().includes(q) ||
      String(r.phone || "").toLowerCase().includes(q) ||
      String(r.plan_name || "").toLowerCase().includes(q) ||
      String(r.status || "").toLowerCase().includes(q)
    );
  }, [requests, search]);

  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return users;
    return users.filter((u) =>
      String(u.full_name || "").toLowerCase().includes(q) ||
      String(u.email || "").toLowerCase().includes(q) ||
      String(u.phone || "").toLowerCase().includes(q) ||
      String(u.plan_name || "").toLowerCase().includes(q) ||
      String(u.status || "").toLowerCase().includes(q)
    );
  }, [users, search]);

  const filteredLeads = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return leads;
    return leads.filter((lead) =>
      String(lead.full_name || "").toLowerCase().includes(q) ||
      String(lead.email || "").toLowerCase().includes(q) ||
      String(lead.phone_number || "").toLowerCase().includes(q) ||
      String(lead.tiktok_username || "").toLowerCase().includes(q) ||
      String(lead.comment || "").toLowerCase().includes(q)
    );
  }, [leads, search]);

  useEffect(() => {
    loadAdmin();
  }, []);

  return (
    <div className="dashboard-layout">
      <Toast message={toast} />
      <AdminSidebar active={activeTab} setActive={setActiveTab} clearSearch={() => setSearch("")} />

      <main className="dashboard-main">
        <div className="dashboard-header">
          <div>
            <h1>Admin Dashboard</h1>
            <p>Manage users, subscriptions, leads, and business performance.</p>
          </div>
        </div>

        {error && <div className="error-box">{error}</div>}

        <div className="admin-stats-grid">
          <div className="stat-card"><span>Total Users</span><strong>{stats?.users?.total ?? users.length}</strong></div>
          <div className="stat-card"><span>Active Users</span><strong>{stats?.users?.active ?? 0}</strong></div>
          <div className="stat-card"><span>Pending Requests</span><strong>{stats?.requests?.pending ?? 0}</strong></div>
          <div className="stat-card"><span>Approved</span><strong>{stats?.requests?.approved ?? 0}</strong></div>
          <div className="stat-card"><span>Total Leads</span><strong>{stats?.leads?.total ?? leads.length}</strong></div>
          <div className="stat-card"><span>Total Revenue</span><strong>{stats?.revenue?.total_tnd ?? 0} TND</strong></div>
        </div>

        <div className="admin-card">
          <div className="admin-topbar">
            <div>
              <h2>
                {activeTab === "requests" && "Subscription Requests"}
                {activeTab === "users" && "Users"}
                {activeTab === "leads" && "All Leads"}
              </h2>
              <p className="muted">
                {activeTab === "requests" && "Approve or reject manual subscription requests."}
                {activeTab === "users" && "Search, review, enable, disable, or delete users."}
                {activeTab === "leads" && "All phone numbers captured by all users."}
              </p>
            </div>

            <div className="admin-actions">
              <input className="search-input admin-search" placeholder={`Search ${activeTab}...`} value={search} onChange={(e) => setSearch(e.target.value)} />
              {activeTab === "leads" && <button className="secondary-btn" onClick={exportAdminLeads}>Export Leads</button>}
              <button className="mini-btn" onClick={() => loadAdmin(true)} disabled={refreshing}>{refreshing ? "Refreshing..." : "Refresh"}</button>
            </div>
          </div>

          {activeTab === "requests" && (
            <div className="table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Plan</th>
                    <th>Price</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.length === 0 ? (
                    <tr><td colSpan="7" className="empty-cell">No subscription requests found.</td></tr>
                  ) : (
                    filteredRequests.map((req) => (
                      <tr key={req.id}>
                        <td>{req.full_name}</td>
                        <td>{req.email}</td>
                        <td>{req.phone}</td>
                        <td>{req.plan_name}</td>
                        <td>{req.price_tnd} TND</td>
                        <td><span className={`status ${req.status}`}>{req.status}</span></td>
                        <td>
                          {req.status === "pending" ? (
                            <div className="actions">
                              <button className="approve-btn" onClick={() => approveRequest(req.id)}>Approve</button>
                              <button className="danger-btn compact" onClick={() => rejectRequest(req.id)}>Reject</button>
                            </div>
                          ) : (
                            <span className="muted">Done</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "users" && (
            <div className="table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Leads</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr><td colSpan="7" className="empty-cell">No users found.</td></tr>
                  ) : (
                    filteredUsers.map((user) => {
                      const active = Number(user.is_active ?? 1) === 1;
                      return (
                        <tr key={user.id}>
                          <td>{user.full_name}</td>
                          <td>{user.email}</td>
                          <td>{user.phone}</td>
                          <td>{user.plan_name || "-"}</td>
                          <td><span className={`status ${active ? "active" : "rejected"}`}>{active ? (user.status || "active") : "disabled"}</span></td>
                          <td>{user.leads ?? 0}</td>
                          <td>
                            <div className="actions">
                              <button className="small-btn" onClick={() => viewUserLeads(user)}>View Leads</button>
                              <button className="small-btn" onClick={() => toggleUser(user)}>{active ? "Disable" : "Enable"}</button>
                              <button className="small-btn danger" onClick={() => deleteUser(user)}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "leads" && (
            <div className="table-wrap">
              <table className="admin-table admin-leads-table">
                <thead>
                  <tr>
                    <th>Owner</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>TikTok User</th>
                    <th>Comment</th>
                    <th>Date</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.length === 0 ? (
                    <tr><td colSpan="7" className="empty-cell">No leads found.</td></tr>
                  ) : (
                    filteredLeads.map((lead) => (
                      <tr key={lead.id}>
                        <td>{lead.full_name || "-"}</td>
                        <td>{lead.email || "-"}</td>
                        <td className="phone-cell">{lead.phone_number}</td>
                        <td title={lead.tiktok_username || "Unknown"}>{lead.tiktok_username || "Unknown"}</td>
                        <td title={lead.comment || "-"}>{lead.comment || "-"}</td>
                        <td className="date-cell">{formatDate(lead.created_at)}</td>
                        <td><button className="small-btn danger" onClick={() => deleteLead(lead.id)}>Delete</button></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function RequireAuth({ children, adminOnly = false }) {
  const user = getStoredUser();
  if (!getToken() || !user) return <Login />;
  if (adminOnly && user.role !== "admin") return <Dashboard />;
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/waiting-approval" element={<WaitingApproval />} />
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth adminOnly><Admin /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
