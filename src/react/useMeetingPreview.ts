import { useCallback, useEffect, useState } from "react";
import { SDK_CONFIG } from "../config/ws";

type LiveRoomState = {
  active: boolean;
  count: number;
  canJoin: boolean;
  approved: boolean;
  isHost: boolean;
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (!roomId || !userId) return;

    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch(
        `${SDK_CONFIG.baseUrl}/api/rooms/${roomId}/live?user_id=${userId}`,
      );

      if (!res.ok) {
        throw new Error("Failed to fetch meeting preview");
      }

      const data = await res.json();

      setRoom(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setIsLoading(false);
    }
  }, [roomId, userId]);

  useEffect(() => {
    load();

    const interval = setInterval(load, 5000);

    return () => clearInterval(interval);
  }, [load]);

  return {
    room,
    isLoading,
    error,
    refetch: load,
  };
}
