import { useEffect, useState } from "react";
import { SDK_CONFIG } from "../config/ws";

type LiveRoomState = {
  active: boolean;
  count: number;
  canJoin: boolean;
  approved: boolean;
  isHost: boolean;
  hasMoreParticipants: boolean;
  participants: {
    id: string;
    name: string;
    isHost: boolean;
    isPresenter: boolean;
    micEnabled: boolean;
    camEnabled: boolean;
  }[];
  room?: {
    id: string;
    name: string;
    room_code: string;
    capacity: number;
    is_private: boolean;
  };
};

/**
 * Current SFU does not expose the old `/watch/:room` mesh presence socket.
 * Preview therefore uses the authoritative REST room endpoint and polls it.
 * Live participant/media state begins after JOIN over the SFU WebSocket.
 */
export function useMeetingPreview(roomId: string, userId: string) {
  const [room, setRoom] = useState<LiveRoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!roomId) {
      setIsLoading(false);
      return;
    }

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const response = await fetch(
          `${SDK_CONFIG.apiBase}/rooms/${encodeURIComponent(roomId)}`,
        );

        if (!response.ok) {
          throw new Error(`Room lookup failed (${response.status})`);
        }

        const data = await response.json();
        if (stopped) return;

        setRoom({
          active: true,
          // The current REST room model intentionally does not expose a live
          // participant count. Do not fabricate one.
          count: 0,
          canJoin: !data.is_private,
          approved: false,
          isHost: false,
          hasMoreParticipants: false,
          participants: [],
          room: {
            id: data.id,
            name: data.name,
            room_code: data.room_code,
            capacity: data.capacity,
            is_private: data.is_private,
          },
        });
        setError(null);
        setIsConnected(true);
        setIsLoading(false);
      } catch (err: any) {
        if (stopped) return;
        setError(err?.message || "Failed to load room");
        setIsConnected(false);
        setIsLoading(false);
      } finally {
        if (!stopped) {
          timer = setTimeout(load, 5000);
        }
      }
    };

    void load();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [roomId, userId]);

  return {
    room,
    isConnected,
    isLoading,
    error,
  };
}
