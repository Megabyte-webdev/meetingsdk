import * as react_jsx_runtime from 'react/jsx-runtime';
import * as React from 'react';
import React__default from 'react';

type Participant = {
    id: string;
    name: string;
};
type Listener = () => void;
declare class MeetingState {
    participants: Map<string, Participant>;
    streams: Map<string, MediaStream>;
    localParticipant: Participant | null;
    localStream: MediaStream | null;
    private listeners;
    subscribe(fn: Listener): () => void;
    private notify;
    addParticipant(p: Participant): boolean;
    removeParticipant(id: string): void;
    setStream(id: string, stream: MediaStream): void;
    getStreamById(id: string): MediaStream | undefined;
    removeStream(id: string): void;
    getParticipants(): Participant[];
}

type Events = {
    onTrack?: (stream: MediaStream, peerId: string) => void;
    onUserJoined?: (p: Participant) => void;
    onUserLeft?: (id: string) => void;
};
declare class VideoSDKCore {
    private url;
    private state;
    private events;
    private ws;
    private peers;
    private initiators;
    private myId;
    private roomId;
    private localStream;
    constructor(url: string, state: MeetingState, events?: Events);
    initLocal(video: HTMLVideoElement, name: string): Promise<void>;
    connect(roomId: string, name: string): Promise<void>;
    private handle;
    private createPeer;
    private createOffer;
    private handleOffer;
    private closePeer;
    disconnect(): void;
    private send;
}

type MeetingContextType = {
    core: VideoSDKCore;
    state: MeetingState;
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
};

declare const useParticipants: () => Participant[];

declare const useStreams: () => Map<string, MediaStream>;

declare const useRemoteVideo: (participantId: string) => React.RefObject<HTMLVideoElement | null>;

declare const useLocalStream: () => MediaStream | null;

export { MeetingProvider, MeetingState, type Participant, VideoSDKCore, useLocalStream, useMeeting, useMeetingContext, useParticipants, useRemoteVideo, useStreams };
