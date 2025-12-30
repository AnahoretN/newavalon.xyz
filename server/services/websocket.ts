/**
 * @file WebSocket service for real-time game communication
 */

import { logger } from '../utils/logger.js';
import { validateMessageSize } from '../utils/security.js';
import { isRateLimited, cleanupRateLimitData } from './rateLimit.js';
import {
  getGameState,
  updateGameState,
  removeClientAssociation,
  getGameIdForClient,
  logGameAction,
  getClientGameMap,
  getPublicGames,
  deleteGameState
} from './gameState.js';
import { generatePlayerToken } from '../utils/deckUtils.js';

// Store wss instance for broadcasting
let wssInstance = null;

// Import handler modules
import {
  handleSubscribe,
  handleUpdateState,
  handleJoinGame,
  handleExitGame,
  handleForceSync
} from '../handlers/gameManagement.js';
import {
  handleStartReadyCheck,
  handleCancelReadyCheck,
  handlePlayerReady
} from '../handlers/readyCheck.js';
import {
  handleSetGameMode,
  handleSetGamePrivacy,
  handleAssignTeams,
  handleSetGridSize
} from '../handlers/gameSettings.js';
import {
  handleTriggerHighlight,
  handleTriggerNoTarget,
  handleTriggerFloatingText,
  handleTriggerFloatingTextBatch
} from '../handlers/visualEffects.js';
import {
  handleUpdateDeckData
} from '../handlers/deckData.js';
import {
  handleUpdatePlayerName,
  handleChangePlayerColor,
  handleUpdatePlayerScore,
  handleChangePlayerDeck,
  handleLoadCustomDeck,
  handleSetDummyPlayerCount,
  handleLogGameAction,
  handleGetGameLogs
} from '../handlers/playerSettings.js';
import {
  handleToggleAutoAbilities,
  handleToggleAutoDraw,
  handleToggleActivePlayer,
  handleNextPhase,
  handlePrevPhase,
  handleSetPhase
} from '../handlers/phaseManagement.js';

/**
 * Setup WebSocket server
 */
export function setupWebSocket(wss) {
  // Store wss instance for broadcasting
  wssInstance = wss;

  wss.on('connection', (ws) => {
    logger.info('New WebSocket connection established');

    // Handle connection close
    ws.on('close', () => {
      handleDisconnection(ws);
    });

    // Handle incoming messages
    ws.on('message', (message) => {
      handleWebSocketMessage(ws, message);
    });

    // Handle connection errors
    ws.on('error', (error) => {
      logger.error('WebSocket error:', error);
      cleanupRateLimitData(ws);
    });

    // Send initial connection confirmation
    ws.send(JSON.stringify({
      type: 'CONNECTION_ESTABLISHED',
      timestamp: Date.now()
    }));
  });

  logger.info('WebSocket server initialized');
}

/**
 * Handle WebSocket messages
 */
function handleWebSocketMessage(ws, message) {
  try {
    // Validate message size
    if (!validateMessageSize(message)) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Message too large'
      }));
      return;
    }

    // Rate limiting check
    if (isRateLimited(ws)) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Rate limit exceeded'
      }));
      return;
    }

    // Parse message
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Invalid JSON'
      }));
      return;
    }

    // Validate message structure
    if (!data.type) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Missing message type'
      }));
      return;
    }

    logger.debug(`Received message type: ${data.type}`);

    // Route message to appropriate handler
    routeMessage(ws, data);

  } catch (error) {
    logger.error('Error handling WebSocket message:', error);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Internal server error'
    }));
  }
}

/**
 * Route message to appropriate handler
 */
function routeMessage(ws, data) {
  const handlers = {
    'SUBSCRIBE': handleSubscribe,
    'CREATE_GAME': handleCreateGame,
    'JOIN_GAME': handleJoinGame,
    'PLAY_CARD': handlePlayCard,
    'MOVE_CARD': handleMoveCard,
    'END_TURN': handleEndTurn,
    'CHAT_MESSAGE': handleChatMessage,
    'GET_GAMES_LIST': handleGetGamesList,
    'UPDATE_DECK_DATA': handleUpdateDeckData,
    'UPDATE_STATE': handleUpdateState,
    'PLAYER_READY': handlePlayerReady,
    'ASSIGN_TEAMS': handleAssignTeams,
    'SET_GAME_MODE': handleSetGameMode,
    'SET_GAME_PRIVACY': handleSetGamePrivacy,
    'SET_GRID_SIZE': handleSetGridSize,
    'DRAW_CARD': handleDrawCard,
    'SHUFFLE_DECK': handleShuffleDeck,
    'ANNOUNCE_CARD': handleAnnounceCard,
    'PLAY_COUNTER': handlePlayCounter,
    'PLAY_TOKEN': handlePlayToken,
    'DESTROY_CARD': handleDestroyCard,
    'RETURN_CARD_TO_HAND': handleReturnCardToHand,
    'ADD_COMMAND': handleAddCommand,
    'CANCEL_PENDING_COMMAND': handleCancelPendingCommand,
    'EXECUTE_PENDING_COMMAND': handleExecutePendingCommand,
    'START_READY_CHECK': handleStartReadyCheck,
    'CANCEL_READY_CHECK': handleCancelReadyCheck,
    'TRIGGER_HIGHLIGHT': handleTriggerHighlight,
    'TRIGGER_FLOATING_TEXT': handleTriggerFloatingText,
    'TRIGGER_FLOATING_TEXT_BATCH': handleTriggerFloatingTextBatch,
    'TRIGGER_NO_TARGET': handleTriggerNoTarget,
    'EXIT_GAME': handleExitGame,
    'FORCE_SYNC': handleForceSync,
    'SYNC_GAME': handleSyncGame,
    'TOGGLE_AUTO_ABILITIES': handleToggleAutoAbilities,
    'TOGGLE_AUTO_DRAW': handleToggleAutoDraw,
    'TOGGLE_ACTIVE_PLAYER': handleToggleActivePlayer,
    'NEXT_PHASE': handleNextPhase,
    'PREV_PHASE': handlePrevPhase,
    'SET_PHASE': handleSetPhase,
    'SET_DUMMY_PLAYER_COUNT': handleSetDummyPlayerCount,
    'UPDATE_PLAYER_NAME': handleUpdatePlayerName,
    'CHANGE_PLAYER_COLOR': handleChangePlayerColor,
    'UPDATE_PLAYER_SCORE': handleUpdatePlayerScore,
    'CHANGE_PLAYER_DECK': handleChangePlayerDeck,
    'LOAD_CUSTOM_DECK': handleLoadCustomDeck,
    'LOG_GAME_ACTION': handleLogGameAction,
    'GET_GAME_LOGS': handleGetGameLogs
  };

  const handler = handlers[data.type];
  if (handler) {
    handler(ws, data);
  } else {
    logger.warn(`Unknown message type: ${data.type}`);
    ws.send(JSON.stringify({
      type: 'ERROR',
      message: 'Unknown message type'
    }));
  }
}

/**
 * Handle client disconnection
 */
function handleDisconnection(ws) {
  try {
    const gameId = getGameIdForClient(ws);

    if (gameId) {
      const gameState = getGameState(gameId);
      if (gameState) {
        // Find the player and handle disconnection (use playerId for reliability)
        const player = gameState.players.find(p => p.id === ws.playerId);
        if (player) {
          logGameAction(gameId, `Player ${player.name} disconnected`);

          // Generate playerToken if not already set (for reconnection)
          const playerToken = player.playerToken || generatePlayerToken();

          // Always mark player as disconnected (whether game started or not)
          // This allows reconnection with the same player slot
          updateGameState(gameId, {
            players: gameState.players.map(p =>
              p.id === ws.playerId
                ? {
                    ...p,
                    isDisconnected: true,
                    ws: null,
                    playerToken,
                    // Only convert to dummy if game is active
                    ...(gameState.isGameStarted && { isDummy: true })
                  }
                : p
            )
          });
        } else {
          logger.warn(`Player with ws.playerId ${ws.playerId} not found in game ${gameId}`);
        }

        // Broadcast updated state to remaining players
        // Get fresh state after any updates
        const updatedState = getGameState(gameId);
        if (updatedState) {
          broadcastToGame(gameId, updatedState, ws);
        }
      }
    }

    // Clean up rate limiting data
    cleanupRateLimitData(ws);

    // Remove client association
    removeClientAssociation(ws);

    logger.info('Client disconnected');
  } catch (error) {
    logger.error('Error handling disconnection:', error);
  }
}

/**
 * Broadcast game state to all clients in a game
 */
export function broadcastToGame(gameId, gameState, excludeClient = null) {
  try {
    const sanitizedGameState = sanitizeGameState(gameState);
    const message = JSON.stringify(sanitizedGameState);

    // Get the client game map to find all clients associated with this game
    const clientGameMap = getClientGameMap();

    // Send to all connected clients associated with this game
    if (wssInstance && wssInstance.clients) {
      wssInstance.clients.forEach(client => {
        if (client !== excludeClient &&
            client.readyState === 1 && // WebSocket.OPEN
            clientGameMap.get(client) === gameId) {
          try {
            client.send(message);
          } catch (error) {
            logger.error('Error sending to client:', error);
          }
        }
      });
    }

  } catch (error) {
    logger.error('Error broadcasting to game:', error);
  }
}

/**
 * Send message to specific client
 */
export function sendToClient(client, message) {
  if (client && client.readyState === 1) {
    try {
      client.send(JSON.stringify(message));
    } catch (error) {
      logger.error('Error sending to client:', error);
    }
  }
}

/**
 * Sanitize game state for client transmission
 */
function sanitizeGameState(gameState) {
  return {
    ...gameState,
    players: gameState.players.map(player => ({
      ...player,
      ws: undefined // Remove WebSocket references
    }))
  };
}

// ============================================================================
// Placeholder handlers for functionality not yet implemented
// These are primarily client-side actions that use UPDATE_STATE
// ============================================================================

// Get games list handler
function handleGetGamesList(ws) {
  const publicGames = getPublicGames();
  sendToClient(ws, { type: 'GAMES_LIST', games: publicGames });
}

// Sync game handler
function handleSyncGame(ws) {
  const gameId = getGameIdForClient(ws);
  if (gameId) {
    const gameState = getGameState(gameId);
    if (gameState) {
      sendToClient(ws, gameState);
    }
  }
}

// Card action handlers - primarily client-side, logged here for tracking
function handleCreateGame() {
  logger.info('CREATE_GAME - handled via UPDATE_STATE');
}

function handlePlayCard() {
  logger.info('PLAY_CARD - handled via UPDATE_STATE');
}

function handleMoveCard() {
  logger.info('MOVE_CARD - handled via UPDATE_STATE');
}

function handleEndTurn() {
  logger.info('END_TURN - handled via UPDATE_STATE');
}

function handleChatMessage() {
  logger.info('CHAT_MESSAGE not yet implemented');
}

function handleDrawCard() {
  logger.info('DRAW_CARD - handled via UPDATE_STATE');
}

function handleShuffleDeck() {
  logger.info('SHUFFLE_DECK - handled via UPDATE_STATE');
}

function handleAnnounceCard() {
  logger.info('ANNOUNCE_CARD - handled via UPDATE_STATE');
}

function handlePlayCounter() {
  logger.info('PLAY_COUNTER - handled via UPDATE_STATE');
}

function handlePlayToken() {
  logger.info('PLAY_TOKEN - handled via UPDATE_STATE');
}

function handleDestroyCard() {
  logger.info('DESTROY_CARD - handled via UPDATE_STATE');
}

function handleReturnCardToHand() {
  logger.info('RETURN_CARD_TO_HAND - handled via UPDATE_STATE');
}

function handleAddCommand() {
  logger.info('ADD_COMMAND - handled via UPDATE_STATE');
}

function handleCancelPendingCommand() {
  logger.info('CANCEL_PENDING_COMMAND - handled via UPDATE_STATE');
}

function handleExecutePendingCommand() {
  logger.info('EXECUTE_PENDING_COMMAND - handled via UPDATE_STATE');
}
