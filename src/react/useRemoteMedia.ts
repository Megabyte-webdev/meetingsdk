import { useEffect, useRef, useState } from "react";
import { useMeetingContext } from "./MeetingProvider";
import { Participant } from "../types/meeting";

export const useRemoteMedia = (participantId: string) => {
  const { sdk } = useMeetingContext();

  // Create refs to access the DOM elements directly
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const [participant, setParticipant] = useState<Participant | null>(
    () => sdk.state.getParticipant(participantId) || null,
  );

  // Sync state from SDK to React
  useEffect(() => {
    const unsub = sdk.state.subscribe(`participant:${participantId}`, () => {
      const updated = sdk.state.getParticipant(participantId);
      if (updated) {
        setParticipant({ ...updated });
      }
    });
    return unsub;
  }, [participantId, sdk]);

  // Handle stream attachment whenever the stream changes
  useEffect(() => {
    const stream = participant?.media?.stream;

    if (stream) {
      if (videoRef.current && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      if (audioRef.current && audioRef.current.srcObject !== stream) {
        audioRef.current.srcObject = stream;
      }
    }
  }, [participant?.media?.stream]);

  return {
    videoRef,
    audioRef,
    isCamActive: !!participant?.media?.camEnabled,
    isMicEnabled: !!participant?.media?.micEnabled,
  };
};
