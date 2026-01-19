/**
 * @file Deck utilities
 * Handles deck creation, shuffling, and card initialization
 */

import { getDeckFiles, getCardDefinition } from '../services/content.js';
import { PLAYER_COLORS } from '../constants/playerColors.js';
import { shuffleDeck } from '../../shared/utils/array.js';

// Re-export for backward compatibility
export { shuffleDeck };

// Command card IDs that get special treatment
export const COMMAND_CARD_IDS = new Set([
  'overwatch',
  'repositioning',
  'tacticalManeuver',
  'mobilization',
  'inspiration',
  'dataInterception',
  'falseOrders',
  'experimentalStimulants',
  'logisticsChain',
  'quickResponseTeam',
  'temporaryShelter',
  'enhancedInterrogation',
]);

/**
 * Generates a unique player token for reconnection
 */
export function generatePlayerToken(): string {
  return Math.random().toString(36).substring(2, 18) + Date.now().toString(36);
}

/**
 * Creates a new, shuffled deck for a player, assigning ownership to each card
 * @param deckType - The type of deck to create (e.g., 'SynchroTech')
 * @param playerId - The ID of the player who will own the deck
 * @param playerName - The name of the player
 * @returns The created deck of cards
 */
export function createDeck(deckType: string, playerId: number, playerName: string): any[] {
  const deckFiles = getDeckFiles();
  const deckFile = deckFiles.find(df => df.id === deckType);

  if (!deckFile) {
    console.error(`Invalid deckType requested: ${deckType}`);
    return [];
  }

  const deckList = [];

  for (const deckEntry of deckFile.cards) {
    const cardDef = getCardDefinition(deckEntry.cardId);
    if (!cardDef) {
      console.warn(`Card definition not found for ID: ${deckEntry.cardId} in deck: ${deckFile.name}`);
      continue;
    }

    const isCommandCard = COMMAND_CARD_IDS.has(deckEntry.cardId);

    for (let i = 0; i < deckEntry.quantity; i++) {
      const cardKey = deckEntry.cardId.toUpperCase().replace(/-/g, '_');
      let card;

      if (isCommandCard) {
        card = {
          ...cardDef,
          deck: 'Command',
          id: `CMD_${cardKey}_${i + 1}`,
          baseId: deckEntry.cardId,
          ownerId: playerId,
          ownerName: playerName,
        };
      } else {
        card = {
          ...cardDef,
          deck: deckFile.id,
          id: `${deckFile.id.substring(0, 3).toUpperCase()}_${cardKey}_${i + 1}`,
          baseId: deckEntry.cardId,
          ownerId: playerId,
          ownerName: playerName,
        };
      }
      deckList.push(card);
    }
  }

  return shuffleDeck(deckList);
}

/**
 * Creates a new player object with a default deck and a unique session token
 * @param id - The ID for the new player
 * @param isDummy - Whether this is a dummy player
 * @returns The new player object
 */
export function createNewPlayer(id: number, isDummy = false): any {
  const deckFiles = getDeckFiles();
  const initialDeck = deckFiles.find(df => df.isSelectable);

  if (!initialDeck) {
    console.error('No selectable decks found in contentDatabase.json!');
    throw new Error('Cannot create players without decks');
  }

  const initialDeckType = initialDeck.id;

  // Safe color assignment with bounds checking
  const colorIndex = (id - 1) % PLAYER_COLORS.length;
  const playerColor = PLAYER_COLORS[colorIndex] || PLAYER_COLORS[0];

  const newPlayer = {
    id,
    name: isDummy ? `Dummy ${id - 1}` : `Player ${id}`,
    score: 0,
    hand: [],
    deck: [], // Deck will be created below
    discard: [],
    selectedDeck: initialDeckType,
    color: playerColor,
    isDummy,
    isDisconnected: false,
    playerToken: generatePlayerToken(),
    isReady: false,
    boardHistory: [],
    autoDrawEnabled: true, // Auto-draw is enabled by default for all players
  };

  // Create the actual deck with cards
  newPlayer.deck = createDeck(initialDeckType, id, newPlayer.name);

  return newPlayer;
}
