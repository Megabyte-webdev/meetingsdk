import * as react_jsx_runtime from 'react/jsx-runtime';
import * as React from 'react';
import React__default from 'react';

type Events = {
    onTrack?: (stream: MediaStream, peerId: string) => void;
    onUserJoined?: (p: Participant) => void;
    onUserLeft?: (id: string) => void;
    onChatMessage?: (msg: ChatMessage) => void;
    onScreenShareStarted?: (peerId: string, stream: MediaStream) => void;
    onScreenShareStopped?: (peerId: string) => void;
};
type ChatMessage = {
    id: string;
    text: string;
    sender_id: string;
    sender_name?: string;
    timestamp: number;
    reply_to?: any;
    target?: string | null;
};
type Participant = {
    id: string;
    name?: string;
    media?: ParticipantMedia;
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
type ParticipantMedia = {
    cameraStream: MediaStream | null;
    screenStream: MediaStream | null;
    micEnabled: boolean;
    camEnabled: boolean;
    isScreenSharing: boolean;
};

declare class MeetingState {
    participants: Map<string, Participant>;
    streams: Map<string, MediaStream>;
    localParticipant: Participant | null;
    localStream: MediaStream | null;
    private listeners;
    chatMessages: Map<string, ChatMessage>;
    subscribe(fn: Listener): () => void;
    private notify;
    addParticipant(p: Participant): boolean;
    removeParticipant(id: string): void;
    setStream(id: string, stream: MediaStream): void;
    getStreamById(id: string): MediaStream | undefined;
    removeStream(id: string): void;
    addChatMessage(msg: ChatMessage): void;
    getChatMessages(): ChatMessage[];
    clearChat(): void;
    getParticipants(): Participant[];
    reset(): void;
}

declare class VideoSDKCore {
    private state;
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
    private pingInterval;
    constructor(state: MeetingState, events?: Events, url?: string);
    initLocal(video: HTMLVideoElement, name: string): Promise<void>;
    connect(roomId: string, name: string): Promise<void>;
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
    private send;
}

type MeetingContextType = {
    core: VideoSDKCore;
    state: MeetingState;
    sendMessage: (payload: ChatInput) => void;
};
declare const MeetingProvider: ({ core, children, }: {
    core: VideoSDKCore;
    children: React__default.ReactNode;
}) => react_jsx_runtime.JSX.Element;
declare const useMeetingContext: () => MeetingContextType;

declare const useMeeting: () => {
    join: (roomId: string, name: string) => Promise<void>;
    startLocalStream: (video: HTMLVideoElement, name: string) => Promise<void>;
    leave: () => void;
    meetingId: any;
    localParticipant: Participant | null;
    usePubSub(type: "SECURE_CHAT"): {
        messages: Map<string, ChatMessage>;
        publish: (payload: ChatInput) => void;
    };
};

declare const useParticipants: () => Participant[];

declare const useStreams: () => Map<string, MediaStream>;

declare const useRemoteVideo: (participantId: string) => React.RefObject<HTMLVideoElement | null>;

declare const useLocalStream: () => MediaStream | null;

export { type ChatInput, MeetingProvider, MeetingState, type Participant, VideoSDKCore, useLocalStream, useMeeting, useMeetingContext, useParticipants, useRemoteVideo, useStreams };
