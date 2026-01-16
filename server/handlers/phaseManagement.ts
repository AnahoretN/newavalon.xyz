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
 * Note: Auto-draw is handled client-side in the onmessage handler when entering Setup phase
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

    // Toggle: if same player clicked, deselect; otherwise select new player
    if (previousActivePlayerId === playerId) {
      gameState.activePlayerId = undefined;
    } else {
      gameState.activePlayerId = playerId;
    }

    broadcastToGame(gameId, gameState);
    logger.info(`Active player changed to ${gameState.activePlayerId || 'none'} in game ${gameId}`);
  } catch (error) {
    logger.error('Failed to toggle active player:', error);
  }
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

    if (numericPhaseIndex < 0 || numericPhaseIndex >= 4) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid phase index. Must be between 0 and 3'
      }));
      return;
    }

    gameState.currentPhase = numericPhaseIndex;
    broadcastToGame(gameId, gameState);
    logger.info(`Phase set to ${numericPhaseIndex} in game ${gameId}`);
  } catch (error) {
    logger.error('Failed to set phase:', error);
  }
}
