# 📹 @afosecure/meetingsdk — React Video Meeting SDK

A modern, lightweight React SDK for building peer-to-peer video communication applications using WebRTC. Designed with a clean, composable API and reactive state management.

---

## Features

- WebRTC peer-to-peer video (no central media server required)
- React Hooks API for seamless integration
- Reactive state system for participants & streams
- Lightweight core optimized for performance
- Flexible WebSocket signaling backend support
- Full TypeScript support

---

## 📦 Installation

```bash
npm install @afosecure/meetingsdk
# or
yarn add @afosecure/meetingsdk
# or
pnpm add @afosecure/meetingsdk
```

---

## Quick Start

### 1. Initialize SDK

```tsx
import { useState } from "react";
import {
  MeetingProvider,
  MeetingState,
  VideoSDKCore,
} from "@afosecure/meetingsdk";

function App() {
  const [core] = useState(
    () =>
      new VideoSDKCore({
        onTrack: (_, peerId) => {
          console.log("📹 Received stream from:", peerId);
        },
        onUserJoined: (participant) => {
          console.log("👤 User joined:", participant.name);
        },
        onUserLeft: (userId) => {
          console.log("👤 User left:", userId);
        },
      }),
  );

  return (
    <MeetingProvider core={core}>
      <VideoCall />
    </MeetingProvider>
  );
}

export default App;
```

---

### 2. Basic Video Call

```tsx
import { useRef, useState } from "react";
import { useMeeting, useParticipants } from "@afosecure/meetingsdk";

function VideoCall() {
  const { join, startLocalStream, leave, localParticipant } = useMeeting();
  const participants = useParticipants();
  const localVideoRef = useRef<HTMLVideoElement>(null);

  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");

  const handleJoin = async () => {
    if (!localVideoRef.current) return;

    await startLocalStream(localVideoRef.current, name);
    await join(roomId, name);
  };

  return (
    <div>
      {!localParticipant ? (
        <>
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <input value={roomId} onChange={(e) => setRoomId(e.target.value)} />
          <button onClick={handleJoin}>Join Meeting</button>
        </>
      ) : (
        <>
          <video ref={localVideoRef} autoPlay muted />
          <button onClick={leave}>Leave</button>

          {participants.map((p) => (
            <div key={p.id}>{p.name}</div>
          ))}
        </>
      )}
    </div>
  );
}
```

---

## Core Concepts

### MeetingState

```ts
const state = new MeetingState();

state.getParticipants();

state.subscribe(() => {
  console.log("updated");
});
```

---

### VideoSDKCore

```ts
const core = new VideoSDKCore(state, {
  onTrack: (stream, peerId) => {},
  onUserJoined: (p) => {},
  onUserLeft: (id) => {},
});
```

---

## Hooks API

### useMeeting()

```ts
const { join, startLocalStream, leave, localParticipant, meetingId } =
  useMeeting();
```

---

### useParticipants()

```ts
const participants = useParticipants();
```

---

### useRemoteVideo()

```tsx
const ref = useRemoteVideo(participantId);

return <video ref={ref} autoPlay />;
```

---

### useLocalStream()

```ts
const stream = useLocalStream();
```

---

### useStreams()

```ts
const streams = useStreams();
```

---

## Complete Example

```tsx
export default function App() {
  const [state] = useState(() => new MeetingState());

  const [core] = useState(
    () =>
      new VideoSDKCore(state, {
        onTrack: () => {},
        onUserJoined: () => {},
        onUserLeft: () => {},
      }),
  );

  return (
    <MeetingProvider core={core}>
      <VideoCallContent />
    </MeetingProvider>
  );
}
```

---

## Server Requirements

Your WebSocket server must support:

### Client → Server

- JOIN
- OFFER
- ANSWER
- ICE

### Server → Client

- EXISTING_USERS
- USER_JOINED
- USER_LEFT

---

## Performance Tips

- Stop media tracks on leave
- Memoize participant components
- Use multiple STUN servers
- Avoid re-rendering video elements

---

## Browser Support

- Chrome 54+
- Firefox 55+
- Safari 11+
- Edge 79+

---

## 📄 License

MIT
