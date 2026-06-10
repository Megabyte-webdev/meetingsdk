import { useCallback, useRef } from "react";
import { useMeetingContext } from "./MeetingProvider";

export const useRemoteVideo = (participantId: string) => {
  const { state } = useMeetingContext();

  const lastStreamRef = useRef<MediaStream | null>(null);

  const videoRef = useCallback(
    (video: HTMLVideoElement | null) => {
      if (!video) return;

      const participant = state.getParticipant(participantId);
      const stream = participant?.media?.stream;

      if (!stream) return;

      // Avoid reassigning same stream
      if (lastStreamRef.current === stream) return;

      lastStreamRef.current = stream;

      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;

      video.play().catch((err) => {
        console.warn(`Autoplay failed for ${participantId}`, err);
      });
    },
    [participantId, state],
  );

  return videoRef;
};
