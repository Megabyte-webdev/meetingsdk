import { useCallback, useEffect, useRef, useState } from "react";
import { useMeetingContext } from "./MeetingProvider";
import { Participant } from "../types/meeting";

export const useLocalParticipant = () => {
  const { sdk } = useMeetingContext();

  // Guard the initial state to ensure it matches Participant | null
  const [localParticipant, setLocalParticipant] = useState<Participant | null>(
    () => {
      const current = sdk.state.localParticipant;
      return current && current.id ? (current as Participant) : null;
    },
  );

  useEffect(() => {
    const unsubscribe = sdk.state.subscribe("localParticipant", () => {
      const current = sdk.state.localParticipant;

      // Safe Type-Guard: Only update if the object has a finalized id
      if (current && current.id) {
        setLocalParticipant({ ...current } as Participant);
      } else {
        setLocalParticipant(null);
      }
    });

    return unsubscribe;
  }, [sdk]);

  const lastStreamRef = useRef<MediaStream | null>(null);

  const videoRef = useCallback(
    (video: HTMLVideoElement | null) => {
      if (!video) return;

      const stream = localParticipant?.media?.stream;
      if (!stream) return;

      if (lastStreamRef.current === stream) return;
      lastStreamRef.current = stream;

      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;

      video.play().catch((err) => {
        console.warn(`Autoplay failed for local view:`, err);
      });
    },
    [localParticipant?.media?.stream],
  );

  return {
    participant: localParticipant,
    videoRef,
  };
};
