import { useCallback, useEffect, useRef, useState } from "react";
import { useMeetingContext } from "./MeetingProvider";
import { Participant } from "../types/meeting";

export const useRemoteVideo = (participantId: string) => {
  const { sdk } = useMeetingContext();

  const [participant, setParticipant] = useState<Participant | null>(() => {
    return sdk.state.getParticipant(participantId) || null;
  });

  useEffect(() => {
    const unsubscribe = sdk.state.subscribe(
      `participant:${participantId}`,
      () => {
        const updated = sdk.state.getParticipant(participantId);
        if (updated) {
          setParticipant({ ...updated });
        }
      },
    );
    return unsubscribe;
  }, [participantId, sdk]);

  const streamSource = participant?.media?.stream;
  const trackSource = participant?.media?.cameraTrack;

  // SAFE VALIDATION: Duck-type check properties on the prototype chain (.id / .kind)
  const hasValidVideoSource = !!(
    (streamSource &&
      (streamSource.id || streamSource instanceof MediaStream)) ||
    (trackSource &&
      (trackSource.id ||
        trackSource.kind ||
        trackSource instanceof MediaStreamTrack))
  );

  const isCamActive = !!(participant?.media?.camEnabled && hasValidVideoSource);
  const isMicEnabled = !!participant?.media?.micEnabled;

  const lastSourceRef = useRef<any>(null);

  const videoRef = useCallback(
    (videoEl: HTMLVideoElement | null) => {
      if (!videoEl || !isCamActive) return;

      const currentSource = streamSource?.id ? streamSource : trackSource;
      if (lastSourceRef.current === currentSource) return;
      lastSourceRef.current = currentSource;

      if (streamSource && streamSource.id) {
        if (videoEl.srcObject !== streamSource) {
          videoEl.srcObject = streamSource;
        }
      } else if (trackSource && trackSource.kind === "video") {
        const currentStream = videoEl.srcObject as MediaStream | null;
        const currentTrack = currentStream?.getVideoTracks()[0];

        if (!currentTrack || currentTrack.id !== trackSource.id) {
          try {
            videoEl.srcObject = new MediaStream([trackSource]);
          } catch (err) {
            console.error(
              "Seamless WebRTC track fallback binding failed:",
              err,
            );
          }
        }
      }

      videoEl.play().catch((err) => {
        console.warn(`Autoplay interrupted for peer ${participantId}:`, err);
      });
    },
    [streamSource, trackSource, isCamActive, participantId],
  );

  return { videoRef, isCamActive, isMicEnabled };
};
