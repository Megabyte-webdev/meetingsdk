import { useEffect, useRef } from "react";
import { useMeetingContext } from "./MeetingProvider";

export const useRemoteVideo = (participantId: string) => {
  const ref = useRef<HTMLVideoElement | null>(null);
  const { state } = useMeetingContext();

  useEffect(() => {
    const attach = () => {
      const stream = state.getStreamById(participantId);
      if (stream && ref.current) {
        ref.current.srcObject = stream;
      }
    };

    attach();

    const unsub = state.subscribe(() => {
      attach();
    });

    return () => unsub();
  }, [participantId, state]);

  return ref;
};
