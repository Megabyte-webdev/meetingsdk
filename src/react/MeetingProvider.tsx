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
  onError: (cb: (err: any) => void) => () => void;
  onEntryRequested: (cb: (req: any) => void) => () => void;
  onEntryResponded: (cb: (payload: any, decision?: any) => void) => () => void;
  onMeetingLeft: (cb: () => void) => () => void;
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

  if (!sdkRef.current) {
    sdkRef.current = new VideoSDKCore({
      onError: (err) => errorListeners.current.forEach((fn) => fn(err)),
      onEntryRequested: (req) =>
        entryRequestListeners.current.forEach((fn) => fn(req)),
      onEntryResponded: (p, d) =>
        entryResponseListeners.current.forEach((fn) => fn(p, d)),
      onMeetingLeft: () => meetingLeftListeners.current.forEach((fn) => fn()),
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
