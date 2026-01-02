import React from 'react'

interface ReconnectingOverlayProps {
  isVisible: boolean
  connectionStatus: string
}

export const ReconnectingOverlay: React.FC<ReconnectingOverlayProps> = ({ isVisible, connectionStatus }) => {
  if (!isVisible) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-gray-900/90 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-6 text-center px-8">
        {/* Animated spinner */}
        <div className="relative w-20 h-20">
          <div className="absolute inset-0 border-4 border-gray-600 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-t-blue-500 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"></div>
        </div>

        {/* Status text */}
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-white">
            {connectionStatus === 'Connecting' ? 'Connecting...' : 'Reconnecting...'}
          </h2>
          <p className="text-gray-300">
            {connectionStatus === 'Connecting'
              ? 'Establishing connection to server...'
              : 'Connection lost. Attempting to restore your game session...'}
          </p>
        </div>

        {/* Pulsing indicator */}
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
          </span>
          <span className="text-sm text-gray-400">Please wait</span>
        </div>
      </div>
    </div>
  )
}
