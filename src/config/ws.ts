/**
 * SDK Configuration for WebSocket and SFU connections
 * Updated to support the new Selective Forwarding Unit (SFU) architecture
 */

export interface SDKConfig {
  // Legacy WebSocket URL (kept for backward compatibility)
  wsUrl?: string;

  // SFU API base URL (for token generation)
  apiBase: string;

  // SFU WebSocket base URL
  wsBase: string;

  // ICE servers for WebRTC connections
  iceServers?: RTCIceServer[];

  // Connection timeout in milliseconds
  connectionTimeout?: number;

  // Maximum reconnection attempts
  maxReconnectAttempts?: number;
}

// Default configuration - update these with your SFU server addresses
export const SDK_CONFIG: SDKConfig = {
  // SFU API endpoint for token generation
  apiBase: "https://sfu-server.duckdns.org/api",

  // SFU WebSocket endpoint for signaling
  wsBase: "wss://sfu-server.duckdns.org/ws",

  // Public STUN/TURN servers (fallback)
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302"] },
    { urls: ["stun:stun1.l.google.com:19302"] },
  ],

  // Connection and reconnection settings
  connectionTimeout: 10000,
  maxReconnectAttempts: 5,

  // Legacy WebSocket URL (if using the old mesh architecture)
  wsUrl: "wss://sfu-server.duckdns.org/ws", // kept for backward compatibility
};

/**
 * Helper function to validate SFU configuration
 * Call this during app initialization to ensure configuration is valid
 */
export function validateSFUConfig(config: SDKConfig): string[] {
  const errors: string[] = [];

  if (!config.apiBase) {
    errors.push("SFU API base URL is not configured (apiBase)");
  } else if (!config.apiBase.startsWith("http")) {
    errors.push("SFU API base URL must start with http or https");
  }

  if (!config.wsBase) {
    errors.push("SFU WebSocket base URL is not configured (wsBase)");
  } else if (!config.wsBase.startsWith("ws")) {
    errors.push("SFU WebSocket base URL must start with ws or wss");
  }

  return errors;
}

export function updateSDKConfig(updates: Partial<SDKConfig>) {
  Object.assign(SDK_CONFIG, updates);
  const errors = validateSFUConfig(SDK_CONFIG);
  if (errors.length > 0) {
    console.warn("SDK Configuration warnings:", errors);
  }
}
