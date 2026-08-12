# @afosecure/meetingsdk

React/TypeScript SDK for the **DEFCOMM Rust SFU**.

This package is no longer a mesh/P2P SDK. It uses the current DEFCOMM SFU architecture:

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

The SDK keeps the media and signaling responsibilities separate and uses the
SFU-generated track ID as the authoritative bridge between signaling metadata
and browser `MediaStreamTrack` objects.

## Current SFU protocol

### Client → SFU

- `join`
- `leave`
- `publish_offer`
- `subscribe`
- `unsubscribe`
- `subscribe_answer`
- `ice_candidate`
- `track_state`
- `start_screen_share`
- `stop_screen_share`
- `start_recording`
- `stop_recording`
- `approve_join`
- `reject_join`
- `ping`

### SFU → Client

- `joined`
- `join_pending`
- `join_requested`
- `join_approved`
- `join_rejected`
- `publish_answer`
- `subscribe_offer`
- `ice_candidate`
- `track_published`
- `track_unpublished`
- `track_state_changed`
- `participant_joined`
- `participant_left`
- `participant_presence`
- `screen_share_started`
- `screen_share_stopped`
- `subscription_updated`
- `recording_started`
- `recording_stopped`
- `pong`
- `left`
- `error`

## Installation

```bash
npm install @afosecure/meetingsdk
```

## Configuration

```ts
import { updateSDKConfig } from "@afosecure/meetingsdk";

updateSDKConfig({
  apiBase: "https://your-sfu.example.com/api",
  wsBase: "wss://your-sfu.example.com/ws",
});
```

Do not use the old mesh `/watch` signaling endpoint. The current SFU uses
`/ws` plus the REST room/token APIs.

## Join

```tsx
import {
  MeetingProvider,
  useMeeting,
  useParticipants,
  useRemoteMedia,
} from "@afosecure/meetingsdk";

function Meeting({ roomId }: { roomId: string }) {
  const {
    join,
    leave,
    toggleMic,
    toggleCam,
    startScreenShare,
    stopScreenShare,
  } = useMeeting();

  const participants = useParticipants();

  // Join once from a user gesture.
  // The SDK obtains the SFU token, opens /ws, sends JOIN, creates the
  // publisher/subscriber PeerConnections, publishes local media and
  // subscribes to existing remote tracks.
}
```

The SDK automatically creates/stores a stable browser participant ID:

```text
defcomm:participant_id
```

The ID is reused across page reloads. It is only generated when no stored ID
exists.

For reconnect/resume, the SFU `resume_token` is stored per room:

```text
defcomm:sfu:resume:<roomCode>
```

An intentional `leave()` clears that room's resume token. A transient network
failure does not.

## Media model

Each participant uses:

- one publisher PeerConnection
- one subscriber PeerConnection

The local camera and microphone are published through the publisher PC.
Remote camera/audio/screen tracks arrive through the subscriber PC.

The SDK maps:

```text
SFU TrackInfo.track_id
        ↓
browser track.id ("track-" + id)
        ↓
normalize track id
        ↓
TrackInfo.participant_id
        ↓
participant MediaStream
```

This avoids relying on custom properties such as
`MediaStreamTrack.participant_id`, which browsers do not provide.

## Remote audio

Remote audio is part of the participant MediaStream. Use the supplied
`useRemoteMedia(participantId)` hook:

```tsx
const { videoRef, audioRef, isCamActive, isMicEnabled } =
  useRemoteMedia(participantId);

return (
  <>
    <video ref={videoRef} autoPlay playsInline muted />
    <audio ref={audioRef} autoPlay />
  </>
);
```

The video element is muted to avoid duplicate audio playback.

## Mute state

Mute state is **signaling authoritative**.

When the local participant mutes:

```text
toggleMic()
   ↓
MediaStreamTrack.enabled = false
   ↓
track_state
   ↓
Rust SFU
   ↓
track_state_changed
   ↓
remote participant UI
```

The same mechanism is used for camera state.

Do not infer another participant's microphone/video icon solely from whether a
browser track happens to be muted. Use `Participant.media.micEnabled` and
`Participant.media.camEnabled`, which are updated from SFU signaling.

## Screen sharing

Screen sharing is a separate publication with:

```text
source = "screen"
```

The SDK does not merge it into the participant camera stream.

```ts
await startScreenShare();
```

and:

```ts
stopScreenShare();
```

The SDK also sends explicit:

```text
start_screen_share
stop_screen_share
```

messages so the SFU can maintain authoritative screen-share state.

The remote participant receives:

```ts
participant.media.screenStream
participant.media.screenTrack
participant.media.isScreenSharing
```

A UI should therefore render screen share as a separate primary stage rather
than replacing the participant's camera tile.

## Reconnection

The SDK intentionally does **not** destroy the local MediaStream when the
signaling WebSocket temporarily disappears.

```text
network interruption
       ↓
WebSocket closes
       ↓
participant becomes reconnecting
       ↓
token refresh
       ↓
JOIN with resume_token
       ↓
same logical participant
       ↓
new publisher/subscriber PeerConnections
       ↓
republish local tracks
       ↓
resubscribe remote tracks
       ↓
fresh ICE/SDP
       ↓
connected
```

The SDK uses exponential reconnect delays and refreshes the SFU access token
before reconnecting.

## Admission control

For private rooms:

```ts
const {
  approveJoinRequest,
  rejectJoinRequest,
} = useMeeting();
```

The SFU remains authoritative. The SDK does not invent approval state locally.

## Recording

Recording is **server-side**. The browser does not use `MediaRecorder`.

Moderators can call:

```ts
await startRecording();
```

and:

```ts
await stopRecording();
```

Recording status:

```ts
const { recording } = await getRecordingStatus();
```

The signaling lifecycle is:

```text
startRecording()
      ↓
start_recording
      ↓
Rust SFU RecordingManager
      ↓
recording_started
```

and:

```text
stopRecording()
      ↓
stop_recording
      ↓
RecordingManager finalizes
      ↓
recording_stopped
```

The SFU records RTP independently of subscriber browsers, so a participant
closing/reconnecting does not make the recording dependent on that browser.

Recording permissions are enforced by the SFU.

## Room API

The SDK also exposes:

```ts
const room = await getRoom(roomCode);

const created = await createRoom({
  name: "Engineering",
  capacity: 100,
  is_private: true,
});

await deleteRoom(roomCode);
```

## Preview

The old mesh SDK used a `/watch/:room` WebSocket preview endpoint. That endpoint
is not part of the current Rust SFU.

`useMeetingPreview()` therefore uses the current REST room endpoint and does
not fabricate a live participant count. Live participant/media state begins
after joining through `/ws`.

## Participant state

```ts
type Participant = {
  id: string;
  name?: string;
  connectionState?: "connected" | "reconnecting" | "disconnected";
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

A professional participant tile should therefore use:

```text
connectionState
    ↓
reconnecting badge

media.micEnabled
    ↓
microphone icon

media.camEnabled
    ↓
camera icon

media.isScreenSharing
    ↓
screen-share layout
```

## Build

```bash
npm install
npm run build
```

The package emits:

```text
dist/index.js
dist/index.mjs
dist/index.d.ts
dist/index.d.mts
```

## Important architectural rule

Do not reintroduce mesh behavior into this SDK.

The SFU is responsible for:

- participant identity
- admission
- room membership
- SDP negotiation
- ICE
- track publication
- subscription
- RTP forwarding
- RTCP feedback
- mute state
- screen-share state
- server-side recording

The browser SDK is responsible for:

- browser media permissions
- publisher/subscriber PeerConnections
- signaling transport
- media attachment
- local UI state
- reconnect/resume orchestration
- React bindings

The current Rust SFU's media path is:

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

This is the architecture the SDK is built to consume.
