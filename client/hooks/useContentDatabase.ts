/**
 * @file Hook for managing content database fetching from server or embedded JSON
 * For GitHub Pages (static hosting), uses embedded content from content.ts
 * For local development, can fetch from server API
 */

import { useState, useEffect, useCallback } from 'react'
import { fetchContentDatabase, cardDatabase, tokenDatabase, countersDatabase, deckFiles } from '../content'

interface ContentDatabase {
  cards: Record<string, any>
  tokens: Record<string, any>
  counters: Record<string, any>
  deckFiles: Array<{
    id: string
    name: string
    isSelectable: boolean
    cards: { cardId: string; quantity: number }[]
  }>
}

const CACHE_KEY = 'content_database_cache'
const CACHE_TIMESTAMP_KEY = 'content_database_timestamp'
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export function useContentDatabase() {
  const [content, setContent] = useState<ContentDatabase | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Check if cache is valid
  const isCacheValid = useCallback(() => {
    const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY)
    if (!timestamp) {
      return false
    }

    const now = Date.now()
    const cachedTime = parseInt(timestamp, 10)
    return now - cachedTime < CACHE_DURATION
  }, [])

  // Load from cache
  const loadFromCache = useCallback((): ContentDatabase | null => {
    if (!isCacheValid()) {
      return null
    }

    try {
      const cached = localStorage.getItem(CACHE_KEY)
      return cached ? JSON.parse(cached) : null
    } catch {
      return null
    }
  }, [isCacheValid])

  // Save to cache
  const saveToCache = useCallback((data: ContentDatabase) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data))
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString())
    } catch {
      // Ignore cache errors
    }
  }, [])

  // Load from embedded content database (for GitHub Pages)
  const loadFromEmbedded = useCallback((): ContentDatabase => {
    // Convert Maps to objects for serialization
    const cardsObj = Object.fromEntries(cardDatabase)
    const tokensObj = Object.fromEntries(tokenDatabase)

    return {
      cards: cardsObj,
      tokens: tokensObj,
      counters: countersDatabase,
      deckFiles: deckFiles
    }
  }, [])

  // Fetch content from server or use embedded
  const fetchContent = useCallback(async (forceRefresh = false) => {
    try {
      // Try cache first (unless force refresh)
      if (!forceRefresh) {
        const cached = loadFromCache()
        if (cached) {
          setContent(cached)
          setError(null)
          setIsLoading(false)
          return
        }
      }

      setIsLoading(true)
      setError(null)

      // Try to fetch from server API first (for local development)
      try {
        const response = await fetch('/api/content/database')
        if (response.ok) {
          const data: ContentDatabase = await response.json()
          setContent(data)
          saveToCache(data)
          setIsLoading(false)
          return
        }
      } catch {
        // Server fetch failed - this is expected on GitHub Pages
      }

      // Use embedded content database as fallback
      await fetchContentDatabase()
      const embeddedData = loadFromEmbedded()
      setContent(embeddedData)
      saveToCache(embeddedData)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load content'
      setError(errorMessage)
      console.error('Content fetch error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [loadFromCache, saveToCache, loadFromEmbedded])

  // Initialize content on mount
  useEffect(() => {
    fetchContent()
  }, [fetchContent])

  return {
    content,
    isLoading,
    error,
    refetch: () => fetchContent(true), // Force refresh
  }
}
