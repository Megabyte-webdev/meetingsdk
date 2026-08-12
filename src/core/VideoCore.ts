import { SDK_CONFIG } from "../config/ws";
import {
  ChatInput,
  ChatMessage,
  Events,
  MeetingConfig,
  Participant,
  SDKError,
  RecordingInfo,
} from "../types/meeting";
import { MeetingState } from "./MeetingState";
import { SFUClient, SFUConnectionState, TrackInfo } from "./SFUClient";

export class VideoSDKCore {
  private sfuClient: SFUClient | null = null;
  private myId: string;
  private room: { id: string | null; name: string | null } = {
    id: null,
    name: null,
  };
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private isScreenSharing = false;
  private participantName = "";
  public readonly state: MeetingState;
  private intentionalDisconnect = false;
  private remoteStreams = new Map<string, MediaStream>();
  private remoteScreenStreams = new Map<string, MediaStream>();

  private emitError(
    code: string,
    message: string,
    raw?: any,
    recoverable = true,
  ) {
    const err: SDKError = {
      code,
      message,
      raw,
      roomId: this.room.id,
      userId: this.myId,
      recoverable,
    };

    this.events.onError?.(err);
    console.error("[MeetingSDK Error]", err);
  }

  constructor(
    private events: Events = {},
    private apiBase: string = SDK_CONFIG.apiBase ||
      "https://api.example.com/api",
    private wsBase: string = SDK_CONFIG.wsBase || "wss://api.example.com/ws",
  ) {
    this.state = new MeetingState();
    this.events = events;

    let storedId: string | null = null;
    try {
      storedId = typeof localStorage !== "undefined"
        ? localStorage.getItem("defcomm:participant_id")
        : null;
    } catch {
      // SSR/private browsing may not expose localStorage.
    }

    this.myId =
      storedId ||
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `user_${Date.now()}`);

    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("defcomm:participant_id", this.myId);
      }
    } catch {
      // ignore
    }
  }

  // ============ LOCAL MEDIA ============

  async initLocal(video: HTMLVideoElement, name: string) {
    this.participantName = name;

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const hasVideo = this.localStream
        .getVideoTracks()
        .some((t) => t.readyState === "live");
      const hasAudio = this.localStream
        .getAudioTracks()
        .some((t) => t.readyState === "live");

      if (!hasVideo || !hasAudio) {
        throw new Error(`Missing tracks: video=${hasVideo}, audio=${hasAudio}`);
      }

      video.srcObject = this.localStream;
      this.updateLocalMedia();
    } catch (err: any) {
      this.emitError("GET_USER_MEDIA_FAILED", err?.message, err, false);
      throw err;
    }
  }

  private updateLocalMedia(audioMuted = false, videoMuted = false) {
    if (!this.localStream) return;

    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: {
        stream: this.localStream,
        cameraTrack: this.localStream.getVideoTracks()[0],
        audioTrack: this.localStream.getAudioTracks()[0],
        micEnabled:
          this.localStream.getAudioTracks()[0]?.enabled ?? !audioMuted,
        camEnabled:
          this.localStream.getVideoTracks()[0]?.enabled ?? !videoMuted,
        isScreenSharing: this.isScreenSharing,
        screenStream: this.screenStream,
        screenTrack: this.screenStream?.getVideoTracks()[0],
      },
    });
    this.state.localStream = this.localStream;
  }

  // ============ CONNECTION / SIGNALLING ============

  async createRoom(input: {
    name: string;
    description?: string;
    capacity?: number;
    is_private?: boolean;
  }) {
    const client = this.sfuClient ?? new SFUClient({
      apiBase: this.apiBase,
      wsBase: this.wsBase,
      userId: this.myId,
    });
    return client.createRoom(input);
  }

  async getRoom(roomCode: string) {
    const client = this.sfuClient ?? new SFUClient({
      apiBase: this.apiBase,
      wsBase: this.wsBase,
      userId: this.myId,
    });
    return client.getRoom(roomCode);
  }

  async deleteRoom(roomCode: string) {
    const client = this.sfuClient ?? new SFUClient({
      apiBase: this.apiBase,
      wsBase: this.wsBase,
      userId: this.myId,
    });
    return client.deleteRoom(roomCode);
  }

  async joinMeeting(config: MeetingConfig) {
    const { roomId, name, audioMuted = false, videoMuted = false } = config;

    if (!roomId || !name) {
      throw new Error("roomId and name are required to join meeting");
    }

    this.intentionalDisconnect = false;
    this.participantName = name;
    this.room.id = roomId;
    this.room.name = name;

    if (!this.localStream) {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
    }

    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !audioMuted;
    });
    this.localStream.getVideoTracks().forEach((track) => {
      track.enabled = !videoMuted;
    });

    this.updateLocalMedia(audioMuted, videoMuted);
    return this.connect(roomId, name);
  }

  private async connect(roomId: string, name: string) {
    if (this.sfuClient) {
      await this.sfuClient.leave();
      this.sfuClient = null;
    }

    const client = new SFUClient({
      apiBase: this.apiBase,
      wsBase: this.wsBase,
      userId: this.myId,
      autoSubscribe: true,

      onStateChange: (state) => this.handleSFUState(state),

      onConnected: (payload, resumed) => {
        console.log(
          `[SFU] ${resumed ? "Resumed" : "Joined"} room`,
          payload,
        );
        this.state.updateLocalParticipant({
          id: this.myId,
          name: this.participantName,
        });
      },

      onDisconnected: () => {
        console.log("[SFU] Signaling WebSocket disconnected; reconnecting");
      },

      onReconnecting: (attempt) => {
        console.warn(`[SFU] Reconnecting, attempt ${attempt}`);
      },

      onJoinPending: (info) => {
        console.log("[SFU] Join request pending", info);
        this.events.onEntryRequested?.({
          requestId: info.request_id,
          userId: this.myId,
          name: this.participantName,
        });
      },

      onJoinApproved: (requestId) => {
        console.log("[SFU] Join approved", requestId);
        this.events.onJoinApproved?.(requestId);
        this.events.onEntryResponded?.(
          { participantId: this.myId, decision: "approved" },
          "approved",
        );
      },

      onJoinRejected: (requestId, reason) => {
        console.warn("[SFU] Join rejected", requestId, reason);
        this.events.onJoinRejected?.(requestId);
        this.events.onEntryResponded?.(
          { participantId: this.myId, decision: "rejected" },
          "rejected",
        );
        this.emitError(
          "JOIN_REJECTED",
          reason || "Your request to join was rejected",
          { requestId, reason },
          false,
        );
      },

      onJoinRequested: (request) => {
        const requestId = request?.request_id || request?.requestId;
        const userId = request?.user_id || request?.userId;
        const nameValue =
          request?.user_metadata?.name ||
          request?.display_name ||
          request?.name ||
          "Participant";

        if (!requestId || !userId) return;

        this.events.onEntryRequested?.({
          requestId,
          userId,
          name: nameValue,
        });
      },

      onParticipantJoined: (participant) => {
        const pid = participant.participant_id;
        if (!pid || pid === this.myId) return;

        const pname =
          participant.user_metadata?.name ||
          participant.display_name ||
          "Participant";

        this.state.addParticipant({
          id: pid,
          name: pname,
          connectionState: "connected",
          media: {
            micEnabled: true,
            camEnabled: true,
            isScreenSharing: false,
            stream: null,
          },
        });

        this.events.onUserJoined?.({
          id: pid,
          name: pname,
        });
      },

      onParticipantPresence: (participantId, presence) => {
        if (participantId === this.myId) return;

        const current = this.state.getParticipant(participantId);
        if (!current) return;

        const connectionState =
          presence === "reconnecting"
            ? "reconnecting"
            : presence === "connected" || presence === "online"
              ? "connected"
              : presence === "disconnected"
                ? "disconnected"
                : current.connectionState;

        this.state.updateParticipantMedia(participantId, {
          stream: current.media?.stream ?? null,
        });

        const next = new Map(this.state.participants);
        next.set(participantId, {
          ...current,
          connectionState,
        });
        this.state.participants = next;
        this.state.notify(`participant:${participantId}`);
        this.state.notify("participants");
      },

      onParticipantLeft: (participant) => {
        const pid =
          typeof participant === "string"
            ? participant
            : participant.participant_id;
        if (!pid) return;

        console.log("[SFU] Participant permanently left", pid);
        this.cleanupRemoteParticipant(pid);
        this.state.removeParticipant(pid);
        this.events.onUserLeft?.(pid);
      },

      onTrackPublished: (track) => {
        console.log("[SFU] Track published", track);
      },

      onTrackUnpublished: (track) => {
        console.log("[SFU] Track unpublished", track);
        const pid = track.participant_id;
        if (!pid) return;

        const current = this.state.getParticipant(pid);
        if (track.source === "screen") {
          const screen = this.remoteScreenStreams.get(pid);
          screen?.getTracks().forEach((t) => t.stop());
          this.remoteScreenStreams.delete(pid);

          this.state.updateParticipantMedia(pid, {
            isScreenSharing: false,
            screenStream: null,
            screenTrack: undefined,
          });
          this.events.onScreenShareStopped?.(pid);
          return;
        }

        if (!current) return;
        this.state.updateParticipantMedia(pid, {
          stream: current.media?.stream ?? null,
          micEnabled:
            track.kind === "audio" ? false : current.media?.micEnabled ?? true,
          camEnabled:
            track.kind === "video" ? false : current.media?.camEnabled ?? true,
        });
      },

      onTrackStateChanged: (track) => {
        const pid = track.participant_id;
        if (!pid || pid === this.myId) return;

        const current = this.state.getParticipant(pid);
        if (!current) return;

        if (track.source === "audio") {
          this.state.updateParticipantMedia(pid, {
            stream: current.media?.stream ?? null,
            micEnabled: !track.muted,
          });
          this.events.onMuteStateChanged?.(pid, "audio", track.muted);
        } else if (track.source === "camera") {
          this.state.updateParticipantMedia(pid, {
            stream: current.media?.stream ?? null,
            camEnabled: !track.muted,
          });
          this.events.onMuteStateChanged?.(pid, "video", track.muted);
        }

        this.events.onTrackStateChanged?.(track as any);
      },

      onRecordingStarted: (recording) => {
        this.events.onRecordingStarted?.(recording);
      },

      onRecordingStopped: (recording) => {
        this.events.onRecordingStopped?.(recording);
      },

      onRemoteTrack: (track, stream, metadata) => {
        this.handleRemoteTrack(track, stream, metadata);
      },

      onScreenShareStarted: (participantId, track) => {
        if (participantId === this.myId) return;
        console.log("[SFU] Screen share started", participantId, track);

        const current = this.state.getParticipant(participantId);
        if (current) {
          this.state.updateParticipantMedia(participantId, {
            isScreenSharing: true,
            screenStream: current.media?.screenStream ?? null,
          });
        }
      },

      onScreenShareStopped: (participantId) => {
        if (participantId === this.myId) return;

        const screen = this.remoteScreenStreams.get(participantId);
        screen?.getTracks().forEach((track) => track.stop());
        this.remoteScreenStreams.delete(participantId);

        this.state.updateParticipantMedia(participantId, {
          isScreenSharing: false,
          screenStream: null,
          screenTrack: undefined,
        });
        this.events.onScreenShareStopped?.(participantId);
      },

      onError: (error) => {
        console.error("[SFU] Error:", error);
        this.emitError("SFU_ERROR", error?.message || String(error), error, true);
      },
    });

    this.sfuClient = client;
    client.setLocalStream(this.localStream);

    // This promise remains pending while a private-room join is waiting for
    // approval. It resolves only after the Rust server sends `joined`.
    return client.getToken(roomId, {
      displayName: name,
      userId: this.myId,
    });
  }

  private handleSFUState(state: SFUConnectionState) {
    this.events.onConnectionStateChanged?.(state);

    if (state === "reconnecting") {
      this.state.updateLocalParticipant({
        id: this.myId,
        name: this.participantName,
      });
      return;
    }

    if (state === "disconnected" && !this.intentionalDisconnect) {
      this.emitError(
        "CONNECTION_LOST",
        "Unable to reconnect to SFU server",
        null,
        true,
      );
    }
  }

  private handleRemoteTrack(
    track: MediaStreamTrack,
    stream: MediaStream,
    metadata: TrackInfo,
  ) {
    const participantId = metadata?.participant_id;
    if (!participantId || participantId === this.myId) return;

    const source = metadata.source;

    if (source === "screen") {
      let screenStream = this.remoteScreenStreams.get(participantId);
      if (!screenStream) {
        screenStream = new MediaStream();
        this.remoteScreenStreams.set(participantId, screenStream);
      }

      for (const old of screenStream.getVideoTracks()) {
        if (old.id !== track.id) {
          screenStream.removeTrack(old);
          old.stop();
        }
      }

      if (!screenStream.getTracks().some((t) => t.id === track.id)) {
        screenStream.addTrack(track);
      }

      this.state.updateParticipantMedia(participantId, {
        screenStream,
        screenTrack: track,
        isScreenSharing: true,
      });
      this.events.onScreenShareStarted?.(participantId, screenStream);
      return;
    }

    let remoteStream = this.remoteStreams.get(participantId);
    if (!remoteStream) {
      remoteStream = new MediaStream();
      this.remoteStreams.set(participantId, remoteStream);
    }

    // Keep exactly one audio and one camera video track per participant.
    for (const old of remoteStream.getTracks()) {
      if (old.kind === track.kind && old.id !== track.id) {
        remoteStream.removeTrack(old);
        old.stop();
      }
    }

    if (!remoteStream.getTracks().some((t) => t.id === track.id)) {
      remoteStream.addTrack(track);
    }

    const current = this.state.getParticipant(participantId);
    this.state.updateParticipantMedia(participantId, {
      stream: remoteStream,
      cameraTrack:
        track.kind === "video"
          ? track
          : current?.media?.cameraTrack,
      audioTrack:
        track.kind === "audio"
          ? track
          : current?.media?.audioTrack,
    });

    this.events.onTrack?.(remoteStream, participantId);

    track.onended = () => {
      if (track.kind === "video") {
        const participant = this.state.getParticipant(participantId);
        this.state.updateParticipantMedia(participantId, {
          camEnabled: false,
          stream: remoteStream,
        });
        return;
      }

      const participant = this.state.getParticipant(participantId);
      this.state.updateParticipantMedia(participantId, {
        micEnabled: false,
        stream: remoteStream,
      });
    };
  }

  getMeeting(): { id: string | null; name: string | null } {
    return this.room;
  }

  // ============ ADMISSION CONTROL ============

  async approveJoinRequest(requestId: string) {
    if (!this.sfuClient) throw new Error("SFU client is not connected");
    return this.sfuClient.approveJoinRequest(requestId);
  }

  async rejectJoinRequest(requestId: string, reason?: string) {
    if (!this.sfuClient) throw new Error("SFU client is not connected");
    return this.sfuClient.rejectJoinRequest(requestId, reason);
  }

  // ============ MEDIA CONTROL ============

  toggleMic() {
    const mediaState = this.state.localParticipant?.media;
    if (!mediaState || !this.localStream) return;

    const nextEnabled = !mediaState.micEnabled;
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = nextEnabled;
    });

    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: { micEnabled: nextEnabled },
    });

    this.sfuClient?.muteAudio(!nextEnabled);
    this.events.onMicToggled?.(this.myId, nextEnabled);
  }

  toggleCam() {
    const mediaState = this.state.localParticipant?.media;
    if (!mediaState || !this.localStream) return;

    const nextEnabled = !mediaState.camEnabled;
    this.localStream.getVideoTracks().forEach((track) => {
      track.enabled = nextEnabled;
    });

    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: { camEnabled: nextEnabled },
    });

    this.sfuClient?.muteVideo(!nextEnabled);
    this.events.onCamToggled?.(this.myId, nextEnabled);
  }

  // ============ SCREEN SHARING ============

  async startScreenShare() {
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Screen sharing not supported on this device");
      }
      if (!this.sfuClient) {
        throw new Error("Cannot share screen before joining the meeting");
      }

      this.screenStream = await this.sfuClient.shareScreen();
      this.isScreenSharing = true;

      this.state.updateLocalParticipant({
        media: {
          isScreenSharing: true,
          screenStream: this.screenStream,
          screenTrack: this.screenStream.getVideoTracks()[0],
        },
      });

      return this.screenStream;
    } catch (err: any) {
      this.emitError(
        "SCREEN_SHARE_FAILED",
        err?.message || "Failed to start screen sharing",
        err,
        true,
      );
      this.isScreenSharing = false;
      this.screenStream = null;
      throw err;
    }
  }

  stopScreenShare() {
    if (!this.screenStream) return;

    void this.sfuClient?.stopScreenShare();
    this.screenStream.getTracks().forEach((track) => track.stop());
    this.screenStream = null;
    this.isScreenSharing = false;

    this.state.updateLocalParticipant({
      media: {
        isScreenSharing: false,
        screenStream: null,
        screenTrack: undefined,
      },
    });
  }

  // ============ RECORDING ============

  async startRecording() {
    if (!this.sfuClient) {
      throw new Error("SFU client is not connected");
    }
    await this.sfuClient.startRecording();
  }

  async stopRecording() {
    if (!this.sfuClient) {
      throw new Error("SFU client is not connected");
    }
    await this.sfuClient.stopRecording();
  }

  async getRecordingStatus(): Promise<{ recording: RecordingInfo | null }> {
    if (!this.sfuClient) {
      throw new Error("SFU client is not connected");
    }
    return this.sfuClient.getRecordingStatus();
  }

  // ============ CHAT ============

  sendChatMessage(payload: ChatInput) {
    if (!this.sfuClient) {
      console.warn("SFU Client not connected");
      return;
    }

    const senderName = this.state.localParticipant?.name || "Anonymous";
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      sender_id: this.myId,
      sender_name: senderName,
      text: payload.message.trim(),
      timestamp: Date.now(),
      reply_to: payload.reply_to ?? null,
      target: payload.target ?? null,
    };

    this.state.addChatMessage(msg);
    this.events.onChatMessage?.(msg);
  }

  // ============ CLEANUP ============

  private cleanupRemoteParticipant(participantId: string) {
    const stream = this.remoteStreams.get(participantId);
    stream?.getTracks().forEach((track) => track.stop());
    this.remoteStreams.delete(participantId);

    const screen = this.remoteScreenStreams.get(participantId);
    screen?.getTracks().forEach((track) => track.stop());
    this.remoteScreenStreams.delete(participantId);
  }

  async disconnect() {
    this.intentionalDisconnect = true;

    await this.sfuClient?.leave();
    this.sfuClient = null;

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    this.screenStream?.getTracks().forEach((track) => track.stop());
    this.screenStream = null;
    this.isScreenSharing = false;

    for (const stream of this.remoteStreams.values()) {
      stream.getTracks().forEach((track) => track.stop());
    }
    this.remoteStreams.clear();

    for (const stream of this.remoteScreenStreams.values()) {
      stream.getTracks().forEach((track) => track.stop());
    }
    this.remoteScreenStreams.clear();

    this.room.id = null;
    this.room.name = null;
    this.state.localParticipant = null;
    this.state.notify("localParticipant");
    this.state.resetRemoteState();

    this.events.onMeetingLeft?.();
  }
}
