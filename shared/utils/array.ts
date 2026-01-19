/**
 * @file Shared utility functions without Node.js dependencies
 * These can be safely used by both client and server
 */

/**
 * Shuffles an array using the Fisher-Yates algorithm
 */
export function shuffleDeck<T>(deck: T[]): T[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
