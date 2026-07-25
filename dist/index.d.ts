import * as react_jsx_runtime from 'react/jsx-runtime';
import * as react from 'react';
import react__default from 'react';

type Events = {
    onMicToggled?: (peerId: string, enabled: boolean) => void;
    onError?: (err: SDKError) => void;
    onCamToggled?: (peerId: string, enabled: boolean) => void;
    onTrack?: (stream: MediaStream, peerId: string) => void;
    onScreenTrack?: (stream: MediaStream, peerId: string) => void;
    onUserJoined?: (p: Participant) => void;
    onEntryRequested?: (req: EntryRequest) => void;
    onEntryResponded?: (payload: {
        participantId: string;
        decision: EntryDecision;
    } | string, decision?: EntryDecision) => void;
    onJoinApproved?: (requestId: string) => void;
    onJoinRejected?: (requestId: string) => void;
    onRoomUpdate?: (data: any) => void;
    onUserLeft?: (id: string) => void;
    onMeetingLeft?: () => void;
    onChatMessage?: (msg: ChatMessage) => void;
    onScreenShareStarted?: (peerId: string, stream: MediaStream) => void;
    onScreenShareStopped?: (peerId: string) => void;
    onMuteStateChanged?: (peerId: string, kind: "audio" | "video", muted: boolean) => void;
};
type ChatMessage = {
    id: string;
    text: string;
    sender_id: string;
    sender_name?: string;
    timestamp: number;
    reply_to?: {
        id: string;
        name: string;
    } | null;
    target?: string | null;
};
type Participant = {
    id: string;
    name?: string;
    isHost?: boolean;
    isLocal?: boolean;
    media?: ParticipantMedia;
    isPresenter?: boolean;
};
type ParticipantMedia = {
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
type Listener = () => void;
type ChatInput = {
    message: string;
    reply_to?: {
        id: string;
        name: string;
    } | null;
    target?: string | null;
};
type MeetingConfig = {
    roomId: string;
    name: string;
    audioMuted?: boolean;
    videoMuted?: boolean;
    token?: string;
};
type PubSubTopic = "SECURE_CHAT";
type StateScope = "participants" | "localParticipant" | "chat" | "presenter" | `participant:${string}`;
type SDKError = {
    code: string;
    message: string;
    roomId?: string | null;
    userId?: string;
    raw?: any;
    recoverable?: boolean;
};
type EntryDecision = "approved" | "rejected";
type EntryRequest = {
    requestId: string;
    userId: string;
    name: string;
};

declare const useLocalParticipant: () => {
    participant: Participant | null;
    videoRef: (video: HTMLVideoElement | null) => void;
};

type LocalParticipantPatch = {
    id?: string;
    name?: string;
    media?: Partial<ParticipantMedia>;
};
declare class MeetingState {
    participants: Map<string, Participant>;
    localParticipant: Participant | null;
    localStream: MediaStream | null;
    chatMessages: Map<string, ChatMessage>;
    presenterId: string | null;
    private listeners;
    subscribe(scope: StateScope, fn: Listener): () => void;
    notify(scope: StateScope): void;
    setPresenterId(id: string | null): void;
    addParticipant(p: Participant): boolean;
    removeParticipant(id: string): void;
    updateParticipantMedia(id: string, patch: Partial<NonNullable<Participant["media"]>>): void;
    updateLocalParticipant(patch: LocalParticipantPatch): void;
    addChatMessage(msg: ChatMessage): void;
    getChatMessages(): ChatMessage[];
    clearChat(): void;
    getParticipants(): Participant[];
    getParticipant(id: string): Participant | null;
    resetRemoteState(): void;
}

declare class VideoSDKCore {
    private events;
    private url;
    private ws;
    private pubPC;
    private subPC;
    private pendingTracks;
    private subscriberNegotiating;
    private subscriberOfferQueue;
    private iceServers;
    private lastPong;
    private intentionalDisconnect;
    private myId;
    private room;
    private localStream;
    private screenStream;
    private screenSender;
    private isScreenSharing;
    private pingInterval;
    private reconnectAttempts;
    private reconnectTimer?;
    private participantName;
    readonly state: MeetingState;
    private joinResolver?;
    private joinRejecter?;
    private isWaitingForApproval;
    private pendingRequestId;
    private iceTransportPolicy;
    constructor(events?: Events, url?: string);
    private acquireLocalMedia;
    initLocal(video: HTMLVideoElement, name: string): Promise<void>;
    joinMeeting(config: MeetingConfig): Promise<void>;
    private setupPublisherPC;
    private setupSubscriberPC;
    connect(roomId: string, name: string): Promise<void>;
    private handle;
    private handleSubscriberOffer;
    private createPublisherOffer;
    toggleMic(): void;
    toggleCam(): void;
    startScreenShare(): Promise<MediaStream>;
    stopScreenShare(): Promise<void>;
    sendChatMessage(payload: ChatInput): void;
    private scheduleReconnect;
    private startHeartbeat;
    private stopHeartbeat;
    private reset;
    disconnect(): void;
    private restartPublisherIce;
    private emitError;
    private send;
    approveJoinRequest(requestId: string): void;
    rejectJoinRequest(requestId: string): void;
    getMeeting(): {
        id: string | null;
        name: string | null;
    };
}

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
    room: {
        id: string | null;
        name: string | null;
    };
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
declare const MeetingProvider: ({ config, children, }: {
    config: MeetingConfig;
    children: react__default.ReactNode;
}) => react_jsx_runtime.JSX.Element;
declare const useMeetingContext: () => MeetingContextValue;

declare const useMeeting: (handlers?: {
    onError?: (err: any) => void;
    onEntryRequested?: (req: any) => void;
    onEntryResponded?: (payload: any, decision?: any) => void;
    onMeetingLeft?: () => void;
}) => {
    join: (config?: MeetingConfig) => Promise<void>;
    leave: () => void;
    toggleMic: () => void;
    toggleCam: () => void;
    startScreenShare: () => Promise<MediaStream>;
    stopScreenShare: () => void;
    sendMessage: (input: ChatInput) => void;
    room: {
        id: string | null;
        name: string | null;
    };
    localParticipant: Participant | null;
    participants: Map<string, Participant>;
    messages: ChatMessage[];
    presenterId: string | null;
    usePubSub: (topic: PubSubTopic) => {
        messages: ChatMessage[];
        publish: (input: ChatInput) => void;
    };
    approveJoinRequest: (requestId: string) => void;
    rejectJoinRequest: (requestId: string) => void;
    onError: (cb: (err: any) => void) => () => void;
    onEntryRequested: (cb: (req: any) => void) => () => void;
    onEntryResponded: (cb: (payload: any, decision?: any) => void) => () => void;
    onMeetingLeft: (cb: () => void) => () => void;
};

declare const useParticipants: () => Participant[];

declare const useRemoteMedia: (participantId: string) => {
    videoRef: react.RefObject<HTMLVideoElement | null>;
    audioRef: react.RefObject<HTMLAudioElement | null>;
    isCamActive: boolean;
    isMicEnabled: boolean;
};

type LiveRoomState = {
    active: boolean;
    count: number;
    canJoin: boolean;
    approved: boolean;
    isHost: boolean;
    hasMoreParticipants: boolean;
    participants: {
        id: string;
        name: string;
        isHost: boolean;
        isPresenter: boolean;
        micEnabled: boolean;
        camEnabled: boolean;
    }[];
};
declare function useMeetingPreview(roomId: string, userId: string): {
    room: LiveRoomState | null;
    isConnected: boolean;
    isLoading: boolean;
    error: string | null;
};

export { type ChatInput, MeetingProvider, MeetingState, type Participant, VideoSDKCore, useLocalParticipant, useMeeting, useMeetingContext, useMeetingPreview, useParticipants, useRemoteMedia };
