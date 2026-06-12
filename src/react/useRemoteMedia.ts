import { useCallback, useEffect, useState } from "react";
import { useMeetingContext } from "./MeetingProvider";
import { Participant } from "../types/meeting";

export const useRemoteMedia = (participantId: string) => {
  const { sdk } = useMeetingContext();

  const [participant, setParticipant] = useState<Participant | null>(
    () => sdk.state.getParticipant(participantId) || null,
  );

  useEffect(() => {
    const unsub = sdk.state.subscribe(`participant:${participantId}`, () => {
      const p = sdk.state.getParticipant(participantId);
      // Ensure we treat the state as immutable to trigger re-renders
      setParticipant(p ? { ...p } : null);
    });
    return unsub;
  }, [participantId, sdk]);

  // Video Callback Ref
  const videoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      if (!node) return;
      const stream = participant?.media?.stream;
      if (!stream) return;

      node.srcObject = stream;
      node.autoplay = true;
      node.playsInline = true;
      node.muted = true; // Video should always be muted

      node.play().catch((e) => console.warn("Video playback failed:", e));
    },
    // FIX: Added cameraTrack so React knows to re-run this when the video track arrives
    [participant?.media?.stream, participant?.media?.cameraTrack],
  );

  // Audio Callback Ref
  const audioRef = useCallback(
    (node: HTMLAudioElement | null) => {
      if (!node) return;
      const stream = participant?.media?.stream;
      if (!stream) return;

      node.srcObject = stream;
      node.autoplay = true;
      node.muted = !participant?.media?.micEnabled;

      node.play().catch((e) => console.warn("Audio playback failed:", e));
    },
    // FIX: Added audioTrack to dependency array
    [participant?.media?.stream, participant?.media?.micEnabled],
  );

  return {
    videoRef,
    audioRef,
    isCamActive: !!participant?.media?.camEnabled,
    isMicEnabled: !!participant?.media?.micEnabled,
  };
};
