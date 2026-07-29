import { useEffect, useRef, useState } from "react";
import { useMeetingContext } from "./MeetingProvider";
import { Participant } from "../types/meeting";

export const useRemoteMedia = (participantId: string) => {
  const { sdk } = useMeetingContext();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [participant, setParticipant] = useState<Participant | null>(
    () => sdk.state.getParticipant(participantId) || null,
  );

  useEffect(() => {
    const unsub = sdk.state.subscribe(`participant:${participantId}`, () => {
      const p = sdk.state.getParticipant(participantId);
      setParticipant(p ? { ...p } : null);
    });

    return unsub;
  }, [participantId, sdk]);

  useEffect(() => {
    const stream = participant?.media?.stream;

    console.log(`[useRemoteMedia] ${participantId} stream update:`, {
      hasStream: !!stream,
      streamId: stream?.id,
      audioTracks: stream?.getAudioTracks().length || 0,
      videoTracks: stream?.getVideoTracks().length || 0,
    });

    if (!stream) return;

    // ✅ VERIFY STREAM HAS TRACKS
    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();

    console.log(`[useRemoteMedia] ${participantId} track details:`, {
      audioTracks: audioTracks.map((t) => ({
        id: t.id,
        enabled: t.enabled,
        readyState: t.readyState,
      })),
      videoTracks: videoTracks.map((t) => ({
        id: t.id,
        enabled: t.enabled,
        readyState: t.readyState,
      })),
    });

    // ✅ VIDEO SETUP
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;
      videoRef.current.autoplay = true;

      videoRef.current
        .play()
        .then(() => {
          console.log(`[useRemoteMedia] ✅ Video playing: ${participantId}`);
        })
        .catch((err) => {
          console.error(
            `[useRemoteMedia] ❌ Video play failed: ${participantId}`,
            err?.name,
            err?.message,
          );
          // Browser autoplay policy - might need user gesture
          if (err?.name === "NotAllowedError") {
            console.warn(
              `[useRemoteMedia] ⚠️ Autoplay blocked. Audio policy may also block audio.`,
            );
          }
        });
    }

    if (audioRef.current) {
      audioRef.current.srcObject = stream;
      audioRef.current.autoplay = true;
      audioRef.current.muted = false;

      const playPromise = audioRef.current.play();

      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log(`[useRemoteMedia] ✅ Audio playing: ${participantId}`);
          })
          .catch((err) => {
            console.error(
              `[useRemoteMedia] ❌ Audio play failed: ${participantId}`,
              {
                name: err?.name,
                message: err?.message,
                audioTracks: audioTracks.length,
                enabled: audioRef.current?.muted,
              },
            );

            // Handle different errors
            if (err?.name === "NotAllowedError") {
              console.warn(
                `[useRemoteMedia] ⚠️ Autoplay blocked by browser policy`,
              );
              console.warn(
                `[useRemoteMedia] Try: Click anywhere on page or unmute browser`,
              );
            } else if (err?.name === "NotSupportedError") {
              console.error(
                `[useRemoteMedia] ❌ Browser doesn't support audio playback`,
              );
            } else if (audioTracks.length === 0) {
              console.warn(
                `[useRemoteMedia] ⚠️ No audio tracks in stream! This is a server issue.`,
              );
            }
          });
      }
    }

    // ✅ CLEANUP: Stop tracks when component unmounts
    return () => {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      if (audioRef.current) {
        audioRef.current.srcObject = null;
      }
    };
  }, [participant?.media?.stream, participantId]);

  return {
    videoRef,
    audioRef,
    isCamActive: !!participant?.media?.camEnabled,
    isMicEnabled: !!participant?.media?.micEnabled,
  };
};
