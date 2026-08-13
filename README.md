# @afosecure/meetingsdk

React/TypeScript SDK for the **DEFCOMM Rust SFU**.

This guide is for developers integrating the SDK into a React application. It covers installation, configuration, joining, media, participants, screen sharing, reconnection, recording, room management, signaling, and production integration.

> **Important:** This package is an SFU client. It is **not** a mesh/P2P SDK.

## Quick start

```bash
npm install @afosecure/meetingsdk
```

Configure the SDK once:

```ts
import { updateSDKConfig } from "@afosecure/meetingsdk";

updateSDKConfig({
  apiBase: "https://your-sfu.example.com/api",
  wsBase: "wss://your-sfu.example.com/ws",
});
```

Then put your meeting UI inside `MeetingProvider`:

```tsx
import {
  MeetingProvider,
  useMeeting,
  useParticipants,
} from "@afosecure/meetingsdk";

function MeetingRoom() {
  const {
    join,
    leave,
    toggleMic,
    toggleCam,
    startScreenShare,
    stopScreenShare,
    startRecording,
    stopRecording,
  } = useMeeting();

  const participants = useParticipants();

  return (
    <div>
      <button onClick={join}>Join</button>
      <button onClick={toggleMic}>Mic</button>
      <button onClick={toggleCam}>Camera</button>
      <button onClick={startScreenShare}>Share screen</button>
      <button onClick={stopScreenShare}>Stop sharing</button>
      <button onClick={startRecording}>Record</button>
      <button onClick={stopRecording}>Stop recording</button>
      <button onClick={leave}>Leave</button>

      {participants.map((participant) => (
        <div key={participant.id}>{participant.name}</div>
      ))}
    </div>
  );
}

export function MeetingPage({ roomCode }: { roomCode: string }) {
  return (
    <MeetingProvider roomCode={roomCode} displayName="Afolabi">
      <MeetingRoom />
    </MeetingProvider>
  );
}
```

Call `join()` from a user action so the browser can request camera/microphone permission normally. The SDK then obtains the SFU token, opens `/ws`, sends JOIN, creates publisher/subscriber PeerConnections, publishes local media, and subscribes to remote tracks. fileciteturn9file0L87-L113

---

# 1. Architecture

The SDK uses one publisher PeerConnection and one subscriber PeerConnection per participant:

```text
Browser
  ├── Publisher RTCPeerConnection ── publish_offer ──> Rust SFU
  │
  └── Subscriber RTCPeerConnection <─ subscribe_offer ── Rust SFU
                                              │
                                          MediaRouter
                                              │
                                      other participants
```

The SFU-generated track ID is the authoritative bridge between signaling metadata and browser `MediaStreamTrack` objects. fileciteturn9file0L5-L20

Think of the system as:

```text
Your React application
        │
        ▼
@afosecure/meetingsdk
        │
        ├── WebSocket signaling
        └── WebRTC media
                │
                ▼
        DEFCOMM Rust SFU
                │
        ┌───────┴────────┐
        │                │
     RTP/RTCP         Recording
        │
     MediaRouter
```

The application owns the UI. The SDK owns browser WebRTC/signaling orchestration. The SFU owns authoritative room and media state.

---

# 2. Installation

```bash
npm install @afosecure/meetingsdk
```

The package is intended for React + TypeScript applications.

---

# 3. Configuration

```ts
import { updateSDKConfig } from "@afosecure/meetingsdk";

updateSDKConfig({
  apiBase: "https://your-sfu.example.com/api",
  wsBase: "wss://your-sfu.example.com/ws",
});
```

Use:

```text
apiBase → REST API base
wsBase  → WebSocket signaling endpoint
```

For local development:

```ts
updateSDKConfig({
  apiBase: "http://localhost:8080/api",
  wsBase: "ws://localhost:8080/ws",
});
```

For production:

```ts
updateSDKConfig({
  apiBase: "https://sfu.example.com/api",
  wsBase: "wss://sfu.example.com/ws",
});
```

Do **not** use the old mesh `/watch/:room` endpoint. The current SFU uses `/ws` plus REST room/token APIs. fileciteturn9file0L76-L85

---

# 4. Meeting lifecycle

A normal meeting follows:

```text
Configure SDK
    ↓
MeetingProvider
    ↓
User clicks Join
    ↓
Get SFU access token
    ↓
Open WebSocket
    ↓
JOIN
    ↓
Create publisher/subscriber PCs
    ↓
Publish microphone + camera
    ↓
Subscribe to remote tracks
    ↓
Attach media to UI
```

The current protocol includes joining/leaving, SDP negotiation, subscriptions, ICE, track state, screen sharing, recording, admission control, and related events. fileciteturn9file0L22-L64

---

# 5. Stable participant identity

The SDK creates a browser participant ID only when one does not already exist.

Storage key:

```text
defcomm:participant_id
```

Therefore:

```text
First load       → generate ID
Reload           → reuse ID
Temporary outage → reuse ID
Reconnect        → reuse ID
```

The room-specific resume token is stored as:

```text
defcomm:sfu:resume:<roomCode>
```

A transient network failure does not clear the resume token. An intentional `leave()` does. fileciteturn9file0L116-L132

This distinction is critical:

```text
Network loss
    → reconnect/resume

User clicked Leave
    → actual departure
```

---

# 6. Joining a meeting

```tsx
const {
  join,
  leave,
} = useMeeting();
```

Join from a user interaction:

```tsx
<button onClick={join}>Join meeting</button>
```

Leave intentionally:

```tsx
<button onClick={leave}>Leave</button>
```

Do not close the WebSocket manually to simulate leaving. Use the SDK's `leave()` method so the SFU receives the proper leave operation and local state is cleaned up.

---

# 7. Participant model

Conceptually:

```ts
type Participant = {
  id: string;
  name?: string;

  connectionState?:
    | "connected"
    | "reconnecting"
    | "disconnected";

  media?: {
    stream?: MediaStream | null;
    screenStream?: MediaStream | null;

    cameraTrack?: MediaStreamTrack;
    screenTrack?: MediaStreamTrack;
    audioTrack?: MediaStreamTrack;

    micEnabled: boolean;
    camEnabled: boolean;
    isScreenSharing: boolean;
  };
};
```

The SDK exposes these connection and media states for meeting UI. fileciteturn9file0L367-L385

---

# 8. Remote audio/video

Use `useRemoteMedia(participantId)`:

```tsx
import { useRemoteMedia } from "@afosecure/meetingsdk";

function RemoteMedia({ participantId }: { participantId: string }) {
  const {
    videoRef,
    audioRef,
    isCamActive,
    isMicEnabled,
  } = useRemoteMedia(participantId);

  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
      />

      <audio
        ref={audioRef}
        autoPlay
      />
    </>
  );
}
```

The video element is muted because remote audio is attached separately through the audio element. fileciteturn9file0L161-L178

---

# 9. Track mapping

The SDK maps:

```text
SFU TrackInfo.track_id
        ↓
browser track.id ("track-" + id)
        ↓
normalize ID
        ↓
TrackInfo.participant_id
        ↓
Participant
        ↓
MediaStream
```

Do not rely on:

```ts
track.participant_id
```

Browsers do not provide `participant_id` as a standard `MediaStreamTrack` property. fileciteturn9file0L144-L159

---

# 10. Microphone and camera

```tsx
const {
  toggleMic,
  toggleCam,
} = useMeeting();
```

Use:

```tsx
<button onClick={toggleMic}>Mic</button>
<button onClick={toggleCam}>Camera</button>
```

The state flow is:

```text
toggleMic()
   ↓
MediaStreamTrack.enabled
   ↓
track_state
   ↓
Rust SFU
   ↓
track_state_changed
   ↓
remote UI
```

The same mechanism is used for camera state. fileciteturn9file0L180-L204

### Important

Remote mute/camera icons should be **signaling authoritative**.

Do not infer a remote participant's state only from:

```ts
remoteTrack.muted
```

or missing RTP.

Use:

```ts
participant.media?.micEnabled
participant.media?.camEnabled
```

The SFU is authoritative for these states. fileciteturn9file0L202-L204

---

# 11. Professional participant tile

A participant tile should combine media and connection state:

```tsx
function ParticipantTile({ participant }: { participant: Participant }) {
  const reconnecting =
    participant.connectionState === "reconnecting";

  const micEnabled =
    participant.media?.micEnabled ?? false;

  const camEnabled =
    participant.media?.camEnabled ?? false;

  const sharing =
    participant.media?.isScreenSharing ?? false;

  return (
    <div className="participant-tile">
      {reconnecting && (
        <span className="reconnecting">
          Reconnecting...
        </span>
      )}

      <video autoPlay playsInline muted />

      <div>{participant.name}</div>

      <MicIcon muted={!micEnabled} />
      <CameraIcon off={!camEnabled} />

      {sharing && <ScreenShareIcon />}
    </div>
  );
}
```

Recommended mapping:

```text
connectionState
    ↓
reconnecting badge

micEnabled
    ↓
microphone icon

camEnabled
    ↓
camera icon

isScreenSharing
    ↓
screen-share layout
```

fileciteturn9file0L387-L405

---

# 12. Screen sharing

Screen sharing is a separate publication with:

```text
source = "screen"
```

It is not the participant's camera. fileciteturn9file0L206-L233

Start:

```tsx
await startScreenShare();
```

Stop:

```tsx
await stopScreenShare();
```

Remote state:

```ts
participant.media.screenStream
participant.media.screenTrack
participant.media.isScreenSharing
```

fileciteturn9file0L235-L244

Recommended layout:

```text
┌───────────────────────────────────────────────┐
│                                               │
│                 SCREEN SHARE                  │
│                                               │
│                                               │
└───────────────────────────────────────────────┘

  ┌────────┐  ┌────────┐  ┌────────┐
  │ Afolabi│  │  Mega  │  │  John  │
  └────────┘  └────────┘  └────────┘
```

The screen should be the primary stage. Participant cameras should become a secondary strip.

Do not attach the screen track to the participant camera element.

---

# 13. Reconnection and resume

The SDK is designed to resume the same logical participant after a temporary network/signaling failure:

```text
Network interruption
       ↓
WebSocket closes
       ↓
participant = reconnecting
       ↓
refresh access token
       ↓
JOIN + resume_token
       ↓
same logical participant
       ↓
new publisher/subscriber PCs
       ↓
republish local tracks
       ↓
resubscribe remote tracks
       ↓
fresh ICE/SDP
       ↓
connected
```

The SDK intentionally does not immediately destroy the local MediaStream when signaling temporarily disappears. It uses reconnect delays and refreshes the access token before reconnecting. fileciteturn9file0L246-L275

### UI rule

During a transient outage:

```text
Reconnecting...
```

should be shown rather than immediately removing the participant.

Only treat the participant as gone after the SFU reports an actual departure/disconnection.

---

# 14. Leave correctly

Intentional departure:

```tsx
await leave();
```

Do not manually close:

```ts
websocket.close();
```

to implement the Leave button.

The intended lifecycle is:

```text
Leave button
    ↓
leave
    ↓
SFU acknowledgement
    ↓
destroy PeerConnections
    ↓
clear room resume token
    ↓
remove local meeting state
```

A temporary network failure is different and should use reconnect/resume.

---

# 15. Private-room admission

For private rooms:

```tsx
const {
  approveJoinRequest,
  rejectJoinRequest,
} = useMeeting();
```

Approve:

```tsx
await approveJoinRequest(participantId);
```

Reject:

```tsx
await rejectJoinRequest(participantId);
```

The SFU remains authoritative. The SDK does not fabricate approval state locally. fileciteturn9file0L278-L289

---

# 16. Server-side recording

Recording is **server-side**. The browser does not use `MediaRecorder`. fileciteturn9file0L291-L340

Start:

```tsx
await startRecording();
```

Stop:

```tsx
await stopRecording();
```

Status:

```tsx
const { recording } = await getRecordingStatus();
```

Lifecycle:

```text
startRecording()
      ↓
start_recording
      ↓
Rust SFU RecordingManager
      ↓
recording_started
```

Stop:

```text
stopRecording()
      ↓
stop_recording
      ↓
RecordingManager finalizes
      ↓
recording_stopped
```

The recording belongs to the meeting/server rather than a particular browser. Recording permissions are enforced by the SFU. fileciteturn9file0L291-L340

---

# 17. Room management

Create:

```tsx
const room = await createRoom({
  name: "Engineering",
  capacity: 100,
  is_private: true,
});
```

Get:

```tsx
const room = await getRoom(roomCode);
```

Delete:

```tsx
await deleteRoom(roomCode);
```

These use the REST API. fileciteturn9file0L342-L355

---

# 18. Preview

The old mesh SDK used:

```text
/watch/:room
```

That endpoint is not part of the current Rust SFU.

`useMeetingPreview()` therefore uses the current REST room endpoint and does not fabricate live participant/media state. Live participant/media state begins after joining through `/ws`. fileciteturn9file0L358-L365

---

# 19. Current signaling protocol

### Client → SFU

```text
join
leave
publish_offer
subscribe
unsubscribe
subscribe_answer
ice_candidate
track_state
start_screen_share
stop_screen_share
start_recording
stop_recording
approve_join
reject_join
ping
```

### SFU → Client

```text
joined
join_pending
join_requested
join_approved
join_rejected
publish_answer
subscribe_offer
ice_candidate
track_published
track_unpublished
track_state_changed
participant_joined
participant_left
participant_presence
screen_share_started
screen_share_stopped
subscription_updated
recording_started
recording_stopped
pong
left
error
```

fileciteturn9file0L22-L64

---

# 20. Recommended React structure

```text
MeetingPage
│
└── MeetingProvider
    │
    ├── MeetingHeader
    │   ├── Room name
    │   ├── Connection state
    │   └── Recording indicator
    │
    ├── MeetingStage
    │   ├── ScreenShareStage
    │   └── ActiveSpeakerStage
    │
    ├── ParticipantStrip
    │   └── ParticipantTile[]
    │       ├── Video
    │       ├── Name
    │       ├── Mic icon
    │       ├── Camera icon
    │       └── Reconnecting badge
    │
    └── MeetingControls
        ├── Mic
        ├── Camera
        ├── Screen share
        ├── Record
        └── Leave
```

The SDK supplies media and meeting state. Your application owns the visual design.

---

# 21. Error handling

Catch operations that can fail:

```tsx
try {
  await join();
} catch (error) {
  console.error("Unable to join meeting", error);
}
```

Your UI should distinguish:

```text
Connecting
Reconnecting
Connected
Disconnected
Join rejected
```

Do not show "left the meeting" for a temporary ICE/WebSocket interruption.

---

# 22. Do not reintroduce mesh logic

Never create a PeerConnection per remote participant.

Wrong:

```text
A ↔ B
A ↔ C
B ↔ C
```

Correct:

```text
A ──┐
B ──┼──► SFU ──► participants
C ──┘
```

The SFU owns:

- participant identity
- room membership
- admission
- SDP negotiation
- ICE
- track publication
- subscription
- RTP forwarding
- RTCP feedback
- mute state
- screen-share state
- server-side recording

The browser SDK owns:

- browser media permissions
- publisher/subscriber PeerConnections
- signaling transport
- media attachment
- local UI state
- reconnect/resume orchestration
- React bindings

fileciteturn9file0L423-L450

---

# 23. Build

```bash
npm install
npm run build
```

Expected output:

```text
dist/
├── index.js
├── index.mjs
├── index.d.ts
└── index.d.mts
```

The SDK consumes the SFU media path:

```text
Publisher
  ↓
SFU Publisher PC
  ↓
PublishedTrackRegistry
  ↓
MediaRouter
  ↓
TrackLocalStaticRTP
  ↓
Subscriber PC
  ↓
Browser ontrack
  ↓
SDK TrackInfo mapping
  ↓
Participant MediaStream
```

fileciteturn9file0L452-L474

---

# 24. Production checklist

Before shipping:

- [ ] Configure `apiBase` and `wsBase`.
- [ ] Use HTTPS/WSS in production.
- [ ] Render hooks inside `MeetingProvider`.
- [ ] Call `join()` from a user action.
- [ ] Handle camera/microphone permissions.
- [ ] Render remote video and audio separately.
- [ ] Keep video elements muted when remote audio is attached separately.
- [ ] Use SFU signaling for remote mic/camera icons.
- [ ] Render screen sharing separately from camera.
- [ ] Show `Reconnecting...` during transient network loss.
- [ ] Do not remove a participant immediately on temporary connection loss.
- [ ] Use `leave()` for intentional departure.
- [ ] Do not create mesh PeerConnections.
- [ ] Restrict recording controls to authorized users.
- [ ] Treat recording as server-side.
- [ ] Test reload, reconnect, leave, and rejoin.
- [ ] Run `npm run build` before publishing.
- [ ] Keep the SDK and SFU signaling protocol versions compatible.

---

# 25. Developer mental model

The simplest mental model is:

```text
YOUR APPLICATION
      │
      │ UI + meeting controls
      ▼
@afosecure/meetingsdk
      │
      ├── React hooks
      ├── WebSocket signaling
      ├── Publisher PC
      ├── Subscriber PC
      ├── Media attachment
      └── Reconnect/resume
      │
      ▼
DEFCOMM RUST SFU
      │
      ├── Rooms
      ├── Participants
      ├── Admission
      ├── SDP / ICE
      ├── Track registry
      ├── MediaRouter
      ├── RTCP feedback
      ├── Screen-share state
      └── Recording
```

**Key rule:** the application owns presentation, the SDK owns browser WebRTC, and the SFU owns authoritative meeting/media state.
