# VideoSDK - React Video Meeting Library

A modern, lightweight React SDK for building peer-to-peer video communication applications. Built on WebRTC with a clean, composable API.

## Features

- **WebRTC P2P Video** - Direct peer-to-peer video connections
- **React Hooks** - Composable React hooks for easy integration
- **Simple API** - Intuitive, easy-to-understand interface
- **State Management** - Built-in reactive state management
- **Lightweight** - Minimal dependencies, small bundle size
- **TypeScript** - Full TypeScript support with type definitions

## Installation

```bash
npm install meetingsdk
# or
yarn add meetingsdk
# or
pnpm add meetingsdk
```

## Quick Start

### 1. Initialize the SDK

```typescript
import { MeetingState, VideoSDKCore } from "meetingsdk";

const state = new MeetingState();
const core = new VideoSDKCore("ws://your-server:8080", state);
```

### 2. Setup React Provider

Wrap your app with `MeetingProvider`:

```tsx
import { MeetingProvider } from "meetingsdk";

function App() {
  const [core] = useState(
    () => new VideoSDKCore("ws://your-server:8080", new MeetingState()),
  );

  return (
    <MeetingProvider core={core}>
      <YourApp />
    </MeetingProvider>
  );
}
```

### 3. Use the Hooks

```tsx
import {
  useMeeting,
  useParticipants,
  useRemoteVideo,
  useLocalStream,
} from "meetingsdk";

function VideoCall() {
  const { join, startLocalStream, leave } = useMeeting();
  const participants = useParticipants();
  const localStream = useLocalStream();

  const handleJoin = async () => {
    const videoEl = document.getElementById("localVideo");
    await startLocalStream(videoEl, "Your Name");
    await join("room-id");
  };

  return (
    <div>
      <button onClick={handleJoin}>Join Meeting</button>
      <video id="localVideo" autoplay muted></video>

      {participants.map((p) => (
        <RemoteVideo key={p.id} participant={p} />
      ))}
    </div>
  );
}
```

## Core Concepts

### MeetingState

Central state management for your meeting. Tracks participants and streams.

```typescript
const state = new MeetingState();

// Get all participants
state.getParticipants(); // Participant[]

// Subscribe to state changes
const unsubscribe = state.subscribe(() => {
  console.log("State updated!");
});

// Cleanup
unsubscribe();
```

### VideoSDKCore

Main SDK class for managing connections and communication.

```typescript
const core = new VideoSDKCore(serverUrl, state, {
  onTrack: (stream, peerId) => console.log("Got stream from", peerId),
  onUserJoined: (participant) => console.log("User joined:", participant),
  onUserLeft: (userId) => console.log("User left:", userId),
});

// Initialize local video
await core.initLocal(videoElement, "Your Name");

// Join a meeting
await core.connect("room-id", "Your Name");

// Leave the meeting
core.disconnect();
```

## React Hooks API

### useMeeting()

Get meeting control methods and info.

```tsx
const { join, startLocalStream, leave, localParticipant, meetingId } =
  useMeeting();
```

**Returns:**

- `join(roomId: string, name: string): Promise<void>` - Join a meeting
- `startLocalStream(element: HTMLVideoElement, name: string): Promise<void>` - Start local video
- `leave(): void` - Leave the meeting
- `localParticipant: Participant | null` - Current user's info
- `meetingId: string | null` - Current room ID

### useParticipants()

Get list of all participants in the meeting.

```tsx
const participants = useParticipants(); // Participant[]

participants.forEach((p) => {
  console.log(p.id, p.name);
});
```

**Returns:** `Participant[]`

### useRemoteVideo(participantId)

Attach remote video stream to an element.

```tsx
const videoRef = useRemoteVideo(participantId);

return <video ref={videoRef} autoplay />;
```

**Parameters:**

- `participantId: string` - The ID of the remote participant

**Returns:** `React.RefObject<HTMLVideoElement>`

### useLocalStream()

Get the local media stream.

```tsx
const localStream = useLocalStream();

if (localStream) {
  const videoTrack = localStream.getVideoTracks()[0];
  // Use the track...
}
```

**Returns:** `MediaStream | null`

### useStreams()

Get a map of all streams keyed by participant ID.

```tsx
const streams = useStreams(); // Map<string, MediaStream>

streams.forEach((stream, participantId) => {
  console.log("Stream from:", participantId);
});
```

**Returns:** `Map<string, MediaStream>`

### useMeetingContext()

Access the raw meeting context (advanced).

```tsx
const { core, state } = useMeetingContext();

// Access core SDK directly
core.disconnect();

// Access raw state
state.participants.forEach((p) => {
  console.log(p);
});
```

**Returns:** `{ core: VideoSDKCore, state: MeetingState }`

## Complete Example

```tsx
import React, { useRef, useState } from "react";
import {
  MeetingProvider,
  VideoSDKCore,
  MeetingState,
  useMeeting,
  useParticipants,
  useRemoteVideo,
} from "meetingsdk";

function RemoteVideo({ participantId }) {
  const ref = useRemoteVideo(participantId);
  return <video ref={ref} autoplay style={{ width: "200px" }} />;
}

function VideoCallContent() {
  const { join, startLocalStream, leave, localParticipant } = useMeeting();
  const participants = useParticipants();
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");
  const localVideoRef = useRef(null);

  const handleJoin = async () => {
    if (!localVideoRef.current) return;

    try {
      await startLocalStream(localVideoRef.current, name);
      await join(roomId);
    } catch (error) {
      console.error("Failed to join:", error);
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h1>Video Meeting</h1>

      {!localParticipant ? (
        <div>
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />
          <button onClick={handleJoin}>Join Call</button>
        </div>
      ) : (
        <div>
          <h2>In Call</h2>
          <p>You: {localParticipant.name}</p>
          <video
            ref={localVideoRef}
            autoplay
            muted
            style={{ width: "300px", border: "2px solid blue" }}
          />
          <button onClick={leave}>Leave Call</button>

          <h3>Participants ({participants.length})</h3>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {participants.map((participant) => (
              <div key={participant.id}>
                <p>{participant.name}</p>
                <RemoteVideo participantId={participant.id} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [state] = useState(() => new MeetingState());
  const [core] = useState(() => new VideoSDKCore("ws://localhost:8080", state));

  return (
    <MeetingProvider core={core}>
      <VideoCallContent />
    </MeetingProvider>
  );
}
```

## Server Requirements

Your server should handle WebSocket connections and support the following message types:

```typescript
// Client to Server
interface JoinMessage {
  type: "JOIN";
  room_id: string;
  user_id: string;
  sender_name: string;
}

interface OfferMessage {
  type: "OFFER";
  payload: string; // SDP
  sender: string;
  target: string;
}

interface AnswerMessage {
  type: "ANSWER";
  payload: string; // SDP
  sender: string;
  target: string;
}

interface IceMessage {
  type: "ICE";
  payload: string; // JSON stringified RTCIceCandidate
  sender: string;
  target: string;
}

// Server to Client
interface ExistingUsersMessage {
  type: "EXISTING_USERS";
  participants: Participant[];
}

interface UserJoinedMessage {
  type: "USER_JOINED";
  participant: Participant;
}

interface UserLeftMessage {
  type: "USER_LEFT";
  peerId: string;
}
```

## Advanced Usage

### Custom Event Handlers

```typescript
const core = new VideoSDKCore("ws://localhost:8080", state, {
  onTrack: (stream, peerId) => {
    console.log("Received stream from:", peerId);
    // Handle incoming stream
  },
  onUserJoined: (participant) => {
    console.log("User joined:", participant.name);
    // Show notification
  },
  onUserLeft: (userId) => {
    console.log("User left:", userId);
    // Clean up UI
  },
});
```

### Accessing Raw State

For more control, access the state directly:

```tsx
function AdvancedExample() {
  const { state } = useMeetingContext();

  // Direct access to participants map
  console.log(state.participants);

  // Direct access to streams
  console.log(state.streams);

  // Local participant
  console.log(state.localParticipant);

  // Local stream
  console.log(state.localStream);

  return null;
}
```

## Performance Tips

1. **Memoize Components** - Use `React.memo()` for video components
2. **Lazy Load** - Consider code-splitting the SDK
3. **Stop Tracks** - Always stop tracks before disconnecting
4. **ICE Servers** - Configure multiple STUN servers for better connectivity
5. **Video Constraints** - Set appropriate video constraints for your use case

```typescript
// Example with constraints
await navigator.mediaDevices.getUserMedia({
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
  },
});
```

## Browser Support

- Chrome/Edge: 54+
- Firefox: 55+
- Safari: 11+
- Mobile browsers with WebRTC support

## Troubleshooting

### No video showing

- Check browser permissions for camera/microphone
- Ensure server is running and WebSocket is accessible
- Verify `startLocalStream()` is called before `join()`

### Participants not connecting

- Check WebSocket connection status
- Verify STUN server is accessible
- Check browser console for ICE errors

### Audio/Video issues

- Check user has granted permissions
- Verify constraints are compatible with device
- Check for resource conflicts with other apps

## License

ISC

## Contributing

Contributions welcome! Please submit PRs to improve the SDK.

## Support

For issues, questions, or suggestions, please open an issue on GitHub.
