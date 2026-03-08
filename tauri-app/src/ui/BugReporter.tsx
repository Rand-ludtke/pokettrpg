import React, { useState, useEffect, useCallback, useRef } from 'react';

/* ------------------------------------------------------------------ */
/*  Bug / Feature Reporter – floating FAB + modal                      */
/*  Reports are saved locally and optionally sent to the server.       */
/* ------------------------------------------------------------------ */

export interface BugReport {
  id: string;
  type: 'bug' | 'feature' | 'feedback';
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  screenshot?: string;          // data-url png
  logs: string[];               // last N console lines
  userAgent: string;
  appVersion: string;
  timestamp: number;
  status: 'pending' | 'sent' | 'failed';
  tab?: string;                 // which tab was active
}

const LS_KEY = 'ttrpg.bugReports';
const MAX_LOG_LINES = 80;
const APP_VERSION = '1.3.10';

/* ---------- console capture ring buffer ---------- */
const logRing: string[] = [];
const origConsole = {
  log:   console.log,
  warn:  console.warn,
  error: console.error,
  info:  console.info,
};
function captureConsole() {
  for (const level of ['log','warn','error','info'] as const) {
    const orig = origConsole[level];
    (console as any)[level] = (...args: any[]) => {
      const ts = new Date().toISOString().slice(11,23);
      const line = `[${ts}][${level}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
      logRing.push(line);
      if (logRing.length > MAX_LOG_LINES * 2) logRing.splice(0, logRing.length - MAX_LOG_LINES);
      orig.apply(console, args);
    };
  }
}
// capture on import
captureConsole();

/* capture unhandled errors */
const errorLog: string[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    errorLog.push(`[ERROR] ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    errorLog.push(`[UNHANDLED] ${e.reason}`);
  });
}

/* ---------- storage helpers ---------- */
function loadReports(): BugReport[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}
function saveReports(reports: BugReport[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(reports)); } catch {}
}

/* ---------- screenshot helper ---------- */
async function takeScreenshot(): Promise<string | undefined> {
  try {
    // Use html2canvas-lite approach: render current viewport to canvas
    const canvas = document.createElement('canvas');
    const body = document.body;
    const w = Math.min(window.innerWidth, 1920);
    const h = Math.min(window.innerHeight, 1080);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    // Try the native screenshot API (works in Tauri / modern browsers)
    if ('getDisplayMedia' in navigator.mediaDevices) {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: w, height: h } } as any);
        const video = document.createElement('video');
        video.srcObject = stream;
        await video.play();
        ctx.drawImage(video, 0, 0, w, h);
        stream.getTracks().forEach(t => t.stop());
        return canvas.toDataURL('image/png', 0.7);
      } catch { /* user declined or not supported, fall through */ }
    }
    return undefined;
  } catch { return undefined; }
}

/* ---------- submit to server ---------- */
async function submitReport(report: BugReport): Promise<boolean> {
  try {
    const base = localStorage.getItem('ttrpg.apiBase') || 'https://pokettrpg.duckdns.org';
    const resp = await fetch(`${base}/api/bug-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: report.type,
        title: report.title,
        description: report.description,
        severity: report.severity,
        logs: report.logs.slice(-40),
        userAgent: report.userAgent,
        appVersion: report.appVersion,
        timestamp: report.timestamp,
        tab: report.tab,
        // don't send screenshot to save bandwidth — keep it local
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/* ---------- main component ---------- */
export function BugReporter({ currentTab }: { currentTab?: string }) {
  const [open, setOpen] = useState(false);
  const [viewHistory, setViewHistory] = useState(false);
  const [reports, setReports] = useState<BugReport[]>([]);
  const [type, setType] = useState<'bug'|'feature'|'feedback'>('bug');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [severity, setSeverity] = useState<'low'|'medium'|'high'|'critical'>('medium');
  const [screenshot, setScreenshot] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [flash, setFlash] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setReports(loadReports()); }, [open]);

  const handleOpen = useCallback(() => {
    setOpen(true);
    setViewHistory(false);
    setType('bug');
    setTitle('');
    setDesc('');
    setSeverity('medium');
    setScreenshot(undefined);
    setFlash('');
  }, []);

  const handleScreenshot = useCallback(async () => {
    // briefly hide modal, take screenshot, re-show
    setOpen(false);
    await new Promise(r => setTimeout(r, 300));
    const img = await takeScreenshot();
    setScreenshot(img);
    setOpen(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) { setFlash('Title is required'); return; }
    setSending(true);
    const report: BugReport = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      type,
      title: title.trim(),
      description: desc.trim(),
      severity,
      screenshot,
      logs: [...logRing.slice(-MAX_LOG_LINES), ...errorLog],
      userAgent: navigator.userAgent,
      appVersion: APP_VERSION,
      timestamp: Date.now(),
      status: 'pending',
      tab: currentTab,
    };
    const ok = await submitReport(report);
    report.status = ok ? 'sent' : 'failed';
    const updated = [report, ...loadReports()].slice(0, 100);
    saveReports(updated);
    setReports(updated);
    setSending(false);
    if (ok) {
      setFlash('Report sent successfully!');
      setTimeout(() => { setOpen(false); setFlash(''); }, 1500);
    } else {
      setFlash('Saved locally (server unreachable). Will retry later.');
    }
  }, [type, title, desc, severity, screenshot, currentTab]);

  const retryFailed = useCallback(async () => {
    setSending(true);
    const all = loadReports();
    let retried = 0;
    for (const r of all) {
      if (r.status === 'failed' || r.status === 'pending') {
        const ok = await submitReport(r);
        if (ok) { r.status = 'sent'; retried++; }
      }
    }
    saveReports(all);
    setReports([...all]);
    setSending(false);
    setFlash(retried > 0 ? `Retried ${retried} report(s)` : 'No pending reports to retry');
  }, []);

  const clearHistory = useCallback(() => {
    saveReports([]);
    setReports([]);
    setFlash('History cleared');
  }, []);

  const pendingCount = reports.filter(r => r.status !== 'sent').length;

  // ---- styles ----
  const fabStyle: React.CSSProperties = {
    position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
    width: 48, height: 48, borderRadius: '50%',
    background: 'linear-gradient(135deg, #e94560, #c0392b)',
    color: '#fff', border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 22, boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    transition: 'transform 0.2s, box-shadow 0.2s',
  };
  const backdropStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10000, padding: 16,
  };
  const modalStyle: React.CSSProperties = {
    background: '#1a1a2e', border: '2px solid #0f3460', borderRadius: 12,
    width: 520, maxWidth: '95vw', maxHeight: '85vh', overflowY: 'auto',
    padding: 20, color: '#e0e0e0', fontFamily: "'Segoe UI', monospace",
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', background: '#16213e',
    border: '1px solid #333', borderRadius: 6, color: '#fff',
    fontSize: 14, fontFamily: 'inherit',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: 12,
  };
  const labelTextStyle: React.CSSProperties = {
    fontSize: 12, color: '#aaa', marginBottom: 4, display: 'block',
  };
  const btnRow: React.CSSProperties = {
    display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16,
  };
  const btnPrimary: React.CSSProperties = {
    padding: '8px 18px', background: '#2d6a4f', color: '#fff',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14,
    fontWeight: 'bold',
  };
  const btnSecondary: React.CSSProperties = {
    padding: '8px 18px', background: '#333', color: '#ccc',
    border: '1px solid #555', borderRadius: 6, cursor: 'pointer', fontSize: 14,
  };
  const typeBtnStyle = (active: boolean, color: string): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
    fontWeight: active ? 'bold' : 'normal',
    background: active ? color : '#222',
    border: `2px solid ${active ? '#fff' : '#444'}`,
    color: active ? '#fff' : '#aaa',
    transition: 'all 0.15s',
  });
  const severityColors: Record<string, string> = {
    low: '#27ae60', medium: '#f39c12', high: '#e67e22', critical: '#e74c3c',
  };
  const badgeStyle: React.CSSProperties = {
    position: 'absolute', top: -4, right: -4,
    background: '#e74c3c', color: '#fff', borderRadius: '50%',
    width: 18, height: 18, fontSize: 11, fontWeight: 'bold',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const historyItemStyle = (status: string): React.CSSProperties => ({
    padding: '8px 10px', background: '#16213e', borderRadius: 6,
    borderLeft: `3px solid ${status === 'sent' ? '#27ae60' : status === 'failed' ? '#e74c3c' : '#f39c12'}`,
    marginBottom: 6,
  });

  return (
    <>
      {/* FAB button */}
      <button
        style={fabStyle}
        onClick={handleOpen}
        title="Report Bug / Request Feature"
        onMouseEnter={e => { (e.target as HTMLElement).style.transform = 'scale(1.1)'; }}
        onMouseLeave={e => { (e.target as HTMLElement).style.transform = 'scale(1)'; }}
      >
        🐛
        {pendingCount > 0 && <span style={badgeStyle}>{pendingCount}</span>}
      </button>

      {/* Modal */}
      {open && (
        <div style={backdropStyle} onClick={() => setOpen(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, color: '#e94560', fontSize: 18 }}>
                {viewHistory ? '📋 Report History' : '🐛 Report Bug / Request Feature'}
              </h3>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  style={{ ...btnSecondary, fontSize: 12, padding: '4px 10px' }}
                  onClick={() => setViewHistory(!viewHistory)}
                >
                  {viewHistory ? '✏️ New' : `📋 History (${reports.length})`}
                </button>
                <button
                  style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: 18 }}
                  onClick={() => setOpen(false)}
                >✕</button>
              </div>
            </div>

            {flash && (
              <div style={{
                padding: '8px 12px', borderRadius: 6, marginBottom: 12,
                background: flash.includes('success') || flash.includes('Retried') ? '#1e4d3a' : '#3d1f1f',
                color: flash.includes('success') || flash.includes('Retried') ? '#a6e3a1' : '#f8a5a5',
                fontSize: 13,
              }}>{flash}</div>
            )}

            {viewHistory ? (
              /* ---- History view ---- */
              <div>
                {reports.length === 0 ? (
                  <div style={{ color: '#666', textAlign: 'center', padding: 20 }}>No reports yet</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                      <button style={{ ...btnSecondary, fontSize: 12 }} onClick={retryFailed} disabled={sending}>
                        {sending ? '⏳ Retrying...' : '🔄 Retry Failed'}
                      </button>
                      <button style={{ ...btnSecondary, fontSize: 12, color: '#e74c3c' }} onClick={clearHistory}>
                        🗑️ Clear All
                      </button>
                    </div>
                    {reports.map(r => (
                      <div key={r.id} style={historyItemStyle(r.status)}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 'bold', fontSize: 13 }}>
                            {r.type === 'bug' ? '🐛' : r.type === 'feature' ? '✨' : '💬'} {r.title}
                          </span>
                          <span style={{
                            fontSize: 11, padding: '2px 6px', borderRadius: 4,
                            background: r.status === 'sent' ? '#1e4d3a' : r.status === 'failed' ? '#4d1e1e' : '#4d3e1e',
                            color: r.status === 'sent' ? '#a6e3a1' : r.status === 'failed' ? '#f8a5a5' : '#f8d5a5',
                          }}>
                            {r.status}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>
                          {new Date(r.timestamp).toLocaleString()} · {r.severity} · {r.tab || 'unknown tab'}
                        </div>
                        {r.description && (
                          <div style={{ fontSize: 12, color: '#999', marginTop: 4, whiteSpace: 'pre-wrap' }}>
                            {r.description.slice(0, 200)}{r.description.length > 200 ? '...' : ''}
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            ) : (
              /* ---- New report form ---- */
              <div>
                {/* Type selector */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <button style={typeBtnStyle(type === 'bug', '#c0392b')} onClick={() => setType('bug')}>🐛 Bug</button>
                  <button style={typeBtnStyle(type === 'feature', '#2980b9')} onClick={() => setType('feature')}>✨ Feature</button>
                  <button style={typeBtnStyle(type === 'feedback', '#8e44ad')} onClick={() => setType('feedback')}>💬 Feedback</button>
                </div>

                {/* Title */}
                <label style={labelStyle}>
                  <span style={labelTextStyle}>Title *</span>
                  <input
                    style={inputStyle}
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder={type === 'bug' ? 'What went wrong?' : type === 'feature' ? 'Feature idea...' : 'Your feedback...'}
                    autoFocus
                    maxLength={120}
                  />
                </label>

                {/* Description */}
                <label style={labelStyle}>
                  <span style={labelTextStyle}>
                    Description {type === 'bug' ? '(steps to reproduce)' : '(details)'}
                  </span>
                  <textarea
                    ref={textareaRef}
                    style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
                    value={desc}
                    onChange={e => setDesc(e.target.value)}
                    placeholder={
                      type === 'bug'
                        ? '1. Go to...\n2. Click on...\n3. Expected: ...\n4. Actual: ...'
                        : type === 'feature'
                        ? 'Describe the feature and how it would help...'
                        : 'Any thoughts, suggestions, or comments...'
                    }
                  />
                </label>

                {/* Severity (for bugs) */}
                {type === 'bug' && (
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Severity</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['low','medium','high','critical'] as const).map(s => (
                        <button
                          key={s}
                          style={{
                            padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                            background: severity === s ? severityColors[s] : '#222',
                            border: `2px solid ${severity === s ? severityColors[s] : '#444'}`,
                            color: severity === s ? '#fff' : '#aaa',
                            textTransform: 'capitalize',
                          }}
                          onClick={() => setSeverity(s)}
                        >{s}</button>
                      ))}
                    </div>
                  </label>
                )}

                {/* Screenshot */}
                <div style={{ marginBottom: 12 }}>
                  <span style={labelTextStyle}>Screenshot (optional)</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button style={btnSecondary} onClick={handleScreenshot}>📸 Capture Screen</button>
                    {screenshot && (
                      <>
                        <img src={screenshot} alt="screenshot" style={{ height: 48, borderRadius: 4, border: '1px solid #444' }} />
                        <button style={{ ...btnSecondary, padding: '4px 8px', fontSize: 12 }} onClick={() => setScreenshot(undefined)}>✕</button>
                      </>
                    )}
                  </div>
                </div>

                {/* Info footer */}
                <div style={{ fontSize: 11, color: '#555', marginBottom: 8 }}>
                  App v{APP_VERSION} · {new Date().toLocaleDateString()} · Console logs ({logRing.length} lines) will be attached automatically
                </div>

                {/* Actions */}
                <div style={btnRow}>
                  <button style={btnSecondary} onClick={() => setOpen(false)}>Cancel</button>
                  <button
                    style={{ ...btnPrimary, opacity: sending ? 0.6 : 1 }}
                    onClick={handleSubmit}
                    disabled={sending}
                  >
                    {sending ? '⏳ Sending...' : '📤 Submit Report'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
