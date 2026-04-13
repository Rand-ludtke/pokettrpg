import React, { useEffect, useState } from 'react';
import { withPublicBase } from '../utils/publicBase';

const RULE_DOCS = [
  { file: 'Main rules.md', label: 'Main Rules' },
  { file: 'Battle Quick Reference.md', label: 'Battle Quick Reference' },
  { file: 'Route Day Procedure.md', label: 'Route Day Procedure' },
  { file: 'Fusion & Defusion (draft).md', label: 'Fusion & Defusion' },
  { file: 'Pokemon Field Stats & Skill Checks.md', label: 'Field Stats & Skill Checks' },
  { file: 'Horde Encounters.md', label: 'Horde Encounters' },
  { file: 'Pokemon Contest & Showcase Draft.md', label: 'Contests & Showcases' },
  { file: 'Crafting Quick Reference.md', label: 'Crafting Quick Ref' },
  { file: 'Crafting Materials Index.md', label: 'Crafting Materials' },
  { file: 'Crafting Recipes - Core Families.md', label: 'Crafting Recipes' },
  { file: 'Crafting, Salvage & Field Fabrication.md', label: 'Salvage & Fabrication' },
  { file: 'Route Gathering, Salvage & Harvest Tables.md', label: 'Gathering & Harvest' },
  { file: 'TM Crafting & Etching.md', label: 'TM Crafting' },
  { file: 'TM Ingredient Table - Regional Species Index.md', label: 'TM Ingredients (Species)' },
  { file: 'TM Ingredient Table - Regional Type Lanes.md', label: 'TM Ingredients (Types)' },
];

export function RulesTab() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const doc = RULE_DOCS[selectedIdx];
    fetch(withPublicBase(`docs/rules/${doc.file}`))
      .then(res => {
        if (!res.ok) throw new Error('Failed to load');
        return res.text();
      })
      .then(text => { if (!cancelled) { setContent(text); setLoading(false); } })
      .catch(() => { if (!cancelled) { setContent('Could not load ' + doc.file); setLoading(false); } });
    return () => { cancelled = true; };
  }, [selectedIdx]);

  const filteredDocs = search
    ? RULE_DOCS.filter(d => d.label.toLowerCase().includes(search.toLowerCase()))
    : RULE_DOCS;

  return (
    <div className="rules-grid" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 12, height: 'calc(100vh - 140px)', marginTop: 12 }}>
      {/* Sidebar */}
      <section className="panel rules-sidebar" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ margin: '0 0 8px' }}>📖 Rule Documents</h3>
        <input
          type="text"
          placeholder="Filter..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--panel-bg)', color: 'inherit', fontSize: '0.9em' }}
        />
        <div style={{ display: 'grid', gap: 4, overflow: 'auto', flex: 1 }}>
          {filteredDocs.map((doc, i) => {
            const realIdx = RULE_DOCS.indexOf(doc);
            const active = realIdx === selectedIdx;
            return (
              <button
                key={doc.file}
                onClick={() => setSelectedIdx(realIdx)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: active ? '1px solid var(--accent)' : '1px solid transparent',
                  background: active ? 'rgba(233,69,96,0.12)' : 'transparent',
                  color: active ? '#fff' : '#ccc',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: '0.9em',
                  fontWeight: active ? 600 : 400,
                  transition: 'all .15s',
                }}
              >
                {doc.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Content */}
      <section className="panel" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ margin: '0 0 8px' }}>{RULE_DOCS[selectedIdx].label}</h2>
        <div className="dim" style={{ marginBottom: 8, fontSize: '0.85em' }}>
          {RULE_DOCS[selectedIdx].file}
        </div>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
            padding: 12,
            border: '1px solid var(--accent)',
            borderRadius: 8,
            flex: 1,
            overflowY: 'auto',
            fontFamily: 'inherit',
            lineHeight: 1.5,
            opacity: loading ? 0.5 : 1,
            transition: 'opacity .15s',
          }}
        >
          {content}
        </pre>
      </section>
    </div>
  );
}

