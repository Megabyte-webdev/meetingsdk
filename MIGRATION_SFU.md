# Mesh SDK → DEFCOMM SFU migration

The old SDK was designed around peer-to-peer/mesh signaling. The current SDK
is a client for the DEFCOMM Rust SFU.

## Removed assumptions

The SDK no longer assumes:

- one RTCPeerConnection per remote participant;
- `EXISTING_USERS`, `USER_JOINED`, `USER_LEFT`;
- server `/watch/:room` presence;
- client-generated peer offers/answers between participants;
- remote `MediaStreamTrack` objects containing participant IDs.

## Current model

Each browser has exactly:

```text
Publisher PC
Subscriber PC
```

The publisher sends the browser's local media to the SFU. The subscriber
receives tracks selected by the SFU.

## Signaling mapping

| Old mesh concept | Current SFU |
|---|---|
| peer offer | `publish_offer` |
| peer answer | `publish_answer` |
| remote peer connection | subscriber PC |
| remote user stream | SFU track subscription |
| peer ICE | `ice_candidate` with `peer` |
| user mute | `track_state` |
| remote mute state | `track_state_changed` |
| screen-share peer stream | `source: "screen"` |
| reconnect by creating a new user | resume existing participant |
| browser recording | server-side RecordingManager |

## Stable identity

A stable browser ID is stored in:

```text
defcomm:participant_id
```

A room-specific SFU resume token is stored in:

```text
defcomm:sfu:resume:<roomCode>
```

A reconnect uses both.

An explicit leave clears the resume token so a later join is a genuine new
session.

## Server-side recording

Recording is controlled through SFU signaling:

```text
start_recording
stop_recording
```

Only the server decides whether the caller has moderator permission.

The SDK does not create a `MediaRecorder` and does not upload a browser
composite.

## Mute state

The UI should not infer another participant's mute state from RTP delivery.

The authoritative state comes from:

```text
track_state_changed
```

and is represented in:

```ts
participant.media.micEnabled
participant.media.camEnabled
```

## Screen share

Screen share is a separate SFU publication:

```text
source: "screen"
```

The participant camera remains a separate publication:

```text
source: "camera"
```

A standard meeting UI should therefore render the screen share in the main
stage and keep the participant camera in the participant strip.

## Reconnect

A temporary signaling/network failure does not equal `participant_left`.

The expected lifecycle is:

```text
connected
   ↓
reconnecting
   ↓
JOIN + resume_token
   ↓
connected
```

The SFU has a reconnect grace period. The SDK therefore keeps the local
MediaStream alive while reconnecting.

## Authoritative leave

The SDK sends:

```text
leave
```

and waits briefly for:

```text
left
```

before closing the signaling socket. This prevents the client-side leave path
from racing the server's authoritative participant cleanup.

## Production note

The SDK and Rust SFU must be versioned together. A signaling message or payload
change on the Rust side should be treated as a protocol change and reflected
in `SFUClient.ts` rather than adding a second legacy protocol.
