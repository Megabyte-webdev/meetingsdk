import { useEffect } from "react";
import { useMeetingContext } from "./MeetingProvider";

export const useMeeting = (handlers?: { onError?: (err: any) => void }) => {
  const ctx = useMeetingContext();

  useEffect(() => {
    if (!handlers?.onError) return;

    const unsubscribe = ctx.onError(handlers.onError);
    return unsubscribe;
  }, [handlers?.onError]);

  return ctx;
};
