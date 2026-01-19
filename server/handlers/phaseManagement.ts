/**
 * @file Phase management handlers
 * Handles turn phase navigation and auto-abilities toggle
 */

import { logger } from '../utils/logger.js';
import { getGameState } from '../services/gameState.js';
import { broadcastToGame } from '../services/websocket.js';

/**
 * Handle TOGGLE_AUTO_ABILITIES message
 * Toggles whether auto-abilities are enabled for the game
 */
export function handleToggleAutoAbilities(ws, data) {
  try {
    const { gameId, enabled } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Validate that enabled is a boolean
    if (typeof enabled !== 'boolean') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid enabled value: must be a boolean'
      }));
      return;
    }

    gameState.autoAbilitiesEnabled = enabled;
    broadcastToGame(gameId, gameState);
    logger.info(`Auto-abilities ${enabled ? 'enabled' : 'disabled'} for game ${gameId}`);
  } catch (error) {
    logger.error('Failed to toggle auto abilities:', error);
  }
}

/**
 * Handle TOGGLE_AUTO_DRAW message
 * Toggles whether auto-draw is enabled for a specific player
 */
export function handleToggleAutoDraw(ws, data) {
  try {
    const { gameId, playerId, enabled } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Validate that enabled is a boolean
    if (typeof enabled !== 'boolean') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid enabled value: must be a boolean'
      }));
      return;
    }

    // Find the player and update their auto-draw setting
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player not found'
      }));
      return;
    }

    player.autoDrawEnabled = enabled;
    broadcastToGame(gameId, gameState);
    logger.info(`Auto-draw ${enabled ? 'enabled' : 'disabled'} for player ${playerId} in game ${gameId}`);
  } catch (error) {
    logger.error('Failed to toggle auto draw:', error);
  }
}

/**
 * Handle TOGGLE_ACTIVE_PLAYER message
 * Sets the active player
 * Triggers the hidden Draw phase (-1) which automatically transitions to Setup (0)
 */
export function handleToggleActivePlayer(ws, data) {
  try {
    const { gameId, playerId } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    const previousActivePlayerId = gameState.activePlayerId;
    logger.info(`[ToggleActivePlayer] ========== TOGGLE ACTIVE PLAYER ==========`);
    logger.info(`[ToggleActivePlayer] Previous active: ${previousActivePlayerId}, Clicked: ${playerId}, Current phase: ${gameState.currentPhase}`);

    // Toggle: if same player clicked, deselect; otherwise select new player
    if (previousActivePlayerId === playerId) {
      gameState.activePlayerId = undefined;
      logger.info(`[ToggleActivePlayer] ❌ DESELECTING player ${playerId}`);
    } else {
      gameState.activePlayerId = playerId;
      logger.info(`[ToggleActivePlayer] ✅ SELECTING player ${playerId} (previous was ${previousActivePlayerId})`);

      // Enter Draw phase (-1) when selecting a new active player
      // The draw phase will auto-draw a card and transition to Setup (0)
      gameState.currentPhase = -1;
      logger.info(`[ToggleActivePlayer] Phase set to -1 (Draw), calling performDrawPhase...`);

      performDrawPhase(gameState);

      logger.info(`[ToggleActivePlayer] After performDrawPhase: phase=${gameState.currentPhase}, activePlayerId=${gameState.activePlayerId}`);
    }

    broadcastToGame(gameId, gameState);
    logger.info(`[ToggleActivePlayer] Broadcast complete. Active player: ${gameState.activePlayerId || 'none'}, Phase: ${gameState.currentPhase}`);
    logger.info(`[ToggleActivePlayer] ========== END TOGGLE ACTIVE PLAYER ==========`);
  } catch (error) {
    logger.error('Failed to toggle active player:', error);
  }
}

/**
 * Perform the hidden Draw phase
 * Draws exactly 1 card for the active player and transitions to Setup
 * Simple rule: draw 1 card from deck to hand when player becomes active
 */
export function performDrawPhase(gameState: any): void {
  logger.info(`[DrawPhase] ========== START DRAW PHASE ==========`);
  logger.info(`[DrawPhase] activePlayerId=${gameState.activePlayerId}, phase=${gameState.currentPhase}`);

  if (gameState.activePlayerId === null) {
    logger.info(`[DrawPhase] ❌ No active player, moving to Setup`);
    gameState.currentPhase = 0;
    return;
  }

  const activePlayer = gameState.players.find((p: any) => p.id === gameState.activePlayerId);
  if (!activePlayer) {
    logger.warn(`[DrawPhase] ❌ Active player ${gameState.activePlayerId} not found`);
    gameState.currentPhase = 0;
    return;
  }

  logger.info(`[DrawPhase] Player ${activePlayer.id} (${activePlayer.name}): hand=${activePlayer.hand?.length || 0}, deck=${activePlayer.deck?.length || 0}, dummy=${activePlayer.isDummy}, autoDraw=${activePlayer.autoDrawEnabled}`);

  // Check if player has cards to draw
  if (!activePlayer.deck || activePlayer.deck.length === 0) {
    logger.info(`[DrawPhase] ❌ Player ${activePlayer.id} has empty deck - skipping draw`);
    gameState.currentPhase = 0;
    return;
  }

  // Determine if auto-draw should happen
  let shouldDraw = false;
  if (activePlayer.isDummy) {
    const hostPlayer = gameState.players.find((p: any) => p.id === 1);
    shouldDraw = hostPlayer?.autoDrawEnabled === true;
    logger.info(`[DrawPhase] Dummy player - using host autoDrawEnabled: ${hostPlayer?.autoDrawEnabled}`);
  } else {
    shouldDraw = activePlayer.autoDrawEnabled !== false;
    logger.info(`[DrawPhase] Real player - using own autoDrawEnabled: ${activePlayer.autoDrawEnabled}`);
  }

  if (shouldDraw) {
    // Draw exactly 1 card from top of deck
    const cardToDraw = activePlayer.deck[0];
    activePlayer.deck.splice(0, 1);
    activePlayer.hand.push(cardToDraw);
    logger.info(`[DrawPhase] ✅ Drew 1 card for player ${activePlayer.id}. New hand: ${activePlayer.hand.length}, deck: ${activePlayer.deck.length}`);
  } else {
    logger.info(`[DrawPhase] ❌ Auto-draw DISABLED for player ${activePlayer.id} - skipping draw`);
  }

  // Transition to Setup phase
  gameState.currentPhase = 0;
  logger.info(`[DrawPhase] ========== END DRAW PHASE (phase now 0) ==========`);
}

/**
 * Handle NEXT_PHASE message
 * Advances to the next turn phase
 */
export function handleNextPhase(ws, data) {
  try {
    const { gameId } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (!gameState.isGameStarted) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game has not started'
      }));
      return;
    }

    // Get current phase or default to 0
    const currentPhase = gameState.currentPhase || 0;

    // Advance to next phase, wrapping around
    gameState.currentPhase = (currentPhase + 1) % 4;

    broadcastToGame(gameId, gameState);
    logger.info(`Phase advanced to ${gameState.currentPhase} in game ${gameId}`);
  } catch (error) {
    logger.error('Failed to advance phase:', error);
  }
}

/**
 * Handle PREV_PHASE message
 * Goes back to the previous turn phase
 */
export function handlePrevPhase(ws, data) {
  try {
    const { gameId } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (!gameState.isGameStarted) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game has not started'
      }));
      return;
    }

    // Get current phase or default to 0
    const currentPhase = gameState.currentPhase || 0;

    // Go to previous phase, wrapping around
    gameState.currentPhase = (currentPhase - 1 + 4) % 4;

    broadcastToGame(gameId, gameState);
    logger.info(`Phase retreated to ${gameState.currentPhase} in game ${gameId}`);
  } catch (error) {
    logger.error('Failed to retreat phase:', error);
  }
}

/**
 * Handle SET_PHASE message
 * Sets the turn phase to a specific index
 * Draw phase (-1) is now an explicit phase that triggers auto-draw
 */
export function handleSetPhase(ws, data) {
  try {
    const { gameId, phaseIndex } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (!gameState.isGameStarted) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game has not started'
      }));
      return;
    }

    // Validate phaseIndex is numeric
    const numericPhaseIndex = Number(phaseIndex);
    if (!Number.isInteger(numericPhaseIndex) || Number.isNaN(numericPhaseIndex)) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid phase index; must be an integer'
      }));
      return;
    }

    // Allow phases -1 (Draw) to 3 (Scoring)
    if (numericPhaseIndex < -1 || numericPhaseIndex >= 4) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid phase index. Must be between -1 and 3'
      }));
      return;
    }

    const previousPhase = gameState.currentPhase;

    // Set the phase directly - auto-draw is handled by UPDATE_STATE when phase=-1 is sent
    // This keeps a single path: client sends UPDATE_STATE with phase=-1 + activePlayerId → draw
    gameState.currentPhase = numericPhaseIndex;

    broadcastToGame(gameId, gameState);
    logger.info(`Phase set to ${gameState.currentPhase} in game ${gameId} (from ${previousPhase})`);
  } catch (error) {
    logger.error('Failed to set phase:', error);
  }
}
