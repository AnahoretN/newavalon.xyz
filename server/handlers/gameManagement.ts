/**
 * @file Game management handlers
 * Handles game creation, joining, and leaving
 */

import { logger } from '../utils/logger.js';
import {
  getGameState,
  createGameState,
  associateClientWithGame,
  removeClientAssociation,
  getGameIdForClient,
  getAllGameLogs,
  updateGameState,
  logGameAction
} from '../services/gameState.js';
import { broadcastToGame } from '../services/websocket.js';
import { createNewPlayer, generatePlayerToken } from '../utils/deckUtils.js';
import {
  handlePlayerLeave,
  cancelGameTermination,
  endGame,
  resetInactivityTimer,
  playerDisconnectTimers,
  broadcastGamesList
} from '../services/gameLifecycle.js';

const MAX_PLAYERS = 4;

/**
 * Handle SUBSCRIBE message
 * Associates a client with a game and sends current state
 */
export function handleSubscribe(ws, data) {
  try {
    const gameState = getGameState(data.gameId);
    if (!gameState) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Associate this client with the game
    associateClientWithGame(ws, data.gameId);
    ws.gameId = data.gameId;

    // Send the current game state to the client
    broadcastToGame(data.gameId, gameState);

    logger.info(`Client subscribed to game ${data.gameId}`);
  } catch (error) {
    logger.error('Failed to subscribe client to game:', error);
  }
}

/**
 * Handle UPDATE_STATE message
 * Updates or creates game state from client
 */
export function handleUpdateState(ws, data) {
  try {
    // Extract gameState from the message - client sends { type: 'UPDATE_STATE', gameState: {...} }
    const { gameState: updatedGameState, playerToken } = data;

    // Validate game state object
    if (!updatedGameState || typeof updatedGameState !== 'object') {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid game state data'
      }));
      logger.warn('Invalid game state update received');
      return;
    }

    const gameIdToUpdate = updatedGameState.gameId;

    if (!gameIdToUpdate) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Missing gameId in game state'
      }));
      return;
    }

    const existingGameState = getGameState(gameIdToUpdate);
    if (existingGameState) {
      // Game exists - check if this is the host reconnecting
      let assignedPlayerId = null;

      if (playerToken) {
        // Try to find the player's slot by token
        const playerToRestore = existingGameState.players.find(
          p => p.playerToken === playerToken && p.isDisconnected
        );
        if (playerToRestore) {
          playerToRestore.isDisconnected = false;
          playerToRestore.isDummy = false;
          assignedPlayerId = playerToRestore.id;
          logger.info(`Host/Player ${assignedPlayerId} reconnected via UPDATE_STATE to game ${gameIdToUpdate}`);
        }
      }

      // If no player restored, try to assign as host if player 1 is disconnected
      if (assignedPlayerId === null) {
        const player1 = existingGameState.players.find(p => p.id === 1);
        if (player1 && player1.isDisconnected) {
          player1.isDisconnected = false;
          player1.isDummy = false;
          assignedPlayerId = 1;
          logger.info(`Player 1 restored via UPDATE_STATE to game ${gameIdToUpdate}`);
        }
      }

      // Update game state with client's state
      Object.assign(existingGameState, updatedGameState);
      associateClientWithGame(ws, gameIdToUpdate);
      ws.gameId = gameIdToUpdate;
      ws.playerId = assignedPlayerId ?? 1; // Default to host if not assigned
      broadcastToGame(gameIdToUpdate, existingGameState);
      logger.info(`State updated for game ${gameIdToUpdate}, playerId=${ws.playerId}`);
    } else {
      // Game doesn't exist, create it
      const newGameState = createGameState(gameIdToUpdate, updatedGameState);
      associateClientWithGame(ws, gameIdToUpdate);
      ws.gameId = gameIdToUpdate;
      ws.playerId = 1; // Host is always player 1 for new games
      broadcastToGame(gameIdToUpdate, newGameState);
      logger.info(`New game created: ${gameIdToUpdate}, host assigned playerId=1`);
    }
  } catch (error) {
    logger.error('Failed to update game state:', error);
  }
}

/**
 * Handle JOIN_GAME message
 * Handles player joining a game (new, reconnection, or takeover)
 */
export function handleJoinGame(ws, data) {
  try {
    const { gameId, playerToken } = data;
    logger.info(`JOIN_GAME request: gameId=${gameId}, hasToken=${!!playerToken}`);

    const gameState = getGameState(gameId);

    if (!gameState) {
      logger.warn(`Game ${gameId} not found, sending ERROR to client`);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: `Game with code ${gameId} not found.`
      }));
      return;
    }

    // Store the game ID on the WebSocket connection
    ws.gameId = gameId;
    associateClientWithGame(ws, gameId);

    // --- 1. Reconnection Logic (must be checked BEFORE isGameStarted) ---
    // Players with a valid playerToken can always reconnect, even if game started
    // This handles F5 refresh, temporary network issues, and tab reopening
    if (playerToken) {
      const playerToReconnect = gameState.players.find(
        p => p.playerToken === playerToken
      );
      if (playerToReconnect) {
        // Always allow reconnection with valid token
        playerToReconnect.isDisconnected = false;
        playerToReconnect.isDummy = false; // Restore as real player
        ws.playerId = playerToReconnect.id;

        // Cancel any game termination timer
        cancelGameTermination(gameId, getAllGameLogs());

        // Clear pending dummy conversion timer
        const timerKey = `${gameId}-${playerToReconnect.id}`;
        if (playerDisconnectTimers.has(timerKey)) {
          clearTimeout(playerDisconnectTimers.get(timerKey));
          playerDisconnectTimers.delete(timerKey);
        }

        ws.send(JSON.stringify({
          type: 'JOIN_SUCCESS',
          playerId: playerToReconnect.id,
          playerToken: playerToReconnect.playerToken
        }));
        logger.info(`Player ${playerToReconnect.id} (${playerToReconnect.name}) reconnected to game ${gameId}`);
        broadcastToGame(gameId, gameState);
        return;
      }
    }

    // Check if game has already started (only for NEW joins without valid token)
    if (gameState.isGameStarted) {
      logger.warn(`Game ${gameId} has already started, sending ERROR to client`);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'This game has already started.'
      }));
      return;
    }

    // --- 2. Takeover "Ghost" Player Slot ---
    const playerToTakeOver = gameState.players.find(p => p.isDisconnected);
    if (playerToTakeOver) {
      playerToTakeOver.isDisconnected = false;
      playerToTakeOver.name = `Player ${playerToTakeOver.id}`;
      playerToTakeOver.playerToken = generatePlayerToken();

      // Cancel any game termination timer
      cancelGameTermination(gameId, getAllGameLogs());

      // Clear pending dummy conversion timer for the slot being taken over
      const timerKey = `${gameId}-${playerToTakeOver.id}`;
      if (playerDisconnectTimers.has(timerKey)) {
        clearTimeout(playerDisconnectTimers.get(timerKey));
        playerDisconnectTimers.delete(timerKey);
      }

      ws.playerId = playerToTakeOver.id;
      ws.send(JSON.stringify({
        type: 'JOIN_SUCCESS',
        playerId: playerToTakeOver.id,
        playerToken: playerToTakeOver.playerToken
      }));
      logger.info(`New player took over slot ${playerToTakeOver.id} in game ${gameId}`);
      broadcastToGame(gameId, gameState);
      return;
    }

    // --- 3. Join as New Player if Space Available ---
    const activePlayers = gameState.players.filter(p => !p.isDummy && !p.isDisconnected);
    const dummyPlayers = gameState.players.filter(p => p.isDummy);

    if (activePlayers.length + dummyPlayers.length >= MAX_PLAYERS) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game is full'
      }));
      return;
    }

    // Find the next available player ID
    const existingIds = new Set(gameState.players.map(p => p.id));
    let newPlayerId = 1;
    while (existingIds.has(newPlayerId)) {
      newPlayerId++;
    }

    // Create new player with full deck using createNewPlayer from deckUtils
    const newPlayer = createNewPlayer(newPlayerId);
    gameState.players.push(newPlayer);
    gameState.players.sort((a, b) => a.id - b.id);

    ws.playerId = newPlayerId;
    ws.send(JSON.stringify({
      type: 'JOIN_SUCCESS',
      playerId: newPlayerId,
      playerToken: newPlayer.playerToken
    }));
    logger.info(`Player ${newPlayerId} (${newPlayer.name}) joined game ${gameId}`);
    broadcastToGame(gameId, gameState);
  } catch (error) {
    logger.error('Failed to join game:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Failed to join game'
    }));
  }
}

/**
 * Handle EXIT_GAME message
 * Removes a player from the game
 */
export async function handleExitGame(ws, data) {
  try {
    const gameId = getGameIdForClient(ws);
    if (!gameId) {
      return;
    }

    const gameState = getGameState(gameId);
    if (!gameState) {
      return;
    }

    const playerId = data.playerId || ws.playerId;
    if (!playerId) {
      return;
    }

    // Check if this is the last active player
    const activePlayers = gameState.players.filter(p => !p.isDummy && !p.isDisconnected);
    const isLeavingPlayerActive = activePlayers.some(p => p.id === playerId);

    if (isLeavingPlayerActive && activePlayers.length === 1) {
      // This was the last active human player - end the game immediately
      const gameLogs = getAllGameLogs();
      await endGame(gameId, 'last player left', gameLogs, ws.server?.clients?.wss);
      logger.info(`Player ${playerId} exited - was last active player, ending game ${gameId}`);
    } else {
      // Other active players remain, mark as disconnected
      // Pass TRUE for manual exit to prevent dummy conversion timer
      handlePlayerLeave(
        gameId,
        playerId,
        true, // isManualExit - prevents dummy conversion timer
        getAllGameLogs(),
        ws.server?.clients?.wss,
        broadcastToGame,
        () => broadcastGamesList(getAllGameLogs(), ws.server?.clients?.wss)
      );
      logger.info(`Player ${playerId} manually exited game ${gameId}`);
    }

    removeClientAssociation(ws);
  } catch (error) {
    logger.error('Failed to exit game:', error);
  }
}

/**
 * Handle FORCE_SYNC message
 * Host-only command to force sync game state to all clients
 */
export function handleForceSync(ws, data) {
  try {
    const { gameState: hostGameState } = data;
    const gameIdToSync = hostGameState ? hostGameState.gameId : null;

    if (!gameIdToSync || !getGameState(gameIdToSync)) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Game not found'
      }));
      return;
    }

    // Only the host (player 1) can force a sync
    if (ws.playerId !== 1) {
      logger.warn(`Non-host player ${ws.playerId} attempted to force sync game ${gameIdToSync}`);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Unauthorized: Only host can force sync'
      }));
      return;
    }

    // Reset inactivity timer
    resetInactivityTimer(gameIdToSync, getAllGameLogs(), ws.server?.clients?.wss);

    // Update game state
    updateGameState(gameIdToSync, hostGameState);
    logGameAction(gameIdToSync, `Host (Player 1) forced a game state synchronization.`);

    logger.info(`Host forcing sync for game ${gameIdToSync}`);

    // Broadcast to ALL clients, including the host to confirm
    broadcastToGame(gameIdToSync, hostGameState);
  } catch (error) {
    logger.error('Failed to force sync:', error);
  }
}
