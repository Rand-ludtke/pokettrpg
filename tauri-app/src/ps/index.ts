/**
 * Pokemon Showdown Integration Module
 * 
 * This module provides React components that wrap the Pokemon Showdown
 * battle engine, giving you the full PS battle experience with:
 * - Animated sprites and battle scenes
 * - Tooltips with damage calculations
 * - Move type colors and PP tracking
 * - Chat commands
 * - Sound effects
 */

export { loadPokemonShowdown, createPSBattle, getDex, getBattleTooltips, toID } from './ps-loader';
export { PSBattlePanel } from './PSBattlePanel';
export { ProtocolConverter, requestToPS, stateToProtocol } from './protocol-adapter';
export type { ServerPokemon, ServerPlayer, ServerBattleState, BattleLog } from './protocol-adapter';
