import { useCallback, useEffect, useState } from "react";
import { useMeetingContext } from "./MeetingProvider";
import { Participant } from "../types/meeting";

export const useRemoteMedia = (participantId: string) => {
  const { sdk } = useMeetingContext();

  const [participant, setParticipant] = useState<Participant | null>(() => {
    return sdk.state.getParticipant(participantId) || null;
  });

  useEffect(() => {
    return sdk.state.subscribe(`participant:${participantId}`, () => {
      const updated = sdk.state.getParticipant(participantId);
      if (updated) setParticipant({ ...updated });
    });
  }, [participantId, sdk]);

  const stream = participant?.media?.stream;
  const videoTrack = participant?.media?.cameraTrack;
  const audioTrack = participant?.media?.audioTrack;

  const isCamActive = !!participant?.media?.camEnabled;
  const isMicEnabled = !!participant?.media?.micEnabled;

  // ---------------- VIDEO ----------------
  const videoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      if (!el) return;

      let streamToUse: MediaStream | null = null;

      if (videoTrack && videoTrack.kind === "video") {
        if (videoTrack.readyState === "live") {
          streamToUse = new MediaStream([videoTrack]);
        }
      } else if (stream instanceof MediaStream) {
        streamToUse = stream;
      }

      if (!streamToUse) return;

      if (el.srcObject !== streamToUse) {
        el.srcObject = streamToUse;
      }

      el.play().catch(() => {});
    },
    [stream, videoTrack],
  );

  // ---------------- AUDIO ----------------
  const audioRef = useCallback(
    (el: HTMLAudioElement | null) => {
      if (!el) return;

      let audioStream: MediaStream | null = null;

      if (audioTrack && audioTrack.kind === "audio") {
        if (audioTrack.readyState === "live") {
          audioStream = new MediaStream([audioTrack]);
        }
      } else if (stream instanceof MediaStream) {
        audioStream = stream;
      }

      if (!audioStream) return;

      if (el.srcObject !== audioStream) {
        el.srcObject = audioStream;
      }

      el.play().catch(() => {});
    },
    [stream, audioTrack],
  );

  return {
    videoRef,
    audioRef,
    isCamActive,
    isMicEnabled,
  };
};
