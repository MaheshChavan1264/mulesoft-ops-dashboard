import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  Eye, EyeOff, Key, User, Zap, Link2, Info, Lock, Sun, Moon,
  Server, ShieldCheck, Database, Activity, ArrowRight, ChevronRight,
} from 'lucide-react';
import { getErrorMessage } from '../services/http';

const TABS = [
  { id: 'app', label: 'Connected App', sub: 'Recommended for SSO', icon: Link2 },
  { id: 'credentials', label: 'Username & Password', sub: 'Classic sign-in', icon: User },
  { id: 'token', label: 'Bearer Token', sub: 'From browser DevTools', icon: Key },
];

// Mirrors the primary sidebar nav items (components/layout/Sidebar.jsx) —
// the signature pipeline visual below is literally the product's own
// navigation, not a decorative abstraction, so it stays true if the nav
// ever changes.
const NODES = [
  { icon: Server, label: 'Applications' },
  { icon: ShieldCheck, label: 'API Manager' },
  { icon: Database, label: 'CPS Sync' },
  { icon: Activity, label: 'Ping Health' },
];

// Fills the dead space beneath the hero copy with something true to the
// product instead of empty canvas — a frozen frame of exactly what the
// Ping Test / health-check feature actually prints, in the same terminal
// palette (`terminal: '#0B0F17'`, tailwind.config.js) used by
// AttemptLog/PingResultCard elsewhere in the app.
const LOG_LINES = [
  { t: '14:02:11', msg: 'GET /api/v1/ping  customer-sapi', status: '200', tone: 'ok' },
  { t: '14:02:12', msg: 'GET /api/v1/ping  order-process-sapi', status: '200', tone: 'ok' },
  { t: '14:02:14', msg: 'CPS sync  3 secure groups resolved', status: 'OK', tone: 'ok' },
  { t: '14:02:15', msg: 'GET /api/v1/ping  billing-rapi', status: '…', tone: 'pending' },
];

/** One animated "packet" traveling along the connector between two pipeline nodes. */
function FlowConnector({ delay = 0 }) {
  return (
    <div className="relative flex-1 h-[2px] min-w-[20px] rounded-full bg-gradient-to-r from-sf-500/10 via-sf-500/50 to-sf-500/10 dark:from-sf-500/10 dark:via-sf-400/40 dark:to-sf-500/10 mx-1.5 sm:mx-2.5">
      <span
        className="flow-dot absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-sf-500 dark:bg-sf-300 shadow-[0_0_12px_3px_rgba(1,118,211,0.6)] dark:shadow-[0_0_12px_3px_rgba(79,176,246,0.9)]"
        style={{ animationDelay: `${delay}s` }}
      />
    </div>
  );
}

function PipelineNode({ icon: Icon, label }) {
  return (
    <div className="flex flex-col items-center gap-3 flex-shrink-0">
      <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-b from-white to-sf-50 dark:from-white/[0.09] dark:to-white/[0.03] border border-sf-100 dark:border-white/15 flex items-center justify-center text-sf-600 dark:text-sf-300 shadow-[0_10px_24px_-8px_rgba(1,118,211,0.25)] dark:shadow-[0_8px_20px_-6px_rgba(0,0,0,0.5)]">
        <div className="absolute inset-0 rounded-2xl bg-sf-400/10 blur-md -z-10" />
        <Icon size={22} strokeWidth={1.75} />
      </div>
      <span className="text-[11px] font-semibold text-gray-500 dark:text-slate-300 uppercase tracking-wide whitespace-nowrap">
        {label}
      </span>
    </div>
  );
}

/** Frozen "live" diagnostics feed — fills the space below the hero copy with real product texture. */
function DiagnosticsFeed() {
  return (
    <div className="mt-10 rounded-2xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-black/40 backdrop-blur-sm shadow-[0_20px_50px_-20px_rgba(15,23,42,0.25)] dark:shadow-[0_20px_50px_-20px_rgba(0,0,0,0.7)] overflow-hidden max-w-lg mx-auto lg:mx-0">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 dark:border-white/[0.06] bg-gray-50/80 dark:bg-white/[0.03]">
        <span className="w-2 h-2 rounded-full bg-sfred-500/70" />
        <span className="w-2 h-2 rounded-full bg-sforange-400/70" />
        <span className="w-2 h-2 rounded-full bg-sfgreen-400/70" />
        <span className="ml-2 font-mono text-[11px] text-gray-400 dark:text-slate-500 tracking-wide">ping-test — live</span>
      </div>
      <div className="px-5 py-4 space-y-2 font-mono text-xs">
        {LOG_LINES.map((l, i) => (
          <div key={i} className="flex items-center gap-3 text-gray-500 dark:text-slate-400">
            <span className="text-gray-400 dark:text-slate-600 flex-shrink-0">{l.t}</span>
            <span className="truncate flex-1 text-left text-gray-600 dark:text-slate-300">{l.msg}</span>
            <span className={`flex-shrink-0 font-semibold ${l.tone === 'ok' ? 'text-sfgreen-600 dark:text-sfgreen-400' : 'text-sforange-500 dark:text-sforange-400 animate-pulse'}`}>
              {l.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LoginPage() {
  const { login, tokenLogin, connectedAppLogin, demoLogin } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [tab, setTab] = useState('app');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showTokenGuide, setShowTokenGuide] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'credentials') {
        await login(username, password);
      } else if (tab === 'token') {
        await tokenLogin(token);
      } else if (tab === 'app') {
        await connectedAppLogin(clientId, clientSecret);
      }
      navigate('/');
    } catch (err) {
      setError(getErrorMessage(err, 'Authentication failed.'));
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = () => {
    demoLogin();
    navigate('/');
  };

  // Shared "glass" input treatment — every field on this screen sits on the
  // same frosted card, so inputs are styled once here instead of repeating
  // the long className string per field. Theme-aware: a soft tinted
  // surface in light mode, a frosted dark surface in dark mode.
  const inputCls = 'w-full bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-white/25 focus:outline-none focus:border-sf-500 dark:focus:border-sf-400/70 focus:ring-2 focus:ring-sf-500/15 dark:focus:ring-sf-400/15 transition-all';

  const activeTab = TABS.find((t) => t.id === tab);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-white dark:bg-[#05070d] transition-colors duration-300">
      {/* Scoped keyframes for the pipeline "packet" animation — respects
          prefers-reduced-motion by freezing the dots at a fixed position. */}
      <style>{`
        @keyframes mule-flow {
          0%   { left: 0%;   opacity: 0; }
          10%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { left: 100%; opacity: 0; }
        }
        .flow-dot { animation: mule-flow 2.6s cubic-bezier(.4,0,.2,1) infinite; }
        @media (prefers-reduced-motion: reduce) {
          .flow-dot { animation: none; opacity: 0.9; left: 50%; }
        }
      `}</style>

      {/* ── Single ambient background canvas — spans the FULL viewport so
          there is no hard seam between a "hero half" and a "form half".
          Fully theme-aware: a soft brand-tinted mesh in light mode, a rich
          dark glow canvas in dark mode — same composition, different
          intensity, so the glassmorphic card always has something to float
          above instead of a flat single-color backdrop. ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-sf-50 via-white to-sfteal-50/60 dark:from-[#070a12] dark:via-sf-950 dark:to-[#05070d]" />
        <div className="absolute top-[-20%] left-[-10%] w-[46rem] h-[46rem] rounded-full bg-sf-400/25 dark:bg-sf-500/25 blur-[110px]" />
        <div className="absolute bottom-[-25%] right-[-10%] w-[42rem] h-[42rem] rounded-full bg-sfteal-400/20 dark:bg-sfteal-500/20 blur-[110px]" />
        <div className="absolute top-1/4 right-[10%] w-[26rem] h-[26rem] rounded-full bg-sfpurple-400/15 dark:bg-sfpurple-500/[0.14] blur-[100px]" />
        <div className="absolute bottom-1/4 left-[15%] w-80 h-80 rounded-full bg-sf-400/10 dark:bg-sf-400/[0.08] blur-[90px]" />
        <div
          className="absolute inset-0 opacity-[0.5] dark:opacity-[0.14]"
          style={{ backgroundImage: 'radial-gradient(circle, #0176d3 1px, transparent 1px)', backgroundSize: '26px 26px' }}
        />
        {/* vignette so the dot grid/glows fade at the extreme edges instead of hard-cutting */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,theme(colors.white)_92%)] dark:bg-[radial-gradient(ellipse_at_center,transparent_35%,#05070d_90%)]" />
      </div>

      {/* Unified brand accent strip, consistent with the authenticated app shell */}
      <div className="fixed top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-sf-500 via-sfteal-400 to-sfpurple-500 z-50 shadow-[0_1px_8px_rgba(1,118,211,0.35)]" />

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className="fixed top-5 right-5 z-50 p-2.5 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-white/80 dark:bg-gray-800/80 hover:bg-white dark:hover:bg-gray-800 border border-gray-200/80 dark:border-gray-700/80 shadow-sm backdrop-blur-sm transition-all"
      >
        <Sun size={16} className={`absolute inset-0 m-auto transition-all duration-300 ${isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-0'}`} />
        <Moon size={16} className={`transition-all duration-300 ${isDark ? 'opacity-0 rotate-90 scale-0' : 'opacity-100 rotate-0 scale-100'}`} />
      </button>

      {/* ── Single scene: hero content + floating glass card share one row,
          centered with generous margins — nothing touches the viewport
          edges, which is what makes it read as one composed scene rather
          than two abutting pages ── */}
      <div className="relative z-10 min-h-screen flex items-center justify-center px-6 sm:px-10 lg:px-16">
        <div className="w-full max-w-[98rem] py-16 flex flex-col lg:flex-row items-center justify-center gap-16 lg:gap-14">

          {/* ══ Hero column ══ */}
          <div className="flex-1 max-w-xl text-center lg:text-left">
            {/* Brand mark */}
            <div className="flex items-center gap-3 justify-center lg:justify-start">
              <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-sf-500 to-sf-700 flex items-center justify-center flex-shrink-0 shadow-lg shadow-sf-500/40 ring-1 ring-white/15">
                <span className="text-white font-bold text-xl font-mono tracking-tight">M</span>
                <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-sfgreen-400 border-2 border-white dark:border-[#05070d] shadow-sm" />
              </div>
              <div className="text-left">
                <p className="text-gray-900 dark:text-white font-mono font-bold text-base tracking-tight leading-tight">MuleSoft</p>
                <p className="text-gray-400 dark:text-slate-400 text-[11px] font-semibold uppercase tracking-widest">Ops Dashboard</p>
              </div>
            </div>

            {/* Headline */}
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-sf-600 dark:text-sf-400 mt-11 mb-5">
              Integration control plane
            </p>
            <h1 className="font-mono font-bold text-[2rem] sm:text-4xl lg:text-[2.9rem] leading-[1.12] text-gray-900 dark:text-white tracking-tight">
              Observe, compare, and
              <br />
              govern every integration.
            </h1>
            <p className="text-gray-500 dark:text-slate-400 text-base leading-relaxed mt-5 max-w-lg mx-auto lg:mx-0">
              Live health checks, side-by-side CPS property diffing, and API Manager
              governance — unified in one console.
            </p>

            {/* Signature: pipeline flow visualization */}
            <div className="mt-12 flex items-center justify-center lg:justify-start">
              {NODES.map((node, i) => (
                <React.Fragment key={node.label}>
                  <PipelineNode icon={node.icon} label={node.label} />
                  {i < NODES.length - 1 && <FlowConnector delay={i * 0.85} />}
                </React.Fragment>
              ))}
            </div>

            {/* Live diagnostics feed — fills the space below the pipeline
                with real product texture instead of empty canvas */}
            <DiagnosticsFeed />

            {/* Live status strip */}
            <div className="hidden lg:flex items-center gap-6 border-t border-gray-200 dark:border-white/10 mt-9 pt-6 text-xs">
              <span className="flex items-center gap-2 text-gray-500 dark:text-slate-400 font-medium">
                <span className="relative flex w-1.5 h-1.5 flex-shrink-0">
                  <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-sfgreen-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-sfgreen-400" />
                </span>
                Diagnostics ready
              </span>
              <span className="font-mono text-gray-400 dark:text-slate-500">Session-based · Zero stored secrets</span>
            </div>
          </div>

          {/* ══ Floating glass card — a wide landscape panel split into a
              method rail (left) and the active sign-in form (right), so the
              extra size granted to this screen reads as deliberate
              horizontal real estate rather than a single column stretched
              taller and taller ══ */}
          <div className="relative w-full max-w-[46rem] flex-shrink-0">
            {/* Halo directly behind the card — brighter/wider in dark mode
                so the glass has something colorful to actually catch and
                reflect. A flat neutral-white glass panel on a near-black
                backdrop reads as a disconnected gray box; the halo is what
                makes the card look lit *by* the scene instead of pasted
                on top of it. */}
            <div className="absolute -inset-12 bg-gradient-to-br from-sf-400/35 dark:from-sf-500/45 via-sfteal-400/15 dark:via-sfteal-500/25 to-sfpurple-400/10 dark:to-sfpurple-500/15 rounded-[52px] blur-[64px] -z-10" />
            {/* Thin gradient edge-light — a 1px border that is itself tinted
                with the brand colors (not plain white/gray), so the card's
                silhouette visibly belongs to the same light as the halo
                behind it rather than a flat neutral outline. */}
            <div className="absolute -inset-px rounded-[32px] bg-gradient-to-br from-sf-300/60 dark:from-sf-400/40 via-white/40 dark:via-white/10 to-sfteal-300/40 dark:to-sfteal-400/20 -z-[5]" />
            <div className="relative rounded-[32px] bg-gradient-to-br from-white/95 via-white/90 to-sf-50/80 dark:from-slate-900/70 dark:via-sf-950/60 dark:to-slate-900/70 backdrop-blur-2xl shadow-[0_50px_110px_-20px_rgba(15,23,42,0.25)] dark:shadow-[0_60px_130px_-20px_rgba(0,0,0,0.9)] overflow-hidden">
              {/* subtle top sheen so the glass reads as an elevated panel, not a flat tinted box */}
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 dark:via-white/30 to-transparent z-10" />

              <div className="grid sm:grid-cols-[0.95fr_1.3fr]">

                {/* ── Left rail: identity + sign-in method picker ── */}
                <div className="relative bg-gray-50/70 dark:bg-sf-500/[0.07] border-b sm:border-b-0 sm:border-r border-gray-200/70 dark:border-white/[0.08] px-8 py-9 sm:py-10 flex flex-col">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-sf-700 dark:text-sf-300 bg-sf-50 dark:bg-sf-500/10 border border-sf-200/70 dark:border-sf-400/20 rounded-full px-3 py-1.5 mb-5 w-fit">
                    <Lock size={11} /> Secure access
                  </span>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Welcome back</h2>
                  <p className="text-gray-500 dark:text-slate-400 text-sm mt-2 leading-relaxed">
                    Choose how you'd like to sign in to your Ops Dashboard account.
                  </p>

                  {/* Vertical method rail */}
                  <div className="mt-7 space-y-2">
                    {TABS.map((t) => {
                      const Icon = t.icon;
                      const selected = tab === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => { setTab(t.id); setError(''); }}
                          className={`w-full flex items-center gap-3 text-left px-3.5 py-3 rounded-xl border transition-all group ${
                            selected
                              ? 'bg-white dark:bg-white/10 border-sf-200/80 dark:border-sf-400/30 shadow-sm ring-1 ring-sf-500/10 dark:ring-sf-400/10'
                              : 'bg-transparent border-transparent hover:bg-white/60 dark:hover:bg-white/[0.04] hover:border-gray-200/70 dark:hover:border-white/10'
                          }`}
                        >
                          <span className={`flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 transition-colors ${
                            selected
                              ? 'bg-sf-600 text-white shadow-sm shadow-sf-500/30'
                              : 'bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-slate-400 group-hover:text-gray-600 dark:group-hover:text-slate-300'
                          }`}>
                            <Icon size={15} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block text-sm font-semibold ${selected ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-slate-300'}`}>
                              {t.label}
                            </span>
                            <span className="block text-[11px] text-gray-400 dark:text-slate-500">{t.sub}</span>
                          </span>
                          <ChevronRight size={14} className={`flex-shrink-0 transition-all ${selected ? 'text-sf-500 dark:text-sf-400' : 'text-gray-300 dark:text-slate-600 opacity-0 group-hover:opacity-100'}`} />
                        </button>
                      );
                    })}
                  </div>

                  {/* Demo button — secondary ghost action, grouped with the method rail since it's an alternate entry path */}
                  <div className="mt-auto pt-7">
                    <button
                      onClick={handleDemoLogin}
                      className="w-full flex items-center justify-center gap-2 text-sfpurple-700 dark:text-sfpurple-300 font-semibold text-sm py-3.5 rounded-xl border border-sfpurple-200/70 dark:border-sfpurple-400/25 bg-sfpurple-50/60 dark:bg-sfpurple-500/[0.08] hover:bg-sfpurple-100 dark:hover:bg-sfpurple-500/15 hover:border-sfpurple-300 dark:hover:border-sfpurple-400/40 transition-all group"
                    >
                      <Zap size={16} />
                      Try Demo Mode
                      <ArrowRight size={14} className="opacity-0 -ml-1 group-hover:opacity-100 group-hover:ml-0 transition-all" />
                    </button>
                    <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-gray-400 dark:text-slate-500 mt-4">
                      <Lock size={10} /> Credentials are never stored
                    </p>
                  </div>
                </div>

                {/* ── Right panel: active sign-in method's form ── */}
                <div className="px-8 py-9 sm:py-10">
                  <div className="mb-6">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">{activeTab.label}</h3>
                    <p className="text-gray-400 dark:text-slate-500 text-xs mt-1">{activeTab.sub}</p>
                  </div>

                  {/* Connected App tab guidance */}
                  {tab === 'app' && (
                    <div className="mb-6 bg-sf-50 dark:bg-sf-500/10 border border-sf-200/70 dark:border-sf-400/20 rounded-2xl p-4 text-xs">
                      <div className="flex items-start gap-3">
                        <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-sf-100 dark:bg-sf-500/20 flex-shrink-0 mt-0.5">
                          <Link2 size={13} className="text-sf-600 dark:text-sf-300" />
                        </span>
                        <div className="text-gray-600 dark:text-slate-300 min-w-0 leading-relaxed">
                          <p>
                            Create a <strong className="text-gray-900 dark:text-white">Connected App</strong> in Anypoint Platform
                            with Client Credentials grant — works independently of SSO.
                          </p>
                          <p className="text-sf-700 dark:text-sf-300 mt-1.5 font-semibold">
                            Access Management → Connected Apps → Create App
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Bearer Token tab — guide */}
                  {tab === 'token' && (
                    <div className="mb-6">
                      <button
                        type="button"
                        onClick={() => setShowTokenGuide(!showTokenGuide)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-sf-600 dark:text-sf-300 hover:text-sf-700 dark:hover:text-sf-200 mb-3 transition-colors"
                      >
                        <Info size={13} />
                        How to grab your token from DevTools
                      </button>
                      {showTokenGuide && (
                        <div className="bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/10 rounded-2xl p-4 text-[11px] text-gray-600 dark:text-slate-300 space-y-1.5 mb-3 leading-relaxed">
                          <p className="text-gray-400 dark:text-slate-500 font-semibold mb-1.5 uppercase tracking-wide text-[9px]">Steps</p>
                          <p>1. Log in to <span className="text-sf-600 dark:text-sf-300 font-semibold">anypoint.mulesoft.com</span> via SSO</p>
                          <p>2. Open DevTools → <span className="text-amber-600 dark:text-amber-300 font-semibold">Network</span> tab</p>
                          <p>3. Filter by <span className="text-emerald-600 dark:text-emerald-300 font-semibold">XHR</span>, reload</p>
                          <p>4. Click any API request to <span className="font-mono text-gray-900 dark:text-white">/accounts/api/me</span></p>
                          <p>5. Copy the value after <span className="font-mono text-amber-600 dark:text-amber-300">Bearer </span></p>
                          <p className="text-gray-400 dark:text-slate-500 pt-1">⚠ Tokens expire — usually within a few hours.</p>
                        </div>
                      )}
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-4">
                    {tab === 'app' && (
                      <>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">Client ID</label>
                          <div className="relative">
                            <Link2 size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" />
                            <input
                              type="text"
                              value={clientId}
                              onChange={(e) => setClientId(e.target.value)}
                              placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                              required
                              className={`${inputCls} pl-11 pr-4 py-3.5 text-sm font-mono`}
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">Client Secret</label>
                          <div className="relative">
                            <Key size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" />
                            <input
                              type={showSecret ? 'text' : 'password'}
                              value={clientSecret}
                              onChange={(e) => setClientSecret(e.target.value)}
                              placeholder="••••••••••••••••••••••••••••••••"
                              required
                              className={`${inputCls} pl-11 pr-11 py-3.5 text-sm font-mono`}
                            />
                            <button
                              type="button"
                              onClick={() => setShowSecret(!showSecret)}
                              aria-label={showSecret ? 'Hide client secret' : 'Show client secret'}
                              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
                            >
                              {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </div>
                        </div>
                      </>
                    )}

                    {tab === 'credentials' && (
                      <>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">Username</label>
                          <div className="relative">
                            <User size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" />
                            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                              placeholder="your@email.com" required
                              className={`${inputCls} pl-11 pr-4 py-3.5 text-sm`} />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">Password</label>
                          <div className="relative">
                            <Key size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" />
                            <input type={showPassword ? 'text' : 'password'} value={password}
                              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required
                              className={`${inputCls} pl-11 pr-11 py-3.5 text-sm`} />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              aria-label={showPassword ? 'Hide password' : 'Show password'}
                              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
                            >
                              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </div>
                        </div>
                      </>
                    )}

                    {tab === 'token' && (
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-2">Bearer Token</label>
                        <textarea value={token} onChange={(e) => setToken(e.target.value)}
                          placeholder="Paste your bearer token here..." required rows={4}
                          className={`${inputCls} px-4 py-3.5 text-sm resize-none font-mono`} />
                      </div>
                    )}

                    {error && (
                      <div className="bg-red-50 dark:bg-red-500/10 border border-red-200/70 dark:border-red-400/30 rounded-xl px-4 py-3 text-red-700 dark:text-red-300 text-sm font-medium">
                        {error}
                      </div>
                    )}

                    <button type="submit" disabled={loading}
                      className="w-full bg-gradient-to-b from-sf-500 to-sf-600 hover:from-sf-400 hover:to-sf-500 disabled:opacity-60 text-white font-semibold py-3.5 rounded-xl shadow-md shadow-sf-500/30 hover:shadow-lg hover:shadow-sf-500/40 ring-1 ring-inset ring-white/20 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2 text-sm">
                      {loading ? (
                        <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>Connecting...</>
                      ) : (
                        tab === 'app' ? 'Connect with Connected App' :
                        tab === 'credentials' ? 'Sign In' :
                        'Connect with Token'
                      )}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
