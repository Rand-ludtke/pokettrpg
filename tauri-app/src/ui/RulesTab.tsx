import React from 'react';
import { TRAINER_TRAITS } from '../data/trainerTraits';

const CORE_RULES = [
  'Stats: Strength, Athletics, Intelligence, Speech, Fortitude, Luck. Ability checks are D12 + half stat (round up).',
  'Type Enthusiast: pick one specialty for stronger catches/checks on that type, weaker on others; Wild Card has no bonus/penalty.',
  'Trainer resources: HP max is 10 + Fortitude, SP max is 5 + Athletics. SP fuels travel/training scenes.',
  'Catching: use normal catch flow plus trainer trait modifiers and type specialty modifiers when applicable.',
  'Battle fallback: use move-power dice brackets, base-stat modifiers, and turn order by speed/priority.',
  'Travel and fractures: route hazards and seam events may require INT/ATH/FTD checks and SP management.',
];

export function RulesTab() {
  return (
    <section className="panel" style={{ marginTop: 12 }}>
      <h2 style={{ marginTop: 0 }}>TTRPG Rules</h2>
      <div className="dim" style={{ marginBottom: 12 }}>
        Core rules and full trainer trait list for quick in-app reference.
      </div>

      <h3>Core Rules</h3>
      <ul style={{ marginTop: 6, display: 'grid', gap: 6 }}>
        {CORE_RULES.map((rule, idx) => (
          <li key={idx}>{rule}</li>
        ))}
      </ul>

      <h3 style={{ marginTop: 16 }}>Trainer Traits</h3>
      <div style={{ display: 'grid', gap: 8 }}>
        {TRAINER_TRAITS.map(trait => (
          <div key={trait.name} style={{ border: '1px solid var(--accent)', borderRadius: 6, padding: 8, display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <strong>{trait.name}</strong>
              {trait.reqText && <span className="chip dim">Req: {trait.reqText}</span>}
            </div>
            <div className="dim">{trait.desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
