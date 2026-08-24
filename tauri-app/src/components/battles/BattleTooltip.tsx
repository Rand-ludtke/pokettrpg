// BattleTooltip.tsx - Pokeathlon-style tooltips for moves/types/sprites in battle
import React, { useState } from "react";

interface MoveTypeInfo {
  id: string;
  name: string;
  type: string; // includes custom types: Crystal, Cosmic, Nuclear, Stellar, Sound, Light
  power: number;
  accuracy: number;
  ppMax: number;
  category: "physical" | "special" | "status";
  description: string;
}

interface SpriteSource {
  url: string;
  attribution: string; // e.g. "Soulstones 2 / Pokeathlon", "Infinite Fusion Custom"
}

interface BattleTooltipProps {
  move?: MoveTypeInfo;
  pokemonName?: string;
  types: string[]; // defender types for effectiveness display
  spriteSource?: SpriteSource | null;
  fusionLineage?: string[]; // [base1, base2] if this is a fusion Pokemon
  opponentTypes?: string[]; // for predicted damage
}

export const BattleTooltip: React.FC<BattleTooltipProps> = ({
  move, pokemonName, types, spriteSource, fusionLineage, opponentTypes
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className="pokeathlon-tooltip-wrapper">
      {/* Trigger */}
      <button
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        className="tooltip-trigger-btn"
      >
        {move?.name || pokemonName || "Hover for Details"}
      </button>
      
      {/* Tooltip Panel */}
      {visible && (
        <div className="pokeathlon-tooltip-panel">
          {/* Sprite Source Badge (if available) */}
          {spriteSource && !fusionLineage && (
            <div className="tooltip-sprite-source" style={{ borderColor: spriteSource.url.includes("pokeathlon") ? "#ffd700" : "#8b5cf6" }}>
              <span>🎨 Sprite:</span> {spriteSource.attribution}
            </div>
          )}

          {/* Fusion Lineage Display */}
          {fusionLineage && fusionLineage.length > 1 && (
            <div className="tooltip-fusion-lineage" style={{ borderColor: "#6a0dad", background: "linear-gradient(135deg, #2d1b4e, #1a0a2e)" }}>
              ⚡ <strong>Union Form:</strong> {fusionLineage.join(` + `)}
            </div>
          )}

          {/* Move Section (if move is provided) */}
          {move && (
            <div className="tooltip-move-section">
              <h4 style={{ color: getTypeColor(move.type), marginBottom: "8px" }}>{move.name}</h4>
              <div className="tooltip-type-badge" style={{ borderColor: getTypeColor(move.type), background: getTypeColor(move.type), color: move.type.toLowerCase() === 'light' ? '#333' : '#fff' }}>
                {move.type}
              </div>
              <div className="tooltip-stats-row" style={{ gap: "12px", flexWrap: "wrap" }}>
                <div><strong>Power:</strong> {move.power}</div>
                <div><strong>Accuracy:</strong> {move.accuracy}%</div>
                <div><strong>PP:</strong> {move.ppMax}/{move.ppMax}</div>
                <div>{move.category.toUpperCase()}</div>
              </div>

              {/* Super Effective / Not Very Effective */}
              {types && types.length > 0 && (
                <EffectivenessDisplay defenderTypes={types} moveType={move.type} opponentTypes={opponentTypes} />
              )}

              <p className="tooltip-desc">{move.description || "No additional effect."}</p>
            </div>
          )}

          {/* Pokémon Info Section (if only pokemon name provided) */}
          {pokemonName && !move && (
            <div className="tooltip-pokemon-section">
              <h4>{pokemonName}</h4>
              <div className="tooltip-type-badges" style={{ display: "flex", gap: "8px" }}>
                {types.map(t => (
                  <span key={t} className="type-badge" style={{ borderColor: getTypeColor(t), background: getTypeColor(t), color: t.toLowerCase() === 'light' ? '#333' : '#fff' }}>{t}</span>
                ))}
              </div>
              <p>{spriteSource ? spriteSource.attribution : "Official Pokettrpg Dex"}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ===================== Helpers =====================

const getTypeColor = (type: string): string => {
  const colors: Record<string, string> = {
    normal: "#a8a77a", fire: "#ee8130", water: "#6390f0", 
    electric: "#f7d02c", grass: "#7ac74c", ice: "#96d9d6",
    fighting: "#c22e28", poison: "#a33ea1", ground: "#e2bf51",
    flying: "#a98ff3", psychic: "#f95587", bug: "#a6b91a",
    rock: "#b6a136", ghost: "#735797", dragon: "#6f35fc",
    dark: "#705746", steel: "#b7b7ce", fairy: "#d685ad",
    // Custom Soulstones types matching Pokeathlon style
    Crystal: "#a0d2eb", Cosmic: "#c491e9", Nuclear: "#4caf50", 
    Stellar: "#fbc531", Sound: "#ff66aa", Light: "#fffacd", Shadow: "#4a3a66"
  };
  return colors[type] || "#888";
};

const EffectivenessDisplay: React.FC<{ defenderTypes: string[]; moveType: string; opponentTypes?: string[] }> = ({ defenderTypes, moveType, opponentTypes }) => {
  // Full type chart for frontend tooltips — must match backend /backend/src/data/type-chart.ts
  const getEffectiveness = (attacker: string, defender: string): number => {
    const chart: Record<string, Partial<Record<string, number>>> = {
      Normal:   { Rock:0.5, Ghost:0,     Steel:0.5   },
      Fire:     { Fire:0.5, Water:0.5,  Grass:2, Ice:2, Bug:2, Rock:0.5, Dragon:0.5, Steel:2 },
      Water:    { Fire:2,   Water:0.5,  Grass:0.5,Ground:2, Rock:2, Dragon:0.5 },
      Electric: { Water:2,  Electric:0.5,Grass:0.5,Ground:0, Flying:2, Dragon:0.5 },
      Grass:    { Fire:0.5, Water:2,     Grass:0.5,Poison:0.5,Ground:2,Flying:0.5,Bug:0.5,Rock:2,Dragon:0.5,Steel:0.5 },
      Ice:      { Fire:0.5, Water:0.5,  Grass:2,Ice:0.5,Ground:2,Flying:2,Dragon:2,Steel:0.5 },
      Fighting: { Normal:2, Ice:2,       Rock:2,     Dark:2,    Steel:2,Poison:0.5,Flying:0.5,Psychic:0.5,Bug:0.5,Ghost:0,Fairy:0.5 },
      Poison:   { Grass:2,    Poison:0.5,Ground:0.5,Rock:0.5, Ghost:0.5,Steel:0,Fairy:2 },
      Ground:   { Fire:2,   Electric:2,  Grass:0.5,Poison:2, Flying:0,Bug:0.5,Rock:2,Steel:2 },
      Flying:   { Electric:0.5,Grass:2,Fighting:2,Bug:2,Rock:0.5,Steel:0.5 },
      Psychic:  { Fighting:2, Poison:2,  Psychic:0.5,Dark:0 },
      Bug:      { Fire:0.5, Grass:2,     Fighting:0.5,Poison:0.5,Flying:0.5,Psychic:2,Ghost:0.5,Dark:2,Steel:0.5,Fairy:0.5 },
      Rock:     { Fire:2,   Ice:2,       Fighting:0.5,Ground:0.5,Flying:2,Bug:2,Steel:0.5 },
      Ghost:    { Normal:0,  Psychic:2,  Ghost:2,Dark:0.5 },
      Dragon:   { Dragon:2, Steel:0.5,   Fairy:0 },
      Dark:     { Fighting:0.5,Psychic:2,Ghost:2,Dark:0.5,Fairy:0.5 },
      Steel:    { Fire:0.5, Water:0.5,  Electric:0.5,Ice:2,Rock:2,Steel:0.5,Fairy:2 },
      Fairy:    { Fire:0.5, Fighting:2, Poison:0.5,Dragon:2,Dark:2,Steel:0.5 },
      // Custom Soulstones types
      Crystal:  { Fire:0.5, Water:2,Ice:0.5,Grass:0.5,Psychic:1.5,Rock:1.2 },
      Cosmic:   { Psychic:2,Dragon:2,Dark:0.5,Steel:1.5 },
      Nuclear:  { Electric:2,Poison:2,Steel:1,Ghost:1.5,Normal:1.5 },
      Stellar:  { Ghost:2,   Dark:2,Fire:0.5,Water:0.5 },
      Sound:    { Psychic:2,Flying:2,Dark:1.5,Ice:0.5 },
      Light:    { Dark:3,    Steel:0.5,Psychic:1.5,Ghost:1.5 },
    };
    if (!chart[attacker]) return 1; // Default: neutral
    return chart[attacker]?.[defender] ?? 1;
  };

  // Fix typo in backend "Poision" → "Poison"

  const effectiveness = defenderTypes.reduce((prod, t) => prod * getEffectiveness(moveType, t), 1);
  
  let label = "";
  if (effectiveness > 1) {
    label = "✨ SUPER EFFECTIVE!";
  } else if (effectiveness < 1 && effectiveness > 0) {
    label = "🛡️ Not Very Effective...";
  } else if (effectiveness === 0) {
    label = "🚫 No Effect!";
  } else {
    label = "➖ Neutral";
  }

  return (
    <div className={`tooltip-effectiveness ${effectiveness > 1 ? "super-effective" : effectiveness === 0 ? "immune" : ""}`} 
         style={{ 
           marginTop: "8px", 
           padding: "6px 12px", 
           borderRadius: "4px",
           fontSize: "13px",
           fontWeight: "bold",
           color: effectiveness > 1 ? "#4caf50" : effectiveness === 0 ? "#ff1744" : effectiveness < 1 ? "#ff9800" : "#bbb",
           background: effectiveness > 1 ? "#1b3a1b22" : effectiveness === 0 ? "#3a1b1b22" : "transparent"
         }}>
      {label}
    </div>
  );
};
