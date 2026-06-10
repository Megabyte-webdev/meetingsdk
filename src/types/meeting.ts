export type Events = {
  onTrack?: (stream: MediaStream, peerId: string, id: string) => void;
  onUserJoined?: (p: Participant) => void;
  onUserLeft?: (id: string) => void;
  onChatMessage?: (msg: ChatMessage) => void;
  onScreenShareStarted?: (peerId: string, stream: MediaStream) => void;
  onScreenShareStopped?: (peerId: string) => void;
};
export type ChatMessage = {
  id: string;
  text: string;
  sender_id: string;
  sender_name?: string;
  timestamp: number;
  reply_to?: any;
  target?: string | null;
};

export type Participant = {
  id: string;
  name?: string;
  media?: ParticipantMedia;
};

export type Listener = () => void;

export type ChatInput = {
  message: string;
  reply_to?: {
    id: string;
    name: string;
  } | null;
  target?: string | null;
};

export type ParticipantMedia = {
  stream?: MediaStream | null;
  cameraTrack?: MediaStreamTrack;
  screenTrack?: MediaStreamTrack;
  micEnabled: boolean;
  camEnabled: boolean;
  isScreenSharing: boolean;
};
