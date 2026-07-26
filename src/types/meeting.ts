export type Events = {
  onMicToggled?: (peerId: string, enabled: boolean) => void;
  onError?: (err: SDKError) => void;
  onCamToggled?: (peerId: string, enabled: boolean) => void;
  onTrack?: (stream: MediaStream, peerId: string) => void;
  onScreenTrack?: (stream: MediaStream, peerId: string) => void;
  onUserJoined?: (p: Participant) => void;
  onEntryRequested?: (req: EntryRequest) => void;

  onEntryResponded?: (
    payload: { participantId: string; decision: EntryDecision } | string,
    decision?: EntryDecision,
  ) => void;

  onJoinApproved?: (requestId: string) => void;
  onJoinRejected?: (requestId: string) => void;
  onRoomUpdate?: (data: any) => void;

  onUserLeft?: (id: string) => void;
  onMeetingLeft?: () => void;
  onChatMessage?: (msg: ChatMessage) => void;
  onScreenShareStarted?: (peerId: string, stream: MediaStream) => void;
  onScreenShareStopped?: (peerId: string) => void;
  onMuteStateChanged?: (
    peerId: string,
    kind: "audio" | "video",
    muted: boolean,
  ) => void;
};

export type ChatMessage = {
  id: string;
  text: string;
  sender_id: string;
  sender_name?: string;
  timestamp: number;
  reply_to?: { id: string; name: string } | null;
  target?: string | null;
};

export type Participant = {
  id: string;
  name?: string;
  isHost?: boolean;
  isLocal?: boolean;
  media?: ParticipantMedia;
  isPresenter?: boolean;
};

export type ParticipantMedia = {
  stream?: MediaStream | null;
  screenStream?: MediaStream | null;
  cameraTrack?: MediaStreamTrack;
  screenTrack?: MediaStreamTrack;
  audioTrack?: MediaStreamTrack;
  micEnabled: boolean;
  camEnabled: boolean;
  isScreenSharing: boolean;
  remoteScreenStreamId?: string;
  cameraStreamId?: string;
};

export type Listener = () => void;

export type ChatInput = {
  message: string;
  reply_to?: { id: string; name: string } | null;
  target?: string | null;
};

export type MeetingConfig = {
  roomId: string;
  name: string;
  audioMuted?: boolean;
  videoMuted?: boolean;
  token?: string;
};

export type PubSubTopic = "SECURE_CHAT";

export type PubSubHandle = {
  messages: ChatMessage[];
  publish: (input: ChatInput) => void;
};

export type StateScope =
  | "participants"
  | "localParticipant"
  | "chat"
  | "presenter"
  | `participant:${string}`;

export type SDKError = {
  code: string;
  message: string;
  roomId?: string | null;
  userId?: string;
  raw?: any;
  recoverable?: boolean;
};

export type EntryDecision = "approved" | "rejected";

export type EntryRequest = {
  requestId: string;
  userId: string;
  name: string;
};

export interface TrackDescriptor {
  id: string;

  publisher_id: string;

  source: "camera" | "screen" | "audio";

  mid?: string;
}
