import * as react_jsx_runtime from 'react/jsx-runtime';
import React from 'react';

type Events = {
    onMicToggled?: (peerId: string, enabled: boolean) => void;
    onError?: (err: SDKError) => void;
    onCamToggled?: (peerId: string, enabled: boolean) => void;
    onTrack?: (stream: MediaStream, peerId: string) => void;
    onScreenTrack?: (stream: MediaStream, peerId: string) => void;
    onUserJoined?: (p: Participant) => void;
    onUserLeft?: (id: string) => void;
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
    media?: ParticipantMedia;
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
    private peers;
    private initiators;
    private myId;
    private roomId;
    private localStream;
    private screenStream;
    private isScreenSharing;
    private screenSenders;
    private pingInterval;
    private pendingIceCandidates;
    private reconnectAttempts;
    private reconnectTimer?;
    private participantName;
    readonly state: MeetingState;
    private joinResolver?;
    private joinRejecter?;
    private emitError;
    constructor(events?: Events, url?: string);
    initLocal(video: HTMLVideoElement, name: string): Promise<void>;
    connect(roomId: string, name: string): Promise<void>;
    joinMeeting(config: MeetingConfig): Promise<void>;
    /** Expose the roomId without making it fully public */
    getMeetingId(): string | null;
    toggleMic(): void;
    toggleCam(): void;
    private scheduleReconnect;
    private startHeartbeat;
    private stopHeartbeat;
    private reset;
    private handle;
    private createPeer;
    private createOffer;
    private handleOffer;
    private closePeer;
    startScreenShare(): Promise<MediaStream>;
    stopScreenShare(): void;
    sendChatMessage(payload: ChatInput): void;
    disconnect(): void;
    private flushIce;
    private send;
}

type PubSubHandle = {
    messages: ChatMessage[];
    publish: (input: ChatInput) => void;
};
type MeetingContextValue = {
    sdk: VideoSDKCore;
    join: (config: MeetingConfig) => Promise<void>;
    leave: () => void;
    toggleMic: () => void;
    toggleCam: () => void;
    startScreenShare: () => Promise<MediaStream>;
    stopScreenShare: () => void;
    sendMessage: (input: ChatInput) => void;
    meetingId: string | null;
    localParticipant: Participant | null;
    participants: Map<string, Participant>;
    messages: ChatMessage[];
    presenterId: string | null;
    usePubSub: (topic: PubSubTopic) => PubSubHandle;
    onError: (cb: (err: any) => void) => () => void;
};
declare const MeetingProvider: ({ config, children, }: {
    config: MeetingConfig;
    children: React.ReactNode;
}) => react_jsx_runtime.JSX.Element;
declare const useMeetingContext: () => MeetingContextValue;

declare const useMeeting: (handlers?: {
    onError?: (err: any) => void;
}) => {
    sdk: VideoSDKCore;
    join: (config: MeetingConfig) => Promise<void>;
    leave: () => void;
    toggleMic: () => void;
    toggleCam: () => void;
    startScreenShare: () => Promise<MediaStream>;
    stopScreenShare: () => void;
    sendMessage: (input: ChatInput) => void;
    meetingId: string | null;
    localParticipant: Participant | null;
    participants: Map<string, Participant>;
    messages: ChatMessage[];
    presenterId: string | null;
    usePubSub: (topic: PubSubTopic) => {
        messages: ChatMessage[];
        publish: (input: ChatInput) => void;
    };
    onError: (cb: (err: any) => void) => () => void;
};

declare const useParticipants: () => Participant[];

declare const useRemoteVideo: (participantId: string) => {
    videoRef: (videoEl: HTMLVideoElement | null) => void;
    isCamActive: boolean;
    isMicEnabled: boolean;
};

export { type ChatInput, MeetingProvider, MeetingState, type Participant, VideoSDKCore, useLocalParticipant, useMeeting, useMeetingContext, useParticipants, useRemoteVideo };
