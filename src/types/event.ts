import { SDKError } from "./meeting";

export type EntryDecision = "approved" | "rejected";

export type EntryRequest = {
  requestId: string;
  userId: string;
  name: string;
};

export type Events = {
  onError?: (err: SDKError) => void;

  onEntryRequested?: (req: EntryRequest) => void;

  onEntryResponded?: (
    payload: { participantId: string; decision: EntryDecision } | string,
    decision?: EntryDecision,
  ) => void;
};
