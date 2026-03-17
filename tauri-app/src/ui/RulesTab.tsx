import React, { useEffect, useState } from 'react';
import { withPublicBase } from '../utils/publicBase';

export function RulesTab() {
  const [rulesText, setRulesText] = useState<string>('Loading full rules...');

  useEffect(() => {
    let cancelled = false;
    async function loadRules() {
      try {
        const res = await fetch(withPublicBase('docs/TTRPG_MAIN_RULES.md'));
        if (!res.ok) throw new Error('Failed to load rules document');
        const text = await res.text();
        if (!cancelled) setRulesText(text);
      } catch {
        if (!cancelled) {
          setRulesText('Could not load the full rules document. Please ensure /public/docs/TTRPG_MAIN_RULES.md is bundled.');
        }
      }
    }
    loadRules();
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="panel" style={{ marginTop: 12 }}>
      <h2 style={{ marginTop: 0 }}>TTRPG Rules</h2>
      <div className="dim" style={{ marginBottom: 12 }}>
        Full rules reference loaded from the bundled rules document.
      </div>
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: 0,
          padding: 12,
          border: '1px solid var(--accent)',
          borderRadius: 8,
          maxHeight: '70vh',
          overflowY: 'auto',
          fontFamily: 'inherit',
          lineHeight: 1.5,
        }}
      >
        {rulesText}
      </pre>
    </section>
  );
}
