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
};

export function useMeetingPreview(roomId: string, userId: string) {
  const [room, setRoom] = useState<LiveRoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!roomId || !userId) {
      setIsLoading(false);
      return;
    }

    let ws: WebSocket | null = null;

    const heartbeat = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "PING",
          }),
        );
      }
    }, 20000);

    ws = new WebSocket(`${SDK_CONFIG.wsUrl}/watch/${roomId}?user_id=${userId}`);

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);
      console.log("[Preview] watcher connected");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== "ROOM_PRESENCE_UPDATE") {
          return;
        }
        setRoom({
          active: msg.active ?? false,
          count: msg.count ?? 0,
          canJoin: msg.canJoin ?? false,
          approved: msg.approved ?? false,
          isHost: msg.isHost ?? false,
          hasMoreParticipants: msg.hasMoreParticipants ?? false,
          participants: msg.participants ?? [],
        });
        // first valid room payload received
        setIsLoading(false);
      } catch (err) {
        console.error("Invalid room presence payload", err);
        setIsLoading(false);
      }
    };
    ws.onerror = () => {
      setError("Failed to connect to room monitor");
      setIsLoading(false);
    };
    ws.onclose = () => {
      setIsConnected(false);
      console.log("[Preview] disconnected");
    };
    return () => {
      clearInterval(heartbeat);
      if (ws) {
        ws.close(1000, "Leaving preview");
      }
    };
  }, [roomId, userId]);

  return {
    room,
    isConnected,
    isLoading,
    error,
  };
}
