export { useLocalParticipant } from "./react/useLocalParticipant";

// Core exports
export { VideoSDKCore } from "./core/VideoCore";
export { SFUClient } from "./core/SFUClient";
export type { SFUConnectionState, TrackInfo, ParticipantInfo } from "./core/SFUClient";
export { MeetingState } from "./core/MeetingState";
export type { Participant, ChatInput, RecordingInfo, MeetingConfig } from "./types/meeting";

// React hooks and components
export { MeetingProvider, useMeetingContext } from "./react/MeetingProvider";
export { useMeeting } from "./react/useMeeting";
export { useParticipants } from "./react/useParticipants";
export { useRemoteMedia } from "./react/useRemoteMedia";
export { useMeetingPreview } from "./react/useMeetingPreview";
