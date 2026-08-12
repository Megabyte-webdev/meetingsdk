import React, { createContext, useContext, useMemo, useRef } from "react";
import { VideoSDKCore } from "../core/VideoCore";
import {
  ChatInput,
  ChatMessage,
  MeetingConfig,
  Participant,
  PubSubTopic,
} from "../types/meeting";
import { useMeetingStore } from "./useMeetingStore";

type PubSubHandle = {
  messages: ChatMessage[];
  publish: (input: ChatInput) => void;
};

type MeetingContextValue = {
  sdk: VideoSDKCore;
  join: (config?: MeetingConfig) => Promise<void>;
  leave: () => void;
  createRoom: (input: {
    name: string;
    description?: string;
    capacity?: number;
    is_private?: boolean;
  }) => Promise<any>;
  getRoom: (roomCode: string) => Promise<any>;
  deleteRoom: (roomCode: string) => Promise<any>;

  toggleMic: () => void;
  toggleCam: () => void;

  startScreenShare: () => Promise<MediaStream>;
  stopScreenShare: () => void;

  sendMessage: (input: ChatInput) => void;

  room: { id: string | null; name: string | null };
  localParticipant: Participant | null;
  participants: Map<string, Participant>;
  messages: ChatMessage[];
  presenterId: string | null;
  usePubSub: (topic: PubSubTopic) => PubSubHandle;
  approveJoinRequest: (requestId: string) => void;
  rejectJoinRequest: (requestId: string) => void;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  getRecordingStatus: () => Promise<any>;
  onError: (cb: (err: any) => void) => () => void;
  onEntryRequested: (cb: (req: any) => void) => () => void;
  onEntryResponded: (cb: (payload: any, decision?: any) => void) => () => void;
  onMeetingLeft: (cb: () => void) => () => void;
  onTrackStateChanged: (cb: (track: any) => void) => () => void;
  onRecordingStarted: (cb: (recording: any) => void) => () => void;
  onRecordingStopped: (cb: (recording: any) => void) => () => void;
};

const MeetingContext = createContext<MeetingContextValue | null>(null);

export const MeetingProvider = ({
  config,
  children,
}: {
  config: MeetingConfig;
  children: React.ReactNode;
}) => {
  const sdkRef = useRef<VideoSDKCore | null>(null);
  const errorListeners = useRef(new Set<(err: any) => void>());
  const entryRequestListeners = useRef(new Set<(req: any) => void>());
  const entryResponseListeners = useRef(
    new Set<(payload: any, decision?: any) => void>(),
  );
  const meetingLeftListeners = useRef(new Set<() => void>());
  const trackStateListeners = useRef(new Set<(track: any) => void>());
  const recordingStartedListeners = useRef(new Set<(recording: any) => void>());
  const recordingStoppedListeners = useRef(new Set<(recording: any) => void>());

  if (!sdkRef.current) {
    sdkRef.current = new VideoSDKCore({
      onError: (err) => errorListeners.current.forEach((fn) => fn(err)),
      onEntryRequested: (req) =>
        entryRequestListeners.current.forEach((fn) => fn(req)),
      onEntryResponded: (p, d) =>
        entryResponseListeners.current.forEach((fn) => fn(p, d)),
      onMeetingLeft: () => meetingLeftListeners.current.forEach((fn) => fn()),
      onTrackStateChanged: (track) =>
        trackStateListeners.current.forEach((fn) => fn(track)),
      onRecordingStarted: (recording) =>
        recordingStartedListeners.current.forEach((fn) => fn(recording)),
      onRecordingStopped: (recording) =>
        recordingStoppedListeners.current.forEach((fn) => fn(recording)),
    });
  }

  const sdk = sdkRef.current;
  const presenterId = useMeetingStore(
    sdk.state,
    "presenter",
    (s) => s.presenterId,
  );
  const participants = useMeetingStore(
    sdk.state,
    "participants",
    (s) => s.participants,
  );
  const localParticipant = useMeetingStore(
    sdk.state,
    "localParticipant",
    (s) => s.localParticipant,
  );
  const messages = useMeetingStore(sdk.state, "chat", (s) =>
    s.getChatMessages(),
  );

  const value = useMemo<MeetingContextValue>(() => {
    if (!sdkRef.current) {
      sdkRef.current = new VideoSDKCore({
        onError: (err) => {
          errorListeners.current.forEach((fn) => fn(err));
        },
      });
    }

    return {
      sdk,

      join: (joinConfig?: MeetingConfig) =>
        sdk.joinMeeting({
          ...config,
          ...joinConfig,
        }),
      leave: () => sdk.disconnect(),
      createRoom: sdk.createRoom.bind(sdk),
      getRoom: sdk.getRoom.bind(sdk),
      deleteRoom: sdk.deleteRoom.bind(sdk),
      toggleMic: sdk.toggleMic.bind(sdk),
      toggleCam: sdk.toggleCam.bind(sdk),
      startScreenShare: sdk.startScreenShare.bind(sdk),
      stopScreenShare: sdk.stopScreenShare.bind(sdk),
      sendMessage: sdk.sendChatMessage.bind(sdk),

      room: sdk.getMeeting(),
      localParticipant,
      participants,
      messages,
      presenterId,
      usePubSub: (topic: PubSubTopic) => {
        if (topic !== "SECURE_CHAT") {
          throw new Error(`Unsupported PubSub argument: "${topic}"`);
        }
        return {
          messages: sdk.state.getChatMessages(),
          publish: sdk.sendChatMessage.bind(sdk),
        };
      },
      approveJoinRequest: sdk.approveJoinRequest.bind(sdk),
      rejectJoinRequest: sdk.rejectJoinRequest.bind(sdk),
      startRecording: sdk.startRecording.bind(sdk),
      stopRecording: sdk.stopRecording.bind(sdk),
      getRecordingStatus: sdk.getRecordingStatus.bind(sdk),

      onError: (cb: (err: any) => void) => {
        errorListeners.current.add(cb);

        return () => {
          errorListeners.current.delete(cb);
        };
      },

      onEntryRequested: (cb: (err: any) => void) => {
        entryRequestListeners.current.add(cb);

        return () => {
          entryRequestListeners.current.delete(cb);
        };
      },
      onEntryResponded: (cb: (err: any) => void) => {
        entryResponseListeners.current.add(cb);

        return () => {
          entryResponseListeners.current.delete(cb);
        };
      },
      onMeetingLeft: (cb: () => void) => {
        meetingLeftListeners.current.add(cb);
        return () => {
          meetingLeftListeners.current.delete(cb);
        };
      },
      onTrackStateChanged: (cb: (track: any) => void) => {
        trackStateListeners.current.add(cb);
        return () => trackStateListeners.current.delete(cb);
      },
      onRecordingStarted: (cb: (recording: any) => void) => {
        recordingStartedListeners.current.add(cb);
        return () => recordingStartedListeners.current.delete(cb);
      },
      onRecordingStopped: (cb: (recording: any) => void) => {
        recordingStoppedListeners.current.add(cb);
        return () => recordingStoppedListeners.current.delete(cb);
      },
    };
  }, [config, sdk, localParticipant, participants, messages, presenterId]);

  return (
    <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>
  );
};

export const useMeetingContext = () => {
  const ctx = useContext(MeetingContext);
  if (!ctx)
    throw new Error("useMeetingContext must be used inside <MeetingProvider>");
  return ctx;
};
