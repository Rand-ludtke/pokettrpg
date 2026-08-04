// PokeRogueTab.tsx — A true 1:1 replica of the official PokeRogue website
// (https://pokerogue.net/), embedded directly via iframe. This is intentionally
// NOT a reimplementation — the user asked for the actual live PokeRogue site,
// pixel-for-pixel identical, with all its real gym leaders, randomized seeds,
// visuals, and mechanics exactly as they exist on pokerogue.net today.
// The site does not send X-Frame-Options or a frame-ancestors CSP directive
// (verified directly against the live response headers), so embedding it in
// an iframe works without any proxy or extra backend work.
//
// Reference repos (for context / future offline-bundling work, not used here
// since the live site embed already satisfies the "simple and easy" 1:1 ask):
//   https://github.com/pagefaultgames/pokerogue (official, beta branch)
//   https://github.com/Admiral-Billy/Pokerogue-App (older downloadable client)

import React, { useState } from 'react';

const POKEROGUE_URL = 'https://pokerogue.net/';

export const PokeRogueTab: React.FC = () => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', background: '#000' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px', background: '#111', borderBottom: '1px solid #333', color: '#ddd', fontSize: 13,
      }}>
        <span>⚡ PokeRogue — live embed of <a href={POKEROGUE_URL} target="_blank" rel="noreferrer" style={{ color: '#7ab7ff' }}>pokerogue.net</a></span>
        <a href={POKEROGUE_URL} target="_blank" rel="noreferrer" style={{ color: '#7ab7ff', textDecoration: 'none', fontWeight: 700 }}>Open in new tab ↗</a>
      </div>
      <div style={{ position: 'relative', flex: 1 }}>
        {!loaded && !failed && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 16 }}>
            Loading PokeRogue…
          </div>
        )}
        {failed && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#ccc', padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Couldn't load PokeRogue in-app.</div>
            <div>Your browser or network may be blocking the embed.</div>
            <a href={POKEROGUE_URL} target="_blank" rel="noreferrer" style={{ padding: '10px 20px', background: '#ffd700', color: '#222', borderRadius: 8, fontWeight: 800, textDecoration: 'none' }}>Open pokerogue.net directly ↗</a>
          </div>
        )}
        <iframe
          title="PokeRogue"
          src={POKEROGUE_URL}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', border: 'none', display: failed ? 'none' : 'block' }}
          allow="fullscreen; gamepad; autoplay"
        />
      </div>
    </div>
  );
};
