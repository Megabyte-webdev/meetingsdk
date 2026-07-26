# 📹 MESHSDK

A lightweight React SDK for building peer-to-peer video conferencing applications using WebRTC Mesh networking. The SDK provides a modern React API, built-in meeting state management, screen sharing, chat, waiting room support, and flexible WebSocket signaling.

---

## Features

- Peer-to-peer WebRTC Mesh architecture
- HD audio and video
- Screen sharing
- Waiting room with host approval
- Public and private in-meeting chat
- Participant presence and media state
- Automatic ICE restart & reconnection
- STUN/TURN support
- React Hooks API
- Full TypeScript support
- Lightweight with zero UI dependencies

---

## Installation

```bash
npm install @afosecure/meshsdk
```

or

```bash
pnpm add @afosecure/meetingsdk
```

or

```bash
yarn add @afosecure/meetingsdk
```

---

# Quick Start

## Create the SDK

```tsx
import { useState } from "react";
import { MeetingProvider, VideoSDKCore } from "@afosecure/meetingsdk";

export default function App() {
  const [sdk] = useState(
    () =>
      new VideoSDKCore({
        onUserJoined: console.log,
        onUserLeft: console.log,
        onTrack: console.log,
      }),
  );

  return (
    <MeetingProvider core={sdk}>
      <Meeting />
    </MeetingProvider>
  );
}
```

---

## Join a Meeting

```tsx
import { useMeeting } from "@afosecure/meetingsdk";

export default function Meeting() {
  const { joinMeeting, startLocalStream, leaveMeeting } = useMeeting();

  const join = async () => {
    await startLocalStream(videoRef.current!, "John");

    await joinMeeting({
      roomId: "room-123",
      name: "John",
    });
  };

  return (
    <>
      <button onClick={join}>Join</button>

      <button onClick={leaveMeeting}>Leave</button>
    </>
  );
}
```

---

# React Hooks

## useMeeting()

Provides meeting actions and local participant state.

```ts
const {
  joinMeeting,
  leaveMeeting,
  toggleMic,
  toggleCam,
  startScreenShare,
  stopScreenShare,
  sendChatMessage,
  participants,
  localParticipant,
  presenterId,
} = useMeeting();
```

---

## useParticipants()

Returns all remote participants.

```ts
const participants = useParticipants();
```

---

## useLocalParticipant()

```ts
const participant = useLocalParticipant();
```

---

## useChat()

```ts
const { messages, sendChatMessage } = useChat();
```

---

## useMeetingState()

Subscribe to the underlying reactive meeting state.

```ts
const meeting = useMeetingState();
```

---

# Meeting Events

```ts
const sdk = new VideoSDKCore({
  onTrack(stream, participantId) {},

  onUserJoined(participant) {},

  onUserLeft(participantId) {},

  onChatMessage(message) {},

  onScreenShareStarted(id, stream) {},

  onScreenShareStopped(id) {},

  onMicToggled(id, enabled) {},

  onCamToggled(id, enabled) {},

  onMeetingLeft() {},

  onError(error) {},
});
```

---

# Features

## Audio & Video

- Camera
- Microphone
- Mute / Unmute
- Camera On / Off

---

## Screen Sharing

```ts
await startScreenShare();

stopScreenShare();
```

Supports:

- Presenter detection
- Automatic renegotiation
- Browser stop-share handling

---

## Waiting Room

Supports:

- Join requests
- Host approval
- Host rejection
- Rejoin after approval

Events:

```ts
onEntryRequested();

onEntryResponded();
```

---

## Chat

Supports:

- Public messages
- Private messages
- Replies
- Optimistic updates

```ts
sendChatMessage({
  message: "Hello everyone!",
});
```

---

# Architecture

```
Participant A
       │
       │
   WebSocket
(Signaling Only)
       │
Participant B

Media
──────────────►
Direct WebRTC
Peer Connection
```

Media never passes through the signaling server.

The WebSocket server is only responsible for:

- room management
- participant discovery
- signaling
- waiting room
- ICE exchange

---

# Server Requirements

Your signaling server should support the following messages.

## Client → Server

- JOIN
- LEAVE
- OFFER
- ANSWER
- ICE
- CHAT_MESSAGE
- MEDIA_STATE
- SCREEN_SHARE_START
- SCREEN_SHARE_STOP
- JOIN_APPROVE
- JOIN_REJECT
- PING

---

## Server → Client

- JOINED
- EXISTING_USERS
- USER_JOINED
- USER_LEFT
- OFFER
- ANSWER
- ICE
- CHAT_MESSAGE
- MEDIA_STATE_CHANGE
- SCREEN_SHARE_START
- SCREEN_SHARE_STOP
- JOIN_PENDING
- JOIN_APPROVED
- JOIN_REJECTED
- ERROR
- PONG

---

# STUN & TURN

The SDK expects the signaling server to provide ICE servers during the JOIN flow.

Example:

```json
{
  "iceServers": [
    {
      "urls": ["stun:stun.l.google.com:19302"]
    },
    {
      "urls": ["turn:turn.example.com:3478"],
      "username": "...",
      "credential": "..."
    }
  ]
}
```

---

# Browser Support

- Chrome
- Edge
- Firefox
- Safari

---

# Mesh Networking

This SDK uses a Mesh topology.

Every participant establishes a direct WebRTC connection with every other participant.

Best suited for:

- One-to-one calls
- Interviews
- Online consultations
- Small meetings
- Team discussions

For larger meetings (10+ participants), an SFU architecture is recommended.

---

# License

MIT
