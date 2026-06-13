import { useCallback, useEffect, useRef, useState } from "react";
import { useMeetingContext } from "./MeetingProvider";
import { Participant } from "../types/meeting";

export const useRemoteMedia = (participantId: string) => {
  const { sdk } = useMeetingContext();
  const [participant, setParticipant] = useState<Participant | null>(
    () => sdk.state.getParticipant(participantId) || null,
  );

  const buildMediaStream = (participant: Participant | null) => {
    if (!participant?.media) return null;

    const stream = new MediaStream();

    const videoTrack = participant.media.stream?.getVideoTracks?.()?.[0];
    const audioTrack = participant.media.stream?.getAudioTracks?.()?.[0];

    if (videoTrack) stream.addTrack(videoTrack);
    if (audioTrack) stream.addTrack(audioTrack);

    return stream;
  };

  useEffect(() => {
    const unsub = sdk.state.subscribe(`participant:${participantId}`, () => {
      const p = sdk.state.getParticipant(participantId);
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

      node.pause();

      // IMPORTANT: always force rebind (no conditions)
      node.srcObject = stream;

      node.muted = true;
      node.playsInline = true;
      node.autoplay = true;

      node.play().catch(() => {
        // ignore autoplay restrictions
      });
    },
    [participant?.media?.stream],
  );

  // Audio Callback Ref
  const audioRef = useCallback(
    (node: HTMLAudioElement | null) => {
      if (!node) return;

      const stream = participant?.media?.stream;
      if (!stream) return;

      node.pause();
      node.srcObject = stream;

      node.muted = false;

      node.play().catch(() => {});
    },
    [participant?.media?.stream],
  );

  return {
    videoRef,
    audioRef,
    isCamActive: !!participant?.media?.camEnabled,
    isMicEnabled: !!participant?.media?.micEnabled,
  };
};
