import * as react_jsx_runtime from 'react/jsx-runtime';
import React from 'react';

type Events = {
    onTrack?: (stream: MediaStream, peerId: string, id: string) => void;
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
    stream?: MediaStream | null;
    cameraTrack?: MediaStreamTrack;
    screenTrack?: MediaStreamTrack;
    micEnabled: boolean;
    camEnabled: boolean;
    isScreenSharing: boolean;
};

declare class MeetingState {
    participants: Map<string, Participant>;
    localParticipant: Participant | null;
    localStream: MediaStream | null;
    private listeners;
    chatMessages: Map<string, ChatMessage>;
    subscribe(fn: Listener): () => void;
    notify(): void;
    addParticipant(p: Participant): boolean;
    removeParticipant(id: string): void;
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
    private pingInterval;
    private pendingIceCandidates;
    private reconnectAttempts;
    private reconnectTimer?;
    private participantName;
    readonly state: MeetingState;
    constructor(events?: Events, url?: string);
    initLocal(video: HTMLVideoElement, name: string): Promise<void>;
    connect(roomId: string, name: string): Promise<void>;
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
    private getOrCreateParticipantMedia;
    private send;
}

type MeetingContextType = {
    core: VideoSDKCore;
    state: MeetingState;
    sendMessage: (payload: ChatInput) => void;
};
declare const MeetingProvider: ({ core, children, }: {
    core: VideoSDKCore;
    children: React.ReactNode;
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

declare const useRemoteVideo: (participantId: string) => (video: HTMLVideoElement | null) => void;

declare const useLocalStream: () => MediaStream | null;

export { type ChatInput, MeetingProvider, MeetingState, type Participant, VideoSDKCore, useLocalStream, useMeeting, useMeetingContext, useParticipants, useRemoteVideo };
