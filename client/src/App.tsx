import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  Bell,
  Camera,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Filter,
  LayoutDashboard,
  LockKeyhole,
  Mail,
  Menu,
  Package,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import CompanyReportList from "./CompanyReportList";
import InspectionImage from "./InspectionImage";
import FixedConnectedReport from "./FixedConnectedReport";
import ProductAwareScan from "./ProductAwareScan";
import MatchingProductCatalog from "./MatchingProductCatalog";
import CompanyDashboard from "./CompanyDashboard";
import ProfileDropdown from "./ProfileDropdown";
import ThemeToggle from "./ThemeToggle";
import { ThemeContext } from "./themeContext";
import "./OfficerProfile.css";

type CheckResult = {
  fieldName: string;
  label: string;
  detectedValue: string | null;
  isCompliant: boolean;
  needsReview?: boolean;
  ruleSection: string;
  confidenceNote: string;
  minFontSizeMm: number;
};
type Inspection = {
  id: string;
  company: string;
  companyId?: string;
  product: string;
  productId?: string;
  status: string;
  score: number;
  createdAt: string;
  checks?: CheckResult[];
  summary?: {
    passed: number;
    failed: number;
    total: number;
    isCompliant: boolean;
  };
  ocrText?: string;
  ocrConfidence?: number | null;
  labelImages?: string[];
  report?: {
    id: string;
    generatedAt: string;
    verdict: string;
    score: number;
    triggeredBy?: string;
    downloadUrl: string;
  };
};
type View =
  | "overview"
  | "scan"
  | "history"
  | "analytics"
  | "rules"
  | "people"
  | "products"
  | "notifications"
  | "report";
type Role = "officer" | "supervisor" | "admin" | "company";
type AuthUser = {
  id: string;
  name: string;
  role: Role;
  email: string;
  orgId: string;
  token?: string;
};

async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  const token = localStorage.getItem("metro-check-token");
  if (token && !headers.has("Authorization"))
    headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.message ?? `Request failed (${response.status})`);
  return body as T;
}

const nav = [
  { id: "overview", label: "Command centre", icon: LayoutDashboard },
  { id: "scan", label: "New inspection", icon: Camera },
  { id: "history", label: "Inspection history", icon: Archive },
  { id: "analytics", label: "State analytics", icon: BarChart3 },
  { id: "rules", label: "Rule configuration", icon: Settings2 },
  { id: "people", label: "Officers & access", icon: Users },
  { id: "notifications", label: "Notifications", icon: Bell },
] as const;

const trend = [
  { day: "06 Sep", value: 74 },
  { day: "07 Sep", value: 69 },
  { day: "08 Sep", value: 81 },
  { day: "09 Sep", value: 78 },
  { day: "10 Sep", value: 86 },
  { day: "11 Sep", value: 80 },
  { day: "12 Sep", value: 92 },
];
const categoryData = [
  { name: "Food", value: 46, color: "#e5a93d" },
  { name: "Homecare", value: 29, color: "#4e8079" },
  { name: "Personal care", value: 17, color: "#d86e52" },
  { name: "Other", value: 8, color: "#c9c3ae" },
];

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const stored = localStorage.getItem("metro-check-user");
      return stored ? (JSON.parse(stored) as AuthUser) : null;
    } catch {
      return null;
    }
  });
  const authenticated = Boolean(user);
  const [view, setView] = useState<View>("overview");
  const [previousView, setPreviousView] = useState<View>("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [selected, setSelected] = useState<Inspection | null>(null);
  const [rescanInspection, setRescanInspection] = useState<Inspection | null>(
    null,
  );
  const [loadError, setLoadError] = useState("");
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifError, setNotifError] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    localStorage.getItem("metro-check-theme") === "dark" ? "dark" : "light",
  );
  const [showLogoutConfirmation, setShowLogoutConfirmation] = useState(false);
  const [officerProfileOpen, setOfficerProfileOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("metro-check-theme", theme);
  }, [theme]);

  useEffect(() => {
    apiRequest<Inspection[]>("/api/inspections")
      .then(setInspections)
      .catch((error: Error) => setLoadError(error.message));
    apiRequest<any[]>("/api/notifications")
      .then(setNotifications)
      .catch((error: Error) => setNotifError(error.message));
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const filteredInspections = inspections;
  const openInspection = (inspection: Inspection) => {
    setSelected(inspection);
    setView("report");
  };
  const handleScanComplete = (inspection: Inspection) => {
    setInspections((current) => [inspection, ...current]);
    setSelected(inspection);
    setRescanInspection(null);
    setView("report");
  };
  const startScan = () => {
    setRescanInspection(null);
    setView("scan");
  };
  const toggleNotifications = () => {
    setView((current) => {
      if (current === "notifications") return previousView;
      setPreviousView(current);
      return "notifications";
    });
  };
  const confirmLogout = () => {
    localStorage.removeItem("metro-check-user");
    localStorage.removeItem("metro-check-token");
    sessionStorage.removeItem("metro-check-user");
    setShowLogoutConfirmation(false);
    setUser(null);
    window.history.replaceState({}, "", "/");
  };
  const logout = () => setShowLogoutConfirmation(true);
  const toggleTheme = () =>
    setTheme((current) => (current === "light" ? "dark" : "light"));
  const themed = (content: React.ReactNode) => (
    <ThemeContext.Provider value={{ theme, toggle: toggleTheme }}>
      {content}
      {showLogoutConfirmation && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-out-title"
            aria-describedby="sign-out-message"
          >
            <div className="confirm-icon">
              <AlertTriangle size={22} />
            </div>
            <span className="eyebrow">CONFIRM SIGN OUT</span>
            <h2 id="sign-out-title">Sign out of Metro-Check?</h2>
            <p id="sign-out-message">
              Are you sure you want to sign out of your account?
            </p>
            <div className="confirm-actions">
              <button
                className="button ghost"
                onClick={() => setShowLogoutConfirmation(false)}
              >
                No
              </button>
              <button className="button danger" onClick={confirmLogout}>
                Yes, sign out
              </button>
            </div>
          </section>
        </div>
      )}
    </ThemeContext.Provider>
  );

  if (!authenticated || !user)
    return (
      <Login
        theme={theme}
        onThemeToggle={toggleTheme}
        onLogin={(nextUser) => {
          localStorage.setItem("metro-check-user", JSON.stringify(nextUser));
          localStorage.setItem("metro-check-token", nextUser.token ?? "");
          setUser(nextUser);
          window.history.replaceState({}, "", `/${nextUser.role}/dashboard`);
        }}
      />
    );

  if (user.role === "admin")
    return themed(view === "people" ? (
      <RoleShell user={user} onLogout={logout} onNotificationsToggle={toggleNotifications}>
        <ConnectedPeople user={user} onBack={() => setView("overview")} />
      </RoleShell>
    ) : view === "notifications" ? (
      <RoleShell user={user} onLogout={logout} onNotificationsToggle={toggleNotifications} notificationsOpen>
        <ConnectedNotifications />
      </RoleShell>
    ) : (
      <ConnectedAdminDashboard
        user={user}
        onLogout={logout}
        onManageOfficers={() => setView("people")}
        onNotificationsToggle={toggleNotifications}
      />
    ));
  if (user.role === "company")
    return themed(<CompanyDashboard user={user} onLogout={logout} />);

  return themed(
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={21} />
          </div>
          <div>
            <strong>metro-check</strong>
            <span>LEGAL METROLOGY / INDIA</span>
          </div>
        </div>
        <div className="officer-profile-area">
          <button
            className="workspace-switcher officer-profile-trigger"
            onClick={() => setOfficerProfileOpen((open) => !open)}
            aria-expanded={officerProfileOpen}
            aria-controls="officer-details"
          >
            <span className="avatar small">{user.name.slice(0, 2).toUpperCase()}</span>
            <div>
              <b>{user.name}</b>
              <small>Enforcement officer</small>
            </div>
            <ChevronRight size={16} className={officerProfileOpen ? "officer-profile-chevron open" : "officer-profile-chevron"} />
          </button>
          {officerProfileOpen && (
            <section className="officer-details" id="officer-details" aria-label="User details">
              <button className="officer-profile-close" onClick={() => setOfficerProfileOpen(false)} aria-label="Close user details"><X size={14} /></button>
              <span className="eyebrow">SIGNED-IN USER</span>
              <b>{user.name}</b>
              <small>Enforcement officer</small>
              <div>
                <span>Email</span>
                <strong>{user.email}</strong>
              </div>
              <div>
                <span>Organisation</span>
                <strong>{user.orgId}</strong>
              </div>
            </section>
          )}
        </div>
        <nav>
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={view === id ? "nav-item active" : "nav-item"}
              onClick={() => {
                if (id === "scan") setRescanInspection(null);
                setView(id);
                setMobileNav(false);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === "notifications" && unreadCount > 0 && <em>{unreadCount}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-box">
            <span className="eyebrow">FIELD NOTE</span>
            <p>
              Always capture both the principal display panel and declarations
              panel.
            </p>
            <button onClick={() => setView("scan")}>
              Start a scan <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="sidebar-footer">
            <span>v0.9.2 · Audit mode</span>
            <button
              className="text-button"
              aria-label="Sign out"
              onClick={logout}
            >
              Sign out <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="Open menu"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={21} />
          </button>
          <div className="crumb">
            <span>Operations</span>
            <ChevronRight size={14} />
            <b>{nav.find((item) => item.id === view)?.label ?? "Report"}</b>
          </div>
          <div className="top-actions">
            <ThemeToggle />
            <button
              className="icon-button notification"
              aria-label="Notifications"
              aria-pressed={view === "notifications"}
              onClick={toggleNotifications}
            >
              <Bell size={19} />
              {unreadCount > 0 && <i />}
            </button>
            <ProfileDropdown user={user} onLogout={logout} />
          </div>
        </header>
        <div className="page-wrap">
          <AnimatePresence mode="wait">
            {view === "overview" && (
              <Overview
                key="overview"
                inspections={filteredInspections}
                onScan={startScan}
                onOpen={openInspection}
                onHistory={() => setView("history")}
                error={loadError}
              />
            )}
            {view === "scan" && (
              <ProductAwareScan
                key="scan"
                onComplete={handleScanComplete}
                initialProductId={rescanInspection?.productId ?? ""}
                resubmissionOf={rescanInspection?.id}
              />
            )}
            {view === "history" && (
              <ConnectedHistory
                key="history"
                inspections={inspections}
                onOpen={openInspection}
                onNewScan={() => setView("scan")}
              />
            )}
            {view === "analytics" && <ConnectedAnalytics key="analytics" />}
            {view === "rules" && <ConnectedRules key="rules" />}
            {view === "people" && <ConnectedPeople key="people" user={user} />}
            {view === "products" && <MatchingProductCatalog key="products" />}
            {view === "notifications" && (
              <ConnectedNotifications key="notifications" />
            )}
            {view === "report" && selected && (
              <FixedConnectedReport
                key="report"
                inspection={selected}
                onBack={() => setView("history")}
                onRetake={() => {
                  setRescanInspection(selected);
                  setView("scan");
                }}
              />
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function Login({ onLogin, theme, onThemeToggle }: { onLogin: (user: AuthUser) => void; theme: "light" | "dark"; onThemeToggle: () => void }) {
  const [role, setRole] = useState("Enforcement officer");
  const [email, setEmail] = useState("arun.sharma@metrology.gov.in");
  const [password, setPassword] = useState("metro-check");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const roleDetails: Record<string, { email: string; label: string }> = {
    "Enforcement officer": {
      email: "arun.sharma@metrology.gov.in",
      label: "officer",
    },
    Administrator: { email: "nisha.verma@metrology.gov.in", label: "admin" },
    Company: { email: "compliance@kaverihomecare.in", label: "company" },
  };
  const chooseRole = (nextRole: string) => {
    setRole(nextRole);
    setEmail(roleDetails[nextRole].email);
    setError("");
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.message ?? "Unable to sign in");
      return;
    }
    onLogin({ ...data.user, token: data.token });
  };
  return (
    <div className="login-shell">
      <div className="login-aside">
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={21} />
          </div>
          <div>
            <strong>metro-check</strong>
            <span>LEGAL METROLOGY / INDIA</span>
          </div>
        </div>
        <div className="login-hero">
          <div className="login-quote"><span className="eyebrow">FIELD INTELLIGENCE</span><h1>Compliance today for a <em>fairer tomorrow.</em></h1><p>A transparent workflow for inspecting, explaining and resolving packaged commodity violations.</p></div>
          <div className="workflow-list">
            {[[Camera, "Scan", "Capture label or barcode"], [FileText, "Analyze", "Extract & check declarations"], [ShieldCheck, "Verify", "Match with legal standards"], [BarChart3, "Report", "View results & take action"]].map(([Icon, title, description], index) => { const StepIcon = Icon as typeof Camera; return <div className="workflow-step" key={title as string} style={{ "--delay": `${index * 110}ms` } as React.CSSProperties}><span className="workflow-icon"><StepIcon size={25} /></span><div><b>{title as string}</b><small>{description as string}</small></div></div>; })}
          </div>
        </div>
        <div className="login-stats"><div><strong>1,284</strong><span>Labels checked<br />across District 04</span></div><div><strong>96.8%</strong><span>Compliance rate<br />this quarter</span></div><div><strong>42</strong><span>Pending for review</span></div></div>
        <div className="login-footer">
          Ministry of Consumer Affairs · Audit-ready by design
        </div>
      </div>
      <main className="login-main">
        <div className="login-topline"><div className="gov-mark"><span>Government of India</span><b>⚖</b><span>Fair Trade<br /><em>Stronger India</em></span></div><ThemeToggle theme={theme} onToggle={onThemeToggle} showLabel /></div>
        <section className="login-card"><form className="login-form" onSubmit={submit}>
          <span className="eyebrow">SECURE ACCESS</span>
          <h2>Sign in to Metro-Check</h2>
          <p className="login-copy">
            Use your department credentials to continue to the inspection
            register.
          </p>
          <label>
            Email address
            <span className="login-input"><Mail size={18} /><input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            /></span>
          </label>
          <label>
            Password
            <span className="login-input">
              <LockKeyhole size={18} />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? "Hide" : "Show"}</button>
            </span>
          </label>
          <div className="role-label">
            <span>Continue as</span>
          </div>
          <div className="role-options">
            {Object.keys(roleDetails).map((item) => (
              <button
                type="button"
                className={role === item ? "selected" : ""}
                onClick={() => chooseRole(item)}
                key={item}
              ><ShieldCheck size={20} /><b>{item === "Enforcement officer" ? <>Enforcement<br />officer</> : item}</b><small>{item === "Enforcement officer" ? "Inspect & verify" : item === "Administrator" ? "Manage system" : "View compliance"}</small></button>
            ))}
          </div>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="button primary login-button">
            Enter {roleDetails[role].label} dashboard <ArrowUpRight size={17} />
          </button>
          <span className="login-help"><ShieldCheck size={15} /> SSO and audit logging enabled <i /> Secure Government Network</span>
        </form></section>
      </main>
    </div>
  );
}

function RoleShell({
  user,
  onLogout,
  onNotificationsToggle,
  notificationsOpen = false,
  children,
}: {
  user: AuthUser;
  onLogout: () => void;
  onNotificationsToggle?: () => void;
  notificationsOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={21} />
          </div>
          <div>
            <strong>metro-check</strong>
            <span>LEGAL METROLOGY / INDIA</span>
          </div>
        </div>
        <div className="workspace-switcher">
          <span className="avatar small">
            {user.name.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <b>{user.name}</b>
            <small>
              {user.role === "admin" ? "Administrator" : "Company account"}
            </small>
          </div>
        </div>
        <nav>
          <div className="nav-item active">
            <LayoutDashboard size={18} />
            <span>
              {user.role === "admin" ? "Admin dashboard" : "Company dashboard"}
            </span>
          </div>
          <button className="nav-item" onClick={onLogout}>
            <ArrowUpRight size={18} />
            <span>Sign out</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-box">
            <span className="eyebrow">AUDIT TRAIL</span>
            <p>
              {user.role === "admin"
                ? "All rule changes and officer actions are recorded."
                : "Every self-check remains available to your compliance team."}
            </p>
          </div>
          <div className="sidebar-footer">
            <span>Signed in securely</span>
            <button aria-label="Sign out" onClick={onLogout}>
              <ArrowUpRight size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="crumb">
            <span>Metro-Check</span>
            <ChevronRight size={14} />
            <b>
              {user.role === "admin"
                ? "Administrator dashboard"
                : "Company dashboard"}
            </b>
          </div>
          <div className="top-actions">
            <ThemeToggle />
            {onNotificationsToggle && (
              <button
                className="icon-button notification"
                aria-label="Notifications"
                aria-pressed={notificationsOpen}
                onClick={onNotificationsToggle}
              >
                <Bell size={19} />
              </button>
            )}
            <ProfileDropdown user={user} onLogout={onLogout} />
          </div>
        </header>
        <div className="page-wrap">
          {children}
          {user.role === "company" && <CompanyReportList user={user} />}
        </div>
      </main>
    </div>
  );
}

function AdminDashboard({
  user,
  onLogout,
}: {
  user: AuthUser;
  onLogout: () => void;
}) {
  return (
    <RoleShell user={user} onLogout={onLogout}>
      <Page
        kicker="ADMINISTRATION / STATE OFFICE"
        title="The state picture, clearly."
        action={
          <button className="button primary">
            <FileText size={16} /> Export briefing
          </button>
        }
      >
        <div className="signal-band">
          <div>
            <span className="eyebrow">ADMINISTRATOR VIEW</span>
            <h2>Compliance is moving in the right direction.</h2>
            <p>
              Monitor districts, rules and open cases from one accountable
              register.
            </p>
          </div>
          <div className="signal-number">
            <strong>82.4%</strong>
            <span>state compliance rate</span>
          </div>
        </div>
        <div className="metric-grid">
          <Metric
            label="Labels inspected"
            value="1,284"
            detail="↑ 8.6% this month"
            tone="positive"
            icon={<ClipboardCheck />}
          />
          <Metric
            label="Open violations"
            value="64"
            detail="12 high priority"
            tone="alert"
            icon={<AlertTriangle />}
          />
          <Metric
            label="Active officers"
            value="24"
            detail="Across 8 districts"
            tone="neutral"
            icon={<Users />}
          />
          <Metric
            label="Rules active"
            value="5 / 5"
            detail="Last reviewed today"
            tone="positive"
            icon={<ShieldCheck />}
          />
        </div>
        <div className="section-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">DISTRICT PERFORMANCE</span>
                <h3>Where attention is needed</h3>
              </div>
              <ArrowUpRight size={17} />
            </div>
            <div className="flag-list">
              <Flag
                label="District 07 · Food declarations"
                count="18 open cases"
                percent="71%"
              />
              <Flag
                label="District 04 · Consumer care"
                count="9 open cases"
                percent="84%"
              />
              <Flag
                label="District 02 · Date marking"
                count="6 open cases"
                percent="89%"
              />
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">RECENT CONTROL CHANGES</span>
                <h3>Audit activity</h3>
              </div>
            </div>
            <div className="notification-row">
              <span className="notification-symbol info">
                <Settings2 size={17} />
              </span>
              <div>
                <b>Minimum font threshold reviewed</b>
                <p>Rule 6(1)(e) remains at 2 mm</p>
                <small>Today · Nisha Verma</small>
              </div>
            </div>
            <div className="notification-row">
              <span className="notification-symbol warning">
                <Users size={17} />
              </span>
              <div>
                <b>Officer access updated</b>
                <p>District 04 permissions renewed</p>
                <small>Yesterday · State office</small>
              </div>
            </div>
          </section>
        </div>
      </Page>
    </RoleShell>
  );
}

function LegacyCompanyDashboard({
  user,
  onLogout,
}: {
  user: AuthUser;
  onLogout: () => void;
}) {
  return (
    <RoleShell user={user} onLogout={onLogout}>
      <Page
        kicker="COMPANY PORTAL / KAVERI HOMECARE"
        title="Keep every label ready for market."
        action={
          <button className="button primary">
            <Plus size={17} /> Start self-check
          </button>
        }
      >
        <div className="signal-band">
          <div>
            <span className="eyebrow">COMPANY COMPLIANCE</span>
            <h2>Two products need your attention.</h2>
            <p>Resolve flagged declarations before your next dispatch.</p>
          </div>
          <div className="signal-number">
            <strong>78%</strong>
            <span>portfolio pass rate</span>
          </div>
        </div>
        <div className="metric-grid">
          <Metric
            label="Registered products"
            value="18"
            detail="3 added this quarter"
            tone="neutral"
            icon={<Package />}
          />
          <Metric
            label="Self-checks completed"
            value="42"
            detail="↑ 6 this month"
            tone="positive"
            icon={<ClipboardCheck />}
          />
          <Metric
            label="Open officer flags"
            value="2"
            detail="Response due in 4 days"
            tone="alert"
            icon={<AlertTriangle />}
          />
          <Metric
            label="Avg. score"
            value="91%"
            detail="↑ 3 pts from August"
            tone="positive"
            icon={<BadgeCheck />}
          />
        </div>
        <div className="section-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">PRODUCTS REQUIRING ACTION</span>
                <h3>Resolve before dispatch</h3>
              </div>
            </div>
            <div className="catalogue">
              <div className="catalogue-row">
                <span className="product-thumb">
                  <Package size={19} />
                </span>
                <div>
                  <b>Lemon Floor Cleaner</b>
                  <small>Consumer care details missing</small>
                </div>
                <Status status="Action required" />
                <ChevronRight size={17} />
              </div>
              <div className="catalogue-row">
                <span className="product-thumb">
                  <Package size={19} />
                </span>
                <div>
                  <b>Disinfectant Concentrate</b>
                  <small>Net quantity format needs review</small>
                </div>
                <Status status="Action required" />
                <ChevronRight size={17} />
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">LATEST OFFICER NOTE</span>
                <h3>INSP-2406</h3>
              </div>
              <Bell size={17} />
            </div>
            <div className="panel-note">
              <AlertTriangle size={17} />
              <span>
                Submit a corrected label response within 4 days to keep the case
                moving.
              </span>
            </div>
            <button className="button secondary full" style={{ marginTop: 22 }}>
              View inspection report <ArrowUpRight size={16} />
            </button>
          </section>
        </div>
      </Page>
    </RoleShell>
  );
}

function Page({
  children,
  title,
  kicker,
  action,
}: {
  children: React.ReactNode;
  title: string;
  kicker: string;
  action?: React.ReactNode;
}) {
  return (
    <motion.section
      className="page"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
    >
      <div className="page-heading">
        <div>
          <span className="eyebrow">{kicker}</span>
          <h1>{title}</h1>
        </div>
        {action}
      </div>
      {children}
    </motion.section>
  );
}
function Status({ status }: { status: string }) {
  const good = status === "Compliant";
  return (
    <span className={`status ${good ? "good" : "warning"}`}>
      <span />
      {status}
    </span>
  );
}

function Overview({
  inspections,
  onScan,
  onOpen,
  onHistory,
  error,
}: {
  inspections: Inspection[];
  onScan: () => void;
  onOpen: (inspection: Inspection) => void;
  onHistory: () => void;
  error: string;
}) {
  const todayCount = inspections.filter((item) =>
    new Date(item.createdAt).toDateString() === new Date().toDateString(),
  ).length;
  const monthCount = inspections.filter((item) => {
    const createdAt = new Date(item.createdAt);
    const now = new Date();
    return createdAt.getFullYear() === now.getFullYear() && createdAt.getMonth() === now.getMonth();
  }).length;
  const openViolations = inspections.filter((item) => item.status !== "Compliant").length;
  const passRate = inspections.length ? Math.round((inspections.filter((item) => item.status === "Compliant").length / inspections.length) * 100) : 0;
  return (
    <Page
      kicker="Saturday, 12 September 2026 · District 04"
      title="Good morning, Arun."
      action={
        <button className="button primary" onClick={onScan}>
          <Plus size={17} /> New inspection
        </button>
      }
    >
      {error && (
        <div className="error-banner">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      <div className="signal-band">
        <div>
          <span className="eyebrow">TODAY'S FIELD SIGNAL</span>
          <h2>
            {todayCount} labels checked. <em>{openViolations ? `${openViolations} need attention.` : "Nothing needs attention."}</em>
          </h2>
          <p>Stay ahead of declarations before they reach the shelf.</p>
        </div>
        <div className="signal-number">
          <strong>{todayCount}</strong>
          <span>inspections today</span>
        </div>
        <div className={`signal-ring ${passRate === 0 ? "empty" : passRate < 80 ? "warning" : "healthy"}`}>
          <span>{passRate}%</span>
          <small>pass rate</small>
        </div>
      </div>
      <div className="metric-grid">
        <Metric
          label="Inspections this month"
          value={String(monthCount)}
          detail="Live inspection register"
          tone="positive"
          icon={<ClipboardCheck />}
        />
        <Metric
          label="Open violations"
          value={String(openViolations)}
          detail="From current inspection register"
          tone="alert"
          icon={<AlertTriangle />}
        />
        <Metric
          label="Average check time"
          value="—"
          detail="Collected after completed scans"
          tone="positive"
          icon={<Activity />}
        />
        <Metric
          label="Coverage this quarter"
          value={inspections.length ? "100%" : "0%"}
          detail="Based on current inspection register"
          tone="neutral"
          icon={<BadgeCheck />}
        />
      </div>
      <section className="panel recent-activity-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ACTION NEEDED NOW</span>
            <h3>Needs attention</h3>
          </div>
          <button className="text-button" onClick={onHistory}>
            View all in Inspection history <ArrowUpRight size={14} />
          </button>
        </div>
        <RecentActivity inspections={inspections} onOpen={onOpen} />
      </section>
    </Page>
  );
}
function Metric({
  label,
  value,
  detail,
  tone,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  tone: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="metric">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small className={tone === "alert" ? "alert-text" : ""}>{detail}</small>
    </div>
  );
}
function RecentActivity({
  inspections,
  onOpen,
}: {
  inspections: Inspection[];
  onOpen: (inspection: Inspection) => void;
}) {
  const pending = inspections
    .filter((inspection) => inspection.status === "Review required")
    .slice(0, 4);
  return (
    <div className="recent-activity-list">
      {pending.length ? (
        pending.map((inspection) => {
          const failedChecks = (inspection.checks ?? []).filter(
            (check) => !check.isCompliant,
          );
          const productLabel =
            inspection.product === "Uploaded label"
              ? `${inspection.company} label`
              : inspection.product;
          const reason = failedChecks[0]?.label
            ? `${failedChecks[0].label} needs review`
            : inspection.ocrConfidence !== null &&
                inspection.ocrConfidence !== undefined
              ? `OCR confidence ${inspection.ocrConfidence}%`
              : "Label evidence needs review";
          const severity =
            (inspection.ocrConfidence !== null &&
              inspection.ocrConfidence !== undefined &&
              inspection.ocrConfidence < 50) ||
            failedChecks.length >= 3
              ? "high"
              : failedChecks.length >= 1
                ? "medium"
                : "low";
          return (
            <div className="recent-activity-row" key={inspection.id}>
              <div className="recent-activity-main">
                <span className="mono">{inspection.id}</span>
                <b className="recent-activity-product">{productLabel}</b>
                <small>{reason}</small>
              </div>
              <span className={`severity-chip ${severity}`}>
                {severity[0].toUpperCase() + severity.slice(1)}
              </span>
              <span className="muted">
                {relativeTime(inspection.createdAt)}
              </span>
              <button
                type="button"
                className="button ghost recent-activity-action"
                onClick={() => onOpen(inspection)}
              >
                View
              </button>
            </div>
          );
        })
      ) : (
        <div className="attention-empty">
          <Check size={18} />
          <div>
            <b>Nothing needs attention</b>
            <small>Review-required inspections will appear here.</small>
          </div>
        </div>
      )}
    </div>
  );
}
function Flag({
  label,
  count,
  percent,
}: {
  label: string;
  count: string;
  percent: string;
}) {
  return (
    <div className="flag-row">
      <div className="flag-icon">
        <AlertTriangle size={15} />
      </div>
      <div>
        <b>{label}</b>
        <small>{count}</small>
      </div>
      <strong>{percent}</strong>
    </div>
  );
}
function InspectionTable({
  inspections,
  onOpen,
}: {
  inspections: Inspection[];
  onOpen: (inspection: Inspection) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Inspection</th>
            <th>Product / company</th>
            <th>Result</th>
            <th>Score</th>
            <th>When</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {inspections.map((inspection) => (
            <tr key={inspection.id} onClick={() => onOpen(inspection)}>
              <td>
                <b className="mono">{inspection.id}</b>
              </td>
              <td>
                <b>{inspection.product}</b>
                <small>{inspection.company}</small>
              </td>
              <td>
                <Status status={inspection.status} />
              </td>
              <td>
                <strong>{inspection.score}%</strong>
              </td>
              <td className="muted">{relativeTime(inspection.createdAt)}</td>
              <td>
                <ChevronRight size={16} className="row-arrow" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function relativeTime(date: string) {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
}

function Scan({
  onComplete,
}: {
  onComplete: (inspection: Inspection) => void;
}) {
  const [stage, setStage] = useState<"upload" | "processing">("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<Inspection | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const stages = [
    "Reading label text",
    "Detecting declarations",
    "Checking font size",
    "Validating against rules",
  ];
  const submit = async () => {
    setStage("processing");
    setError("");
    const formData = new FormData();
    files.forEach((file) => formData.append("images", file));
    formData.append("companyId", "company-kaveri");
    formData.append("productId", "product-001");
    try {
      const data = await apiRequest<Inspection>("/api/scan", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("metro-check-token") ?? ""}`,
        },
        body: formData,
      });
      setResult(data);
      setTimeout(() => onComplete(data), 2800);
    } catch (scanError) {
      setStage("upload");
      setError(scanError instanceof Error ? scanError.message : "Scan failed");
    }
  };
  return (
    <Page
      kicker="OFFICER WORKFLOW / STEP 01"
      title="Inspect a packaged commodity."
      action={
        stage === "upload" ? (
          <div className="step-count">
            <b>01</b>
            <span>Upload label</span>
            <i />
            <span>02 Results</span>
          </div>
        ) : undefined
      }
    >
      {stage === "upload" && (
        <div className="scanner-layout">
          <div className="scanner-card">
            <div className="scanner-top">
              <div>
                <span className="eyebrow">LABEL CAPTURE</span>
                <h2>Capture both display panels</h2>
                <p>
                  Sharp, straight-on images produce the clearest declaration
                  matches.
                </p>
              </div>
              <Camera size={28} />
            </div>
            {error && (
              <div className="error-banner">
                <AlertTriangle size={16} /> {error}
              </div>
            )}
            <div
              className={`drop-zone ${files.length ? "has-files" : ""}`}
              onClick={() => inputRef.current?.click()}
            >
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(event) =>
                  setFiles(Array.from(event.target.files ?? []))
                }
              />
              {files.length ? (
                <>
                  <div className="upload-success">
                    <Check size={22} />
                  </div>
                  <h3>
                    {files.length} image{files.length > 1 ? "s" : ""} ready
                  </h3>
                  <p>{files.map((file) => file.name).join(" · ")}</p>
                  <button type="button" className="text-button">
                    Replace images
                  </button>
                </>
              ) : (
                <>
                  <div className="upload-icon">
                    <Upload size={23} />
                  </div>
                  <h3>Drop label images here</h3>
                  <p>or click to browse · JPG, PNG up to 10 MB</p>
                  <button type="button" className="button secondary">
                    <Camera size={17} /> Open camera
                  </button>
                </>
              )}
            </div>
            <div className="capture-tips">
              <div>
                <Check size={15} />
                <span>Include MRP and quantity</span>
              </div>
              <div>
                <Check size={15} />
                <span>Keep text in focus</span>
              </div>
              <div>
                <Check size={15} />
                <span>Avoid glare</span>
              </div>
            </div>
          </div>
          <aside className="scan-aside">
            <span className="eyebrow">WHAT WILL BE CHECKED</span>
            <h3>Five mandatory declarations</h3>
            {[
              "Manufacturer / packer",
              "Net quantity",
              "Date marking",
              "Maximum retail price",
              "Consumer care details",
            ].map((item, index) => (
              <div className="check-list-item" key={item}>
                <span>0{index + 1}</span>
                {item}
                <BadgeCheck size={15} />
              </div>
            ))}
            <div className="legal-note">
              <FileText size={18} />
              <p>
                Mapped to Legal Metrology (Packaged Commodities) Rules, 2011.
              </p>
            </div>
          </aside>
        </div>
      )}
      {stage === "processing" && <Processing stages={stages} result={result} />}
      {stage === "upload" && (
        <div className="scan-footer">
          <span>
            <ShieldCheck size={16} /> Evidence is encrypted and audit logged
          </span>
          <button
            className="button primary"
            disabled={!files.length}
            onClick={submit}
          >
            Run compliance check <ArrowUpRight size={17} />
          </button>
        </div>
      )}
    </Page>
  );
}
function Processing({
  stages,
  result,
}: {
  stages: string[];
  result: Inspection | null;
}) {
  return (
    <div className="processing">
      <div className="processing-visual">
        <div className="scan-orb">
          <div className="scan-line" />
          <ShieldCheck size={46} />
        </div>
        <span className="eyebrow">TRANSPARENT PROCESSING</span>
        <h2>Reading the label, line by line.</h2>
        <p>
          Metro-Check checks every declaration against the active rule set. No
          black box.
        </p>
      </div>
      <div className="progress-steps">
        {stages.map((stage, index) => (
          <div
            className={`progress-step ${result || index < 3 ? "done" : index === 3 ? "current" : ""}`}
            key={stage}
          >
            <span>{result || index < 3 ? <Check size={15} /> : index + 1}</span>
            <div>
              <b>{stage}…</b>
              <small>
                {result || index < 3
                  ? "Complete"
                  : index === 3
                    ? "Comparing against Rule 6"
                    : "Queued"}
              </small>
            </div>
            {index < 3 && <div className="step-bar" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function History({
  inspections,
  onOpen,
  onNewScan,
}: {
  inspections: Inspection[];
  onOpen: (inspection: Inspection) => void;
  onNewScan: () => void;
}) {
  return (
    <Page
      kicker="REGISTER / 184 TOTAL"
      title="Inspection history"
      action={
        <button className="button primary" onClick={onNewScan}>
          <Plus size={17} /> New inspection
        </button>
      }
    >
      <div className="toolbar">
        <div className="search-field">
          <Search size={17} />
          <input placeholder="Search ID, product or company" />
        </div>
        <button className="button ghost">
          <Filter size={16} /> All results <ChevronRight size={15} />
        </button>
        <button className="button ghost">
          Last 30 days <ChevronRight size={15} />
        </button>
      </div>
      <section className="panel">
        <InspectionTable inspections={inspections} onOpen={onOpen} />
      </section>
    </Page>
  );
}
function Analytics() {
  return (
    <Page
      kicker="ADMINISTRATION / DISTRICT 04"
      title="State compliance at a glance"
      action={
        <button className="button ghost">
          <FileText size={16} /> Export briefing
        </button>
      }
    >
      <div className="metric-grid">
        <Metric
          label="Compliance rate"
          value="82.4%"
          detail="↑ 4.2 pts this month"
          tone="positive"
          icon={<BadgeCheck />}
        />
        <Metric
          label="Labels inspected"
          value="1,284"
          detail="Across 8 districts"
          tone="neutral"
          icon={<ClipboardCheck />}
        />
        <Metric
          label="Open cases"
          value="64"
          detail="12 high priority"
          tone="alert"
          icon={<AlertTriangle />}
        />
        <Metric
          label="Avg. resolution"
          value="6.4d"
          detail="↓ 1.1 days"
          tone="positive"
          icon={<Activity />}
        />
      </div>
      <div className="chart-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">LAST 7 DAYS</span>
              <h3>Compliance trend</h3>
            </div>
            <span className="chart-legend">
              <i /> Pass rate
            </span>
          </div>
          <ResponsiveContainer width="100%" height={270}>
            <BarChart
              data={trend}
              margin={{ top: 20, right: 12, left: -20, bottom: 0 }}
            >
              <CartesianGrid vertical={false} stroke="#e7e5dc" />
              <XAxis
                dataKey="day"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#7f8177", fontSize: 12 }}
              />
              <YAxis
                domain={[50, 100]}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#7f8177", fontSize: 12 }}
              />
              <Tooltip cursor={{ fill: "#f7f6ef" }} />
              <Bar
                dataKey="value"
                fill="#e5a93d"
                radius={[4, 4, 0, 0]}
                barSize={28}
              />
            </BarChart>
          </ResponsiveContainer>
        </section>
        <section className="panel chart-panel category-chart">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">BY PRODUCT CATEGORY</span>
              <h3>Inspection mix</h3>
            </div>
          </div>
          <div className="donut-wrap">
            <ResponsiveContainer width="48%" height={180}>
              <PieChart>
                <Pie
                  data={categoryData}
                  innerRadius={52}
                  outerRadius={76}
                  dataKey="value"
                  stroke="none"
                >
                  {categoryData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="legend-list">
              {categoryData.map((item) => (
                <div key={item.name}>
                  <i style={{ background: item.color }} />
                  <span>{item.name}</span>
                  <b>{item.value}%</b>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </Page>
  );
}

function Rules() {
  const [rules, setRules] = useState([
    {
      label: "Maximum Retail Price",
      section: "Rule 6(1)(e)",
      threshold: "2 mm",
      active: true,
    },
    {
      label: "Net quantity",
      section: "Rule 6(1)(d)",
      threshold: "2 mm",
      active: true,
    },
    {
      label: "Date marking",
      section: "Rule 6(1)(c)",
      threshold: "2 mm",
      active: true,
    },
    {
      label: "Manufacturer / packer",
      section: "Rule 6(1)(a)",
      threshold: "2 mm",
      active: true,
    },
    {
      label: "Consumer care",
      section: "Rule 6(1)(f)",
      threshold: "2 mm",
      active: true,
    },
  ]);
  return (
    <Page
      kicker="ADMINISTRATION / AUDITABLE CORE"
      title="Rule configuration"
      action={
        <button className="button primary">
          <Check size={17} /> Save changes
        </button>
      }
    >
      <div className="rule-intro">
        <div>
          <ShieldCheck size={24} />
          <div>
            <h3>Active rule set · Packaged Commodities Rules, 2011</h3>
            <p>
              Changes are versioned and attached to every future inspection
              report.
            </p>
          </div>
        </div>
        <span className="version-tag">v2.4 · active</span>
      </div>
      <section className="panel rule-panel">
        <div className="rule-table-header">
          <span>Declaration</span>
          <span>Legal reference</span>
          <span>Minimum text height</span>
          <span>Status</span>
        </div>
        {rules.map((rule, index) => (
          <div className="rule-row" key={rule.label}>
            <div>
              <span className="rule-number">0{index + 1}</span>
              <b>{rule.label}</b>
            </div>
            <span className="mono reference">{rule.section}</span>
            <label className="input-unit">
              <input
                value={rule.threshold.replace(" mm", "")}
                onChange={(event) =>
                  setRules((current) =>
                    current.map((item) =>
                      item.label === rule.label
                        ? { ...item, threshold: `${event.target.value} mm` }
                        : item,
                    ),
                  )
                }
              />
              <span>mm</span>
            </label>
            <button
              className={`toggle ${rule.active ? "on" : ""}`}
              onClick={() =>
                setRules((current) =>
                  current.map((item) =>
                    item.label === rule.label
                      ? { ...item, active: !item.active }
                      : item,
                  ),
                )
              }
            >
              <i />
            </button>
          </div>
        ))}
        <div className="rule-foot">
          <FileText size={16} />
          <span>
            Regex patterns and evidence notes are managed in the server rule
            registry.
          </span>
          <button className="text-button">
            View JSON registry <ArrowUpRight size={14} />
          </button>
        </div>
      </section>
    </Page>
  );
}
function People() {
  return (
    <Page
      kicker="ADMINISTRATION / 24 ACTIVE USERS"
      title="Officers & access"
      action={
        <button className="button primary">
          <Plus size={17} /> Add officer
        </button>
      }
    >
      <div className="toolbar">
        <div className="search-field">
          <Search size={17} />
          <input placeholder="Search officers" />
        </div>
        <button className="button ghost">
          All roles <ChevronRight size={15} />
        </button>
      </div>
      <section className="panel people-panel">
        {[
          ["AS", "Arun Sharma", "Enforcement officer", "District 04", "Active"],
          ["PM", "Priya Menon", "Senior officer", "District 02", "Active"],
          [
            "RK",
            "Rakesh Kumar",
            "Enforcement officer",
            "District 04",
            "Active",
          ],
          ["NV", "Nisha Verma", "Administrator", "State office", "Active"],
        ].map(([initials, name, role, district, status]) => (
          <div className="person-row" key={name}>
            <span className="avatar">{initials}</span>
            <div>
              <b>{name}</b>
              <small>{role}</small>
            </div>
            <span className="muted">{district}</span>
            <Status status="Compliant" />
            <button className="icon-button">
              <ChevronRight size={17} />
            </button>
          </div>
        ))}
      </section>
    </Page>
  );
}
function Products() {
  return (
    <Page
      kicker="COMPANY REGISTRY / 438 PRODUCTS"
      title="Product register"
      action={
        <button className="button primary">
          <Plus size={17} /> Register product
        </button>
      }
    >
      <div className="product-feature">
        <div>
          <span className="eyebrow">SELF-CHECK PORTAL</span>
          <h2>Give manufacturers a clear path to compliance.</h2>
          <p>
            Invite a company to submit a label before dispatch. Their
            self-checks stay visible to your team.
          </p>
          <button className="button dark">
            Open company portal <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="product-stamp">
          <Package size={29} />
          <b>438</b>
          <span>registered products</span>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">RECENTLY ADDED</span>
            <h3>Product catalogue</h3>
          </div>
          <button className="text-button">
            View all <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="catalogue">
          {[
            [
              "Sunrise Mustard Oil",
              "Bharat Foods Pvt Ltd",
              "Edible oils",
              "Compliant",
            ],
            ["A2 Cow Ghee", "Nourish Naturals", "Dairy", "Action required"],
            [
              "Lemon Floor Cleaner",
              "Kaveri Homecare",
              "Homecare",
              "Action required",
            ],
          ].map(([name, company, category, status]) => (
            <div className="catalogue-row" key={name}>
              <span className="product-thumb">
                <Package size={19} />
              </span>
              <div>
                <b>{name}</b>
                <small>
                  {company} · {category}
                </small>
              </div>
              <Status status={status} />
              <ChevronRight size={17} />
            </div>
          ))}
        </div>
      </section>
    </Page>
  );
}
function Notifications() {
  return (
    <Page
      kicker="INBOX / 3 UNREAD"
      title="Notifications"
      action={<button className="button ghost">Mark all as read</button>}
    >
      <section className="panel notification-panel">
        {[
          [
            "Action required",
            "Nourish Naturals resubmitted A2 Cow Ghee",
            "12 minutes ago",
            "warning",
          ],
          [
            "New self-check",
            "Kaveri Homecare submitted Lemon Floor Cleaner",
            "Yesterday",
            "info",
          ],
          [
            "Case reminder",
            "INSP-2402 follow-up is due tomorrow",
            "Yesterday",
            "alert",
          ],
        ].map(([title, text, when, tone]) => (
          <div className="notification-row" key={text}>
            <span className={`notification-symbol ${tone}`}>
              <Bell size={17} />
            </span>
            <div>
              <b>{title}</b>
              <p>{text}</p>
              <small>{when}</small>
            </div>
            <ChevronRight size={17} />
          </div>
        ))}
      </section>
    </Page>
  );
}
function Report({
  inspection,
  onBack,
}: {
  inspection: Inspection;
  onBack: () => void;
}) {
  const checks = inspection.checks ?? [];
  const passed = checks.filter((check) => check.isCompliant).length;
  return (
    <Page
      kicker={`REPORT / ${inspection.id}`}
      title="Inspection result"
      action={
        <>
          <button className="button ghost" onClick={onBack}>
            Back to history
          </button>
          <button className="button primary">
            <FileText size={16} /> Download PDF
          </button>
        </>
      }
    >
      <div
        className={`result-banner ${inspection.status === "Compliant" ? "result-good" : "result-bad"}`}
      >
        <div className="result-icon">
          {inspection.status === "Compliant" ? (
            <Check size={28} />
          ) : (
            <AlertTriangle size={27} />
          )}
        </div>
        <div>
          <span className="eyebrow">FINAL DETERMINATION</span>
          <h2>
            {inspection.status === "Compliant"
              ? "Label declarations are compliant."
              : "Action required before release."}
          </h2>
          <p>
            {passed} of {checks.length || 5} mandatory declarations matched the
            active rule set.
          </p>
        </div>
        <div className="result-score">
          <strong>{inspection.score}%</strong>
          <span>compliance score</span>
        </div>
      </div>
      <div className="report-grid">
        <section className="panel declarations-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">DECLARATION CHECKS</span>
              <h3>Evidence register</h3>
            </div>
            <span className="mono">RULE SET v2.4</span>
          </div>
          {checks.length ? (
            checks.map((check) => (
              <div
                className={`declaration-row ${check.isCompliant ? "pass" : "fail"}`}
                key={check.fieldName}
              >
                <div className="declaration-status">
                  {check.isCompliant ? <Check size={17} /> : <X size={17} />}
                </div>
                <div className="declaration-copy">
                  <b>{check.label}</b>
                  <span>
                    {check.detectedValue
                      ? `Detected: ${check.detectedValue}`
                      : "Declaration not detected on supplied images"}
                  </span>
                </div>
                <div className="declaration-ref">
                  <b>{check.ruleSection}</b>
                  <small>{check.confidenceNote}</small>
                </div>
                <ChevronRight size={16} />
              </div>
            ))
          ) : (
            <div className="empty-report">
              <ClipboardCheck size={27} />
              <p>Open a completed scan to see declaration evidence.</p>
            </div>
          )}
        </section>
        <aside className="panel evidence-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">EVIDENCE</span>
              <h3>Inspection record</h3>
            </div>
          </div>
          <div className="evidence-image">
            <div className="corner c1" />
            <div className="corner c2" />
            <div className="corner c3" />
            <div className="corner c4" />
            <Package size={45} />
            <span>Label image preview</span>
          </div>
          <div className="evidence-meta">
            <div>
              <span>Inspector</span>
              <b>Arun Sharma</b>
            </div>
            <div>
              <span>Captured</span>
              <b>
                {new Date(inspection.createdAt).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </b>
            </div>
            <div>
              <span>OCR confidence</span>
              <b>94.8%</b>
            </div>
          </div>
          <button className="button secondary full">
            <Upload size={16} /> Add evidence photo
          </button>
        </aside>
      </div>
    </Page>
  );
}

function ConnectedHistory({
  inspections,
  onOpen,
  onNewScan,
}: {
  inspections: Inspection[];
  onOpen: (inspection: Inspection) => void;
  onNewScan: () => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [violation, setViolation] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const violations = [
    ...new Set(
      inspections.flatMap((inspection) =>
        (inspection.checks ?? [])
          .filter((check) => !check.isCompliant)
          .map((check) => check.label),
      ),
    ),
  ].sort();
  const filtered = inspections.filter((inspection) => {
    const haystack =
      `${inspection.id} ${inspection.product} ${inspection.company}`.toLowerCase();
    const inspectionDate = inspection.createdAt.slice(0, 10);
    const hasViolation =
      violation === "all" ||
      (inspection.checks ?? []).some(
        (check) => !check.isCompliant && check.label === violation,
      );
    return (
      haystack.includes(query.toLowerCase()) &&
      (status === "all" || inspection.status === status) &&
      hasViolation &&
      (!fromDate || inspectionDate >= fromDate) &&
      (!toDate || inspectionDate <= toDate)
    );
  });
  return (
    <Page
      kicker="REGISTER / 184 TOTAL"
      title="Inspection history"
      action={
        <button className="button primary" onClick={onNewScan}>
          <Plus size={17} /> New inspection
        </button>
      }
    >
      <div className="toolbar history-filters">
        <div className="search-field">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search product, brand, ID or company"
          />
        </div>
        <select
          className="button ghost"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="Compliant">Compliant</option>
          <option value="Review required">Review required</option>
          <option value="Action required">Action required</option>
        </select>
        <select
          className="button ghost"
          value={violation}
          onChange={(event) => setViolation(event.target.value)}
        >
          <option value="all">All violation types</option>
          {violations.map((item) => (
            <option value={item} key={item}>
              {item}
            </option>
          ))}
        </select>
        <label className="date-filter">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </label>
        <label className="date-filter">
          To
          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </label>
        <button
          className="button ghost"
          onClick={() => {
            setQuery("");
            setStatus("all");
            setViolation("all");
            setFromDate("");
            setToDate("");
          }}
        >
          Clear filters
        </button>
      </div>
      <section className="panel">
        <InspectionTable inspections={filtered} onOpen={onOpen} />
      </section>
    </Page>
  );
}

type ConnectedRule = {
  fieldName: string;
  label: string;
  ruleSection: string;
  minFontSizeMm: number;
  settings?: { isActive: boolean; minFontSizeMm: number; readabilityThreshold: number; verificationThreshold: number };
};
function ConnectedRules() {
  const [items, setItems] = useState<ConnectedRule[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    apiRequest<ConnectedRule[]>("/api/rules")
      .then(setItems)
      .catch((requestError: Error) => setError(requestError.message));
  }, []);
  const update = async (
    item: ConnectedRule,
    patch: { minFontSizeMm?: number; isActive?: boolean; readabilityThreshold?: number; verificationThreshold?: number },
  ) => {
    try {
      const result = await apiRequest<{
        minFontSizeMm: number;
        isActive: boolean;
        readabilityThreshold: number;
        verificationThreshold: number;
      }>(`/api/rules/${item.fieldName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setItems((current) =>
        current.map((currentItem) =>
          currentItem.fieldName === item.fieldName
            ? {
                ...currentItem,
                settings: result,
                minFontSizeMm: result.minFontSizeMm,
              }
            : currentItem,
        ),
      );
      setSaved(`${item.label} saved`);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to save rule",
      );
    }
  };
  return (
    <Page
      kicker="ADMINISTRATION / AUDITABLE CORE"
      title="Rule configuration"
      action={
        <span className="saved-note">{saved || "Changes save per rule"}</span>
      }
    >
      {error && (
        <div className="error-banner">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      <section className="panel rule-panel">
        <div className="rule-table-header">
          <span>Declaration</span>
          <span>Legal reference</span>
          <span>Minimum text height</span>
              <span>OCR thresholds</span>
          <span>Status</span>
        </div>
        {items.map((item, index) => {
          const active = item.settings?.isActive ?? true;
          const threshold = item.settings?.minFontSizeMm ?? item.minFontSizeMm;
          const readabilityThreshold = item.settings?.readabilityThreshold ?? 60;
          const verificationThreshold = item.settings?.verificationThreshold ?? 85;
          return (
            <div className="rule-row" key={item.fieldName}>
              <div>
                <span className="rule-number">0{index + 1}</span>
                <b>{item.label}</b>
              </div>
              <span className="mono reference">{item.ruleSection}</span>
              <label className="input-unit">
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={threshold}
                  onChange={(event) =>
                    update(item, { minFontSizeMm: Number(event.target.value) })
                  }
                />
                <span>mm</span>
              </label>
              <div className="rule-thresholds">
                <label className="input-unit"><input type="number" min="0" max="100" step="1" value={readabilityThreshold} aria-label={`${item.label} readability threshold`} onChange={(event) => update(item, { readabilityThreshold: Number(event.target.value) })} /><span>review %</span></label>
                <label className="input-unit"><input type="number" min={readabilityThreshold} max="100" step="1" value={verificationThreshold} aria-label={`${item.label} verification threshold`} onChange={(event) => update(item, { verificationThreshold: Number(event.target.value) })} /><span>verify %</span></label>
              </div>
              <button
                className={`toggle ${active ? "on" : ""}`}
                onClick={() => update(item, { isActive: !active })}
              >
                <i />
              </button>
            </div>
          );
        })}
        <div className="rule-foot">
          <FileText size={16} />
          <span>
            Every threshold and status change is stored in the development rule
            registry.
          </span>
        </div>
      </section>
    </Page>
  );
}

function ConnectedProducts() {
  const [products, setProducts] = useState<
    Array<{
      id: string;
      name: string;
      companyId: string;
      category: string;
      status: string;
    }>
  >([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  useEffect(() => {
    apiRequest<typeof products>("/api/products")
      .then(setProducts)
      .catch((requestError: Error) => setError(requestError.message));
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const product = await apiRequest<(typeof products)[number]>(
        "/api/products",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, category }),
        },
      );
      setProducts((current) => [product, ...current]);
      setName("");
      setCategory("");
      setShowForm(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to register product",
      );
    }
  };
  return (
    <Page
      kicker="COMPANY REGISTRY"
      title="Product register"
      action={
        <button
          className="button primary"
          onClick={() => setShowForm((current) => !current)}
        >
          <Plus size={17} /> Register product
        </button>
      }
    >
      {error && (
        <div className="error-banner">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {showForm && (
        <form className="product-form panel" onSubmit={submit}>
          <label>
            Product name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label>
            Category
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              required
            />
          </label>
          <button className="button primary" type="submit">
            Save product <Check size={16} />
          </button>
        </form>
      )}
      <section className="panel">
        <div className="catalogue">
          {products.map((product) => (
            <div className="catalogue-row" key={product.id}>
              <span className="product-thumb">
                <Package size={19} />
              </span>
              <div>
                <b>{product.name}</b>
                <small>
                  {product.companyId} · {product.category}
                </small>
              </div>
              <Status
                status={
                  product.status === "Compliant"
                    ? "Compliant"
                    : "Action required"
                }
              />
              <ChevronRight size={17} />
            </div>
          ))}
        </div>
      </section>
    </Page>
  );
}

function ConnectedNotifications() {
  const [items, setItems] = useState<
    Array<{
      id: string;
      title: string;
      text: string;
      when: string;
      tone: string;
      read: boolean;
    }>
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
    apiRequest<typeof items>("/api/notifications")
      .then(setItems)
      .catch((requestError: Error) => setError(requestError.message));
  }, []);
  const readAll = async () => {
    try {
      setItems(
        await apiRequest<typeof items>("/api/notifications/read-all", {
          method: "POST",
        }),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update notifications",
      );
    }
  };
  return (
    <Page
      kicker="INBOX"
      title="Notifications"
      action={
        <button className="button ghost" onClick={readAll}>
          Mark all as read
        </button>
      }
    >
      {error && (
        <div className="error-banner">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      <section className="panel notification-panel">
        {items.map((item) => (
          <div
            className={`notification-row ${item.read ? "read" : ""}`}
            key={item.id}
          >
            <span className={`notification-symbol ${item.tone}`}>
              <Bell size={17} />
            </span>
            <div>
              <b>{item.title}</b>
              <p>{item.text}</p>
              <small>
                {item.when}
                {item.read ? " · Read" : ""}
              </small>
            </div>
            <ChevronRight size={17} />
          </div>
        ))}
      </section>
    </Page>
  );
}

function downloadJson(filename: string, value: unknown) {
  const report = (
    value as { report?: { id: string; downloadUrl: string } } | null
  )?.report;
  if (report?.downloadUrl) {
    void downloadPdf(report.downloadUrl, `${report.id}.pdf`);
    return;
  }
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
async function downloadPdf(url: string, filename: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${localStorage.getItem("metro-check-token") ?? ""}`,
    },
  });
  if (!response.ok) throw new Error("Unable to download report");
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
function ConnectedReport({
  inspection,
  onBack,
}: {
  inspection: Inspection;
  onBack: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const checks = inspection.checks ?? [];
  const passed = checks.filter((check) => check.isCompliant).length;
  const uploadEvidence = async () => {
    if (!files.length) return;
    const formData = new FormData();
    files.forEach((file) => formData.append("evidence", file));
    try {
      await apiRequest(`/api/inspections/${inspection.id}/evidence`, {
        method: "POST",
        body: formData,
      });
      setFiles([]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to upload evidence",
      );
    }
  };
  return (
    <Page
      kicker={`REPORT / ${inspection.id}`}
      title="Inspection result"
      action={
        <>
          <button className="button ghost" onClick={onBack}>
            Back to history
          </button>
          <button
            className="button primary"
            onClick={() =>
              downloadJson(`${inspection.id}-report.json`, inspection)
            }
          >
            <FileText size={16} /> Download report
          </button>
        </>
      }
    >
      <div
        className={`result-banner ${inspection.status === "Compliant" ? "result-good" : "result-bad"}`}
      >
        <div className="result-icon">
          {inspection.status === "Compliant" ? (
            <Check size={28} />
          ) : (
            <AlertTriangle size={27} />
          )}
        </div>
        <div>
          <span className="eyebrow">FINAL DETERMINATION</span>
          <h2>
            {inspection.status === "Compliant"
              ? "Label declarations are compliant."
              : "Action required before release."}
          </h2>
          <p>
            {passed} of {checks.length || 5} mandatory declarations matched the
            active rule set.
          </p>
        </div>
        <div className="result-score">
          <strong>{inspection.score}%</strong>
          <span>compliance score</span>
        </div>
      </div>
      {error && (
        <div className="error-banner">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      <div className="report-grid">
        <section className="panel declarations-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">DECLARATION CHECKS</span>
              <h3>Evidence register</h3>
            </div>
            <span className="mono">RULE SET v2.4</span>
          </div>
          {checks.map((check) => (
            <div
              className={`declaration-row ${check.isCompliant ? "pass" : "fail"}`}
              key={check.fieldName}
            >
              <div className="declaration-status">
                {check.isCompliant ? <Check size={17} /> : <X size={17} />}
              </div>
              <div className="declaration-copy">
                <b>{check.label}</b>
                <span>
                  {check.detectedValue
                    ? `Detected: ${check.detectedValue}`
                    : "Declaration not detected on supplied images"}
                </span>
              </div>
              <div className="declaration-ref">
                <b>{check.ruleSection}</b>
                <small>{check.confidenceNote}</small>
              </div>
              <ChevronRight size={16} />
            </div>
          ))}
        </section>
        <aside className="panel evidence-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">EVIDENCE</span>
              <h3>Inspection record</h3>
            </div>
          </div>
          <div className="evidence-image">
            <div className="corner c1" />
            <div className="corner c2" />
            <div className="corner c3" />
            <div className="corner c4" />
            <Package size={45} />
            <span>Label image preview</span>
          </div>
          <div className="evidence-meta">
            <div>
              <span>Inspector</span>
              <b>Arun Sharma</b>
            </div>
            <div>
              <span>Captured</span>
              <b>
                {new Date(inspection.createdAt).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </b>
            </div>
            <div>
              <span>OCR confidence</span>
              <b>94.8%</b>
            </div>
          </div>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          <button className="button secondary full" onClick={uploadEvidence}>
            <Upload size={16} />{" "}
            {files.length
              ? `Upload ${files.length} evidence image${files.length > 1 ? "s" : ""}`
              : "Choose evidence photo"}
          </button>
        </aside>
      </div>
    </Page>
  );
}
function ConnectedAdminDashboard({
  user,
  onLogout,
  onManageOfficers,
  onNotificationsToggle,
}: {
  user: AuthUser;
  onLogout: () => void;
  onManageOfficers: () => void;
  onNotificationsToggle: () => void;
}) {
  const [analytics, setAnalytics] = useState<{
    total: number;
    complianceRate: number;
    openCases: number;
    compliant: number;
    pendingReview: number;
    nonCompliant: number;
    activeRules: number;
    flags: { label: string; count: number; percent: number }[];
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    apiRequest<typeof analytics>("/api/analytics")
      .then(setAnalytics)
      .catch((requestError: Error) => setError(requestError.message));
  }, []);
  const values = analytics ?? {
    total: 0,
    complianceRate: 0,
    openCases: 0,
    compliant: 0,
    pendingReview: 0,
    nonCompliant: 0,
    activeRules: 0,
    flags: [],
  };
  return (
    <RoleShell user={user} onLogout={onLogout} onNotificationsToggle={onNotificationsToggle}>
      <Page
        kicker="ADMINISTRATION / STATE OFFICE"
        title="The state picture, clearly."
        action={
          <div className="page-actions">
            <button className="button ghost" onClick={onManageOfficers}>
              <Users size={16} /> Officers & access
            </button>
            <button
              className="button primary"
              onClick={() => downloadJson("metro-check-briefing.json", values)}
            >
              <FileText size={16} /> Export briefing
            </button>
          </div>
        }
      >
        {error && (
          <div className="error-banner">
            <AlertTriangle size={16} /> {error}
          </div>
        )}
        <div className="signal-band">
          <div>
            <span className="eyebrow">ADMINISTRATOR VIEW</span>
            <h2>Compliance is moving in the right direction.</h2>
            <p>
              Monitor districts, rules and open cases from one accountable
              register.
            </p>
          </div>
          <div className="signal-number">
            <strong>{values.complianceRate}%</strong>
            <span>computed compliance rate</span>
          </div>
        </div>
        <div className="metric-grid">
          <Metric
            label="Labels inspected"
            value={String(values.total)}
            detail="Persisted inspection records"
            tone="positive"
            icon={<ClipboardCheck />}
          />
          <Metric
            label="Open violations"
            value={String(values.openCases)}
            detail="Confirmed non-compliant"
            tone="alert"
            icon={<AlertTriangle />}
          />
          <Metric
            label="Pending review"
            value={String(values.pendingReview)}
            detail="Excluded until decided"
            tone="neutral"
            icon={<Activity />}
          />
          <Metric
            label="Active officers"
            value="24"
            detail="Across 8 districts"
            tone="neutral"
            icon={<Users />}
          />
          <Metric
            label="Rules active"
            value={`${values.activeRules} / 5`}
            detail="Read from rule registry"
            tone="positive"
            icon={<ShieldCheck />}
          />
        </div>
        <div className="section-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">DISTRICT PERFORMANCE</span>
                <h3>Where attention is needed</h3>
              </div>
              <button
                className="text-button"
                onClick={() =>
                  downloadJson("metro-check-analytics.json", values)
                }
              >
                Download data <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="flag-list">
              <Flag
                label="Open cases"
                count={`${values.openCases} persisted inspections`}
                percent={`${values.nonCompliant} records`}
              />
              <Flag
                label="Compliant inspections"
                count={`${values.compliant} records`}
                percent={`${values.complianceRate}%`}
              />
              <Flag
                label="Pending review"
                count={`${values.pendingReview} records excluded from rate`}
                percent="—"
              />
            </div>
            <p className="analytics-note">
              {values.pendingReview
                ? "Pending reviews are not counted as failures or included in the compliance denominator."
                : values.compliant === 0 && values.nonCompliant > 0
                  ? "No inspections have passed all checks yet — see Open Cases for details."
                  : "Compliance rate uses decided inspections only."}
            </p>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">CONTROL CENTRE</span>
                <h3>Available actions</h3>
              </div>
            </div>
            <button
              className="notification-row action-row"
              onClick={onManageOfficers}
            >
              <span className="notification-symbol info">
                <Users size={17} />
              </span>
              <div>
                <b>Manage officer accounts</b>
                <p>Create, deactivate, or reactivate enforcement accounts.</p>
              </div>
              <ChevronRight size={17} />
            </button>
            <div className="notification-row">
              <span className="notification-symbol warning">
                <Settings2 size={17} />
              </span>
              <div>
                <b>Rule registry</b>
                <p>Use the rule configuration screen to edit thresholds.</p>
              </div>
            </div>
          </section>
        </div>
      </Page>
    </RoleShell>
  );
}

function ConnectedCompanyDashboard({
  user,
  onLogout,
}: {
  user: AuthUser;
  onLogout: () => void;
}) {
  const [showSelfCheck, setShowSelfCheck] = useState(false);
  const [report, setReport] = useState<Inspection | null>(null);
  const [error, setError] = useState("");
  const runSelfCheck = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const formData = new FormData(event.currentTarget);
    try {
      const result = await apiRequest<Inspection>("/api/scan", {
        method: "POST",
        body: formData,
      });
      setReport(result);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Self-check failed",
      );
    }
  };
  return (
    <RoleShell user={user} onLogout={onLogout}>
      <Page
        kicker="COMPANY PORTAL / KAVERI HOMECARE"
        title="Keep every label ready for market."
        action={
          <button
            className="button primary"
            onClick={() => {
              setShowSelfCheck(true);
              setReport(null);
            }}
          >
            <Plus size={17} /> Start self-check
          </button>
        }
      >
        {error && (
          <div className="error-banner">
            <AlertTriangle size={16} /> {error}
          </div>
        )}
        {showSelfCheck && (
          <form className="panel self-check-form" onSubmit={runSelfCheck}>
            <div>
              <span className="eyebrow">PRE-DISPATCH REVIEW</span>
              <h3>Submit a label for compliance checking</h3>
            </div>
            <label>
              Product name
              <input
                name="product"
                defaultValue="Lemon Floor Cleaner"
                required
              />
            </label>
            <label>
              Label images
              <input
                name="images"
                type="file"
                accept="image/*"
                multiple
                required
              />
            </label>
            <div className="self-check-actions">
              <button
                type="button"
                className="button ghost"
                onClick={() => setShowSelfCheck(false)}
              >
                Cancel
              </button>
              <button type="submit" className="button primary">
                Run self-check <ArrowUpRight size={16} />
              </button>
            </div>
          </form>
        )}
        {report && (
          <div
            className={`result-banner ${report.status === "Compliant" ? "result-good" : "result-bad"}`}
          >
            <div className="result-icon">
              {report.status === "Compliant" ? (
                <Check size={28} />
              ) : (
                <AlertTriangle size={27} />
              )}
            </div>
            <div>
              <span className="eyebrow">SELF-CHECK RESULT</span>
              <h2>{report.status}</h2>
              <p>
                {report.summary?.passed ?? 0} of {report.summary?.total ?? 0}{" "}
                declarations matched. Inspection {report.id} is saved.
              </p>
            </div>
            <div className="result-score">
              <strong>{report.score}%</strong>
              <span>compliance score</span>
            </div>
          </div>
        )}
        <div className="signal-band">
          <div>
            <span className="eyebrow">COMPANY COMPLIANCE</span>
            <h2>Two products need your attention.</h2>
            <p>Resolve flagged declarations before your next dispatch.</p>
          </div>
          <div className="signal-number">
            <strong>78%</strong>
            <span>portfolio pass rate</span>
          </div>
        </div>
        <div className="metric-grid">
          <Metric
            label="Registered products"
            value="18"
            detail="3 added this quarter"
            tone="neutral"
            icon={<Package />}
          />
          <Metric
            label="Self-checks completed"
            value="42"
            detail="↑ 6 this month"
            tone="positive"
            icon={<ClipboardCheck />}
          />
          <Metric
            label="Open officer flags"
            value="2"
            detail="Response due in 4 days"
            tone="alert"
            icon={<AlertTriangle />}
          />
          <Metric
            label="Avg. score"
            value="91%"
            detail="↑ 3 pts from August"
            tone="positive"
            icon={<BadgeCheck />}
          />
        </div>
        <div className="section-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">PRODUCTS REQUIRING ACTION</span>
                <h3>Resolve before dispatch</h3>
              </div>
            </div>
            <div className="catalogue">
              <div className="catalogue-row">
                <span className="product-thumb">
                  <Package size={19} />
                </span>
                <div>
                  <b>Lemon Floor Cleaner</b>
                  <small>Consumer care details missing</small>
                </div>
                <Status status="Action required" />
                <ChevronRight size={17} />
              </div>
              <div className="catalogue-row">
                <span className="product-thumb">
                  <Package size={19} />
                </span>
                <div>
                  <b>Disinfectant Concentrate</b>
                  <small>Net quantity format needs review</small>
                </div>
                <Status status="Action required" />
                <ChevronRight size={17} />
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">LATEST OFFICER NOTE</span>
                <h3>INSP-2406</h3>
              </div>
              <Bell size={17} />
            </div>
            <div className="panel-note">
              <AlertTriangle size={17} />
              <span>
                Submit a corrected label response within 4 days to keep the case
                moving.
              </span>
            </div>
            <button
              className="button secondary full"
              style={{ marginTop: 22 }}
              onClick={async () => {
                try {
                  const inspection = await apiRequest<Inspection>(
                    "/api/inspections/INSP-2406",
                  );
                  setReport(inspection);
                } catch (requestError) {
                  setError(
                    requestError instanceof Error
                      ? requestError.message
                      : "Unable to load report",
                  );
                }
              }}
            >
              View inspection report <ArrowUpRight size={16} />
            </button>
          </section>
        </div>
      </Page>
    </RoleShell>
  );
}

function ConnectedAnalytics() {
  const [data, setData] = useState<{
    total: number;
    compliant: number;
    complianceRate: number;
    openCases: number;
    pendingReview: number;
    nonCompliant: number;
    activeRules: number;
    flags: { label: string; count: number; percent: number }[];
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    apiRequest<typeof data>("/api/analytics")
      .then(setData)
      .catch((requestError: Error) => setError(requestError.message));
  }, []);
  const values = data ?? {
    total: 0,
    compliant: 0,
    complianceRate: 0,
    openCases: 0,
    pendingReview: 0,
    nonCompliant: 0,
    activeRules: 0,
    flags: [],
  };
  return (
    <Page
      kicker="ADMINISTRATION / DISTRICT 04"
      title="State compliance at a glance"
      action={
        <button
          className="button ghost"
          onClick={() => downloadJson("metro-check-analytics.json", values)}
        >
          <FileText size={16} /> Export briefing
        </button>
      }
    >
      {error && (
        <div className="error-banner">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      <div className="metric-grid">
        <Metric
          label="Compliance rate"
          value={`${values.complianceRate}%`}
          detail="Computed from inspection register"
          tone="positive"
          icon={<BadgeCheck />}
        />
        <Metric
          label="Labels inspected"
          value={String(values.total)}
          detail="Persisted records"
          tone="neutral"
          icon={<ClipboardCheck />}
        />
        <Metric
          label="Open cases"
          value={String(values.openCases)}
          detail="Confirmed non-compliant"
          tone="alert"
          icon={<AlertTriangle />}
        />
        <Metric
          label="Pending review"
          value={String(values.pendingReview)}
          detail="Excluded from rate"
          tone="neutral"
          icon={<Activity />}
        />
        <Metric
          label="Rules active"
          value={`${values.activeRules} / 5`}
          detail="Current rule registry"
          tone="positive"
          icon={<Activity />}
        />
      </div>
      <section className="panel chart-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">REGISTER HEALTH</span>
            <h3>Computed compliance snapshot</h3>
          </div>
        </div>
        <div className="flag-list">
          <Flag
            label="Compliant inspections"
            count={`${values.compliant} persisted records`}
            percent={`${values.complianceRate}%`}
          />
          <Flag
            label="Open action cases"
            count={`${values.nonCompliant} persisted records`}
            percent={`${values.nonCompliant ? Math.round((values.nonCompliant / Math.max(1, values.total - values.pendingReview)) * 100) : 0}%`}
          />
          <Flag
            label="Pending review"
            count={`${values.pendingReview} persisted records`}
            percent="—"
          />
        </div>
        <p className="analytics-note">Pending reviews are excluded from the compliance rate until an officer decides the case.</p>
      </section>
      <section className="panel signal-panel analytics-flags">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DECLARATION WATCH</span>
            <h3>Common flags</h3>
          </div>
          <Filter size={17} />
        </div>
        {values.flags.length ? <div className="flag-list">{values.flags.map((flag) => <Flag key={flag.label} label={flag.label} count={`${flag.count} flags`} percent={`${flag.percent}%`} />)}</div> : <div className="empty-workspace"><AlertTriangle size={24} /><h3>No declaration flags yet</h3><p>Common flags will appear after inspections are recorded.</p></div>}
      </section>
    </Page>
  );
}

function ConnectedPeople({
  user,
  onBack,
}: {
  user: AuthUser;
  onBack?: () => void;
}) {
  type ManagedUser = {
    id: string;
    name: string;
    role: string;
    email: string;
    orgId: string;
    active?: boolean;
  };
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const loadUsers = async () => {
    try {
      setUsers(await apiRequest<ManagedUser[]>("/api/users"));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load users",
      );
    }
  };
  useEffect(() => {
    void loadUsers();
  }, []);
  const createOfficer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setSubmitting(true);
    setError("");
    setMessage("");
    const formData = new FormData(form);
    try {
      await apiRequest<ManagedUser>("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.token ?? ""}`,
        },
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          password: formData.get("password"),
          role: formData.get("role"),
          scope: formData.get("scope"),
        }),
      });
      setMessage("Account created with its role and access scope.");
      form.reset();
      setShowForm(false);
      await loadUsers();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to create officer account",
      );
    } finally {
      setSubmitting(false);
    }
  };
  const updateOfficer = async (managedUser: ManagedUser) => {
    try {
      const updated = await apiRequest<ManagedUser>(
        `/api/users/${managedUser.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${user.token ?? ""}`,
          },
          body: JSON.stringify({ active: managedUser.active === false }),
        },
      );
      setUsers((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setMessage(
        updated.active === false
          ? "Officer account deactivated."
          : "Officer account reactivated.",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update account",
      );
    }
  };
  const filtered = users.filter((managedUser) =>
    `${managedUser.name} ${managedUser.email} ${managedUser.role}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <Page
      kicker="DIRECTORY / USER MANAGEMENT"
      title="Officers & access"
      action={
        <>
          {onBack && (
            <button className="button ghost" onClick={onBack}>
              Back to dashboard
            </button>
          )}{" "}
          {user.role === "admin" && (
            <button
              className="button primary"
              onClick={() => setShowForm((current) => !current)}
            >
              <Plus size={17} /> Add officer
            </button>
          )}
        </>
      }
    >
      {error && (
        <div className="error-banner">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {message && (
        <div className="success-banner">
          <Check size={16} /> {message}
        </div>
      )}
      {showForm && (
        <form className="panel officer-form" onSubmit={createOfficer}>
          <div>
            <span className="eyebrow">NEW ENFORCEMENT ACCOUNT</span>
            <h3>Create an enforcement account</h3>
          </div>
          <label>
            Full name
            <input
              name="name"
              required
              minLength={2}
              placeholder="Officer name"
            />
          </label>
          <label>
            Email address
            <input
              name="email"
              type="email"
              required
              placeholder="officer@metrology.gov.in"
            />
          </label>
          <label>
            Temporary password
            <input
              name="password"
              type="password"
              required
              minLength={8}
              placeholder="At least 8 characters"
            />
          </label>
          <label>
            Role
            <select name="role" required defaultValue="officer">
              <option value="officer">Officer</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Admin</option>
              <option value="company">Company</option>
            </select>
          </label>
          <label>
            District / scope
            <input name="scope" required placeholder="district-04 or state-office" />
          </label>
          <small className="form-help">Company accounts remain restricted to their own company product and inspection history.</small>
          <div className="officer-form-actions">
            <button
              type="button"
              className="button ghost"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={submitting}
            >
              {submitting ? "Creating account..." : "Create officer"}{" "}
              <Check size={16} />
            </button>
          </div>
        </form>
      )}
      <div className="toolbar">
        <div className="search-field">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search officers and roles"
          />
        </div>
      </div>
      <section className="panel people-panel">
        <div className="person-row person-header" aria-hidden="true">
          <span />
          <span>Name / email</span>
          <span>Scope</span>
          <span>Status</span>
          <span>Role</span>
          <span>Actions</span>
        </div>
        {filtered.map((managedUser) => (
          <div
            className={`person-row ${managedUser.active === false ? "inactive" : ""}`}
            key={managedUser.id}
          >
            <span className="avatar">
              {managedUser.name.slice(0, 2).toUpperCase()}
            </span>
            <div>
              <b>{managedUser.name}</b>
              <small>{managedUser.email}</small>
            </div>
            <span className="muted">{managedUser.orgId}</span>
            <span
              className={`status ${managedUser.active === false ? "warning" : "good"}`}
            >
              <span />
              {managedUser.active === false ? "Inactive" : "Active"}
            </span>
            <span className="role-label">{managedUser.role}</span>
            <div className="person-actions">
            {user.role === "admin" && managedUser.id !== user.id ? (
              <button
                className="button ghost account-toggle"
                onClick={() => updateOfficer(managedUser)}
              >
                {managedUser.active === false ? "Reactivate" : "Deactivate"}
              </button>
            ) : <span className="action-placeholder">—</span>}
            </div>
          </div>
        ))}
      </section>
    </Page>
  );
}
