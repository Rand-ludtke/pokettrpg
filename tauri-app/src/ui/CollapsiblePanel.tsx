import React, { useState } from 'react';

interface CollapsiblePanelProps {
  title: string;
  icon?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function CollapsiblePanel({ title, icon, children, defaultOpen = false }: CollapsiblePanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="panel collapsible" style={{ padding: isOpen ? undefined : '6px 12px' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isOpen ? '0 0 8px 0' : 0,
          textAlign: 'left',
          fontSize: '1em',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon && <span>{icon}</span>}
          <strong>{title}</strong>
        </span>
        <span style={{ fontSize: '0.8em', opacity: 0.6 }}>
          {isOpen ? '▼' : '▶'}
        </span>
      </button>
      {isOpen && children}
    </section>
  );
}
