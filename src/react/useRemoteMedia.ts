import { useCallback, useEffect, useRef, useState } from "react";
import { useMeetingContext } from "./MeetingProvider";
import { Participant } from "../types/meeting";

export const useRemoteMedia = (participantId: string) => {
  const { sdk } = useMeetingContext();

  const [participant, setParticipant] = useState<Participant | null>(
    () => sdk.state.getParticipant(participantId) || null,
  );

  useEffect(() => {
    return sdk.state.subscribe(`participant:${participantId}`, () => {
      const updated = sdk.state.getParticipant(participantId);
      if (updated) setParticipant({ ...updated });
    });
  }, [participantId, sdk]);

  const stream = participant?.media?.stream;
  const track = participant?.media?.cameraTrack;

  const hasVideo = !!(stream || (track && track.kind === "video"));

  const isCamActive = !!(participant?.media?.camEnabled && hasVideo);
  const isMicEnabled = !!participant?.media?.micEnabled;

  const lastRef = useRef<any>(null);

  const videoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      if (!el || !isCamActive) return;

      const source = stream || (track ? new MediaStream([track]) : null);
      if (!source) return;

      if (lastRef.current === source) return;
      lastRef.current = source;

      if (el.srcObject !== source) {
        el.srcObject = source;
      }

      el.play().catch(() => {});
    },
    [stream, track, isCamActive],
  );

  // ---------------- AUDIO (hidden but crucial) ----------------
  const audioRef = useCallback(
    (el: HTMLAudioElement | null) => {
      if (!el || !stream) return;

      if (el.srcObject !== stream) {
        el.srcObject = stream;
        el.autoplay = true;
      }

      el.muted = false;

      el.play().catch(() => {});
    },
    [stream],
  );

  return {
    videoRef,
    audioRef,
    isCamActive,
    isMicEnabled,
  };
};
