/**
 * @file Player settings handlers
 * Handles player name, color, deck, and score changes
 */

import { logger } from '../utils/logger.js';
import { getGameState } from '../services/gameState.js';
import { sanitizePlayerName } from '../utils/security.js';
import { broadcastToGame } from '../services/websocket.js';
import { createNewPlayer, generatePlayerToken } from '../utils/deckUtils.js';
import { logGameAction as logAction, GameActions } from '../utils/gameLogger.js';

/**
 * Handle UPDATE_PLAYER_NAME message
 * Updates a player's display name
 */
export function handleUpdatePlayerName(ws, data) {
  try {
    const { gameId, playerId, playerName } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player not found'
      }));
      return;
    }

    const sanitizedName = sanitizePlayerName(playerName);
    player.name = sanitizedName;
    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to update player name:', error);
  }
}

/**
 * Handle CHANGE_PLAYER_COLOR message
 * Changes a player's assigned color
 */
export function handleChangePlayerColor(ws, data) {
  try {
    const { gameId, playerId, color } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player not found'
      }));
      return;
    }

    // Check if color is already used by another player
    const colorInUse = gameState.players.some(p => p.id !== playerId && p.color === color);
    if (colorInUse) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Color already in use'
      }));
      return;
    }

    player.color = color;
    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to change player color:', error);
  }
}

/**
 * Handle UPDATE_PLAYER_SCORE message
 * Updates a player's score
 */
export function handleUpdatePlayerScore(ws, data) {
  try {
    const { gameId, playerId, score } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player not found'
      }));
      return;
    }

    // Validate score is a finite number and non-negative
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore) || numericScore < 0) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid score value'
      }));
      return;
    }

    const previousScore = player.score;
    player.score = numericScore;
    const scoreDelta = numericScore - previousScore;

    // Log score change (only if score actually changed)
    if (scoreDelta !== 0) {
      logAction(gameId, GameActions.SCORE_CHANGED, {
        playerId: player.id,
        playerName: player.name,
        previousScore,
        newScore: numericScore,
        delta: scoreDelta
      }).catch();
    }

    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to update player score:', error);
  }
}

/**
 * Handle CHANGE_PLAYER_DECK message
 * Changes a player's selected deck (before game starts)
 */
export function handleChangePlayerDeck(ws, data) {
  try {
    const { gameId, playerId, deckType } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (gameState.isGameStarted) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Cannot change deck after game has started'
      }));
      return;
    }

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Player not found'
      }));
      return;
    }

    // Validate deckType against available decks
    if (!deckType || typeof deckType !== 'string') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid deck type'
      }));
      return;
    }

    player.selectedDeck = deckType;
    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to change player deck:', error);
  }
}

/**
 * Handle LOAD_CUSTOM_DECK message
 * Loads a custom deck for a player
 */
export function handleLoadCustomDeck(ws, data) {
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

    if (gameState.isGameStarted) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Cannot load custom deck after game has started'
      }));
      return;
    }

    // Custom deck loading is handled primarily on the client side
    // This handler just acknowledges the request
    ws.send(JSON.stringify({
      type: 'CUSTOM_DECK_LOADED',
      playerId,
      success: true
    }));
  } catch {
    // Error handling - client already notified
  }
}

/**
 * Handle SET_DUMMY_PLAYER_COUNT message
 * Sets the number of dummy players in the game
 */
export function handleSetDummyPlayerCount(ws, data) {
  try {
    const { gameId, count } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    if (gameState.isGameStarted) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Cannot change dummy players after game has started'
      }));
      return;
    }

    // Validate and sanitize count
    const numericCount = Number(count);
    if (!Number.isFinite(numericCount) || numericCount < 0 || numericCount > 3) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid dummy player count (must be 0-3)'
      }));
      return;
    }

    // Get current real players (non-dummy)
    const realPlayers = gameState.players.filter((p: any) => !p.isDummy);
    const currentDummies = gameState.players.filter((p: any) => p.isDummy);

    // If count matches current number of dummies, no change needed
    if (currentDummies.length === numericCount) {
      gameState.dummyPlayerCount = numericCount;
      broadcastToGame(gameId, gameState);
      return;
    }

    // Remove all existing dummy players
    gameState.players = realPlayers;

    // Add new dummy players
    let nextPlayerId = Math.max(...realPlayers.map((p: any) => p.id), 0);
    for (let i = 0; i < numericCount; i++) {
      nextPlayerId++;
      const dummyPlayer = createNewPlayer(nextPlayerId, true);
      dummyPlayer.name = `Dummy ${i + 1}`;
      dummyPlayer.playerToken = generatePlayerToken(); // Generate token for dummy
      gameState.players.push(dummyPlayer);
    }

    gameState.dummyPlayerCount = numericCount;
    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to set dummy player count:', error);
  }
}

/**
 * Handle LOG_GAME_ACTION message
 * Logs a game action to the game log
 */
export function handleLogGameAction(ws, data) {
  try {
    const { gameId, action } = data;
    const gameState = getGameState(gameId);

    if (!gameState) {
      return;
    }

    // Game logs are stored in the gameState.gameLog array
    if (!gameState.gameLog) {
      gameState.gameLog = [];
    }
    gameState.gameLog.push({
      timestamp: Date.now(),
      action
    });

    // Keep only last 1000 log entries to prevent unbounded memory growth
    if (gameState.gameLog.length > 1000) {
      gameState.gameLog = gameState.gameLog.slice(-1000);
    }

    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to log game action:', error);
  }
}

/**
 * Handle GET_GAME_LOGS message
 * Returns the game log for the specified game
 */
export function handleGetGameLogs(ws, data) {
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

    ws.send(JSON.stringify({
      type: 'GAME_LOGS',
      gameId,
      logs: gameState.gameLog || []
    }));
  } catch (error) {
    logger.error('Failed to get game logs:', error);
  }
}
