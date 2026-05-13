import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area
} from "recharts";
import {
  Shield, ShieldAlert, ShieldCheck, Activity, Users, LogOut,
  Globe, Lock, Eye, Server, AlertTriangle, CheckCircle,
  XCircle, Plus, Trash2, RefreshCw, Zap, Database, User, Key,
  ChevronLeft, ChevronRight, TrendingUp, Layers, Settings, Bell,
  Calendar, Clock, ChevronDown, X, FileText, Search, Filter,
  Download, LogIn, UserPlus, UserMinus, Edit2, Shield as ShieldIcon,
  AlertCircle, Info, Mail, EyeOff, Lock as LockIcon, Check, BellRing,
  Box, HardDrive, Boxes, Network, GitBranch, Cpu, Package
} from "lucide-react";
import { saveCredential, initStore, getCredential } from "./credentialStore.js";
import { fetchInventory } from "./awsFetcher.js";

// ─── Design Tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:        "#05080f",
  surface:   "#080d1a",
  card:      "#0c1224",
  card2:     "#101828",
  border:    "#1a2744",
  border2:   "#1f3058",
  accent:    "#1e3a5f",
  cyan:      "#00d4ff",
  cyanDim:   "#00a8cc",
  green:     "#00e878",
  red:       "#ff3b5c",
  orange:    "#ff8c00",
  yellow:    "#ffd000",
  purple:    "#a855f7",
  pink:      "#f43f8d",
  textPri:   "#dce8f8",
  textSec:   "#6b85a8",
  textMut:   "#344d6e",
  glow:      "rgba(0,212,255,0.12)",
};

const PIE_COLORS = [C.red, C.orange, C.yellow, C.cyan];

// ─── Audit Log Data ─────────────────────────────────────────────────────────
const ACTION_META = {
  login:           { label:"Login",            Icon:LogIn,     color:C.green  },
  logout:          { label:"Logout",           Icon:LogOut,    color:C.textSec},
  failed_login:    { label:"Failed Login",     Icon:XCircle,   color:C.red    },
  user_add:        { label:"User Added",       Icon:UserPlus,  color:C.cyan   },
  user_delete:     { label:"User Deleted",     Icon:UserMinus, color:C.red    },
  account_add:     { label:"Account Added",    Icon:Database,  color:C.cyan   },
  account_delete:  { label:"Account Deleted",  Icon:Database,  color:C.red    },
  config_change:   { label:"Config Changed",   Icon:Settings,  color:C.yellow },
  export_report:   { label:"Report Exported",  Icon:Download,  color:C.purple },
  view_section:    { label:"Section Viewed",   Icon:Eye,       color:C.textSec},
  permission_deny: { label:"Access Denied",    Icon:Lock,      color:C.orange },
};

// ─── Cleared Audit Log (no dummy entries) ────────────────────────────────────
const INITIAL_AUDIT_LOG = [];

// ─── Time Range System ─────────────────────────────────────────────────────────
const RELATIVE_GROUPS = [
  { label:"Minutes", options:[
    {label:"Last 1 minute",value:"1m",minutes:1},{label:"Last 5 minutes",value:"5m",minutes:5},
    {label:"Last 10 minutes",value:"10m",minutes:10},{label:"Last 30 minutes",value:"30m",minutes:30},
  ]},
  { label:"Hours", options:[
    {label:"Last 1 hour",value:"1h",minutes:60},{label:"Last 3 hours",value:"3h",minutes:180},
    {label:"Last 6 hours",value:"6h",minutes:360},{label:"Last 12 hours",value:"12h",minutes:720},
    {label:"Last 24 hours",value:"24h",minutes:1440},
  ]},
  { label:"Days", options:[
    {label:"Last 3 days",value:"3d",minutes:4320},{label:"Last 7 days",value:"7d",minutes:10080},
    {label:"Last 14 days",value:"14d",minutes:20160},{label:"Last 30 days",value:"30d",minutes:43200},
  ]},
  { label:"Months", options:[
    {label:"Last 3 months",value:"3mo",minutes:129600},{label:"Last 6 months",value:"6mo",minutes:259200},
    {label:"Last 12 months",value:"12mo",minutes:518400},
  ]},
];

function getScaleFactor(timeRange) {
  if (!timeRange) return 1;
  if (timeRange.type === "relative") {
    const opt = RELATIVE_GROUPS.flatMap(g=>g.options).find(o=>o.value===timeRange.value);
    if (!opt) return 1;
    return Math.min(opt.minutes / 1440, 3.5);
  }
  if (timeRange.type === "absolute") {
    const ms = new Date(timeRange.end) - new Date(timeRange.start);
    return Math.min((ms/60000) / 1440, 3.5);
  }
  return 1;
}

function scaleVal(base, factor) {
  return Math.round(base * factor * (0.9 + Math.random() * 0.2));
}

function formatRangeLabel(timeRange) {
  if (!timeRange || timeRange.type === "relative") {
    const opt = RELATIVE_GROUPS.flatMap(g=>g.options).find(o=>o.value===(timeRange?.value||"24h"));
    return opt?.label || "Last 24 hours";
  }
  if (timeRange.type === "absolute") {
    const fmt = d => new Date(d).toLocaleString("en-US",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
    return `${fmt(timeRange.start)} – ${fmt(timeRange.end)}`;
  }
  return "Custom";
}

function durationPreview(start, end) {
  if (!start||!end) return null;
  const ms = new Date(end)-new Date(start);
  if (ms<=0) return "⚠ End must be after start";
  const mins = Math.round(ms/60000);
  if (mins<60) return `${mins} minute${mins!==1?"s":""}`;
  const hrs = Math.round(ms/3600000*10)/10;
  if (hrs<24) return `${hrs} hour${hrs!==1?"s":""}`;
  const days = Math.round(ms/86400000*10)/10;
  return `${days} day${days!==1?"s":""}`;
}

// ─── TimeRangePicker ──────────────────────────────────────────────────────────
function TimeRangePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab]   = useState("relative");
  const [absStart, setAbsStart] = useState("");
  const [absEnd,   setAbsEnd]   = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = value || { type:"relative", value:"24h" };
  const label   = formatRangeLabel(current);
  const preview = tab === "absolute" ? durationPreview(absStart, absEnd) : null;

  function applyAbsolute() {
    if (!absStart||!absEnd) return;
    if (new Date(absEnd) <= new Date(absStart)) return;
    onChange({ type:"absolute", start:absStart, end:absEnd });
    setOpen(false);
  }

  const btnBase = { background:"none", border:"none", cursor:"pointer", borderRadius:6,
    padding:"5px 10px", fontSize:12, textAlign:"left", width:"100%", transition:"background 0.12s" };
  const tabBtn = active => ({
    flex:1, padding:"8px 0", fontSize:13, fontWeight:active?700:500,
    background:active?`${C.cyan}18`:"none", color:active?C.cyan:C.textSec,
    border:"none", borderBottom:active?`2px solid ${C.cyan}`:`2px solid transparent`,
    cursor:"pointer", transition:"all 0.15s",
  });
  const inpStyle = { background:C.card2, border:`1px solid ${C.border2}`, borderRadius:8,
    padding:"8px 12px", color:C.textPri, fontSize:13, width:"100%", boxSizing:"border-box", outline:"none" };

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        display:"flex", alignItems:"center", gap:8,
        background:C.card2, border:`1px solid ${open?C.cyan:C.border2}`,
        borderRadius:8, padding:"8px 14px", color:C.textPri, fontSize:13,
        cursor:"pointer", transition:"border-color 0.15s", whiteSpace:"nowrap",
      }}>
        <Clock size={14} color={C.cyan} />
        <span style={{ maxWidth:200, overflow:"hidden", textOverflow:"ellipsis" }}>{label}</span>
        <ChevronDown size={13} color={C.textSec} style={{ transform:open?"rotate(180deg)":"none", transition:"transform 0.15s" }} />
      </button>
      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 6px)", right:0, zIndex:1000,
          background:C.card, border:`1px solid ${C.border2}`, borderRadius:12,
          boxShadow:"0 24px 64px rgba(0,0,0,0.7)", width:460, overflow:"hidden" }}>
          <div style={{ display:"flex", borderBottom:`1px solid ${C.border}` }}>
            <button style={tabBtn(tab==="relative")} onClick={()=>setTab("relative")}>
              <Clock size={12} style={{ marginRight:6, verticalAlign:"middle" }}/>Relative
            </button>
            <button style={tabBtn(tab==="absolute")} onClick={()=>setTab("absolute")}>
              <Calendar size={12} style={{ marginRight:6, verticalAlign:"middle" }}/>Absolute
            </button>
          </div>
          {tab==="relative" && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)" }}>
              {RELATIVE_GROUPS.map(group => (
                <div key={group.label} style={{ borderRight:`1px solid ${C.border}`, padding:"12px 0" }}>
                  <div style={{ color:C.textMut, fontSize:10, fontWeight:700, textTransform:"uppercase",
                    letterSpacing:"0.1em", padding:"0 12px 8px" }}>{group.label}</div>
                  {group.options.map(opt => (
                    <button key={opt.value} onClick={()=>{ onChange({type:"relative",value:opt.value}); setOpen(false); }}
                      style={{ ...btnBase, color:current.value===opt.value?C.cyan:C.textSec,
                        background:current.value===opt.value?`${C.cyan}12`:"none", fontWeight:current.value===opt.value?700:400 }}
                      onMouseEnter={e=>{ if(current.value!==opt.value) e.currentTarget.style.background=`${C.border}60`; }}
                      onMouseLeave={e=>{ if(current.value!==opt.value) e.currentTarget.style.background="none"; }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          {tab==="absolute" && (
            <div style={{ padding:16, display:"flex", flexDirection:"column", gap:12 }}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div>
                  <div style={{ color:C.textSec, fontSize:11, marginBottom:6 }}>Start</div>
                  <input type="datetime-local" style={inpStyle} value={absStart} onChange={e=>setAbsStart(e.target.value)}/>
                </div>
                <div>
                  <div style={{ color:C.textSec, fontSize:11, marginBottom:6 }}>End</div>
                  <input type="datetime-local" style={inpStyle} value={absEnd} onChange={e=>setAbsEnd(e.target.value)}/>
                </div>
              </div>
              {preview && <div style={{ color:preview.startsWith("⚠")?C.red:C.textSec, fontSize:12 }}>Duration: {preview}</div>}
              <button onClick={applyAbsolute} disabled={!absStart||!absEnd||new Date(absEnd)<=new Date(absStart)}
                style={{ background:C.cyan, border:"none", borderRadius:8, padding:"9px", color:C.bg,
                  fontSize:13, fontWeight:700, cursor:"pointer", opacity:(!absStart||!absEnd)?0.4:1 }}>
                Apply Range
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Account Template (for adding new accounts) ──────────────────────────────────
const ACCOUNT_TEMPLATE = {
  waf: {
    allow: 0,
    block: 0,
    count: 0,
    challenge: 0,
    captcha: 0,
    configuredRules: 0,
    webACLs: [],
    topGeoIPs: [],
    topURIs: [],
    blockedRules: [],
  },
  securityHub: {
    score: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    trend: [],
    standards: [],
    findingsByRegion: [],
    findings: [],
  },
  guardDuty: {
    findings: 0,
    high: 0,
    medium: 0,
    low: 0,
    types: [],
    findingsList: [],
    findingsByRegion: [],
    topResources: [],
  },
  inspector: {
    score: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    findings: [],
    findingsList: [],
    criticalFindings: [],
    resourceTypes: [],
  },
};

// ─── Initial Users (cleared — add your own) ───────────────────────────────────
const INIT_USERS = [];

// ─── Initial Credentials (cleared — credentials should be provisioned securely) ──
function getEnvironmentCredentials() {
  const raw = import.meta.env.VITE_DEFAULT_CREDENTIALS;
  if (!raw) {
    return [];
  }
  try {
    const trimmed = raw.trim();
    const normalized =
      ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
       (trimmed.startsWith('"') && trimmed.endsWith('"')))
        ? trimmed.slice(1, -1)
        : trimmed;
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed to parse VITE_DEFAULT_CREDENTIALS:", err);
    return [];
  }
}

async function loginWithServer(email, password) {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (res.status === 401 || res.status === 404) return null;
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || "Invalid email or password.");
  }

  const payload = await res.json();
  return { ...payload.user, password };
}

function readStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[storage] Could not persist ${key}:`, err);
  }
}

function usePersistentState(key, fallback) {
  const [value, setValue] = useState(() => readStoredJson(key, fallback));
  useEffect(() => writeStoredJson(key, value), [key, value]);
  return [value, setValue];
}

function accountFromInventory(account, inventory) {
  const publicS3 = inventory?.s3?.public || 0;
  const publicAlb = (inventory?.alb?.loadBalancers || []).filter(lb => lb.scheme === "internet-facing").length;
  const stoppedEc2 = inventory?.ec2?.stopped || 0;
  const totalResources =
    (inventory?.ec2?.total || 0) +
    (inventory?.eks?.total || 0) +
    (inventory?.s3?.total || 0) +
    (inventory?.vpc?.total || 0) +
    (inventory?.alb?.total || 0);
  const exposure = publicS3 + publicAlb;
  const score = Math.max(35, 100 - publicS3 * 12 - publicAlb * 4 - stoppedEc2 * 2);

  return {
    ...account,
    inventory,
    lastInventorySync: inventory?.fetchedAt || new Date().toISOString(),
    securityHub: inventory?.securityHub ? {
      ...account.securityHub,
      ...inventory.securityHub,
      trend: inventory.securityHub.trend?.length ? inventory.securityHub.trend : account.securityHub.trend || [],
      standards: inventory.securityHub.standards || account.securityHub.standards || [],
      findingsByRegion: inventory.securityHub.findingsByRegion || account.securityHub.findingsByRegion || [],
      findings: inventory.securityHub.findings || account.securityHub.findings || [],
      mitreTactics: inventory.securityHub.mitreTactics || [],
    } : {
      ...account.securityHub,
      score,
      critical: publicS3,
      high: publicAlb,
      medium: stoppedEc2,
      low: Math.max(0, totalResources - exposure - stoppedEc2),
      trend: account.securityHub.trend || [],
      standards: account.securityHub.standards || [],
      findingsByRegion: account.securityHub.findingsByRegion || [],
      findings: account.securityHub.findings || [],
      mitreTactics: [],
    },
    guardDuty: inventory?.guardDuty ? {
      ...account.guardDuty,
      ...inventory.guardDuty,
      findingsList: inventory.guardDuty.findingsList || account.guardDuty.findingsList || [],
      findingsByRegion: inventory.guardDuty.findingsByRegion || account.guardDuty.findingsByRegion || [],
      topResources: inventory.guardDuty.topResources || account.guardDuty.topResources || [],
    } : {
      ...account.guardDuty,
      findings: exposure,
      high: publicS3,
      medium: publicAlb,
      low: 0,
      types: [
        ...(publicS3 ? [{ type:"S3/BucketPublicAccess", count:publicS3, severity:"high" }] : []),
        ...(publicAlb ? [{ type:"Recon/PublicLoadBalancerExposure", count:publicAlb, severity:"medium" }] : []),
      ],
      findingsList: [],
      findingsByRegion: [],
      topResources: [],
    },
    inspector: inventory?.inspector ? {
      ...account.inspector,
      ...inventory.inspector,
      findingsList: inventory.inspector.findingsList || account.inspector.findingsList || [],
      criticalFindings: inventory.inspector.criticalFindings || account.inspector.criticalFindings || [],
      resourceTypes: inventory.inspector.resourceTypes || account.inspector.resourceTypes || [],
    } : {
      ...account.inspector,
      score: Math.max(40, 100 - stoppedEc2 * 5),
      critical: 0,
      high: stoppedEc2,
      medium: 0,
      low: 0,
      findings: (inventory?.ec2?.instances || [])
        .filter(i => i.state !== "running")
        .map(i => ({ resource:i.id, type:"Stopped EC2 instance", severity:"high" })),
      findingsList: [],
      criticalFindings: [],
      resourceTypes: [],
    },
    waf: inventory?.waf ? {
      ...account.waf,
      ...inventory.waf,
      webACLs: inventory.waf.webACLs || account.waf.webACLs || [],
      topGeoIPs: inventory.waf.topGeoIPs?.length ? inventory.waf.topGeoIPs : account.waf.topGeoIPs || [],
      topURIs: inventory.waf.topURIs?.length ? inventory.waf.topURIs : account.waf.topURIs || [],
      blockedRules: inventory.waf.blockedRules?.length ? inventory.waf.blockedRules : account.waf.blockedRules || [],
    } : {
      ...account.waf,
      allow: totalResources,
      block: exposure,
      count: stoppedEc2,
      challenge: publicAlb,
      captcha: publicS3,
      configuredRules: totalResources,
      webACLs: [],
      topGeoIPs: [],
      topURIs: (inventory?.s3?.buckets || []).slice(0, 5).map(b => ({ uri:b.name, requests:b.isPublic ? 1 : 0 })),
      blockedRules: [
        ...(publicS3 ? [{ rule:"Public S3 Buckets", blocks:publicS3 }] : []),
        ...(publicAlb ? [{ rule:"Public Load Balancers", blocks:publicAlb }] : []),
      ],
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function calcRisk(acc) {
  if (!acc) return 0;
  let s = 100;
  
  // Security Hub weighted impact
  s -= (acc.securityHub.critical || 0) * 5;
  s -= (acc.securityHub.high || 0) * 2;
  s -= (acc.securityHub.medium || 0) * 0.5;

  // GuardDuty weighted impact
  s -= (acc.guardDuty.high || 0) * 4;
  s -= (acc.guardDuty.medium || 0) * 1.5;

  // Inspector weighted impact
  s -= (acc.inspector.critical || 0) * 3;
  s -= (acc.inspector.high || 0) * 1;

  // Compliance Standards impact
  const failedStandards = (acc.securityHub.standards || []).filter(std => std.failedChecks > 10).length;
  s -= failedStandards * 5;

  // WAF effectiveness
  const totalWaf = (acc.waf.allow || 0) + (acc.waf.block || 0);
  if (totalWaf > 0) {
    const blockRate = (acc.waf.block || 0) / totalWaf;
    if (blockRate > 0.2) s -= 10; // High attack volume
  }

  return Math.max(0, Math.min(100, Math.round(s)));
}
function riskColor(score) { return score>=70?C.green:score>=50?C.yellow:C.red; }
function sevColor(sev) { return {critical:C.red, high:C.orange, medium:C.yellow, low:C.cyan}[sev]||C.textSec; }
function sevBg(sev) { return {critical:"rgba(255,59,92,0.12)",high:"rgba(255,140,0,0.12)",medium:"rgba(255,208,0,0.12)",low:"rgba(0,212,255,0.12)"}[sev]||"transparent"; }
const fmtNum = n => n>=1000?(n/1000).toFixed(1)+"k":n;

function getScenarios(acc) {
  const s = [];
  acc.guardDuty.types.forEach(t=>{
    if (t.type.includes("SSHBruteForce")) s.push({name:"SSH Brute Force",risk:"critical",desc:"Repeated SSH attempts on EC2 — possible credential stuffing attack."});
    if (t.type.includes("CryptoCurrency")) s.push({name:"Crypto-mining Detected",risk:"critical",desc:"Suspicious crypto-mining traffic from EC2 indicates compromise."});
    if (t.type.includes("PortProbe")) s.push({name:"Recon / Port Scanning",risk:"high",desc:"Active reconnaissance via port scanning on EC2 instances."});
    if (t.type.includes("InstanceCredentialExfiltration")) s.push({name:"Credential Exfiltration",risk:"critical",desc:"IAM instance credentials exfiltrated and used externally."});
    if (t.type.includes("BucketPublicAccess")) s.push({name:"S3 Data Exposure",risk:"high",desc:"S3 bucket with public access may be leaking sensitive data."});
    if (t.type.includes("ConsoleLoginSuccess")) s.push({name:"Unusual Console Login",risk:"medium",desc:"Successful console login from anomalous IP / user agent."});
    if (t.type.includes("NetworkPermissions")) s.push({name:"IAM Privilege Escalation",risk:"high",desc:"IAM user queried network permissions — lateral movement risk."});
  });
  const sensitiveURI = acc.waf.topURIs.find(u=>[".env",".git","wp-login","phpmyadmin","xmlrpc"].some(p=>u.uri.includes(p)));
  if (sensitiveURI) s.push({name:"Config Discovery Attempt",risk:"high",desc:`Blocked access attempts to ${sensitiveURI.uri} — potential secret harvesting.`});
  return s.slice(0,6);
}

function scaleAccount(acc, factor) {
  if (factor===1) return acc;
  const s = v => scaleVal(v, factor);
  return {
    ...acc,
    waf:{ ...acc.waf, allow:s(acc.waf.allow), block:s(acc.waf.block), count:s(acc.waf.count),
      challenge:s(acc.waf.challenge), captcha:s(acc.waf.captcha),
      topGeoIPs:acc.waf.topGeoIPs.map(x=>({...x,requests:s(x.requests)})),
      topURIs:acc.waf.topURIs.map(x=>({...x,requests:s(x.requests)})),
      blockedRules:acc.waf.blockedRules.map(x=>({...x,blocks:s(x.blocks)})) },
    guardDuty:{ ...acc.guardDuty, findings:s(acc.guardDuty.findings), high:s(acc.guardDuty.high),
      medium:s(acc.guardDuty.medium), low:s(acc.guardDuty.low),
      types:acc.guardDuty.types.map(x=>({...x,count:s(x.count)})) },
    inspector:{ ...acc.inspector, critical:s(acc.inspector.critical), high:s(acc.inspector.high),
      medium:s(acc.inspector.medium), low:s(acc.inspector.low) },
    securityHub:{ ...acc.securityHub, critical:s(acc.securityHub.critical), high:s(acc.securityHub.high),
      medium:s(acc.securityHub.medium), low:s(acc.securityHub.low) },
  };
}

// ─── Password Strength ────────────────────────────────────────────────────────
function getPasswordStrength(password) {
  if (!password) return { score:0, label:"", color:"transparent", checks:[] };
  const checks = [
    { label:"At least 14 characters",   pass: password.length >= 14 },
    { label:"Uppercase letter (A–Z)",    pass: /[A-Z]/.test(password) },
    { label:"Lowercase letter (a–z)",    pass: /[a-z]/.test(password) },
    { label:"Number (0–9)",              pass: /[0-9]/.test(password) },
    { label:"Special character (!@#…)",  pass: /[^A-Za-z0-9]/.test(password) },
    { label:"No common patterns",        pass: !/(password|123456|qwerty|abc)/i.test(password) },
  ];
  const passed = checks.filter(c=>c.pass).length;
  const score = Math.round((passed / checks.length) * 100);
  let label, color;
  if (passed <= 2)      { label = "Very Weak";  color = C.red;    }
  else if (passed <= 3) { label = "Weak";       color = C.orange; }
  else if (passed <= 4) { label = "Fair";       color = C.yellow; }
  else if (passed <= 5) { label = "Strong";     color = C.green;  }
  else                  { label = "Very Strong"; color = C.cyan;  }
  return { score, label, color, checks, passed };
}

// ─── Notification Toast ───────────────────────────────────────────────────────
function Toast({ toasts, removeToast }) {
  return (
    <div style={{ position:"fixed", top:20, right:20, zIndex:9999, display:"flex", flexDirection:"column", gap:8, pointerEvents:"none" }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background:t.type==="success"?`${C.green}15`:t.type==="error"?`${C.red}15`:`${C.cyan}15`,
          border:`1px solid ${t.type==="success"?C.green:t.type==="error"?C.red:C.cyan}50`,
          borderRadius:12, padding:"14px 18px", color:C.textPri, fontSize:13, fontWeight:500,
          backdropFilter:"blur(10px)", boxShadow:"0 8px 32px rgba(0,0,0,0.4)",
          display:"flex", alignItems:"center", gap:10, pointerEvents:"all",
          animation:"slideInRight 0.3s ease", minWidth:280, maxWidth:380,
        }}>
          {t.type==="success" && <CheckCircle size={16} color={C.green}/>}
          {t.type==="error"   && <XCircle     size={16} color={C.red}/>}
          {t.type==="info"    && <Info        size={16} color={C.cyan}/>}
          <span style={{ flex:1 }}>{t.msg}</span>
          <button onClick={()=>removeToast(t.id)} style={{ background:"none", border:"none", color:C.textSec, cursor:"pointer", padding:2 }}>
            <X size={13}/>
          </button>
        </div>
      ))}
    </div>
  );
}

function useToast() {
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((msg, type="info") => {
    const id = Date.now();
    setToasts(t=>[...t, {id, msg, type}]);
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)), 4000);
  }, []);
  const removeToast = useCallback(id=>setToasts(t=>t.filter(x=>x.id!==id)), []);
  return { toasts, addToast, removeToast };
}

// ─── Shared UI Primitives ─────────────────────────────────────────────────────
const card  = (extra={}) => ({
  background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:20, ...extra
});
const card2 = (extra={}) => ({
  background:C.card2, border:`1px solid ${C.border2}`, borderRadius:10, padding:16, ...extra
});
const tooltipStyle = {
  background:C.card2, border:`1px solid ${C.border2}`, borderRadius:10,
  color:C.textPri, fontSize:12, padding:"8px 12px",
};

function Tag({ label, color }) {
  return (
    <span style={{ background:`${color}20`, color, fontSize:11, fontWeight:700,
      padding:"3px 10px", borderRadius:20, letterSpacing:"0.05em", textTransform:"uppercase",
      border:`1px solid ${color}30` }}>
      {label}
    </span>
  );
}

function Stat({ label, value, color=C.cyan, icon:Icon, sub }) {
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"18px 20px",
      display:"flex", flexDirection:"column", gap:6, position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:0, right:0, width:80, height:80, borderRadius:"0 14px 0 80px",
        background:`${color}08`, pointerEvents:"none" }} />
      <div style={{ display:"flex", alignItems:"center", gap:7, color:C.textSec, fontSize:11,
        textTransform:"uppercase", letterSpacing:"0.09em", fontWeight:600 }}>
        {Icon && <Icon size={12} color={color} />}{label}
      </div>
      <div style={{ fontSize:30, fontWeight:800, color, fontVariantNumeric:"tabular-nums", lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:C.textSec }}>{sub}</div>}
    </div>
  );
}

function SevBar({ critical, high, medium, low }) {
  const total = critical+high+medium+low||1;
  const bars = [
    {label:"Critical",val:critical,color:C.red},
    {label:"High",val:high,color:C.orange},
    {label:"Medium",val:medium,color:C.yellow},
    {label:"Low",val:low,color:C.cyan},
  ];
  return (
    <div>
      <div style={{ display:"flex", height:6, borderRadius:3, overflow:"hidden", gap:1 }}>
        {bars.map(b=><div key={b.label} style={{ flex:b.val, background:b.color, minWidth:b.val?2:0 }} />)}
      </div>
      <div style={{ display:"flex", gap:16, marginTop:10 }}>
        {bars.map(b=>(
          <div key={b.label} style={{ display:"flex", flexDirection:"column", gap:1 }}>
            <span style={{ fontSize:17, fontWeight:800, color:b.color }}>{b.val}</span>
            <span style={{ fontSize:10, color:C.textSec, textTransform:"uppercase", letterSpacing:"0.05em" }}>{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScoreRing({ score, size=120, label="Score" }) {
  const color = riskColor(score);
  const r = (size/2)-10;
  const circ = 2*Math.PI*r;
  const dash = (score/100)*circ;
  return (
    <div style={{ position:"relative", width:size, height:size }}>
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={`${color}20`} strokeWidth={8} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition:"stroke-dasharray 0.6s ease", filter:`drop-shadow(0 0 6px ${color}80)` }} />
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center", textAlign:"center" }}>
        <div style={{ fontSize:size>110?22:15, fontWeight:900, color }}>{score}</div>
        <div style={{ fontSize:9, color:C.textSec, textTransform:"uppercase", letterSpacing:"0.08em" }}>{label}</div>
      </div>
    </div>
  );
}

// ─── Password Strength Meter ──────────────────────────────────────────────────
function PasswordStrengthMeter({ password }) {
  const strength = getPasswordStrength(password);
  if (!password) return null;
  return (
    <div style={{ marginTop:10 }}>
      {/* Bar */}
      <div style={{ display:"flex", gap:3, marginBottom:6 }}>
        {[1,2,3,4,5,6].map(i => (
          <div key={i} style={{
            flex:1, height:4, borderRadius:2,
            background: i <= strength.passed ? strength.color : C.border2,
            transition:"background 0.2s",
          }}/>
        ))}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ fontSize:11, color:strength.color, fontWeight:700 }}>{strength.label}</span>
        <span style={{ fontSize:11, color:C.textSec }}>{strength.passed}/{strength.checks.length} checks passed</span>
      </div>
      {/* Checklist */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
        {strength.checks.map((c,i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:6, fontSize:11,
            color:c.pass?C.green:C.textSec }}>
            {c.pass
              ? <CheckCircle size={11} color={C.green}/>
              : <XCircle size={11} color={C.textMut}/>
            }
            {c.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Change Password Modal ────────────────────────────────────────────────────
function ChangePasswordModal({ currentUser, onClose, credentials, setCredentials, setCurrentUser, addToast }) {
  const [oldPass,   setOldPass]   = useState("");
  const [newPass,   setNewPass]   = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [showOld,   setShowOld]   = useState(false);
  const [showNew,   setShowNew]   = useState(false);
  const [showConf,  setShowConf]  = useState(false);
  const [err,       setErr]       = useState("");

  const strength = getPasswordStrength(newPass);

  function handleSubmit() {
    setErr("");
    const cred = credentials.find(c=>c.email===currentUser.email);
    if (!cred || cred.password !== oldPass) { setErr("Current password is incorrect."); return; }
    if (newPass.length < 14) { setErr("New password must be at least 14 characters."); return; }
    if (strength.passed < 4) { setErr("Password is too weak. Please meet at least 4 requirements."); return; }
    if (newPass !== confirm) { setErr("New passwords do not match."); return; }
    if (newPass === oldPass)  { setErr("New password cannot be the same as the current password."); return; }

    setCredentials(prev => prev.map(c =>
      c.email === currentUser.email ? { ...c, password: newPass } : c
    ));
    setCurrentUser(prev => prev ? { ...prev, password: newPass } : prev);

    fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: cred.notifyEmail || cred.email,
        subject: 'AWS SecureView Password Changed',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #00d4ff;">Your password was changed</h2>
            <p>Hi ${currentUser.name || currentUser.email},</p>
            <p>Your dashboard password was successfully updated.</p>
            <p>If you did not make this change, contact your administrator immediately.</p>
            <p>Best regards,<br/>AWS SecureView Team</p>
          </div>
        `,
        text: `Your password was changed.\n\nIf you did not make this change, contact your administrator immediately.\n\nAWS SecureView Team\n`,
      }),
    }).catch(err => {
      console.warn('Password email failed to send:', err);
    });

    addToast(`Password changed. Confirmation sent to ${cred.notifyEmail || cred.email}`, "success");
    onClose();
  }

  const inp = {
    background:C.card2, border:`1px solid ${C.border2}`, borderRadius:9,
    padding:"10px 40px 10px 12px", color:C.textPri, fontSize:13, width:"100%",
    boxSizing:"border-box", outline:"none", fontFamily:"inherit",
  };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:2000, background:"rgba(0,0,0,0.7)",
      backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ ...card(), width:460, boxShadow:"0 32px 80px rgba(0,0,0,0.8)" }}>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:38, height:38, borderRadius:10, background:`${C.cyan}15`,
              display:"flex", alignItems:"center", justifyContent:"center", border:`1px solid ${C.cyan}30` }}>
              <Key size={18} color={C.cyan}/>
            </div>
            <div>
              <div style={{ color:C.textPri, fontSize:15, fontWeight:800 }}>Change Password</div>
              <div style={{ color:C.textSec, fontSize:11 }}>Minimum 14 characters required</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:C.textSec, cursor:"pointer", padding:4 }}>
            <X size={18}/>
          </button>
        </div>

        {err && (
          <div style={{ background:`${C.red}12`, border:`1px solid ${C.red}40`, borderRadius:9,
            padding:"10px 14px", color:C.red, fontSize:12, marginBottom:16, display:"flex", alignItems:"center", gap:8 }}>
            <AlertCircle size={13}/>{err}
          </div>
        )}

        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {/* Current Password */}
          <div>
            <div style={{ color:C.textSec, fontSize:11, marginBottom:6 }}>Current Password</div>
            <div style={{ position:"relative" }}>
              <input style={inp} type={showOld?"text":"password"} placeholder="Enter current password"
                value={oldPass} onChange={e=>setOldPass(e.target.value)}/>
              <button onClick={()=>setShowOld(!showOld)} style={{ position:"absolute", right:10, top:"50%",
                transform:"translateY(-50%)", background:"none", border:"none", color:C.textSec, cursor:"pointer" }}>
                {showOld ? <EyeOff size={14}/> : <Eye size={14}/>}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div>
            <div style={{ color:C.textSec, fontSize:11, marginBottom:6 }}>New Password</div>
            <div style={{ position:"relative" }}>
              <input style={inp} type={showNew?"text":"password"} placeholder="Minimum 14 characters"
                value={newPass} onChange={e=>setNewPass(e.target.value)}/>
              <button onClick={()=>setShowNew(!showNew)} style={{ position:"absolute", right:10, top:"50%",
                transform:"translateY(-50%)", background:"none", border:"none", color:C.textSec, cursor:"pointer" }}>
                {showNew ? <EyeOff size={14}/> : <Eye size={14}/>}
              </button>
            </div>
            <PasswordStrengthMeter password={newPass}/>
          </div>

          {/* Confirm Password */}
          <div>
            <div style={{ color:C.textSec, fontSize:11, marginBottom:6 }}>Confirm New Password</div>
            <div style={{ position:"relative" }}>
              <input style={{
                ...inp,
                borderColor: confirm && (confirm===newPass?C.green:C.red),
              }} type={showConf?"text":"password"} placeholder="Repeat new password"
                value={confirm} onChange={e=>setConfirm(e.target.value)}/>
              <button onClick={()=>setShowConf(!showConf)} style={{ position:"absolute", right:10, top:"50%",
                transform:"translateY(-50%)", background:"none", border:"none", color:C.textSec, cursor:"pointer" }}>
                {showConf ? <EyeOff size={14}/> : <Eye size={14}/>}
              </button>
            </div>
            {confirm && confirm!==newPass && (
              <div style={{ color:C.red, fontSize:11, marginTop:5 }}>Passwords do not match</div>
            )}
          </div>

          {/* Email notification note */}
          <div style={{ ...card2(), display:"flex", alignItems:"center", gap:10, padding:"10px 14px" }}>
            <Mail size={14} color={C.cyan}/>
            <span style={{ color:C.textSec, fontSize:12 }}>
              A confirmation will be sent to <span style={{ color:C.cyan }}>
                {credentials.find(c=>c.email===currentUser.email)?.notifyEmail || currentUser.email}
              </span>
            </span>
          </div>

          <div style={{ display:"flex", gap:10, marginTop:4 }}>
            <button onClick={handleSubmit}
              disabled={!oldPass||!newPass||!confirm}
              style={{ flex:1, background:`linear-gradient(135deg,${C.cyan},#006bff)`,
                border:"none", borderRadius:9, padding:"11px", color:"#fff",
                fontSize:13, fontWeight:700, cursor:"pointer",
                opacity:(!oldPass||!newPass||!confirm)?0.5:1,
                boxShadow:`0 4px 16px ${C.cyan}35` }}>
              Update Password
            </button>
            <button onClick={onClose} style={{ background:"none", border:`1px solid ${C.border2}`,
              borderRadius:9, padding:"11px 20px", color:C.textSec, fontSize:13, cursor:"pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Notification Settings Modal ──────────────────────────────────────────────
function NotificationSettingsModal({ currentUser, credentials, setCredentials, onClose, addToast }) {
  const cred = credentials.find(c=>c.email===currentUser.email) || {};
  const [notifyEmail, setNotifyEmail] = useState(cred.notifyEmail || currentUser.email || "");
  const [enabled,     setEnabled]     = useState(cred.notificationsEnabled ?? true);
  const [events, setEvents] = useState({
    failed_login:    cred.notify_failed_login    ?? true,
    new_login:       cred.notify_new_login       ?? true,
    password_change: cred.notify_password_change ?? true,
    user_add:        cred.notify_user_add        ?? false,
    critical_alert:  cred.notify_critical_alert  ?? true,
  });

  function save() {
    setCredentials(prev => prev.map(c =>
      c.email === currentUser.email
        ? { ...c, notifyEmail, notificationsEnabled:enabled,
            notify_failed_login:events.failed_login,
            notify_new_login:events.new_login,
            notify_password_change:events.password_change,
            notify_user_add:events.user_add,
            notify_critical_alert:events.critical_alert,
          }
        : c
    ));
    addToast(`Notification preferences saved. Alerts will go to ${notifyEmail}`, "success");
    onClose();
  }

  const toggle = key => setEvents(e=>({...e,[key]:!e[key]}));
  const switchStyle = on => ({
    width:38, height:20, borderRadius:10, border:"none", cursor:"pointer",
    background:on?C.cyan:C.border2, position:"relative", transition:"background 0.2s", flexShrink:0,
  });

  const eventList = [
    { key:"failed_login",    label:"Failed Login Attempt",     desc:"Alert when someone fails to log in" },
    { key:"new_login",       label:"New Login",                desc:"Alert on every successful sign-in" },
    { key:"password_change", label:"Password Changed",         desc:"Alert when your password is updated" },
    { key:"user_add",        label:"User Added/Removed",       desc:"Alert on user management actions" },
    { key:"critical_alert",  label:"Critical Security Alert",  desc:"Alert on critical/high severity findings" },
  ];

  return (
    <div style={{ position:"fixed", inset:0, zIndex:2000, background:"rgba(0,0,0,0.7)",
      backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ ...card(), width:500, boxShadow:"0 32px 80px rgba(0,0,0,0.8)", maxHeight:"85vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:22 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:38, height:38, borderRadius:10, background:`${C.yellow}15`,
              display:"flex", alignItems:"center", justifyContent:"center", border:`1px solid ${C.yellow}30` }}>
              <Bell size={18} color={C.yellow}/>
            </div>
            <div>
              <div style={{ color:C.textPri, fontSize:15, fontWeight:800 }}>Notification Settings</div>
              <div style={{ color:C.textSec, fontSize:11 }}>Email alerts for security events</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", color:C.textSec, cursor:"pointer" }}>
            <X size={18}/>
          </button>
        </div>

        {/* Verified Email */}
        <div style={{ marginBottom:18 }}>
          <div style={{ color:C.textSec, fontSize:11, marginBottom:6 }}>Verified Notification Email</div>
          <div style={{ position:"relative" }}>
            <input
              style={{ background:C.card2, border:`1px solid ${C.border2}`, borderRadius:9,
                padding:"10px 40px 10px 36px", color:C.textPri, fontSize:13, width:"100%",
                boxSizing:"border-box", outline:"none", fontFamily:"inherit" }}
              type="email" value={notifyEmail}
              onChange={e=>setNotifyEmail(e.target.value)}
              placeholder="your@email.com"
            />
            <Mail size={14} color={C.textSec} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }}/>
            {notifyEmail.includes("@") && (
              <CheckCircle size={14} color={C.green} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)" }}/>
            )}
          </div>
          <div style={{ color:C.textSec, fontSize:11, marginTop:5, display:"flex", alignItems:"center", gap:5 }}>
            <Shield size={11} color={C.cyan}/> Notifications are sent only to this verified address
          </div>
        </div>

        {/* Master toggle */}
        <div style={{ ...card2(), display:"flex", justifyContent:"space-between", alignItems:"center",
          marginBottom:14, padding:"12px 16px" }}>
          <div>
            <div style={{ color:C.textPri, fontSize:13, fontWeight:600 }}>Email Notifications</div>
            <div style={{ color:C.textSec, fontSize:11 }}>Master switch for all alerts</div>
          </div>
          <button onClick={()=>setEnabled(!enabled)} style={switchStyle(enabled)}>
            <div style={{ position:"absolute", top:2, left:enabled?20:2, width:16, height:16,
              borderRadius:8, background:"white", transition:"left 0.2s" }}/>
          </button>
        </div>

        {/* Individual events */}
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:20 }}>
          {eventList.map(ev => (
            <div key={ev.key} style={{ ...card2(), display:"flex", justifyContent:"space-between",
              alignItems:"center", padding:"12px 16px", opacity:enabled?1:0.4 }}>
              <div>
                <div style={{ color:C.textPri, fontSize:13, fontWeight:500 }}>{ev.label}</div>
                <div style={{ color:C.textSec, fontSize:11 }}>{ev.desc}</div>
              </div>
              <button onClick={()=>enabled&&toggle(ev.key)} style={switchStyle(events[ev.key]&&enabled)}>
                <div style={{ position:"absolute", top:2, left:events[ev.key]&&enabled?20:2, width:16, height:16,
                  borderRadius:8, background:"white", transition:"left 0.2s" }}/>
              </button>
            </div>
          ))}
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <button onClick={save} style={{ flex:1, background:`linear-gradient(135deg,${C.yellow},${C.orange})`,
            border:"none", borderRadius:9, padding:"11px", color:"#000",
            fontSize:13, fontWeight:700, cursor:"pointer" }}>
            Save Preferences
          </button>
          <button onClick={onClose} style={{ background:"none", border:`1px solid ${C.border2}`,
            borderRadius:9, padding:"11px 20px", color:C.textSec, fontSize:13, cursor:"pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Executive Report Modal ───────────────────────────────────────────────────
function ExecutiveReportModal({ accounts, onClose }) {
  const print = () => window.print();
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", zIndex:1000,
      display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:"#fff", width:"100%", maxWidth:900, height:"90vh", borderRadius:16,
        display:"flex", flexDirection:"column", overflow:"hidden", boxShadow:"0 24px 60px rgba(0,0,0,0.5)" }}>
        
        {/* Modal Header (Not printed) */}
        <div className="no-print" style={{ padding:"16px 24px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0",
          display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <h2 style={{ margin:0, fontSize:18, fontWeight:800, color:"#1e293b" }}>Executive Security Report</h2>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={print} style={{ background:"#0ea5e9", color:"#fff", border:"none", borderRadius:8,
              padding:"8px 16px", fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}>
              <Printer size={16}/> Print / Save PDF
            </button>
            <button onClick={onClose} style={{ background:"none", border:"1px solid #cbd5e1", borderRadius:8,
              padding:"8px 16px", color:"#64748b", fontWeight:600, cursor:"pointer" }}>Close</button>
          </div>
        </div>

        {/* Report Content */}
        <div id="report-content" style={{ flex:1, overflowY:"auto", padding:48, color:"#1e293b", fontFamily:"serif" }}>
          <style>{`
            @media print {
              .no-print { display: none !important; }
              body { background: #fff !important; }
              #report-content { padding: 0 !important; overflow: visible !important; height: auto !important; }
            }
          `}</style>

          <div style={{ textAlign:"center", marginBottom:40 }}>
            <h1 style={{ fontSize:32, fontWeight:900, margin:"0 0 8px", color:"#0f172a" }}>AWS Security Posture Report</h1>
            <p style={{ fontSize:16, color:"#64748b", margin:0 }}>Generated on {date}</p>
          </div>

          <div style={{ marginBottom:32 }}>
            <h2 style={{ fontSize:20, borderBottom:"2px solid #0ea5e9", paddingBottom:8, marginBottom:16 }}>1. Executive Summary</h2>
            <p style={{ lineHeight:1.6 }}>
              This report provides a high-level overview of the security posture across <strong>{accounts.length}</strong> AWS accounts. 
              The assessment includes compliance standards, vulnerability scanning, threat detection, and edge protection metrics.
            </p>
          </div>

          <div style={{ marginBottom:32 }}>
            <h2 style={{ fontSize:20, borderBottom:"2px solid #0ea5e9", paddingBottom:8, marginBottom:20 }}>2. Multi-Account Risk Matrix</h2>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:"#f1f5f9" }}>
                  {["Account Name", "ID", "Risk Score", "Critical", "High", "WAF Blocks"].map(h => (
                    <th key={h} style={{ textAlign:"left", padding:12, border:"1px solid #e2e8f0", fontSize:13 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accounts.map(acc => (
                  <tr key={acc.id}>
                    <td style={{ padding:12, border:"1px solid #e2e8f0", fontWeight:700 }}>{acc.name}</td>
                    <td style={{ padding:12, border:"1px solid #e2e8f0", fontFamily:"monospace" }}>{acc.id}</td>
                    <td style={{ padding:12, border:"1px solid #e2e8f0", fontWeight:800, color:calcRisk(acc) < 50 ? "#ef4444" : "#10b981" }}>{calcRisk(acc)}/100</td>
                    <td style={{ padding:12, border:"1px solid #e2e8f0" }}>{acc.securityHub.critical + acc.inspector.critical}</td>
                    <td style={{ padding:12, border:"1px solid #e2e8f0" }}>{acc.securityHub.high + acc.inspector.high}</td>
                    <td style={{ padding:12, border:"1px solid #e2e8f0" }}>{acc.waf.block}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h2 style={{ fontSize:20, borderBottom:"2px solid #0ea5e9", paddingBottom:8, marginBottom:16 }}>3. Critical Recommendations</h2>
            <ul style={{ lineHeight:1.8 }}>
              {accounts.some(a => a.securityHub.critical > 0) && <li>Immediate remediation of Critical Security Hub findings (S3 Public Access, Root MFA).</li>}
              {accounts.some(a => a.inspector.critical > 0) && <li>Patching of critical CVEs identified in EC2 and ECR instances.</li>}
              {accounts.some(a => a.guardDuty.high > 0) && <li>Investigation of high-severity GuardDuty threat detections (Unauthorized Access, Malware).</li>}
              <li>Review WAF rate-limiting rules to mitigate ongoing reconnaissance activities.</li>
            </ul>
          </div>

          <div style={{ marginTop:60, paddingTop:20, borderTop:"1px solid #e2e8f0", fontSize:12, color:"#94a3b8", textAlign:"center" }}>
            AWS SecureView Executive Report — Internal Use Only
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Login ─────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, credentials }) {
  const [email, setEmail]   = useState("");
  const [pass,  setPass]    = useState("");
  const [err,   setErr]     = useState("");
  const [show,  setShow]    = useState(false);
  const [loading, setLoading] = useState(false);

  async function attempt() {
    setErr("");
    setLoading(true);
    try {
      const serverUser = await loginWithServer(email, pass);
      const found = serverUser || credentials.find(c=>c.email===email&&c.password===pass);
      if (found) {
        await onLogin(found);
        setErr("");
      } else {
        setErr(credentials.length
          ? "Invalid email or password."
          : "No login credentials are configured for this deployment.");
      }
    } catch (err) {
      setErr(err.message || "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  const inp = { background:`${C.card2}cc`, border:`1px solid ${C.border2}`, borderRadius:10,
    padding:"11px 14px", color:C.textPri, fontSize:14, width:"100%", outline:"none",
    boxSizing:"border-box", transition:"border-color 0.2s",
    fontFamily:"'Segoe UI', system-ui, sans-serif" };

  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center",
      justifyContent:"center", fontFamily:"'Segoe UI',system-ui,sans-serif", position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", inset:0, backgroundImage:`
        linear-gradient(${C.border}44 1px, transparent 1px),
        linear-gradient(90deg, ${C.border}44 1px, transparent 1px)`,
        backgroundSize:"48px 48px", opacity:0.4 }} />
      <div style={{ position:"absolute", top:"20%", left:"30%", width:400, height:400,
        borderRadius:"50%", background:`radial-gradient(circle, ${C.cyan}18 0%, transparent 70%)`, filter:"blur(40px)" }} />
      <div style={{ position:"absolute", bottom:"20%", right:"25%", width:300, height:300,
        borderRadius:"50%", background:`radial-gradient(circle, ${C.purple}18 0%, transparent 70%)`, filter:"blur(40px)" }} />

      <div style={{ ...card(), width:420, position:"relative", boxShadow:`0 32px 80px rgba(0,0,0,0.8), 0 0 0 1px ${C.border2}` }}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ display:"inline-flex", alignItems:"center", justifyContent:"center",
            width:60, height:60, borderRadius:16, background:`${C.cyan}18`,
            border:`1px solid ${C.cyan}30`, marginBottom:16, boxShadow:`0 0 24px ${C.cyan}30` }}>
            <Shield size={28} color={C.cyan} />
          </div>
          <h1 style={{ color:C.textPri, fontSize:22, fontWeight:900, margin:0, letterSpacing:"-0.02em" }}>AWS SecureView</h1>
          <p style={{ color:C.textSec, fontSize:13, marginTop:6, margin:"6px 0 0" }}>Cloud Security Posture Dashboard</p>
        </div>

        {err && (
          <div style={{ background:"rgba(255,59,92,0.1)", border:`1px solid ${C.red}40`,
            borderRadius:10, padding:"10px 14px", color:C.red, fontSize:13, marginBottom:16,
            display:"flex", alignItems:"center", gap:8 }}>
            <AlertCircle size={14}/>{err}
          </div>
        )}

        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <input style={inp} type="email" placeholder="Email address" value={email}
            onChange={e=>setEmail(e.target.value)}
            onFocus={e=>e.target.style.borderColor=C.cyan}
            onBlur={e=>e.target.style.borderColor=C.border2} />
          <div style={{ position:"relative" }}>
            <input style={inp} type={show?"text":"password"} placeholder="Password" value={pass}
              onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&attempt()}
              onFocus={e=>e.target.style.borderColor=C.cyan}
              onBlur={e=>e.target.style.borderColor=C.border2} />
            <button onClick={()=>setShow(!show)} style={{ position:"absolute", right:12, top:"50%",
              transform:"translateY(-50%)", background:"none", border:"none", color:C.textSec, cursor:"pointer" }}>
              {show ? <EyeOff size={15}/> : <Eye size={15}/>}
            </button>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:6 }}>
            <button onClick={async () => {
              if (!email) { setErr("Please enter your email first."); return; }
              try {
                const res = await fetch("/api/password-reset", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email })
                });
                if (res.ok) setErr("Reset link sent! Check your email.");
                else setErr("Failed to send reset link.");
              } catch (e) { setErr("Error requesting reset."); }
            }} style={{ background:"none", border:"none", color:C.cyan, fontSize:12, cursor:"pointer", padding:0 }}>
              Forgot Password?
            </button>
          </div>
          <button onClick={attempt} disabled={loading} style={{
            background:loading?C.card2:`linear-gradient(135deg,${C.cyan},#006bff)`,
            border:"none", borderRadius:10, padding:"13px", color:"#fff", fontSize:15,
            fontWeight:700, cursor:loading?"not-allowed":"pointer", letterSpacing:"0.03em",
            boxShadow:loading?"none":`0 8px 24px ${C.cyan}40`, transition:"all 0.2s" }}>
            {loading?"Signing in…":"Sign In →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
const NAV = [
  { id:"overview",    label:"Overview",       Icon:Layers    },
  { id:"inventory",   label:"Inventory",      Icon:Boxes     },
  { id:"waf",         label:"WAF",            Icon:Shield    },
  { id:"securityhub", label:"Security Hub",   Icon:ShieldCheck},
  { id:"guardduty",   label:"GuardDuty",      Icon:ShieldAlert},
  { id:"inspector",   label:"Inspector",      Icon:Activity  },
  { id:"risk",        label:"Risk & Attacks", Icon:Zap       },
  { id:"accounts",    label:"Accounts",       Icon:Database, adminOnly:true },
  { id:"users",       label:"Users",          Icon:Users,    adminOnly:true },
  { id:"auditlog",    label:"Audit Log",      Icon:FileText, adminOnly:true },
  { id:"settings",    label:"Settings",       Icon:Settings  },
];

function Sidebar({ active, setActive, role, user, onLogout, onChangePassword, onNotifSettings }) {
  const [collapsed, setCollapsed] = useState(false);
  const w = collapsed ? 64 : 220;

  return (
    <div style={{ width:w, minHeight:"100vh", background:C.surface, borderRight:`1px solid ${C.border}`,
      display:"flex", flexDirection:"column", transition:"width 0.22s ease", flexShrink:0, zIndex:50 }}>
      <div style={{ padding:collapsed?"14px 0":"18px 16px 14px", borderBottom:`1px solid ${C.border}`,
        display:"flex", alignItems:"center", justifyContent:collapsed?"center":"space-between", minHeight:60 }}>
        {!collapsed && (
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:32, height:32, borderRadius:9, background:`${C.cyan}18`,
              display:"flex", alignItems:"center", justifyContent:"center",
              border:`1px solid ${C.cyan}30`, boxShadow:`0 0 12px ${C.cyan}25` }}>
              <Shield size={17} color={C.cyan} />
            </div>
            <span style={{ color:C.textPri, fontSize:14, fontWeight:800, letterSpacing:"-0.01em" }}>SecureView</span>
          </div>
        )}
        <button onClick={()=>setCollapsed(!collapsed)} style={{ background:`${C.border}80`, border:"none",
          borderRadius:7, padding:6, cursor:"pointer", color:C.textSec, display:"flex", transition:"background 0.15s" }}
          onMouseEnter={e=>e.currentTarget.style.background=`${C.cyan}20`}
          onMouseLeave={e=>e.currentTarget.style.background=`${C.border}80`}>
          {collapsed?<ChevronRight size={15}/>:<ChevronLeft size={15}/>}
        </button>
      </div>

      <nav style={{ flex:1, padding:"10px 0", overflowY:"auto" }}>
        {NAV.filter(n=>!n.adminOnly||role==="admin").map(n=>{
          const isActive = active===n.id;
          return (
            <button key={n.id} onClick={()=>setActive(n.id)}
              style={{ display:"flex", alignItems:"center", gap:11, width:"100%",
                padding:collapsed?"12px 0":"9px 16px", justifyContent:collapsed?"center":"flex-start",
                background:isActive?`${C.cyan}14`:"none", border:"none",
                borderLeft:isActive?`2px solid ${C.cyan}`:"2px solid transparent",
                color:isActive?C.cyan:C.textSec, cursor:"pointer", fontSize:13,
                fontWeight:isActive?700:500, transition:"all 0.12s", position:"relative" }}
              onMouseEnter={e=>{ if (!isActive){ e.currentTarget.style.background=`${C.border}60`; e.currentTarget.style.color=C.textPri; }}}
              onMouseLeave={e=>{ if (!isActive){ e.currentTarget.style.background="none"; e.currentTarget.style.color=C.textSec; }}}>
              <n.Icon size={16} />
              {!collapsed && <span>{n.label}</span>}
              {isActive && !collapsed && (
                <div style={{ marginLeft:"auto", width:5, height:5, borderRadius:"50%", background:C.cyan, boxShadow:`0 0 6px ${C.cyan}` }} />
              )}
            </button>
          );
        })}
      </nav>

      <div style={{ borderTop:`1px solid ${C.border}`, padding:collapsed?"10px 0":"12px 14px" }}>
        {!collapsed && (
          <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:10,
            padding:"9px 10px", background:C.card2, borderRadius:10, border:`1px solid ${C.border}` }}>
            <div style={{ width:30, height:30, borderRadius:"50%", background:`${C.purple}25`,
              display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <User size={14} color={C.purple} />
            </div>
            <div style={{ overflow:"hidden" }}>
              <div style={{ color:C.textPri, fontSize:12, fontWeight:700, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{user.name}</div>
              <div style={{ color:C.purple, fontSize:10, textTransform:"uppercase", letterSpacing:"0.05em" }}>
                {user.role==="admin"?"Administrator":"Viewer"}
              </div>
            </div>
          </div>
        )}
        <button onClick={onLogout}
          style={{ display:"flex", alignItems:"center", gap:8, justifyContent:collapsed?"center":"flex-start",
            width:"100%", background:"none", border:"none", color:C.red, cursor:"pointer",
            fontSize:12, padding:collapsed?"8px 0":"6px 8px", borderRadius:7, transition:"background 0.12s" }}
          onMouseEnter={e=>e.currentTarget.style.background=`${C.red}14`}
          onMouseLeave={e=>e.currentTarget.style.background="none"}>
          <LogOut size={15}/>{!collapsed && "Sign out"}
        </button>
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────
function Header({ accounts, selected, setSelected, section, timeRange, setTimeRange, currentUser, onChangePassword, onNotifSettings, onRefresh, refreshing }) {
  const acc  = accounts.find(a=>a.id===selected)||accounts[0];
  const risk = calcRisk(acc);
  const navItem = NAV.find(n=>n.id===section);

  return (
    <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"12px 24px",
      display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap", minHeight:64 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        {navItem && <navItem.Icon size={18} color={C.cyan} />}
        <div>
          <h1 style={{ color:C.textPri, fontSize:16, fontWeight:800, margin:0, letterSpacing:"-0.01em" }}>
            {navItem?.label||"Dashboard"}
          </h1>
          <p style={{ color:C.textSec, fontSize:11, margin:0 }}>
            Account: <span style={{ color:C.cyan, fontFamily:"monospace" }}>{acc?.id}</span>
            {acc && ` · ${acc.region}`}
          </p>
        </div>
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
        {section!=="auditlog" && section!=="settings" && (
          <>
            <TimeRangePicker value={timeRange} onChange={setTimeRange} />
            <select value={selected} onChange={e=>setSelected(e.target.value)}
              style={{ background:C.card2, border:`1px solid ${C.border2}`, borderRadius:8,
                color:C.textPri, fontSize:13, padding:"8px 12px", cursor:"pointer", outline:"none" }}>
              {accounts.map(a=><option key={a.id} value={a.id}>{a.name} (…{a.id.slice(-4)})</option>)}
            </select>
            <div style={{ display:"flex", alignItems:"center", gap:6, background:C.card2,
              border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 12px" }}>
              <span style={{ fontSize:11, color:C.textSec }}>Risk</span>
              <span style={{ fontSize:14, fontWeight:800, color:riskColor(risk) }}>{risk}</span>
              <span style={{ fontSize:11, color:C.textMut }}>/100</span>
            </div>
          </>
        )}

        <button onClick={onRefresh} disabled={refreshing}
          style={{ width:36, height:36, borderRadius:8, background:C.card2, border:`1px solid ${C.border2}`,
            display:"flex", alignItems:"center", justifyContent:"center", cursor:refreshing?"not-allowed":"pointer",
            color:C.cyan, transition:"border-color 0.15s", opacity:refreshing?0.65:1 }}
          onMouseEnter={e=>e.currentTarget.style.borderColor=C.cyan}
          onMouseLeave={e=>e.currentTarget.style.borderColor=C.border2}
          title="Refresh current page">
          <RefreshCw size={15} style={refreshing?{animation:"spin 1s linear infinite"}:{}}/>
        </button>

        {/* Notification bell */}
        <button onClick={onNotifSettings}
          style={{ width:36, height:36, borderRadius:8, background:C.card2, border:`1px solid ${C.border2}`,
            display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer",
            color:C.yellow, transition:"border-color 0.15s" }}
          onMouseEnter={e=>e.currentTarget.style.borderColor=C.yellow}
          onMouseLeave={e=>e.currentTarget.style.borderColor=C.border2}
          title="Notification settings">
          <Bell size={15}/>
        </button>

        {/* Password change */}
        <button onClick={onChangePassword}
          style={{ width:36, height:36, borderRadius:8, background:C.card2, border:`1px solid ${C.border2}`,
            display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer",
            color:C.cyan, transition:"border-color 0.15s" }}
          onMouseEnter={e=>e.currentTarget.style.borderColor=C.cyan}
          onMouseLeave={e=>e.currentTarget.style.borderColor=C.border2}
          title="Change password">
          <Key size={15}/>
        </button>

        <div style={{ display:"flex", alignItems:"center", gap:5, color:C.textMut, fontSize:11 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:C.green,
            boxShadow:`0 0 6px ${C.green}`, animation:"pulse 2s infinite" }} />
          Live
        </div>
      </div>
    </div>
  );
}

// ─── Settings Section ─────────────────────────────────────────────────────────
function SettingsSection({ currentUser, credentials, setCredentials, setCurrentUser, addToast }) {
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [showNotif,     setShowNotif]     = useState(false);
  const cred = credentials.find(c=>c.email===currentUser.email) || {};

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18, maxWidth:600 }}>
      <div>
        <h2 style={{ color:C.textPri, fontSize:18, fontWeight:800, margin:0 }}>Account Settings</h2>
        <p style={{ color:C.textSec, fontSize:12, margin:"4px 0 0" }}>Manage your password and notification preferences</p>
      </div>

      {/* Profile */}
      <div style={card()}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ width:52, height:52, borderRadius:"50%", background:`${C.purple}25`,
            display:"flex", alignItems:"center", justifyContent:"center", border:`1px solid ${C.purple}40` }}>
            <User size={24} color={C.purple}/>
          </div>
          <div>
            <div style={{ color:C.textPri, fontSize:16, fontWeight:800 }}>{currentUser.name}</div>
            <div style={{ color:C.textSec, fontSize:12 }}>{currentUser.email}</div>
            <Tag label={currentUser.role==="admin"?"Administrator":"Viewer"} color={currentUser.role==="admin"?C.cyan:C.purple}/>
          </div>
        </div>
      </div>

      {/* Security */}
      <div style={card()}>
        <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 16px", display:"flex", alignItems:"center", gap:8 }}>
          <Lock size={14} color={C.cyan}/> Security
        </h3>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 0",
          borderBottom:`1px solid ${C.border}` }}>
          <div>
            <div style={{ color:C.textPri, fontSize:13, fontWeight:600 }}>Password</div>
            <div style={{ color:C.textSec, fontSize:12 }}>Last changed: Never (change recommended)</div>
          </div>
          <button onClick={()=>setShowChangePwd(true)}
            style={{ background:`${C.cyan}15`, border:`1px solid ${C.cyan}30`, borderRadius:8,
              padding:"8px 16px", color:C.cyan, fontSize:12, fontWeight:700, cursor:"pointer" }}>
            Change Password
          </button>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:14 }}>
          <div>
            <div style={{ color:C.textPri, fontSize:13, fontWeight:600 }}>Two-Factor Authentication</div>
            <div style={{ color:C.textSec, fontSize:12 }}>Recommended for admin accounts</div>
          </div>
          <Tag label="Not Configured" color={C.orange}/>
        </div>
      </div>

      {/* Notifications */}
      <div style={card()}>
        <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 16px", display:"flex", alignItems:"center", gap:8 }}>
          <Bell size={14} color={C.yellow}/> Email Notifications
        </h3>
        <div style={{ ...card2(), marginBottom:14 }}>
          <div style={{ color:C.textSec, fontSize:11, marginBottom:4 }}>Notification Address</div>
          <div style={{ color:C.textPri, fontSize:13, fontWeight:600, display:"flex", alignItems:"center", gap:8 }}>
            <Mail size={13} color={C.cyan}/>
            {cred.notifyEmail || currentUser.email || "Not configured"}
            <CheckCircle size={13} color={C.green}/>
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {[
            {label:"Login Alerts", active:cred.notify_new_login??true},
            {label:"Failed Login", active:cred.notify_failed_login??true},
            {label:"Password Change", active:cred.notify_password_change??true},
            {label:"Critical Alerts", active:cred.notify_critical_alert??true},
          ].map(item=>(
            <div key={item.label} style={{ background:item.active?`${C.green}12`:`${C.border}50`,
              border:`1px solid ${item.active?C.green:C.border2}`, borderRadius:8,
              padding:"6px 10px", fontSize:11, color:item.active?C.green:C.textSec }}>
              {item.active?"✓ ":""}{item.label}
            </div>
          ))}
        </div>
        <button onClick={()=>setShowNotif(true)}
          style={{ background:"none", border:`1px solid ${C.border2}`, borderRadius:8,
            padding:"10px", color:C.textSec, fontSize:12, fontWeight:700, cursor:"pointer", width:"100%", marginTop:12 }}>
          Configure Notifications
        </button>
      </div>

      {/* Global App Settings (Admin Only) */}
      {currentUser.role === "admin" && (
        <div style={card()}>
          <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 16px", display:"flex", alignItems:"center", gap:8 }}>
            <Settings size={14} color={C.cyan}/> Global App Settings
          </h3>
          <p style={{ color:C.textSec, fontSize:11, marginBottom:16 }}>Sensitive keys are encrypted before storage in Supabase.</p>
          
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            <div>
              <div style={{ color:C.textPri, fontSize:12, fontWeight:600, marginBottom:8 }}>Resend API Key</div>
              <div style={{ display:"flex", gap:8 }}>
                <input id="resend-key-input" type="password" placeholder="re_••••••••••••••••••••"
                  style={{ flex:1, background:C.card2, border:`1px solid ${C.border2}`, borderRadius:8,
                    padding:"8px 12px", color:C.textPri, fontSize:12, outline:"none" }}/>
                <button onClick={async () => {
                  const val = document.getElementById("resend-key-input").value;
                  if (!val) return;
                  try {
                    const res = await fetch("/api/settings", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ key: "resend_api_key", value: val })
                    });
                    if (res.ok) { addToast("Resend API Key encrypted & saved", "success"); document.getElementById("resend-key-input").value = ""; }
                    else addToast("Failed to save key", "error");
                  } catch (e) { addToast("Error saving key", "error"); }
                }} style={{ background:C.cyan, border:"none", borderRadius:8, padding:"8px 14px", color:C.bg, fontSize:12, fontWeight:700, cursor:"pointer" }}>
                  Save
                </button>
              </div>
            </div>

            <div>
              <div style={{ color:C.textPri, fontSize:12, fontWeight:600, marginBottom:8 }}>Gmail App Password</div>
              <div style={{ display:"flex", gap:8 }}>
                <input id="gmail-key-input" type="password" placeholder="•••• •••• •••• ••••"
                  style={{ flex:1, background:C.card2, border:`1px solid ${C.border2}`, borderRadius:8,
                    padding:"8px 12px", color:C.textPri, fontSize:12, outline:"none" }}/>
                <button onClick={async () => {
                  const val = document.getElementById("gmail-key-input").value;
                  if (!val) return;
                  try {
                    const res = await fetch("/api/settings", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ key: "gmail_pass", value: val })
                    });
                    if (res.ok) { addToast("Gmail App Password encrypted & saved", "success"); document.getElementById("gmail-key-input").value = ""; }
                    else addToast("Failed to save password", "error");
                  } catch (e) { addToast("Error saving password", "error"); }
                }} style={{ background:C.cyan, border:"none", borderRadius:8, padding:"8px 14px", color:C.bg, fontSize:12, fontWeight:700, cursor:"pointer" }}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showChangePwd && (
        <ChangePasswordModal currentUser={currentUser} onClose={()=>setShowChangePwd(false)}
          credentials={credentials} setCredentials={setCredentials} setCurrentUser={setCurrentUser} addToast={addToast}/>
      )}
      {showNotif && (
        <NotificationSettingsModal currentUser={currentUser} credentials={credentials}
          setCredentials={setCredentials} onClose={()=>setShowNotif(false)} addToast={addToast}/>
      )}
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────
function OverviewSection({ accounts, setActive, setSelected }) {
  const [showReport, setShowReport] = useState(false);
  const hasInventory = accounts.some(a => a.inventory);
  const totals = accounts.reduce((acc,a)=>({
    critical:acc.critical+a.securityHub.critical+a.inspector.critical,
    high:acc.high+a.securityHub.high+a.inspector.high,
    gdFindings:acc.gdFindings+a.guardDuty.findings,
    wafBlocked:acc.wafBlocked+a.waf.block,
    ec2:acc.ec2+(a.inventory?.ec2?.total || 0),
    s3:acc.s3+(a.inventory?.s3?.total || 0),
    vpc:acc.vpc+(a.inventory?.vpc?.total || 0),
    publicS3:acc.publicS3+(a.inventory?.s3?.public || 0),
  }),{critical:0,high:0,gdFindings:0,wafBlocked:0,ec2:0,s3:0,vpc:0,publicS3:0});

  if (accounts.length === 0) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:400, gap:20 }}>
        <div style={{ width:80, height:80, borderRadius:16, background:`${C.cyan}15`, 
          display:"flex", alignItems:"center", justifyContent:"center", border:`2px solid ${C.cyan}30` }}>
          <Database size={40} color={C.cyan}/>
        </div>
        <div style={{ textAlign:"center" }}>
          <h2 style={{ color:C.textPri, fontSize:20, fontWeight:800, margin:"0 0 8px" }}>No AWS Accounts Yet</h2>
          <p style={{ color:C.textSec, fontSize:14, margin:"0 0 16px", maxWidth:400 }}>
            Add your first AWS account to begin monitoring security events, findings, and compliance data.
          </p>
          <button onClick={()=>setActive("accounts")} 
            style={{ background:`linear-gradient(135deg,${C.cyan},${C.cyanDim})`, border:"none", 
              borderRadius:10, padding:"12px 28px", color:C.bg, fontSize:14, fontWeight:700, cursor:"pointer" }}>
            + Add AWS Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <h2 style={{ color:C.textPri, fontSize:18, fontWeight:800, margin:0 }}>Executive Summary</h2>
        <button onClick={() => setShowReport(true)}
          style={{ display:"flex", alignItems:"center", gap:8, background:`${C.cyan}18`, border:`1px solid ${C.cyan}40`,
            borderRadius:10, padding:"10px 16px", color:C.cyan, fontSize:13, fontWeight:700, cursor:"pointer" }}>
          <FileText size={15}/>Generate Executive Report
        </button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 }}>
        {hasInventory ? (
          <>
            <Stat label="EC2 Instances" value={totals.ec2} color={C.cyan} icon={Server} sub="Live AWS inventory"/>
            <Stat label="S3 Buckets" value={totals.s3} color={totals.publicS3?C.orange:C.green} icon={Database} sub={`${totals.publicS3} public`}/>
            <Stat label="VPCs" value={totals.vpc} color={C.yellow} icon={Network} sub="Across accounts"/>
            <Stat label="Exposure" value={totals.high + totals.critical} color={(totals.high + totals.critical)?C.red:C.green} icon={ShieldAlert} sub="Public resources found"/>
          </>
        ) : (
          <>
            <Stat label="Total Critical" value={totals.critical} color={C.red}    icon={XCircle}       sub="Across all accounts"/>
            <Stat label="Total High"     value={totals.high}     color={C.orange}  icon={AlertTriangle} sub="Across all accounts"/>
            <Stat label="GD Findings"    value={totals.gdFindings} color={C.yellow} icon={ShieldAlert}  sub="GuardDuty"/>
            <Stat label="WAF Blocks"     value={fmtNum(totals.wafBlocked)} color={C.cyan} icon={Shield} sub="Total blocked requests"/>
          </>
        )}
      </div>

      {showReport && <ExecutiveReportModal accounts={accounts} onClose={() => setShowReport(false)} />}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16 }}>
        {accounts.map(acc=>{
          const risk = calcRisk(acc);
          return (
            <div key={acc.id} style={{ ...card(), cursor:"pointer", transition:"border-color 0.2s, transform 0.2s" }}
              onClick={()=>{ setSelected(acc.id); setActive("risk"); }}
              onMouseEnter={e=>{ e.currentTarget.style.borderColor=C.cyan; e.currentTarget.style.transform="translateY(-2px)"; }}
              onMouseLeave={e=>{ e.currentTarget.style.borderColor=C.border; e.currentTarget.style.transform="none"; }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                <div>
                  <div style={{ color:C.textPri, fontWeight:800, fontSize:15 }}>{acc.name}</div>
                  <div style={{ color:C.textSec, fontSize:11, marginTop:2 }}>{acc.id} · {acc.region}</div>
                </div>
                <ScoreRing score={risk} size={72} label="Risk" />
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {(acc.inventory ? [
                  {l:"EC2",v:acc.inventory.ec2.total,c:C.cyan},
                  {l:"S3 Buckets",v:acc.inventory.s3.total,c:acc.inventory.s3.public?C.orange:C.green},
                  {l:"VPCs",v:acc.inventory.vpc.total,c:C.yellow},
                  {l:"ALBs",v:acc.inventory.alb.total,c:C.pink},
                ] : [
                  {l:"SecHub Score",v:`${acc.securityHub.score}`,c:riskColor(acc.securityHub.score)},
                  {l:"Inspector Score",v:`${acc.inspector.score}`,c:riskColor(acc.inspector.score)},
                  {l:"GD Findings",v:acc.guardDuty.findings,c:acc.guardDuty.high>0?C.orange:C.yellow},
                  {l:"WAF Blocks",v:fmtNum(acc.waf.block),c:C.cyan},
                ]).map(x=>(
                  <div key={x.l} style={{ background:C.card2, borderRadius:8, padding:"9px 11px" }}>
                    <div style={{ color:C.textSec, fontSize:10, textTransform:"uppercase", letterSpacing:"0.06em" }}>{x.l}</div>
                    <div style={{ color:x.c, fontSize:17, fontWeight:800, marginTop:2 }}>{x.v}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:14 }}>
                <div style={{ color:C.textSec, fontSize:10, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>Severity distribution</div>
                <SevBar critical={acc.securityHub.critical+acc.inspector.critical}
                  high={acc.securityHub.high+acc.inspector.high}
                  medium={acc.securityHub.medium+acc.inspector.medium}
                  low={acc.securityHub.low+acc.inspector.low}/>
              </div>
            </div>
          );
        })}
      </div>

      <div style={card()}>
        <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 16px" }}>Security Score Comparison</h3>
        <div style={{ height:200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={accounts.map(a=>({ name:a.name, "Security Hub":a.securityHub.score, "Inspector":a.inspector.score, "Risk":calcRisk(a) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="name" tick={{fill:C.textSec,fontSize:12}} axisLine={false} tickLine={false}/>
              <YAxis domain={[0,100]} tick={{fill:C.textSec,fontSize:12}} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={tooltipStyle} cursor={{fill:`${C.cyan}08`}}/>
              <Bar dataKey="Security Hub" fill={C.cyan} radius={[5,5,0,0]}/>
              <Bar dataKey="Inspector" fill={C.purple} radius={[5,5,0,0]}/>
              <Bar dataKey="Risk" fill={C.orange} radius={[5,5,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─── WAF Section ──────────────────────────────────────────────────────────────
function WAFSection({ account }) {
  if (!account) {
      return (
            <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:400, gap:16 }}>
                    <Shield size={40} color={C.textMut}/>
                            <p style={{ color:C.textSec, fontSize:14 }}>Select an AWS account to view WAF data</p>
                                  </div>
                                      );
                                        }
                                        
  const w = account.waf;
    const webACLs = w?.webACLs || [];
      const [selectedIndex, setSelectedIndex] = useState(0);
        const selectedACL = webACLs[selectedIndex] || webACLs[0] || null;
        
  useEffect(() => {
      if (webACLs.length && selectedIndex >= webACLs.length) {
            setSelectedIndex(0);
                }
                  }, [webACLs.length, selectedIndex]);
                  
  const protectedResources = webACLs.reduce((sum, acl) => sum + (acl.attachedResources?.length || 0), 0);
    const totalTraffic = w.totalTraffic ?? (w.allow + w.block + w.count + w.challenge + w.captcha);
    
  const attackTypes = useMemo(() => {
      if (w.attackTypes?.length) return w.attackTypes;
          return (w.blockedRules || []).slice(0, 10).map(r => ({ type: r.rule, requests: r.blocks }));
            }, [w.attackTypes, w.blockedRules]);
            
  const managedGroups = useMemo(() => {
      if (w.managedRuleGroups?.length) return w.managedRuleGroups;
          const map = new Map();
              webACLs.forEach(acl => {
                    (acl.rules || []).forEach(rule => {
                            if (!rule.ruleGroup) return;
                                    const entry = map.get(rule.ruleGroup) || { name: rule.ruleGroup, ruleCount: 0, webACLs: new Set() };
                                            entry.ruleCount += 1;
                                                    entry.webACLs.add(acl.name);
                                                            map.set(rule.ruleGroup, entry);
                                                                  });
                                                                      });
                                                                          return Array.from(map.values()).map(entry => ({ name: entry.name, ruleCount: entry.ruleCount, webACLs: Array.from(entry.webACLs) }));
                                                                            }, [w.managedRuleGroups, webACLs]);
                                                                            
  const webACLOptions = webACLs.map((acl, idx) => ({
      value: idx,
          label: `${acl.name} (${acl.scope}) — ${acl.attachedResources?.length ?? 0} resources`,
            }));
            
  return (
      <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
            <div style={card()}>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:18, justifyContent:"space-between", alignItems:"flex-start" }}>
                              <div style={{ minWidth:260, flex:1 }}>
                                          <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 12px" }}>Available Web ACLs</h3>
                                                      {webACLOptions.length === 0 ? (
                                                                    <p style={{ color:C.textSec, fontSize:12, margin:0 }}>No Web ACLs detected for this account.</p>
                                                                                ) : (
                                                                                              <select value={selectedIndex} onChange={e => setSelectedIndex(Number(e.target.value))}
                                                                                                              style={{ width:"100%", background:C.card2, border:`1px solid ${C.border2}`, borderRadius:10,
                                                                                                                                color:C.textPri, padding:"10px 12px", fontSize:13, outline:"none" }}>
                                                                                                                                                {webACLOptions.map(opt => (
                                                                                                                                                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                                                                                                                                                  ))}
                                                                                                                                                                                                </select>
                                                                                                                                                                                                            )}
                                                                                                                                                                                                                      </div>
                                                                                                                                                                                                                                {selectedACL && (
                                                                                                                                                                                                                                            <div style={{ flex:1, minWidth:280, display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12 }}>
                                                                                                                                                                                                                                                          <Stat label="Scope" value={selectedACL.scope} color={C.cyan} icon={Globe}/>
                                                                                                                                                                                                                                                                        <Stat label="Default Action" value={selectedACL.defaultAction} color={selectedACL.defaultAction === "BLOCK" ? C.red : C.green} icon={Shield}/>
                                                                                                                                                                                                                                                                                      <Stat label="Rules" value={selectedACL.rules?.length ?? 0} color={C.yellow} icon={Activity}/>
                                                                                                                                                                                                                                                                                                    <Stat label="Resources" value={selectedACL.attachedResources?.length ?? 0} color={C.purple} icon={Server}/>
                                                                                                                                                                                                                                                                                                                </div>
                                                                                                                                                                                                                                                                                                                          )}
                                                                                                                                                                                                                                                                                                                                  </div>
                                                                                                                                                                                                                                                                                                                                        </div>
                                                                                                                                                                                                                                                                                                                                        
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))", gap:12 }}>
              <Stat label="Total Traffic" value={fmtNum(totalTraffic)} color={C.cyan} icon={Globe}/>
                      <Stat label="Allow" value={fmtNum(w.allow)} color={C.green} icon={CheckCircle}/>
                              <Stat label="Block" value={fmtNum(w.block)} color={C.red} icon={XCircle}/>
                                      <Stat label="COUNT" value={fmtNum(w.count)} color={C.yellow} icon={Activity}/>
                                              <Stat label="Challenges" value={fmtNum(w.challenge)} color={C.orange} icon={AlertTriangle}/>
                                                      <Stat label="CAPTCHA" value={fmtNum(w.captcha)} color={C.purple} icon={Lock}/>
                                                            </div>
                                                            
      <div style={card()}>
              <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 14px" }}>Selected WebACL Details</h3>
                      {selectedACL ? (
                                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:12 }}>
                                            <div style={{ padding:12, borderRadius:14, background:C.card2 }}>
                                                          <div style={{ color:C.textSec, fontSize:11, textTransform:"uppercase", letterSpacing:"0.06em" }}>WebACL</div>
                                                                        <div style={{ color:C.textPri, fontSize:13, fontWeight:700, marginTop:6 }}>{selectedACL.name}</div>
                                                                                    </div>
                                                                                                <div style={{ padding:12, borderRadius:14, background:C.card2 }}>
                                                                                                              <div style={{ color:C.textSec, fontSize:11, textTransform:"uppercase", letterSpacing:"0.06em" }}>Scope</div>
                                                                                                                            <div style={{ color:C.textPri, fontSize:13, fontWeight:700, marginTop:6 }}>{selectedACL.scope}</div>
                                                                                                                                        </div>
                                                                                                                                                    <div style={{ padding:12, borderRadius:14, background:C.card2 }}>
                                                                                                                                                                  <div style={{ color:C.textSec, fontSize:11, textTransform:"uppercase", letterSpacing:"0.06em" }}>Attached Resources</div>
                                                                                                                                                                                <div style={{ color:C.textPri, fontSize:13, fontWeight:700, marginTop:6 }}>{selectedACL.attachedResources?.length ?? 0}</div>
                                                                                                                                                                                            </div>
                                                                                                                                                                                                        <div style={{ padding:12, borderRadius:14, background:C.card2 }}>
                                                                                                                                                                                                                      <div style={{ color:C.textSec, fontSize:11, textTransform:"uppercase", letterSpacing:"0.06em" }}>Rule Count</div>
                                                                                                                                                                                                                                    <div style={{ color:C.textPri, fontSize:13, fontWeight:700, marginTop:6 }}>{selectedACL.rules?.length ?? 0}</div>
                                                                                                                                                                                                                                                </div>
                                                                                                                                                                                                                                                          </div>
                                                                                                                                                                                                                                                                  ) : (
                                                                                                                                                                                                                                                                            <p style={{ color:C.textSec, fontSize:12 }}>No WebACL selected.</p>
                                                                                                                                                                                                                                                                                    )}
                                                                                                                                                                                                                                                                                          </div>
                                                                                                                                                                                                                                                                                          
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:18 }}>
              <div style={card()}>
                        <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 14px" }}>Top 10 Countries</h3>
                                  {!(w.topGeoIPs?.length > 0) ? (
                                              <p style={{ color:C.textSec, fontSize:12, margin:0 }}>No geo IP data available.</p>
                                                        ) : (
                                                                    <div style={{ display:"grid", gap:10 }}>
                                                                                  {(w.topGeoIPs || []).slice(0, 10).map((item, i) => (
                                                                                                  <div key={i} style={{ display:"flex", justifyContent:"space-between", gap:10, padding:12, borderRadius:12, background:C.card2 }}>
                                                                                                                    <span style={{ color:C.textPri, fontSize:12 }}>{item.country}</span>
                                                                                                                                      <span style={{ color:C.orange, fontWeight:700 }}>{fmtNum(item.requests)}</span>
                                                                                                                                                      </div>
                                                                                                                                                                    ))}
                                                                                                                                                                                </div>
                                                                                                                                                                                          )}
                                                                                                                                                                                                  </div>
                                                                                                                                                                                                  
        <div style={card()}>
                  <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 14px" }}>Attack Types</h3>
                            {attackTypes.length === 0 ? (
                                        <p style={{ color:C.textSec, fontSize:12, margin:0 }}>No attack type data available.</p>
                                                  ) : (
                                                              <div style={{ display:"grid", gap:10 }}>
                                                                            {attackTypes.slice(0, 10).map((item, i) => (
                                                                                            <div key={i} style={{ display:"flex", justifyContent:"space-between", gap:10, padding:12, borderRadius:12, background:C.card2 }}>
                                                                                                              <span style={{ color:C.textPri, fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.type}</span>
                                                                                                                                <span style={{ color:C.red, fontWeight:700 }}>{fmtNum(item.requests)}</span>
                                                                                                                                                </div>
                                                                                                                                                              ))}
                                                                                                                                                                          </div>
                                                                                                                                                                                    )}
                                                                                                                                                                                            </div>
                                                                                                                                                                                                  </div>
                                                                                                                                                                                                  
      <div style={card()}>
              <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 14px" }}>Managed Rule Groups</h3>
                      {managedGroups.length === 0 ? (
                                <p style={{ color:C.textSec, fontSize:12, margin:0 }}>No managed rule group data available.</p>
                                        ) : (
                                                  <div style={{ display:"grid", gap:10 }}>
                                                              {managedGroups.map((group, i) => (
                                                                            <div key={i} style={{ padding:12, borderRadius:12, background:C.card2 }}>
                                                                                            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
                                                                                                              <span style={{ color:C.textPri, fontSize:13, fontWeight:700 }}>{group.name}</span>
                                                                                                                                <span style={{ color:C.cyan, fontWeight:700 }}>{group.ruleCount} rules</span>
                                                                                                                                                </div>
                                                                                                                                                                <div style={{ color:C.textSec, fontSize:11, marginTop:6 }}>Web ACLs: {group.webACLs.join(", ")}</div>
                                                                                                                                                                              </div>
                                                                                                                                                                                          ))}
                                                                                                                                                                                                    </div>
                                                                                                                                                                                                            )}
                                                                                                                                                                                                                  </div>
                                                                                                                                                                                                                      </div>
                                                                                                                                                                                                                        );
                                                                                                                                                                                                                        }
                                                                                                                                                                                                                        
// ─── Security Hub Section ─────────────────────────────────────────────────────
// ─── Security Hub Section ─────────────────────────────────────────────────────
function SecurityHubSection({ account }) {
  if (!account) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:400, gap:16 }}>
        <ShieldCheck size={40} color={C.textMut}/>
        <p style={{ color:C.textSec, fontSize:14 }}>Select an AWS account to view Security Hub data</p>
      </div>
    );
  }
  const sh = account.securityHub;
  const trendData = sh.trend?.length
    ? sh.trend.map((v,i)=>({ day:`D-${sh.trend.length-i}`, score:v }))
    : [{ day:"Current", score:Math.round(sh.score || 0) }];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:18 }}>
        <div style={{ ...card(), display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
          <ScoreRing score={Math.round(sh.score)} size={140} label="SecHub" />
          <div style={{ textAlign:"center" }}>
            <div style={{ color:C.textPri, fontSize:13, fontWeight:700 }}>Security Hub Score</div>
            <div style={{ color:C.textSec, fontSize:11 }}>AWS Foundational Standard</div>
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:12 }}>
          <Stat label="Critical" value={sh.critical} color={C.red}    icon={XCircle}/>
          <Stat label="High"     value={sh.high}     color={C.orange}  icon={AlertTriangle}/>
          <Stat label="Medium"   value={sh.medium}   color={C.yellow}  icon={AlertCircle}/>
          <Stat label="Low"      value={sh.low}      color={C.cyan}    icon={Info}/>
        </div>
      </div>
      <div style={card()}>
        <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 14px" }}>Score Trend</h3>
        <div style={{ height:160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="sh_grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.cyan} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={C.cyan} stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
              <XAxis dataKey="day" tick={{fill:C.textSec,fontSize:12}} axisLine={false} tickLine={false}/>
              <YAxis domain={[50,100]} tick={{fill:C.textSec,fontSize:12}} axisLine={false} tickLine={false}/>
              <Tooltip contentStyle={tooltipStyle}/>
              <Area type="monotone" dataKey="score" stroke={C.cyan} fill="url(#sh_grad)" strokeWidth={2}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div style={card()}>
        <div style={{ display:"grid", gridTemplateColumns:"1.2fr 0.8fr", gap:18 }}>
          <div>
            <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 10px" }}>Standards & Compliance</h3>
            {sh.standards.length === 0 ? (
              <p style={{ color:C.textSec, fontSize:12, margin:0 }}>No Security Hub standards subscriptions detected.</p>
            ) : (
              <div style={{ display:"grid", gap:10 }}>
                {sh.standards.map((std, i) => (
                  <div key={i} style={{ padding:12, borderRadius:10, background:C.card2, border:`1px solid ${C.border}` }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginBottom:8 }}>
                      <div style={{ color:C.textPri, fontWeight:700, fontSize:13 }}>{std.name}</div>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ fontSize:14, fontWeight:800, color:riskColor(std.score || 0) }}>{std.score || 0}%</span>
                        <Tag label={std.status?.toLowerCase() || "unknown"} color={std.status === "ENABLED" ? C.green : C.textSec}/>
                      </div>
                    </div>
                    <div style={{ height:4, background:C.bg, borderRadius:2, overflow:"hidden", marginBottom:6 }}>
                      <div style={{ width:`${std.score || 0}%`, height:"100%", background:riskColor(std.score || 0), borderRadius:2 }}/>
                    </div>
                    <div style={{ color:C.textSec, fontSize:11, display:"flex", justifyContent:"space-between" }}>
                      <span>{std.description?.slice(0, 80) || "No description available."}...</span>
                      <span style={{ color:C.red, fontWeight:600 }}>{std.failedChecks || 0} Failed</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 10px" }}>Findings by Region</h3>
            {sh.findingsByRegion.length === 0 ? (
              <p style={{ color:C.textSec, fontSize:12, margin:0 }}>No regional finding breakdown available.</p>
            ) : (
              <div style={{ display:"grid", gap:10 }}>
                {sh.findingsByRegion.map((item, i) => (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", gap:10, padding:10, borderRadius:10, background:C.card2 }}>
                    <span style={{ color:C.textPri, fontSize:12 }}>{item.region}</span>
                    <span style={{ color:C.cyan, fontWeight:700 }}>{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={card()}>
        {sh.error && <p style={{ color:C.orange, fontSize:12, margin:"0 0 10px" }}>{sh.error}</p>}
        <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 4px" }}>Severity Distribution</h3>
        <p style={{ color:C.textSec, fontSize:12, margin:"0 0 14px" }}>Breakdown of all active findings</p>
        <SevBar critical={sh.critical} high={sh.high} medium={sh.medium} low={sh.low}/>
      </div>
    </div>
  );
}

// ─── GuardDuty Section ────────────────────────────────────────────────────────
function GuardDutySection({ account }) {
  if (!account) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:400, gap:16 }}>
        <ShieldAlert size={40} color={C.textMut}/>
        <p style={{ color:C.textSec, fontSize:14 }}>Select an AWS account to view GuardDuty findings</p>
      </div>
    );
  }
  const gd = account.guardDuty;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12 }}>
        <Stat label="Total Findings" value={gd.findings} color={C.yellow}  icon={ShieldAlert}/>
        <Stat label="High Severity"  value={gd.high}     color={C.red}     icon={XCircle}/>
        <Stat label="Medium"         value={gd.medium}   color={C.orange}  icon={AlertTriangle}/>
        <Stat label="Low"            value={gd.low}      color={C.cyan}    icon={CheckCircle}/>
      </div>
      <div style={card()}>
        <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 16px" }}>Active Threat Findings</h3>
        {gd.error && <p style={{ color:C.orange, fontSize:12, margin:"0 0 10px" }}>{gd.error}</p>}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {gd.types.length === 0 ? (
            <div style={{ color:C.textSec, fontSize:12, textAlign:"center", padding:24 }}>No active GuardDuty findings found</div>
          ) : gd.types.map((t,i)=>(
            <div key={i} style={{ ...card2(), display:"flex", alignItems:"center", gap:14,
              borderLeft:`3px solid ${sevColor(t.severity)}` }}>
              <div style={{ width:40, height:40, borderRadius:10, background:sevBg(t.severity),
                display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <ShieldAlert size={18} color={sevColor(t.severity)}/>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ color:C.textPri, fontSize:13, fontWeight:600, fontFamily:"monospace",
                  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{t.type}</div>
                <div style={{ color:C.textSec, fontSize:11, marginTop:2 }}>Count: {t.count}</div>
              </div>
              <Tag label={t.severity} color={sevColor(t.severity)}/>
            </div>
          ))}
        </div>
      </div>
      <div style={card()}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:18 }}>
          <div>
            <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 10px" }}>Top Affected Resources</h3>
            {gd.topResources.length === 0 ? (
              <p style={{ color:C.textSec, fontSize:12, margin:0 }}>No resource breakdown available.</p>
            ) : (
              <div style={{ display:"grid", gap:10 }}>
                {gd.topResources.slice(0, 6).map((item, i) => (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:10, borderRadius:10, background:C.card2 }}>
                    <span style={{ color:C.textPri, fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.resource}</span>
                    <span style={{ color:C.orange, fontWeight:700 }}>{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 10px" }}>Findings by Region</h3>
            {gd.findingsByRegion.length === 0 ? (
              <p style={{ color:C.textSec, fontSize:12, margin:0 }}>No regional distribution available.</p>
            ) : (
              <div style={{ display:"grid", gap:10 }}>
                {gd.findingsByRegion.map((item, i) => (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:10, borderRadius:10, background:C.card2 }}>
                    <span style={{ color:C.textPri, fontSize:12 }}>{item.region}</span>
                    <span style={{ color:C.cyan, fontWeight:700 }}>{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={card()}>
        <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 14px" }}>Recent GuardDuty Findings</h3>
        {gd.findingsList.length === 0 ? (
          <div style={{ color:C.textSec, fontSize:12, textAlign:"center", padding:24 }}>No recent GuardDuty findings available.</div>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                  {['Type','Severity','Resource','Region'].map(h => (
                    <th key={h} style={{ color:C.textSec, padding:"8px 10px", textAlign:"left", fontWeight:600, fontSize:11, textTransform:"uppercase", letterSpacing:"0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gd.findingsList.slice(0, 8).map((item, i) => (
                  <tr key={i} style={{ borderBottom:`1px solid ${C.border}22` }}>
                    <td style={{ padding:"10px", color:C.textPri }}>{item.type}</td>
                    <td style={{ padding:"10px" }}><Tag label={item.severity} color={sevColor(item.severity)}/></td>
                    <td style={{ padding:"10px", color:C.textSec, fontFamily:"monospace", fontSize:12 }}>{item.resource}</td>
                    <td style={{ padding:"10px", color:C.textSec }}>{item.region}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div style={card()}>
        <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 14px" }}>Severity Breakdown</h3>
        <SevBar critical={0} high={gd.high} medium={gd.medium} low={gd.low}/>
      </div>
    </div>
  );
}

// ─── Inspector Section ────────────────────────────────────────────────────────
function InspectorSection({ account }) {
  if (!account) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:400, gap:16 }}>
        <Activity size={40} color={C.textMut}/>
        <p style={{ color:C.textSec, fontSize:14 }}>Select an AWS account to view Inspector findings</p>
      </div>
    );
  }
  const ins = account.inspector;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:18 }}>
        <div style={{ ...card(), display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
          <ScoreRing score={Math.round(ins.score)} size={140} label="Inspector"/>
          <div style={{ textAlign:"center" }}>
            <div style={{ color:C.textPri, fontSize:13, fontWeight:700 }}>Inspector Score</div>
            <div style={{ color:C.textSec, fontSize:11 }}>Vulnerability Assessment</div>
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:12 }}>
          <Stat label="Critical" value={ins.critical} color={C.red}   icon={XCircle}/>
          <Stat label="High"     value={ins.high}     color={C.orange} icon={AlertTriangle}/>
          <Stat label="Medium"   value={ins.medium}   color={C.yellow} icon={AlertCircle}/>
          <Stat label="Low"      value={ins.low}      color={C.cyan}  icon={Info}/>
        </div>
      </div>
      <div style={card()}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:18 }}>
          <div>
            <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 10px" }}>Top Resource Types</h3>
            {ins.resourceTypes.length === 0 ? (
              <p style={{ color:C.textSec, fontSize:12, margin:0 }}>No resource type distribution available.</p>
            ) : (
              <div style={{ display:"grid", gap:10 }}>
                {ins.resourceTypes.slice(0, 6).map((item, i) => (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:10, borderRadius:10, background:C.card2 }}>
                    <span style={{ color:C.textPri, fontSize:12 }}>{item.resourceType}</span>
                    <span style={{ color:C.purple, fontWeight:700 }}>{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 10px" }}>Critical Findings</h3>
            {ins.criticalFindings.length === 0 ? (
              <p style={{ color:C.textSec, fontSize:12, margin:0 }}>No critical Inspector findings available.</p>
            ) : (
              <div style={{ display:"grid", gap:10 }}>
                {ins.criticalFindings.slice(0, 6).map((item, i) => (
                  <div key={i} style={{ padding:10, borderRadius:10, background:C.card2 }}>
                    <div style={{ color:C.textPri, fontSize:12, fontWeight:600 }}>{item.resource}</div>
                    <div style={{ color:C.textSec, fontSize:11, marginTop:4 }}>{item.type}</div>
                    <Tag label={item.severity} color={sevColor(item.severity)} style={{ marginTop:8 }}/>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div style={card()}>
        <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 14px" }}>Critical & High Findings</h3>
        {ins.error && <p style={{ color:C.orange, fontSize:12, margin:"0 0 10px" }}>{ins.error}</p>}
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
          <thead>
            <tr style={{ borderBottom:`1px solid ${C.border}` }}>
              {["Resource","CVE / Finding","Severity"].map(h=>(
                <th key={h} style={{ color:C.textSec, padding:"8px 14px", textAlign:"left",
                  fontWeight:600, fontSize:11, textTransform:"uppercase", letterSpacing:"0.06em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ins.findings.length === 0 ? (
              <tr><td colSpan={3} style={{ padding:24, color:C.textSec, textAlign:"center" }}>No active Inspector findings found</td></tr>
            ) : ins.findings.map((f,i)=>(
              <tr key={i} style={{ borderBottom:`1px solid ${C.border}44` }}>
                <td style={{ padding:"10px 14px", color:C.cyan, fontFamily:"monospace", fontSize:12 }}>{f.resource}</td>
                <td style={{ padding:"10px 14px", color:C.textPri, fontFamily:"monospace", fontSize:12 }}>{f.type}</td>
                <td style={{ padding:"10px 14px" }}><Tag label={f.severity} color={sevColor(f.severity)}/></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Risk Section ─────────────────────────────────────────────────────────────
function RiskSection({ account }) {
  if (!account) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:400, gap:16 }}>
        <Zap size={40} color={C.textMut}/>
        <p style={{ color:C.textSec, fontSize:14 }}>Select an AWS account to view risk assessment</p>
      </div>
    );
  }

  const risk = calcRisk(account);
  const scenarios = getScenarios(account);
  const mitreData = account.securityHub.mitreTactics || [];

  const breakdown = [
    { label:"Security Hub Compliance", score:Math.round(account.securityHub.score), weight:30 },
    { label:"Inspector Vulnerability",  score:Math.round(account.inspector.score),  weight:30 },
    { label:"GuardDuty Threat Level",   score:Math.max(0,100-(account.guardDuty.high*8+account.guardDuty.medium*3)), weight:25 },
    { label:"WAF Block Ratio",          score:Math.max(0,100-Math.round((account.waf.block/((account.waf.allow+account.waf.block)||1))*200)), weight:15 },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      {/* Risk Summary & Breakdown */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:18 }}>
        <div style={{ ...card(), display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16 }}>
          <ScoreRing score={risk} size={160} label="Risk"/>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontSize:22, fontWeight:900, color:riskColor(risk) }}>
              {risk>=70?"LOW RISK":risk>=50?"MEDIUM RISK":"HIGH RISK"}
            </div>
            <div style={{ color:C.textSec, fontSize:12, marginTop:4 }}>{account.name} Environment</div>
          </div>
        </div>
        <div style={card()}>
          <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 16px" }}>Risk Score Breakdown</h3>
          {breakdown.map(b=>(
            <div key={b.label} style={{ marginBottom:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                <span style={{ color:C.textPri, fontSize:13, fontWeight:600 }}>{b.label}</span>
                <div style={{ display:"flex", gap:10 }}>
                  <span style={{ color:C.textSec, fontSize:11 }}>Weight: {b.weight}%</span>
                  <span style={{ color:riskColor(b.score), fontSize:13, fontWeight:700 }}>{b.score}/100</span>
                </div>
              </div>
              <div style={{ height:6, background:C.card2, borderRadius:3, overflow:"hidden" }}>
                <div style={{ width:`${b.score}%`, height:"100%",
                  background:`linear-gradient(90deg,${riskColor(b.score)},${riskColor(b.score)}88)`,
                  borderRadius:3, transition:"width 0.6s ease" }}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* MITRE ATT&CK Heatmap */}
      <div style={card()}>
        <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 4px" }}>MITRE ATT&CK® Tactic Mapping</h3>
        <p style={{ color:C.textSec, fontSize:12, margin:"0 0 16px" }}>Findings mapped to adversary tactics and techniques</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:10 }}>
          {["Initial Access", "Execution", "Persistence", "Privilege Escalation", "Defense Evasion", "Credential Access", "Discovery", "Lateral Movement", "Collection", "Command and Control", "Exfiltration", "Impact"].map(tactic => {
            const entry = mitreData.find(m => m.tactic === tactic);
            const count = entry ? entry.count : 0;
            const intensity = Math.min(1, count / 5);
            return (
              <div key={tactic} style={{
                background: count > 0 ? `rgba(255, 59, 92, ${0.1 + intensity * 0.4})` : C.card2,
                border: `1px solid ${count > 0 ? C.red : C.border2}`,
                borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 4,
                transition: "transform 0.2s"
              }}>
                <div style={{ color: count > 0 ? C.textPri : C.textSec, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em" }}>{tactic}</div>
                <div style={{ color: count > 0 ? C.red : C.textMut, fontSize: 18, fontWeight: 800 }}>{count}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Attack Scenarios */}
      <div style={card()}>
        <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 4px" }}>Possible Attack Scenarios</h3>
        <p style={{ color:C.textSec, fontSize:12, margin:"0 0 16px" }}>Based on active findings from GuardDuty, WAF, and security misconfigurations</p>
        {scenarios.length===0 ? (
          <div style={{ textAlign:"center", padding:40, color:C.green }}>
            <CheckCircle size={32} style={{ marginBottom:8 }}/>
            <div style={{ fontSize:14, fontWeight:600 }}>No significant attack scenarios detected</div>
          </div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:12 }}>
            {scenarios.map((s,i)=>(
              <div key={i} style={{ ...card2(), borderLeft:`3px solid ${sevColor(s.risk)}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:8 }}>
                  <Zap size={15} color={sevColor(s.risk)}/>
                  <span style={{ color:C.textPri, fontWeight:700, fontSize:13 }}>{s.name}</span>
                  <Tag label={s.risk} color={sevColor(s.risk)}/>
                </div>
                <p style={{ color:C.textSec, fontSize:12, margin:0, lineHeight:1.6 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Users Section ────────────────────────────────────────────────────────────
function UsersSection({ users, setUsers, setCredentials, addToast, logEvent }) {
  if (!users) users = [];
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState({ name:"", email:"", role:"viewer", password:"" });
  const [showPw, setShowPw]   = useState(false);
  const strength = getPasswordStrength(form.password);

  async function addUser() {
    if (!form.name||!form.email||!form.password) return;
    if (form.password.length < 14) { addToast("Password must be at least 14 characters", "error"); return; }
    if (strength.passed < 4) { addToast("Password is too weak", "error"); return; }

    const newUser = { id:Date.now(), ...form, lastLogin:"Never" };
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser)
      });
      if (!res.ok) throw new Error(await res.text());
      
      const savedUser = await res.json();
      setUsers(u=>[...u, savedUser]);
      
      // Also send welcome email
      fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: form.email,
          subject: 'Welcome to AWS SecureView Dashboard',
          html: `<h2>Welcome ${form.name}!</h2><p>Your account has been created.</p><p>Password: ${form.password}</p>`
        })
      }).catch(e => console.warn("Email failed", e));

      logEvent("user_add", `Created ${form.role} user ${form.email}`, "success");
      addToast(`User ${form.name} created & saved to Supabase`, "success");
      setForm({ name:"", email:"", role:"viewer", password:"" });
      setShowAdd(false);
    } catch (err) { addToast("Failed to save user: " + err.message, "error"); }
  }

  async function removeUser(user) {
    if (!window.confirm(`Remove user ${user.name}?`)) return;
    try {
      const res = await fetch(`/api/users?email=${user.email}`, { method: "DELETE" });
      if (res.ok) {
        setUsers(prev => prev.filter(u => u.email !== user.email));
        addToast("User removed from Supabase", "info");
        logEvent("user_delete", `Removed user ${user.email}`, "warning");
      }
    } catch (e) { addToast("Failed to delete user", "error"); }
  }

  const inp = { background:C.card2, border:`1px solid ${C.border2}`, borderRadius:9,
    padding:"9px 12px", color:C.textPri, fontSize:13, width:"100%", boxSizing:"border-box",
    outline:"none", fontFamily:"'Segoe UI',system-ui,sans-serif" };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <h2 style={{ color:C.textPri, fontSize:18, fontWeight:800, margin:0 }}>User Management</h2>
          <p style={{ color:C.textSec, fontSize:12, margin:"4px 0 0" }}>Manage dashboard access and roles</p>
        </div>
        <button onClick={()=>setShowAdd(true)} style={{ display:"flex", alignItems:"center", gap:8,
          background:`linear-gradient(135deg,${C.cyan},#006bff)`, border:"none", borderRadius:9,
          padding:"10px 18px", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer",
          boxShadow:`0 4px 16px ${C.cyan}35` }}>
          <Plus size={15}/>Add User
        </button>
      </div>

      {showAdd && (
        <div style={card()}>
          <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 16px" }}>New User</h3>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
            <input style={inp} placeholder="Full name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
            <input style={inp} placeholder="Email address" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/>
            <div style={{ gridColumn:"1/-1" }}>
              <div style={{ color:C.textSec, fontSize:11, marginBottom:5 }}>Password (min. 14 characters)</div>
              <div style={{ position:"relative" }}>
                <input style={inp} placeholder="Strong password (14+ chars)" type={showPw?"text":"password"}
                  value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/>
                <button onClick={()=>setShowPw(!showPw)} style={{ position:"absolute", right:10, top:"50%",
                  transform:"translateY(-50%)", background:"none", border:"none", color:C.textSec, cursor:"pointer" }}>
                  {showPw?<EyeOff size={14}/>:<Eye size={14}/>}
                </button>
              </div>
              <PasswordStrengthMeter password={form.password}/>
            </div>
            <select style={inp} value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
              <option value="viewer">Viewer (Read-only)</option>
              <option value="admin">Administrator</option>
            </select>
          </div>
          <div style={{ ...card2(), marginBottom:14, display:"flex", gap:10, alignItems:"center", padding:"10px 14px" }}>
            <Mail size={13} color={C.cyan}/>
            <span style={{ color:C.textSec, fontSize:12 }}>A welcome email with login instructions will be sent to the user's email address.</span>
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={addUser} style={{ background:C.cyan, border:"none", borderRadius:9,
              padding:"9px 20px", color:C.bg, fontSize:13, fontWeight:700, cursor:"pointer" }}>
              Create User
            </button>
            <button onClick={()=>setShowAdd(false)} style={{ background:"none", border:`1px solid ${C.border2}`,
              borderRadius:9, padding:"9px 20px", color:C.textSec, fontSize:13, cursor:"pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {users.length === 0 ? (
        <div style={{ ...card(), textAlign:"center", padding:48, color:C.textSec }}>
          <Users size={36} style={{ marginBottom:12, color:C.textMut }}/>
          <div style={{ fontSize:14, fontWeight:600, marginBottom:6 }}>No users yet</div>
          <div style={{ fontSize:12 }}>Click "Add User" to create the first user account.</div>
        </div>
      ) : (
        <div style={card()}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                {["User","Email","Role","Last Login","Actions"].map(h=>(
                  <th key={h} style={{ color:C.textSec, padding:"8px 14px", textAlign:"left",
                    fontWeight:600, fontSize:11, textTransform:"uppercase", letterSpacing:"0.06em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u=>(
                <tr key={u.id} style={{ borderBottom:`1px solid ${C.border}44`, transition:"background 0.12s" }}
                  onMouseEnter={e=>e.currentTarget.style.background=`${C.border}30`}
                  onMouseLeave={e=>e.currentTarget.style.background="none"}>
                  <td style={{ padding:"12px 14px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ width:34, height:34, borderRadius:"50%",
                        background:u.role==="admin"?`${C.cyan}20`:`${C.purple}20`,
                        display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        <User size={14} color={u.role==="admin"?C.cyan:C.purple}/>
                      </div>
                      <span style={{ color:C.textPri, fontWeight:600 }}>{u.name}</span>
                    </div>
                  </td>
                  <td style={{ padding:"12px 14px", color:C.textSec, fontSize:12 }}>{u.email}</td>
                  <td style={{ padding:"12px 14px" }}>
                    <Tag label={u.role==="admin"?"Administrator":"Viewer"} color={u.role==="admin"?C.cyan:C.purple}/>
                  </td>
                  <td style={{ padding:"12px 14px", color:C.textSec, fontFamily:"monospace", fontSize:11 }}>{u.lastLogin}</td>
                  <td style={{ padding:"12px 14px" }}>
                    <button onClick={()=>removeUser(u)}
                      style={{ background:`${C.red}15`, border:`1px solid ${C.red}35`, borderRadius:7,
                        padding:"5px 10px", color:C.red, fontSize:11, cursor:"pointer",
                        display:"flex", alignItems:"center", gap:5, fontWeight:600 }}>
                      <Trash2 size={11}/>Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Accounts Section ─────────────────────────────────────────────────────────
function AccountsSection({ accounts, setAccounts, addToast, logEvent }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ id:"", name:"", region:"us-east-1", accessKey:"", secretKey:"" });
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const regions = ["us-east-1","us-east-2","us-west-1","us-west-2","eu-west-1","eu-west-2","eu-central-1","ap-south-1","ap-southeast-1","ap-northeast-1","ca-central-1","sa-east-1"];

  async function addAccount() {
    if (!form.id||!form.name||!form.accessKey||!form.secretKey) {
      addToast("All fields are required", "error"); return;
    }
    if (!/^\d{12}$/.test(form.id)) {
      addToast("Account ID must be exactly 12 digits", "error"); return;
    }
    if (!form.accessKey.startsWith("AKIA") && !form.accessKey.startsWith("ASIA")) {
      addToast("Access Key ID must start with AKIA or ASIA", "error"); return;
    }
    setSaving(true);
    try {
      // ── SECURE: persist AWS keys to the backend API and Supabase, not localStorage ──
      const savedAccount = await saveCredential(form.id, {
        accessKeyId:     form.accessKey,
        secretAccessKey: form.secretKey,
        region:          form.region,
        name:            form.name,
      });
      const baseAccount = { ...ACCOUNT_TEMPLATE, id:form.id, name:form.name, region:form.region, hasCredentials:true };
      let nextAccount = baseAccount;
      try {
        const inventory = await fetchInventory(form.id, form.region);
        nextAccount = accountFromInventory(baseAccount, inventory);
      } catch (fetchErr) {
        addToast(`Account saved, but live AWS fetch failed: ${fetchErr.message}`, "warning");
      }
      if (res.ok) {
        const savedAccount = await res.json();
        setAccounts(prev=>[...prev,{ ...ACCOUNT_TEMPLATE, ...savedAccount, hasCredentials:true }]);
        logEvent("account_add", `Onboarded AWS account ${form.name} (${form.id}) in ${form.region}`, "success");
        addToast(`Account "${form.name}" onboarded & persisted in Supabase`, "success");
        setForm({ id:"", name:"", region:"us-east-1", accessKey:"", secretKey:"" });
        setShowAdd(false);
      } else {
        throw new Error(await res.text());
      }
    } catch(err) {
      addToast(`Failed to save credentials: ${err.message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  async function removeAccount(id) {
    if (!window.confirm("Are you sure you want to remove this account? Credentials will be deleted.")) return;
    try {
      const res = await fetch(`/api/accounts?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setAccounts(prev => prev.filter(a => a.id !== id));
        addToast("Account removed from Supabase", "info");
        logEvent("account_delete", `Removed AWS account ${id}`, "warning");
      }
    } catch (e) { addToast("Failed to delete account", "error"); }
  }

  const inp = { background:C.card2, border:`1px solid ${C.border2}`, borderRadius:9,
    padding:"9px 12px", color:C.textPri, fontSize:13, width:"100%", boxSizing:"border-box",
    outline:"none", fontFamily:"'Segoe UI',system-ui,sans-serif" };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <h2 style={{ color:C.textPri, fontSize:18, fontWeight:800, margin:0 }}>AWS Account Onboarding</h2>
          <p style={{ color:C.textSec, fontSize:12, margin:"4px 0 0" }}>Credentials are AES-256-GCM encrypted before storage — never stored in plain text</p>
        </div>
        <button onClick={()=>setShowAdd(true)} style={{ display:"flex", alignItems:"center", gap:8,
          background:`linear-gradient(135deg,${C.cyan},#006bff)`, border:"none", borderRadius:9,
          padding:"10px 18px", color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer",
          boxShadow:`0 4px 16px ${C.cyan}35` }}>
          <Plus size={15}/>Onboard Account
        </button>
      </div>

      {/* Security callout banner */}
      <div style={{ ...card2(), display:"flex", gap:14, alignItems:"flex-start", borderLeft:`3px solid ${C.cyan}` }}>
        <Lock size={16} color={C.cyan} style={{ marginTop:2, flexShrink:0 }}/>
        <div>
          <div style={{ color:C.textPri, fontSize:13, fontWeight:700, marginBottom:4 }}>How credentials are protected</div>
          <div style={{ color:C.textSec, fontSize:12, lineHeight:1.7 }}>
            • Keys are encrypted with <strong style={{color:C.cyan}}>AES-256-GCM</strong> using the Web Crypto API before any storage.<br/>
            • The encryption key is derived with <strong style={{color:C.cyan}}>PBKDF2 (200k iterations)</strong> from your session secret + a random salt — never stored.<br/>
            • The raw access key / secret key are <strong style={{color:C.cyan}}>cleared from memory</strong> immediately after encryption.<br/>
            • In production (Vercel), keys are stored as <strong style={{color:C.cyan}}>Environment Variables</strong> on the server; the browser only ever sees query results.<br/>
            • GitHub deployments: ensure <code style={{color:C.yellow}}>.env.local</code> is in <code style={{color:C.yellow}}>.gitignore</code> (already configured). Never commit credentials.
          </div>
        </div>
      </div>

      {showAdd && (
        <div style={card()}>
          <h3 style={{ color:C.textPri, fontSize:14, fontWeight:700, margin:"0 0 4px" }}>Add AWS Account</h3>
          <div style={{ ...card2(), marginBottom:14, display:"flex", gap:10, alignItems:"center" }}>
            <Shield size={14} color={C.yellow}/>
            <span style={{ color:C.yellow, fontSize:12 }}>
              Use an IAM user with <strong>ReadOnlyAccess</strong> policy only. Enable MFA. Rotate keys every 90 days.
            </span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
            <div>
              <div style={{ color:C.textSec, fontSize:11, marginBottom:5 }}>Account ID (12 digits)</div>
              <input style={inp} placeholder="123456789012" value={form.id} onChange={e=>setForm({...form,id:e.target.value})}/>
            </div>
            <div>
              <div style={{ color:C.textSec, fontSize:11, marginBottom:5 }}>Account Alias / Name</div>
              <input style={inp} placeholder="Production" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>
            </div>
            <div>
              <div style={{ color:C.textSec, fontSize:11, marginBottom:5 }}>Primary Region</div>
              <select style={inp} value={form.region} onChange={e=>setForm({...form,region:e.target.value})}>
                {regions.map(r=><option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div/>
            <div>
              <div style={{ color:C.textSec, fontSize:11, marginBottom:5 }}>IAM Access Key ID</div>
              <input style={inp} placeholder="AKIA..." value={form.accessKey}
                onChange={e=>setForm({...form,accessKey:e.target.value})}
                autoComplete="off" spellCheck={false}/>
            </div>
            <div>
              <div style={{ color:C.textSec, fontSize:11, marginBottom:5 }}>IAM Secret Access Key</div>
              <div style={{ position:"relative" }}>
                <input style={{...inp, paddingRight:36}} type={showSecret?"text":"password"}
                  placeholder="••••••••••••••••••••"
                  value={form.secretKey} onChange={e=>setForm({...form,secretKey:e.target.value})}
                  autoComplete="new-password" spellCheck={false}/>
                <button onClick={()=>setShowSecret(v=>!v)} style={{ position:"absolute", right:10, top:"50%",
                  transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer",
                  color:C.textSec, padding:0, display:"flex", alignItems:"center" }}>
                  {showSecret ? <EyeOff size={14}/> : <Eye size={14}/>}
                </button>
              </div>
            </div>
          </div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <button onClick={addAccount} disabled={saving} style={{ background:saving?C.accent:C.cyan, border:"none", borderRadius:9,
              padding:"9px 20px", color:C.bg, fontSize:13, fontWeight:700, cursor:saving?"not-allowed":"pointer",
              display:"flex", alignItems:"center", gap:8 }}>
              {saving ? <><RefreshCw size={13} style={{animation:"spin 1s linear infinite"}}/> Encrypting…</> : <><Lock size={13}/>Encrypt & Onboard</>}
            </button>
            <button onClick={()=>setShowAdd(false)} style={{ background:"none", border:`1px solid ${C.border2}`,
              borderRadius:9, padding:"9px 20px", color:C.textSec, fontSize:13, cursor:"pointer" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14 }}>
        {accounts.map(acc=>{
          const risk = calcRisk(acc);
          const hasCred = acc.hasCredentials ?? !!getCredential(acc.id);
          return (
            <div key={acc.id} style={card()}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <button onClick={() => removeAccount(acc.id)} style={{ background:"none", border:"none", color:C.textMut, cursor:"pointer", padding:4, display:"flex", alignItems:"center" }}>
                    <Trash2 size={14}/>
                  </button>
                  <div style={{ width:38, height:38, borderRadius:10, background:`${C.cyan}18`,
                    display:"flex", alignItems:"center", justifyContent:"center", border:`1px solid ${C.cyan}25` }}>
                    <Database size={18} color={C.cyan}/>
                  </div>
                  <div>
                    <div style={{ color:C.textPri, fontWeight:700, fontSize:14 }}>{acc.name}</div>
                    <div style={{ color:C.textSec, fontSize:11, fontFamily:"monospace" }}>{acc.id}</div>
                  </div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
                  <Tag label={calcRisk(acc)>=70?"Healthy":calcRisk(acc)>=50?"At Risk":"Critical"} color={riskColor(calcRisk(acc))}/>
                  <div style={{ display:"flex", alignItems:"center", gap:4, fontSize:10, color:hasCred?C.green:C.yellow }}>
                    {hasCred ? <><Check size={10}/>Keys Secured</> : <><AlertCircle size={10}/>No Local Keys</>}
                  </div>
                </div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {[
                  {l:"Region",v:acc.region},
                  {l:"Risk Score",v:`${risk}/100`,c:riskColor(risk)},
                  {l:"WAF Rules",v:acc.waf.configuredRules},
                  {l:"GD Findings",v:acc.guardDuty.findings,c:acc.guardDuty.high>0?C.red:C.green},
                ].map(x=>(
                  <div key={x.l} style={{ background:C.card2, borderRadius:7, padding:"8px 10px" }}>
                    <div style={{ color:C.textSec, fontSize:10, textTransform:"uppercase", letterSpacing:"0.06em" }}>{x.l}</div>
                    <div style={{ color:x.c||C.textPri, fontSize:13, fontWeight:700, marginTop:2 }}>{x.v}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:12 }}>
                <div style={{ height:4, background:C.card2, borderRadius:2, overflow:"hidden" }}>
                  <div style={{ width:`${risk}%`, height:"100%", background:riskColor(risk), borderRadius:2 }}/>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Inventory Section ────────────────────────────────────────────────────────
function InventorySection({ account, refreshSignal, onInventoryLoaded }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  if (!account) {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:400, gap:16 }}>
        <Database size={40} color={C.textMut}/>
        <p style={{ color:C.textSec, fontSize:14 }}>Select an AWS account to view inventory</p>
      </div>
    );
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const inv = await fetchInventory(account.id, account.region);
      setData(inv);
      onInventoryLoaded?.(account.id, inv);
      setLastFetched(new Date());
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [account.id, account.region]);

  useEffect(() => { load(); }, [load, refreshSignal]);

  const sectionIcon = (Icon, color) => (
    <div style={{ width:32, height:32, borderRadius:8, background:`${color}18`,
      display:"flex", alignItems:"center", justifyContent:"center", border:`1px solid ${color}30`, flexShrink:0 }}>
      <Icon size={16} color={color}/>
    </div>
  );

  function SummaryCard({ label, value, sub, color, Icon }) {
    return (
      <div style={{ ...card(), display:"flex", flexDirection:"column", gap:6 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
          {sectionIcon(Icon, color)}
          <span style={{ color:C.textSec, fontSize:12, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</span>
        </div>
        <div style={{ color, fontSize:28, fontWeight:800, lineHeight:1 }}>{value ?? "—"}</div>
        {sub && <div style={{ color:C.textSec, fontSize:11 }}>{sub}</div>}
      </div>
    );
  }

  function ResourceTable({ title, Icon, color, rows, columns }) {
    return (
      <div style={card()}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
          {sectionIcon(Icon, color)}
          <span style={{ color:C.textPri, fontSize:14, fontWeight:700 }}>{title}</span>
          <span style={{ marginLeft:"auto", color:C.textSec, fontSize:11 }}>{rows.length} resource{rows.length!==1?"s":""}</span>
        </div>
        {rows.length === 0 ? (
          <div style={{ color:C.textMut, fontSize:12, textAlign:"center", padding:"16px 0" }}>No resources found</div>
        ) : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead>
                <tr>
                  {columns.map(c=>(
                    <th key={c.key} style={{ color:C.textMut, fontSize:10, fontWeight:700, textTransform:"uppercase",
                      letterSpacing:"0.06em", textAlign:"left", padding:"6px 10px", borderBottom:`1px solid ${C.border}` }}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} style={{ borderBottom:`1px solid ${C.border}20` }}
                    onMouseEnter={e=>e.currentTarget.style.background=`${C.accent}40`}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    {columns.map(c => (
                      <td key={c.key} style={{ padding:"8px 10px", color:c.color?c.color(row[c.key]):C.textPri,
                        fontFamily:c.mono?"monospace":"inherit", fontSize:c.mono?11:12 }}>
                        {c.render ? c.render(row) : (row[c.key] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (loading && !data) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:300, gap:12, color:C.textSec }}>
      <RefreshCw size={18} style={{ animation:"spin 1s linear infinite" }} color={C.cyan}/>
      <span style={{ fontSize:14 }}>Fetching live inventory from AWS…</span>
    </div>
  );

  if (error) return (
    <div style={{ ...card(), display:"flex", flexDirection:"column", gap:12, alignItems:"center", padding:32, textAlign:"center" }}>
      <AlertCircle size={32} color={C.red}/>
      <div style={{ color:C.textPri, fontWeight:700 }}>Failed to fetch inventory</div>
      <div style={{ color:C.textSec, fontSize:12, maxWidth:400 }}>{error}</div>
      <button onClick={load} style={{ background:C.cyan, border:"none", borderRadius:8, padding:"8px 20px",
        color:C.bg, fontSize:13, fontWeight:700, cursor:"pointer" }}>Retry</button>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <h2 style={{ color:C.textPri, fontSize:18, fontWeight:800, margin:0 }}>Resource Inventory</h2>
          <p style={{ color:C.textSec, fontSize:12, margin:"4px 0 0" }}>
            Live resources in <strong style={{color:C.cyan}}>{account.region}</strong> · Account {account.id}
            {lastFetched && <span> · Fetched {lastFetched.toLocaleTimeString()}</span>}
          </p>
        </div>
        <button onClick={load} disabled={loading} style={{ display:"flex", alignItems:"center", gap:8,
          background:C.card2, border:`1px solid ${C.border2}`, borderRadius:8,
          padding:"8px 14px", color:loading?C.textMut:C.textPri, fontSize:12, cursor:loading?"not-allowed":"pointer" }}>
          <RefreshCw size={13} color={C.cyan} style={loading?{animation:"spin 1s linear infinite"}:{}}/>
          Refresh
        </button>
      </div>

      {data && (
        <>
          {/* Summary row */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:12 }}>
            <SummaryCard label="EC2 Instances" value={data.ec2.total} sub={`${data.ec2.running} running · ${data.ec2.stopped} stopped`} color={C.cyan}   Icon={Server}/>
            <SummaryCard label="EKS Clusters"  value={data.eks.total} sub={`${data.eks.clusters.reduce((a,c)=>a+(c.nodeCount||0),0)} total nodes`}         color={C.purple} Icon={Cpu}/>
            <SummaryCard label="S3 Buckets"    value={data.s3.total}  sub={`${data.s3.public} public · ${data.s3.private} private`}  color={data.s3.public>0?C.orange:C.green} Icon={Database}/>
            <SummaryCard label="VPCs"           value={data.vpc.total} sub={`${data.vpc.vpcs.reduce((a,v)=>a+v.subnets,0)} subnets total`}                  color={C.yellow} Icon={Network}/>
            <SummaryCard label="Load Balancers" value={data.alb.total} sub={`${data.alb.loadBalancers.filter(l=>l.scheme==="internet-facing").length} public · ${data.alb.loadBalancers.filter(l=>l.scheme==="internal").length} internal`} color={C.pink} Icon={GitBranch}/>
            <SummaryCard label="Web ACLs"     value={data.waf.webACLs?.length ?? 0} sub={`${data.waf.webACLs?.filter(a=>a.scope==="CLOUDFRONT").length || 0} CDN · ${data.waf.webACLs?.filter(a=>a.scope!="CLOUDFRONT").length || 0} regional`} color={C.orange} Icon={Shield}/>
          </div>

          {/* EC2 table */}
          <ResourceTable title="EC2 Instances" Icon={Server} color={C.cyan} rows={data.ec2.instances}
            columns={[
              { key:"name",  label:"Name",      render: r=><span style={{fontWeight:600,color:C.textPri}}>{r.name}</span> },
              { key:"id",    label:"Instance ID", mono:true, color:()=>C.textSec },
              { key:"type",  label:"Type",        mono:true },
              { key:"state", label:"State",       render: r=><span style={{color:r.state==="running"?C.green:C.yellow,fontWeight:700}}>{r.state}</span> },
              { key:"az",    label:"AZ",          color:()=>C.textSec },
            ]}
          />

          {/* EKS table */}
          <ResourceTable title="EKS Clusters" Icon={Cpu} color={C.purple} rows={data.eks.clusters}
            columns={[
              { key:"name",      label:"Cluster Name", render: r=><span style={{fontWeight:600,color:C.textPri}}>{r.name}</span> },
              { key:"version",   label:"K8s Version",  mono:true },
              { key:"nodeCount", label:"Nodes",        render: r=><span style={{color:C.cyan,fontWeight:700}}>{r.nodeCount ?? "—"}</span> },
              { key:"status",    label:"Status",       render: r=><span style={{color:r.status==="ACTIVE"?C.green:C.yellow,fontWeight:700}}>{r.status}</span> },
            ]}
          />

          {/* S3 table */}
          <ResourceTable title="S3 Buckets" Icon={Database} color={data.s3.public>0?C.orange:C.green} rows={data.s3.buckets}
            columns={[
              { key:"name",     label:"Bucket Name", render: r=><span style={{fontWeight:600,color:C.textPri}}>{r.name}</span> },
              { key:"region",   label:"Region",      color:()=>C.textSec },
              { key:"isPublic", label:"Access",      render: r=>(
                <span style={{ display:"inline-flex", alignItems:"center", gap:5,
                  color:r.isPublic?C.red:C.green, fontWeight:700 }}>
                  {r.isPublic ? <><Globe size={11}/>Public</> : <><Lock size={11}/>Private</>}
                </span>
              )},
            ]}
          />

          {/* VPC table */}
          <ResourceTable title="VPCs" Icon={Network} color={C.yellow} rows={data.vpc.vpcs}
            columns={[
              { key:"name",      label:"Name / ID",  render: r=><span style={{fontWeight:600,color:C.textPri}}>{r.name}</span> },
              { key:"id",        label:"VPC ID",     mono:true, color:()=>C.textSec },
              { key:"cidr",      label:"CIDR",       mono:true },
              { key:"subnets",   label:"Subnets",    render: r=><span style={{color:C.cyan}}>{r.subnets}</span> },
              { key:"isDefault", label:"Default",    render: r=><span style={{color:r.isDefault?C.yellow:C.textMut}}>{r.isDefault?"Yes":"No"}</span> },
            ]}
          />

          {/* ALB table */}
          <ResourceTable title="Application Load Balancers" Icon={GitBranch} color={C.pink} rows={data.alb.loadBalancers}
            columns={[ 
              { key:"name",    label:"Name",   render: r=><span style={{fontWeight:600,color:C.textPri}}>{r.name}</span> },
              { key:"scheme",  label:"Scheme", render: r=>(
                <span style={{color:r.scheme==="internet-facing"?C.orange:C.cyan,fontWeight:700}}>
                  {r.scheme==="internet-facing"?"Public":"Internal"}
                </span>
              )},
              { key:"state",   label:"State",  render: r=><span style={{color:r.state==="active"?C.green:C.yellow,fontWeight:700}}>{r.state}</span> },
              { key:"dns",     label:"DNS",    mono:true, color:()=>C.textSec },
            ]}
          />

          <ResourceTable title="WAF Web ACLs" Icon={Shield} color={C.orange} rows={data.waf.webACLs || []}
            columns={[
              { key:"name", label:"Name", render: r=><span style={{fontWeight:600,color:C.textPri}}>{r.name}</span> },
              { key:"scope", label:"Scope", render: r=><span style={{color:r.scope==="CLOUDFRONT"?C.purple:C.cyan,fontWeight:700}}>{r.scope}</span> },
              { key:"defaultAction", label:"Default Action", render: r=><span style={{color:r.defaultAction==="BLOCK"?C.red:C.green,fontWeight:700}}>{r.defaultAction}</span> },
              { key:"rules", label:"Rules", render: r=><span style={{color:C.textSec}}>{r.rules?.length ?? 0}</span> },
            ]}
          />
        </>
      )}
    </div>
  );
}

// ─── Audit Log Section ────────────────────────────────────────────────────────
function AuditLogSection({ auditLog }) {
  const [search,  setSearch]  = useState("");
  const [filter,  setFilter]  = useState("all");
  const [page,    setPage]    = useState(1);
  const PER_PAGE = 15;
  auditLog = auditLog || [];

  const filtered = auditLog.filter(e => {
    const q = search.toLowerCase();
    const matchSearch = !q || e.user?.toLowerCase().includes(q) || e.action?.includes(q) || e.ip?.includes(q) || e.detail?.toLowerCase().includes(q);
    const matchFilter = filter==="all" || e.status===filter;
    return matchSearch && matchFilter;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const page_items = filtered.slice((page-1)*PER_PAGE, page*PER_PAGE);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <h2 style={{ color:C.textPri, fontSize:18, fontWeight:800, margin:0 }}>Audit Log</h2>
          <p style={{ color:C.textSec, fontSize:12, margin:"4px 0 0" }}>{filtered.length} events recorded</p>
        </div>
      </div>

      <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
        <div style={{ position:"relative", flex:1, minWidth:200 }}>
          <Search size={13} color={C.textSec} style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)" }}/>
          <input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}
            placeholder="Search user, action, IP…"
            style={{ background:C.card2, border:`1px solid ${C.border2}`, borderRadius:8,
              padding:"8px 12px 8px 34px", color:C.textPri, fontSize:13, width:"100%",
              boxSizing:"border-box", outline:"none" }}/>
        </div>
        {["all","success","warning","info"].map(f=>(
          <button key={f} onClick={()=>{setFilter(f);setPage(1);}}
            style={{ background:filter===f?`${C.cyan}15`:C.card2,
              border:`1px solid ${filter===f?C.cyan:C.border2}`, borderRadius:8,
              padding:"8px 14px", color:filter===f?C.cyan:C.textSec, fontSize:12, cursor:"pointer",
              fontWeight:filter===f?700:400, transition:"all 0.15s", textTransform:"capitalize" }}>
            {f==="all"?"All Events":f}
          </button>
        ))}
      </div>

      {auditLog.length === 0 ? (
        <div style={{ ...card(), textAlign:"center", padding:60, color:C.textSec }}>
          <FileText size={40} style={{ marginBottom:12, color:C.textMut }}/>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:6, color:C.textPri }}>No audit events yet</div>
          <div style={{ fontSize:12 }}>Events will appear here as users log in and perform actions.</div>
        </div>
      ) : (
        <div style={card()}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                {["Timestamp","User","Action","IP","Detail","Status"].map(h=>(
                  <th key={h} style={{ color:C.textSec, padding:"8px 12px", textAlign:"left",
                    fontWeight:600, fontSize:10, textTransform:"uppercase", letterSpacing:"0.06em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page_items.map(e=>{
                const meta = ACTION_META[e.action]||{label:e.action,Icon:Info,color:C.textSec};
                const statusColor = {success:C.green,warning:C.orange,info:C.textSec,error:C.red}[e.status]||C.textSec;
                return (
                  <tr key={e.id} style={{ borderBottom:`1px solid ${C.border}22`, transition:"background 0.1s" }}
                    onMouseEnter={ev=>ev.currentTarget.style.background=`${C.border}25`}
                    onMouseLeave={ev=>ev.currentTarget.style.background="none"}>
                    <td style={{ padding:"9px 12px", color:C.textMut, fontFamily:"monospace", fontSize:11, whiteSpace:"nowrap" }}>{e.ts}</td>
                    <td style={{ padding:"9px 12px" }}>
                      <div style={{ color:C.textPri, fontWeight:600, fontSize:12 }}>{e.user}</div>
                      {e.role!=="—" && <div style={{ color:C.textMut, fontSize:10 }}>{e.role}</div>}
                    </td>
                    <td style={{ padding:"9px 12px" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:6, color:meta.color }}>
                        <meta.Icon size={12}/><span style={{ fontWeight:600, fontSize:11 }}>{meta.label}</span>
                      </div>
                    </td>
                    <td style={{ padding:"9px 12px", color:C.textSec, fontFamily:"monospace", fontSize:11 }}>{e.ip}</td>
                    <td style={{ padding:"9px 12px", color:C.textSec, fontSize:11, maxWidth:280,
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.detail}</td>
                    <td style={{ padding:"9px 12px" }}>
                      <span style={{ background:`${statusColor}18`, color:statusColor,
                        fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:10,
                        textTransform:"uppercase", letterSpacing:"0.05em" }}>{e.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div style={{ display:"flex", justifyContent:"center", alignItems:"center", gap:6, marginTop:16 }}>
              <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}
                style={{ background:C.card2, border:`1px solid ${C.border2}`, borderRadius:7,
                  padding:"6px 12px", color:page===1?C.textMut:C.textPri, cursor:page===1?"not-allowed":"pointer",
                  fontSize:12, display:"flex", alignItems:"center", gap:4 }}>
                <ChevronLeft size={13}/>Prev
              </button>
              {Array.from({length:Math.min(5,totalPages)},(_,i)=>{
                const pg = Math.min(Math.max(page-2,1)+i,totalPages);
                return (
                  <button key={pg} onClick={()=>setPage(pg)}
                    style={{ background:pg===page?C.cyan:C.card2, border:`1px solid ${pg===page?C.cyan:C.border2}`,
                      borderRadius:7, padding:"6px 11px", color:pg===page?C.bg:C.textPri,
                      cursor:"pointer", fontSize:12, fontWeight:pg===page?700:400 }}>
                    {pg}
                  </button>
                );
              })}
              <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages}
                style={{ background:C.card2, border:`1px solid ${C.border2}`, borderRadius:7,
                  padding:"6px 12px", color:page===totalPages?C.textMut:C.textPri,
                  cursor:page===totalPages?"not-allowed":"pointer", fontSize:12, display:"flex", alignItems:"center", gap:4 }}>
                Next<ChevronRight size={13}/>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [credentials,  setCredentials]  = usePersistentState("asv_credentials", getEnvironmentCredentials());
  const [currentUser,  setCurrentUser]  = usePersistentState("asv_current_user", null);
  const [section,      setSection]      = usePersistentState("asv_section", "overview");
  const [selectedAcc,  setSelectedAcc]  = usePersistentState("asv_selected_account", null);
  const [accounts,     setAccounts]     = usePersistentState("asv_accounts", []);
  const [users,        setUsers]        = usePersistentState("asv_users", INIT_USERS);
  const [auditLog,     setAuditLog]     = usePersistentState("asv_audit_log", INITIAL_AUDIT_LOG);
  const [timeRange,    setTimeRange]    = usePersistentState("asv_time_range", { type:"relative", value:"24h" });
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [refreshingPage, setRefreshingPage] = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [showNotif,     setShowNotif]   = useState(false);
  const { toasts, addToast, removeToast } = useToast();

  useEffect(() => {
    if (currentUser?.email && currentUser?.password) {
      initStore(currentUser.email + ":" + currentUser.password).catch(err => {
        console.warn("Could not restore encrypted credential store:", err);
      });
    }
  }, [currentUser?.email, currentUser?.password]);

  useEffect(() => {
    if (!currentUser) return;
    async function loadBackendState() {
      try {
        const [accountsRes, usersRes, auditRes] = await Promise.all([
          fetch("/api/accounts"),
          fetch("/api/users"),
          fetch("/api/audit"),
        ]);

        if (accountsRes.ok) {
          const accountsData = await accountsRes.json();
          setAccounts(accountsData.map(a => ({ ...ACCOUNT_TEMPLATE, ...a })));
          if (!selectedAcc && accountsData[0]?.id) setSelectedAcc(accountsData[0].id);
        }

        if (usersRes.ok) {
          const usersData = await usersRes.json();
          setUsers(usersData);
        }

        if (auditRes.ok) {
          const auditData = await auditRes.json();
          setAuditLog(auditData);
        }
      } catch (err) {
        console.warn("Could not load backend dashboard state:", err);
      }
    }
    loadBackendState();
  }, [currentUser]);

  useEffect(() => {
    if (!selectedAcc && accounts[0]?.id) setSelectedAcc(accounts[0].id);
    if (selectedAcc && accounts.length && !accounts.some(a => a.id === selectedAcc)) {
      setSelectedAcc(accounts[0].id);
    }
  }, [accounts, selectedAcc, setSelectedAcc]);

  const scaledAccounts = useMemo(()=>{
    const factor = getScaleFactor(timeRange);
    return accounts.map(a=>scaleAccount(a,factor));
  }, [accounts, timeRange]);

  const account = useMemo(
    ()=>scaledAccounts.find(a=>a.id===selectedAcc)||scaledAccounts[0],
    [scaledAccounts, selectedAcc]
  );

  function logEvent(action, detail, status="info") {
    const cred = credentials.find(c=>c.email===currentUser?.email);
    setAuditLog(prev=>[{
      id: Date.now(),
      ts: new Date().toISOString().replace("T"," ").slice(0,19),
      user: currentUser?.name || "Unknown",
      email: currentUser?.email || "—",
      role: currentUser?.role || "—",
      action, ip:"—", detail, status,
    }, ...prev]);
  }

  function refreshCurrentPage() {
    setRefreshingPage(true);
    setRefreshSignal(v => v + 1);
    logEvent("view_section", `Refreshed ${NAV.find(n=>n.id===section)?.label || section}`, "info");
    setTimeout(() => setRefreshingPage(false), 800);
  }

  function handleInventoryLoaded(accountId, inventory) {
    setAccounts(prev => prev.map(acc =>
      acc.id === accountId ? accountFromInventory(acc, inventory) : acc
    ));
    logEvent("view_section", `Fetched live AWS inventory for account ${accountId}`, "success");
  }

  if (!currentUser) {
    return <LoginScreen onLogin={async cred=>{
      // ── init the credential store with the user's session passphrase ──
      await initStore(cred.email + ":" + cred.password);
      setCredentials(prev =>
        prev.some(u => u.email === cred.email)
          ? prev.map(u => u.email === cred.email ? { ...u, ...cred } : u)
          : [...prev, cred]
      );
      setUsers(prev => prev.map(u => u.email === cred.email ? { ...u, lastLogin:new Date().toISOString().replace("T"," ").slice(0,19) } : u));
      const existingUser = credentials.find(u => u.email === cred.email) || users.find(u => u.email === cred.email) || {};
      setCurrentUser({ ...existingUser, ...cred });
      setAuditLog(prev=>[{
        id:Date.now(), ts:new Date().toISOString().replace("T"," ").slice(0,19),
        user:cred.name||cred.email, email:cred.email, role:cred.role,
        action:"login", ip:"—", detail:"Successful login", status:"success"
      }, ...prev]);
    }} credentials={credentials}/>;
  }

  function handleSetSection(s) {
    if ((s==="users"||s==="accounts"||s==="auditlog")&&currentUser.role!=="admin") return;
    setSection(s);
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${C.surface}; }
        ::-webkit-scrollbar-thumb { background: ${C.border2}; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: ${C.textMut}; }
        select option { background: ${C.card2}; color: ${C.textPri}; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes slideInRight { from { transform: translateX(40px); opacity:0; } to { transform: translateX(0); opacity:1; } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      <Toast toasts={toasts} removeToast={removeToast}/>

      {showChangePwd && (
        <ChangePasswordModal currentUser={currentUser} onClose={()=>setShowChangePwd(false)}
          credentials={credentials} setCredentials={setCredentials} setCurrentUser={setCurrentUser} addToast={addToast}/>
      )}
      {showNotif && (
        <NotificationSettingsModal currentUser={currentUser} credentials={credentials}
          setCredentials={setCredentials} onClose={()=>setShowNotif(false)} addToast={addToast}/>
      )}

      <div style={{ display:"flex", minHeight:"100vh", background:C.bg,
        fontFamily:"'Segoe UI',system-ui,-apple-system,sans-serif", color:C.textPri }}>
        <Sidebar
          active={section}
          setActive={handleSetSection}
          role={currentUser.role}
          user={currentUser}
          onLogout={()=>{ setCurrentUser(null); setSection("overview"); }}
          onChangePassword={()=>setShowChangePwd(true)}
          onNotifSettings={()=>setShowNotif(true)}
          onRefresh={refreshCurrentPage}
          refreshing={refreshingPage}
        />
        <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0, overflow:"hidden" }}>
          <Header
            accounts={scaledAccounts}
            selected={selectedAcc}
            setSelected={setSelectedAcc}
            section={section}
            timeRange={timeRange}
            setTimeRange={setTimeRange}
            currentUser={currentUser}
            onChangePassword={()=>setShowChangePwd(true)}
            onNotifSettings={()=>setShowNotif(true)}
          />
          <div key={`${section}-${refreshSignal}`} style={{ flex:1, padding:22, overflowY:"auto" }}>
            {section==="overview"    && <OverviewSection accounts={scaledAccounts} setActive={setSection} setSelected={setSelectedAcc}/>}
            {section==="inventory"   && <InventorySection account={account} refreshSignal={refreshSignal} onInventoryLoaded={handleInventoryLoaded}/>}
            {section==="waf"         && <WAFSection account={account}/>}
            {section==="securityhub" && <SecurityHubSection account={account}/>}
            {section==="guardduty"   && <GuardDutySection account={account}/>}
            {section==="inspector"   && <InspectorSection account={account}/>}
            {section==="risk"        && <RiskSection account={account}/>}
            {section==="users"       && currentUser.role==="admin" && <UsersSection users={users} setUsers={setUsers} setCredentials={setCredentials} addToast={addToast} logEvent={logEvent}/>}
            {section==="accounts"    && currentUser.role==="admin" && <AccountsSection accounts={accounts} setAccounts={setAccounts} addToast={addToast} logEvent={logEvent}/>}
            {section==="auditlog"    && currentUser.role==="admin" && <AuditLogSection auditLog={auditLog}/>}
            {section==="settings"    && <SettingsSection currentUser={currentUser} credentials={credentials} setCredentials={setCredentials} setCurrentUser={setCurrentUser} addToast={addToast}/>}
          </div>
        </div>
      </div>
    </>
  );
}
