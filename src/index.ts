export { useLocalParticipant } from "./react/useLocalParticipant";

// Core exports
export { VideoSDKCore } from "./core/VideoCore";
export { MeetingState } from "./core/MeetingState";
export type { Participant, ChatInput } from "./types/meeting";

// React hooks and components
export { MeetingProvider, useMeetingContext } from "./react/MeetingProvider";
export { useMeeting } from "./react/useMeeting";
export { useParticipants } from "./react/useParticipants";
export { useRemoteMedia } from "./react/useRemoteMedia";
