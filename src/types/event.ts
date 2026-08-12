import { SDKError } from "./meeting";

export type EntryDecision = "approved" | "rejected";

export type EntryRequest = {
  requestId: string;
  userId: string;
  name: string;
};

export type Events = {
  onError?: (err: SDKError) => void;
  onJoinApproved?: (requestId: string) => void;
  onJoinRejected?: (requestId: string) => void;
  onConnectionStateChanged?: (state: string) => void;
  onRecordingStarted?: (recording: { recording_id: string; started_at: string }) => void;
  onRecordingStopped?: (recording: { recording_id: string; stopped_at: string }) => void;

  onEntryRequested?: (req: EntryRequest) => void;

  onEntryResponded?: (
    payload: { participantId: string; decision: EntryDecision } | string,
    decision?: EntryDecision,
  ) => void;
};
