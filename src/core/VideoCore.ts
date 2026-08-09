import { SDK_CONFIG } from "../config/ws";
import {
  ChatInput,
  ChatMessage,
  Events,
  MeetingConfig,
  Participant,
  SDKError,
} from "../types/meeting";
import { MeetingState } from "./MeetingState";
import { SFUClient } from "./SFUClient";

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
  private joinResolver?: () => void;
  private joinRejecter?: (e: any) => void;
  private intentionalDisconnect = false;
  private remoteStreams = new Map<string, MediaStream>();
  private remoteVideoElements = new Map<string, HTMLVideoElement>();
  private remoteAudioElements = new Map<string, HTMLAudioElement>();

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
    this.joinRejecter?.(err);
    this.joinRejecter = undefined;

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
    this.myId = localStorage.getItem("vsdk_id") || crypto.randomUUID();
    localStorage.setItem("vsdk_id", this.myId);
  }

  // ============ STREAM MANAGEMENT ============

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

      // Verify tracks are live
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
      this.state.updateLocalParticipant({
        id: this.myId,
        name: this.participantName,
        media: {
          stream: this.localStream,
          micEnabled: true,
          camEnabled: true,
          isScreenSharing: false,
        },
      });

      this.state.localStream = this.localStream;
    } catch (err: any) {
      this.emitError("GET_USER_MEDIA_FAILED", err?.message, err, false);
      throw err;
    }
  }

  // ============ CONNECTION MANAGEMENT ============

  async joinMeeting(config: MeetingConfig) {
    const { roomId, name, audioMuted = false, videoMuted = false } = config;

    if (!roomId || !name) {
      throw new Error("roomId and name are required to join meeting");
    }

    this.participantName = name;
    this.room.id = roomId;
    this.room.name = name;

    // Reuse existing stream if initLocal already configured it
    if (!this.localStream) {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
    }

    // Set initial mute states
    this.localStream.getAudioTracks().forEach((t) => {
      t.enabled = !audioMuted;
    });
    this.localStream.getVideoTracks().forEach((t) => {
      t.enabled = !videoMuted;
    });

    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: {
        stream: this.localStream,
        micEnabled: !audioMuted,
        camEnabled: !videoMuted,
        isScreenSharing: false,
      },
    });

    this.state.localStream = this.localStream;

    return this.connect(roomId, name);
  }

  async connect(roomId: string, name: string) {
    return new Promise<void>((resolve, reject) => {
      this.joinResolver = resolve;
      this.joinRejecter = reject;

      // Initialize SFU Client with event handlers
      this.sfuClient = new SFUClient({
        apiBase: this.apiBase,
        wsBase: this.wsBase,

        onConnected: (payload) => {
          console.log("[SFU] Connected to room", payload);
          // Notify that join was successful
          this.joinResolver?.();
        },

        onDisconnected: () => {
          console.log("[SFU] Disconnected from room");
          if (!this.intentionalDisconnect) {
            this.emitError(
              "CONNECTION_LOST",
              "Lost connection to SFU server",
              null,
              true,
            );
          }
        },

        onParticipantJoined: (participant) => {
          console.log("[SFU] Participant joined", participant);
          const pid = participant.participant_id || participant.id;
          const pname =
            participant.user_metadata?.name ||
            participant.display_name ||
            "Participant";

          this.state.addParticipant({
            id: pid,
            name: pname,
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

        onParticipantLeft: (participant) => {
          const pid =
            typeof participant === "string"
              ? participant
              : participant.participant_id || participant.id;
          console.log("[SFU] Participant left", pid);

          this.state.removeParticipant(pid);
          this.events.onUserLeft?.(pid);

          // Clean up remote streams
          this.cleanupRemoteParticipant(pid);
        },

        onRemoteTrack: (track, stream, metadata) => {
          const participantId = metadata?.participant_id;
          if (!participantId) return;

          console.log(
            `[SFU] Remote ${track.kind} track received`,
            participantId,
          );

          // Store or create remote stream
          if (!this.remoteStreams.has(participantId)) {
            this.remoteStreams.set(participantId, stream);
          }

          // Update participant media state
          this.state.updateParticipantMedia(participantId, {
            stream: stream,
          });

          // Emit appropriate event
          if (track.kind === "video") {
            this.events.onTrack?.(stream, participantId);
          } else if (track.kind === "audio") {
            // Audio is typically mixed into the same stream
            this.events.onTrack?.(stream, participantId);
          }
        },

        onError: (error) => {
          console.error("[SFU] Error:", error);
          this.emitError("SFU_ERROR", String(error), error, true);
        },

        autoSubscribe: true,
      });

      // Connect to the meeting
      this.sfuClient
        .getToken(roomId, { displayName: name })
        .then(async () => {
          // Publish local streams
          try {
            await this.sfuClient!.publish({
              audio: true,
              video: true,
            });
            console.log("[SFU] Published local tracks");
          } catch (err) {
            console.error("[SFU] Failed to publish", err);
            reject(err);
          }
        })
        .catch((err) => {
          console.error("[SFU] Failed to get token", err);
          reject(err);
        });
    });
  }

  getMeeting(): { id: string | null; name: string | null } {
    return this.room;
  }

  // ============ MEDIA CONTROL ============

  toggleMic() {
    const mediaState = this.state.localParticipant?.media;
    if (!mediaState) return;

    const nextEnabled = !mediaState.micEnabled;

    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = nextEnabled;
    });

    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: {
        ...mediaState,
        micEnabled: nextEnabled,
      },
    });

    this.sfuClient?.muteAudio(!nextEnabled);
    this.events.onMicToggled?.(this.myId, nextEnabled);
  }

  toggleCam() {
    const mediaState = this.state.localParticipant?.media;
    if (!mediaState) return;

    const nextEnabled = !mediaState.camEnabled;

    this.localStream?.getVideoTracks().forEach((t) => {
      t.enabled = nextEnabled;
    });

    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: {
        ...mediaState,
        camEnabled: nextEnabled,
      },
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

      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });

      this.isScreenSharing = true;

      this.state.updateLocalParticipant({
        media: {
          isScreenSharing: true,
          screenStream: this.screenStream,
          screenTrack: this.screenStream.getVideoTracks()[0],
        },
      });

      // Share screen via SFU
      await this.sfuClient?.shareScreen();

      // Handle the user clicking browser's built-in "Stop Sharing" button
      this.screenStream.getVideoTracks()[0].onended = () => {
        this.stopScreenShare();
      };

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

    this.screenStream.getTracks().forEach((t) => t.stop());
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

    // Optimistic UI update
    this.state.addChatMessage(msg);
    this.events.onChatMessage?.(msg);
  }

  // ============ CLEANUP ============

  private cleanupRemoteParticipant(participantId: string) {
    const stream = this.remoteStreams.get(participantId);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      this.remoteStreams.delete(participantId);
    }

    this.remoteVideoElements.delete(participantId);
    this.remoteAudioElements.delete(participantId);
  }

  disconnect() {
    this.intentionalDisconnect = true;

    this.stopScreenShare();

    // Leave via SFU
    this.sfuClient?.leave();
    this.sfuClient = null;

    // Clean up local streams
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    // Clean up remote streams
    this.remoteStreams.forEach((stream) => {
      stream.getTracks().forEach((t) => t.stop());
    });
    this.remoteStreams.clear();
    this.remoteVideoElements.clear();
    this.remoteAudioElements.clear();

    this.room.id = null;
    this.state.localParticipant = null;
    this.state.notify("localParticipant");

    this.state.participants.clear();
    this.state.notify("participants");

    this.events.onMeetingLeft?.();
    this.state.clearChat();
  }
}
