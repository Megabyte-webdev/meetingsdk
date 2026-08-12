import { useEffect } from "react";
import { useMeetingContext } from "./MeetingProvider";

export const useMeeting = (handlers?: {
  onError?: (err: any) => void;
  onEntryRequested?: (req: any) => void;
  onEntryResponded?: (payload: any, decision?: any) => void;
  onMeetingLeft?: () => void;
  onTrackStateChanged?: (track: any) => void;
  onRecordingStarted?: (recording: any) => void;
  onRecordingStopped?: (recording: any) => void;
}) => {
  const ctx = useMeetingContext();

  // Error Handler
  useEffect(() => {
    if (!handlers?.onError) return;
    return ctx.onError(handlers.onError);
  }, [handlers?.onError]);

  // Entry Request Handler
  useEffect(() => {
    if (!handlers?.onEntryRequested) return;
    return ctx.onEntryRequested(handlers.onEntryRequested);
  }, [handlers?.onEntryRequested]);

  // Entry Response Handler
  useEffect(() => {
    if (!handlers?.onEntryResponded) return;
    return ctx.onEntryResponded(handlers.onEntryResponded);
  }, [handlers?.onEntryResponded]);

  // Meeting Left Handler
  useEffect(() => {
    if (!handlers?.onMeetingLeft) return;
    return ctx.onMeetingLeft(handlers.onMeetingLeft);
  }, [handlers?.onMeetingLeft]);

  useEffect(() => {
    if (!handlers?.onTrackStateChanged) return;
    return ctx.onTrackStateChanged(handlers.onTrackStateChanged);
  }, [handlers?.onTrackStateChanged]);

  useEffect(() => {
    if (!handlers?.onRecordingStarted) return;
    return ctx.onRecordingStarted(handlers.onRecordingStarted);
  }, [handlers?.onRecordingStarted]);

  useEffect(() => {
    if (!handlers?.onRecordingStopped) return;
    return ctx.onRecordingStopped(handlers.onRecordingStopped);
  }, [handlers?.onRecordingStopped]);

  const { sdk: _, ...publicApi } = ctx;
  return publicApi;
};
