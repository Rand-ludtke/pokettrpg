export function calculateHp(baseHp: number, level: number) {
  return Math.floor(baseHp / 2) + level;
}

export function getAttackModifier(base: number) {
  if (base >= 200) return 7;
  if (base >= 150) return 5;
  if (base >= 120) return 4;
  if (base >= 100) return 3;
  if (base >= 80) return 2;
  if (base >= 60) return 1;
  return 0;
}

export function getDefenseModifier(base: number) {
  if (base >= 150) return -4;
  if (base >= 120) return -3;
  if (base >= 100) return -2;
  if (base >= 80) return -1;
  if (base >= 60) return 0;
  return +1;
}

export function getMoveDice(power: number): 'd20'|'d12'|'d10'|'d8'|'d6'|'d4' {
  if (power >= 120) return 'd20';
  if (power >= 85) return 'd12';
  if (power >= 75) return 'd10';
  if (power >= 60) return 'd8';
  if (power >= 30) return 'd6';
  return 'd4';
}
