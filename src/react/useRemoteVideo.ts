import { useEffect, useRef } from "react";
import { useMeetingContext } from "./MeetingProvider";

export const useRemoteVideo = (participantId: string) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { state } = useMeetingContext();

  useEffect(() => {
    const attachStream = () => {
      const video = videoRef.current;
      const stream = state.getStreamById(participantId);

      if (!video || !stream) return;

      if (video.srcObject !== stream) {
        video.srcObject = stream;

        video.play?.().catch((err) => {
          console.warn(
            `Failed to autoplay remote video for participant ${participantId}`,
            err,
          );
        });
      }
    };

    attachStream();

    const unsubscribe = state.subscribe(() => {
      attachStream();
    });

    return () => {
      unsubscribe();

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [participantId, state]);

  return videoRef;
};
