import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (!roomId || !userId) return;

    const load = async () => {
      const res = await fetch(
        `${SDK_CONFIG.baseUrl}/api/rooms/${roomId}/live?user_id=${userId}`,
      );

      const data = await res.json();

      setRoom(data);
    };

    load();

    // optional polling like Google Meet preview
    const interval = setInterval(load, 5000);

    return () => clearInterval(interval);
  }, [roomId, userId]);

  return room;
}
