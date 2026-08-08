import { SDK_CONFIG } from "../config/ws";
import {
  ChatInput,
  ChatMessage,
  Events,
  MeetingConfig,
  Participant,
  SDKError,
  TrackDescriptor,
} from "../types/meeting";
import { MeetingState } from "./MeetingState";

export class VideoSDKCore {
  private ws: WebSocket | null = null;
  private pubPC: RTCPeerConnection | null = null;
  private subPC: RTCPeerConnection | null = null;
  private pendingTracks = new Map<string, TrackDescriptor>();

  private publisherNegotiating = false;
  private publisherOfferQueue: boolean[] = [];

  private subscriberNegotiating = false;
  private subscriberOfferQueue: any[] = [];

  private iceServers: RTCIceServer[] = [];
  private lastPong = Date.now();
  private intentionalDisconnect = false;

// Publisher negotiation
private publisherOfferTimeout?: ReturnType<typeof setTimeout>;
private publisherRevision = 0;

// Track cache
private publisherStreams = new Map<string, MediaStream>();
private remoteTrackMap = new Map<string, MediaStreamTrack>();

// ICE restart
private iceRestartAttempts = new Map<string, number>();
private readonly maxIceRestartAttempts = 3;

  private myId: string;
  private room: { id: string | null; name: string | null } = {
    id: null,
    name: null,
  };

  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private screenSender: RTCRtpSender | null = null;
  private isScreenSharing = false;

  private pingInterval: any = null;
  private reconnectAttempts = 0;
  private reconnectTimer?: number;
  private participantName = "";
  public readonly state: MeetingState;

  private joinResolver?: () => void;
  private joinRejecter?: (e: any) => void;
  private isWaitingForApproval = false;
  private pendingRequestId: string | null = null;
  private iceTransportPolicy: RTCIceTransportPolicy = "all";


  constructor(
    private events: Events = {},
    private url: string = SDK_CONFIG.wsUrl,
  ) {
    this.state = new MeetingState();
    this.events = events;
    this.url = url;
    this.myId = localStorage.getItem("vsdk_id") || crypto.randomUUID();
    localStorage.setItem("vsdk_id", this.myId);
  }

  private send(message: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private async acquireLocalMedia(options: {
    videoConstraints?: boolean | MediaTrackConstraints;
    audioConstraints?: boolean | MediaTrackConstraints;
  }): Promise<{
    stream: MediaStream;
    camEnabled: boolean;
    micEnabled: boolean;
  }> {
    const { videoConstraints = true, audioConstraints = true } = options;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: audioConstraints,
      });

      const hasVideo = stream
        .getVideoTracks()
        .some((t) => t.readyState === "live");
      const hasAudio = stream
        .getAudioTracks()
        .some((t) => t.readyState === "live");

      return { stream, camEnabled: hasVideo, micEnabled: hasAudio };
    } catch (err: any) {
      console.warn(
        "[VideoSDKCore] Primary getUserMedia failed:",
        err?.name || err?.message,
      );

      const isDeviceLocked =
        err?.name === "NotReadableError" ||
        err?.name === "TrackStartError" ||
        err?.message?.toLowerCase().includes("allocate videosource") ||
        err?.message?.toLowerCase().includes("could not start video source");

      if (isDeviceLocked) {
        try {
          const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: audioConstraints,
          });

          return {
            stream: audioOnlyStream,
            camEnabled: false,
            micEnabled: audioOnlyStream
              .getAudioTracks()
              .some((t) => t.readyState === "live"),
          };
        } catch (audioErr: any) {
          console.warn("[VideoSDKCore] Audio acquisition failed.");
        }
      }

      return {
        stream: new MediaStream(),
        camEnabled: false,
        micEnabled: false,
      };
    }
  }

  async initLocal(video: HTMLVideoElement, name: string) {
    this.participantName = name;
    try {
      const { stream, camEnabled, micEnabled } = await this.acquireLocalMedia({
        videoConstraints: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audioConstraints: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.localStream = stream;

      if (video && this.localStream.getVideoTracks().length > 0) {
        video.srcObject = this.localStream;
      }

      const cameraTrack = this.localStream.getVideoTracks()[0] || undefined;
      const audioTrack = this.localStream.getAudioTracks()[0] || undefined;

      this.state.updateLocalParticipant({
        id: this.myId,
        name: this.participantName,
        media: {
          stream: this.localStream,
          cameraTrack,
          audioTrack,
          micEnabled,
          camEnabled,
          isScreenSharing: false,
        },
      });

      this.state.localStream = this.localStream;
    } catch (err: any) {
      this.emitError("GET_USER_MEDIA_FAILED", err?.message, err, false);
      throw err;
    }
  }

  async joinMeeting(config: MeetingConfig) {
    const { roomId, name, audioMuted = false, videoMuted = false } = config;
    if (!roomId || !name) {
      throw new Error("roomId and name are required to join meeting");
    }
    this.participantName = name;

    let camEnabled = !videoMuted;
    let micEnabled = !audioMuted;

    if (!this.localStream) {
      const acquired = await this.acquireLocalMedia({
        videoConstraints: !videoMuted,
        audioConstraints: !audioMuted,
      });

      this.localStream = acquired.stream;
      camEnabled = acquired.camEnabled && !videoMuted;
      micEnabled = acquired.micEnabled && !audioMuted;
    }

    this.localStream.getAudioTracks().forEach((t) => (t.enabled = micEnabled));
    this.localStream.getVideoTracks().forEach((t) => (t.enabled = camEnabled));

    const cameraTrack = this.localStream.getVideoTracks()[0] || undefined;
    const audioTrack = this.localStream.getAudioTracks()[0] || undefined;

    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: {
        stream: this.localStream,
        cameraTrack,
        audioTrack,
        micEnabled,
        camEnabled,
        isScreenSharing: false,
      },
    });

    this.state.localStream = this.localStream;
    await this.connect(roomId, name);
  }

  private setupPublisherPC() {
  if (!this.localStream) return;

  this.pubPC?.close();

  this.pubPC = new RTCPeerConnection({
    iceServers: this.iceServers,
    iceTransportPolicy: this.iceTransportPolicy,
  });

  for (const track of this.localStream.getTracks()) {
    this.pubPC.addTrack(track, this.localStream);
  }

  this.pubPC.onicecandidate = ({ candidate }) => {
    if (!candidate || !candidate.sdpMid) return;

    this.send({
      type: "PUB_ICE",
      payload: JSON.stringify(candidate),
      user_id: this.myId,
    });
  };

  this.pubPC.onnegotiationneeded = async () => {
    await this.createPublisherOffer();
  };

  this.pubPC.onconnectionstatechange = () => {
    switch (this.pubPC?.connectionState) {
      case "failed":
        this.restartPublisherIce();
        break;

      case "connected":
        this.iceRestartAttempts.delete("publisher");
        break;
    }
  };

  this.pubPC.oniceconnectionstatechange = () => {
    if (this.pubPC?.iceConnectionState === "failed") {
      this.restartPublisherIce();
    }
  };
}

  private setupSubscriberPC() {
  this.subPC?.close();

  this.subPC = new RTCPeerConnection({
    iceServers: this.iceServers,
    iceTransportPolicy: this.iceTransportPolicy,
  });

  this.subPC.onicecandidate = ({ candidate }) => {
    if (!candidate || !candidate.sdpMid) return;

    this.send({
      type: "SUB_ICE",
      payload: JSON.stringify(candidate),
      user_id: this.myId,
    });
  };

  this.subPC.ontrack = (event) => {
    const mid = event.transceiver.mid;
    if (!mid) return;

    const descriptor = this.pendingTracks.get(mid);
    if (!descriptor) return;

    this.pendingTracks.delete(mid);

    const publisherId = descriptor.publisher_id;

    let stream = this.publisherStreams.get(publisherId);

    if (!stream) {
      stream = new MediaStream();
      this.publisherStreams.set(publisherId, stream);
    }

    if (!this.remoteTrackMap.has(event.track.id)) {
      this.remoteTrackMap.set(event.track.id, event.track);
      stream.addTrack(event.track);
    }

    event.track.onended = () => {
      this.remoteTrackMap.delete(event.track.id);

      stream?.removeTrack(event.track);

      if (stream && stream.getTracks().length === 0) {
        this.publisherStreams.delete(publisherId);
      }
    };

    const update: any = {
      stream,
    };

    if (event.track.kind === "video") {
      update.cameraTrack = event.track;
    }

    if (event.track.kind === "audio") {
      update.audioTrack = event.track;
    }

    this.state.updateParticipantMedia(publisherId, update);
  };

  this.subPC.onconnectionstatechange = () => {
    switch (this.subPC?.connectionState) {
      case "failed":
        this.restartSubscriberIce();
        break;

      case "connected":
        this.iceRestartAttempts.delete("subscriber");
        break;
    }
  };
}

  async connect(roomId: string, name: string) {
    this.room.id = roomId;
    this.reset();

    return new Promise<void>((resolve, reject) => {
      this.joinResolver = resolve;
      this.joinRejecter = reject;
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        const micEnabled = !!this.state.localParticipant?.media?.micEnabled;
        const camEnabled = !!this.state.localParticipant?.media?.camEnabled;

        this.send({
          type: "join",
          payload: {
            room_id: roomId,
            user_id: this.myId,
            sender_name: name,
            camera_stream_id: this.localStream?.id.replace(/[{}]/g, ""),
            audio_muted: !micEnabled,
            video_muted: !camEnabled,
          },
        });
      };

      this.ws.onerror = (err) => {
        this.emitError("WS_ERROR", "WebSocket encountered an error", err, true);
      };

      this.ws.onclose = (e) => {
        this.joinRejecter?.({
          code: "WS_CLOSED",
          message: "Connection closed before join completed",
          raw: e,
        });
        this.joinRejecter = undefined;

        if (
          this.intentionalDisconnect ||
          e.code === 1000 ||
          e.code === 1001 ||
          this.isWaitingForApproval
        ) {
          return;
        }
        this.scheduleReconnect();
      };

      this.ws.onmessage = async (e) => {
        await this.handle(JSON.parse(e.data));
      };
    });
  }

  private async handle(msg: any) {
    const type = msg.type || msg.event;
    const payload = msg.payload || msg.data || msg;

    if (msg.sender === this.myId || payload.sender_id === this.myId) return;

    switch (type) {
      case "pong":
      case "PONG":
        this.lastPong = Date.now();
        break;

      case "joined":
      case "JOINED": {
        const iceServers = payload.ice_servers || payload.iceServers;
        if (iceServers) {
          this.iceServers = iceServers;
        }
        this.room.name = payload.room_name || payload.roomName;

        this.isWaitingForApproval = false;
        this.pendingRequestId = null;
        this.intentionalDisconnect = false;
        this.reconnectAttempts = 0;

        this.setupPublisherPC();
        this.setupSubscriberPC();

        await this.createPublisherOffer();

        const media = this.state.localParticipant?.media;
        if (media) {
          this.send({
            type: "media_state",
            payload: {
              kind: "audio",
              enabled: !!media.micEnabled,
            },
          });

          this.send({
            type: "media_state",
            payload: {
              kind: "video",
              enabled: !!media.camEnabled,
            },
          });
        }

        this.startHeartbeat();
        this.joinResolver?.();
        this.joinResolver = undefined;
        this.joinRejecter = undefined;
        break;
      }

      case "pub_answer":
      case "publish_answer":
      case "PUB_ANSWER": {
        if (this.pubPC) {
          if (this.publisherOfferTimeout) {
            clearTimeout(this.publisherOfferTimeout);
            this.publisherOfferTimeout = null;
          }

          const sdp = typeof payload === "string" ? payload : payload.sdp;
          await this.pubPC.setRemoteDescription({
            type: "answer",
            sdp,
          });
          this.publisherNegotiating = false;

          if (this.publisherOfferQueue.length > 0) {
            this.publisherOfferQueue.shift();
            await this.createPublisherOffer();
          }
        }
        break;
      }

      case "sub_offer":
      case "subscribe_offer":
      case "SUB_OFFER": {
        if (!this.subPC) break;

        const tracks = payload.tracks || msg.tracks;
        if (tracks && Array.isArray(tracks)) {
          for (const trackDescriptor of tracks) {
            const mid = trackDescriptor.mid;
            if (mid && !this.pendingTracks.has(mid)) {
              this.pendingTracks.set(mid, {
                mid: trackDescriptor.mid,
                publisher_id:
                  trackDescriptor.publisher_id || trackDescriptor.publisherId,
                kind: trackDescriptor.kind,
                stream_id:
                  trackDescriptor.stream_id || trackDescriptor.streamId,
              });
            }
          }
        }

        if (this.subscriberNegotiating) {
          this.subscriberOfferQueue.push(msg);
        } else {
          this.subscriberOfferQueue.push(msg);
          await this.processOfferQueue();
        }
        break;
      }

      case "ice_candidate":
      case "ICE_CANDIDATE":
        await this.handleIceCandidate(payload);
        break;

      case "existing_users":
      case "EXISTING_USERS": {
        const presenterId = payload.presenter_id || payload.presenterId;
        if (presenterId) {
          this.state.setPresenterId(presenterId);
        }

        const participants = payload.participants || payload.users || [];
        for (const p of participants) {
          const id = p.id || p.user_id;
          if (!id || id === this.myId) continue;

          const structuredParticipant: Participant = {
            id,
            name: p.name || p.sender_name || "Guest",
            isHost: p.is_host ?? p.isHost ?? false,
            isPresenter: p.is_presenter ?? p.isPresenter ?? false,
            media: {
              stream: null,
              screenStream: undefined,
              micEnabled: p.mic_enabled ?? p.micEnabled ?? true,
              camEnabled: p.cam_enabled ?? p.camEnabled ?? true,
              isScreenSharing:
                p.is_screen_sharing ?? p.isScreenSharing ?? false,
              remoteScreenStreamId:
                p.remote_screen_stream_id ||
                p.remoteScreenStreamId ||
                undefined,
              cameraStreamId: p.camera_stream_id || p.cameraId || undefined,
            },
          };
          this.state.addParticipant(structuredParticipant);
          this.events.onUserJoined?.(structuredParticipant);
        }
        break;
      }

      case "user_joined":
      case "USER_JOINED": {
        const p = payload.participant || payload;
        const id = p.id || p.user_id;
        if (!id || id === this.myId) return;

        const structuredParticipant: Participant = {
          id,
          name: p.name || p.sender_name || "Guest",
          isHost: p.is_host ?? p.isHost ?? false,
          isPresenter: p.is_presenter ?? p.isPresenter ?? false,
          media: {
            stream: null,
            screenStream: undefined,
            micEnabled: p.mic_enabled ?? p.micEnabled ?? true,
            camEnabled: p.cam_enabled ?? p.camEnabled ?? true,
            isScreenSharing: p.is_screen_sharing ?? p.isScreenSharing ?? false,
            remoteScreenStreamId:
              p.remote_screen_stream_id || p.remoteScreenStreamId || undefined,
            cameraStreamId: p.camera_stream_id || p.cameraId || undefined,
          },
        };
        this.state.addParticipant(structuredParticipant);
        this.events.onUserJoined?.(structuredParticipant);
        break;
      }

      case "user_left":
      case "USER_LEFT": {
        const peerId =
          payload.peer_id || payload.participant?.id || payload.user_id;
        if (!peerId) return;

        for (const [mid, descriptor] of this.pendingTracks.entries()) {
          if (descriptor.publisher_id === peerId) {
            this.pendingTracks.delete(mid);
          }
        }
        this.state.removeParticipant(peerId);
        this.events.onUserLeft?.(peerId);
        break;
      }

      case "media_state_change":
      case "MEDIA_STATE_CHANGE": {
        const peerId = payload.peer_id || payload.peerId;
        const { kind, enabled } = payload;

        if (kind === "audio") {
          this.state.updateParticipantMedia(peerId, { micEnabled: enabled });
          this.events.onMicToggled?.(peerId, enabled);
        } else if (kind === "video") {
          this.state.updateParticipantMedia(peerId, { camEnabled: enabled });
          this.events.onCamToggled?.(peerId, enabled);
        }
        break;
      }

      case "screen_share_start":
      case "SCREEN_SHARE_START": {
        const peerId = payload.peer_id || payload.peerId || payload.sender;
        const streamId = payload.stream_id || payload.streamId;

        this.state.updateParticipantMedia(peerId, {
          isScreenSharing: true,
          remoteScreenStreamId: streamId,
          cameraStreamId: payload.camera_stream_id || payload.cameraId,
        });

        if (!this.state.presenterId) {
          this.state.setPresenterId(peerId);
        }
        break;
      }

      case "screen_share_stop":
      case "SCREEN_SHARE_STOP": {
        const peerId = payload.peer_id || payload.peerId || payload.sender;
        this.state.updateParticipantMedia(peerId, { isScreenSharing: false });
        if (this.state.presenterId === peerId) {
          this.state.setPresenterId(null);
        }
        this.events.onScreenShareStopped?.(peerId);
        break;
      }

      case "chat_message":
      case "CHAT_MESSAGE": {
        const newMsg = payload.data || payload;
        if (newMsg.sender_id === this.myId || newMsg.user_id === this.myId)
          break;

        const chatData: ChatMessage = {
          id: newMsg.id || crypto.randomUUID(),
          text: newMsg.message || newMsg.text,
          sender_id: newMsg.sender_id || newMsg.user_id,
          sender_name: newMsg.sender_name || newMsg.senderName || "Guest",
          timestamp: newMsg.timestamp
            ? new Date(newMsg.timestamp).getTime()
            : Date.now(),
          target: newMsg.target ?? null,
          reply_to: newMsg.reply_to ?? null,
        };

        this.state.addChatMessage(chatData);
        this.events.onChatMessage?.(chatData);
        break;
      }

      case "join_pending":
      case "JOIN_PENDING": {
        const req = payload.request || payload;
        this.isWaitingForApproval = true;
        this.pendingRequestId = req.request_id || req.requestId;
        this.events.onEntryRequested?.({
          requestId: this.pendingRequestId!,
          userId: req.user_id || req.userId,
          name: req.name || req.sender_name,
        });
        break;
      }

      case "join_approved":
      case "JOIN_APPROVED": {
        this.isWaitingForApproval = false;
        this.pendingRequestId = null;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.send({
            type: "join",
            payload: {
              room_id: this.room.id,
              user_id: this.myId,
              sender_name: this.participantName,
            },
          });
        }
        break;
      }

      case "join_rejected":
      case "JOIN_REJECTED": {
        this.isWaitingForApproval = false;
        this.pendingRequestId = null;
        this.events.onEntryResponded?.({
          participantId: payload.user_id || payload.userId,
          decision: "rejected",
        });
        break;
      }

      case "error":
      case "ERROR": {
        const fatal = payload?.fatal === true;
        this.emitError(
          "WS_ERROR",
          payload?.message || "Unknown server error",
          payload,
          !fatal,
        );
        if (fatal) this.disconnect();
        return;
      }
    }
  }

  private async processOfferQueue() {
    while (this.subscriberOfferQueue.length && !this.subscriberNegotiating) {
      this.subscriberNegotiating = true;

      const offerMsg = this.subscriberOfferQueue.shift();
      const payload = offerMsg.payload || offerMsg;
      const sdp = payload.sdp || (typeof payload === "string" ? payload : null);
      const revision = payload.revision ?? 1;

      try {
        await this.subPC!.setRemoteDescription({
          type: "offer",
          sdp,
        });

        const answer = await this.subPC!.createAnswer();
        await this.subPC!.setLocalDescription(answer);

        this.send({
          type: "subscribe_answer",
          payload: {
            revision,
            sdp: answer.sdp,
          },
        });
      } catch (err) {
        console.error("[SFU Subscriber Offer Processing Error]", err);
      } finally {
        this.subscriberNegotiating = false;
      }
    }
  }

  private async createPublisherOffer() {
  if (!this.pubPC) return;

  if (
    this.publisherNegotiating ||
    this.pubPC.signalingState !== "stable"
  ) {
    this.publisherOfferQueue = true;
    return;
  }

  try {
    this.publisherNegotiating = true;

    const offer = await this.pubPC.createOffer();

    await this.pubPC.setLocalDescription(offer);

    this.send({
      type: "PUB_OFFER",
      payload: offer.sdp,
      room_id: this.room.id,
      user_id: this.myId,
    });

    clearTimeout(this.publisherOfferTimeout);

    this.publisherOfferTimeout = setTimeout(() => {
      this.publisherNegotiating = false;

      if (this.publisherOfferQueue) {
        this.publisherOfferQueue = false;
        this.createPublisherOffer();
      }
    }, 5000);

  } catch (err) {
    console.error(err);
    this.publisherNegotiating = false;
  }
}

  private async handleIceCandidate(payload: any) {
    const peerType = payload.peer || payload.target;
    const pc = peerType === "publisher" ? this.pubPC : this.subPC;

    if (!pc) return;

    await pc.addIceCandidate({
      candidate: payload.candidate,
      sdpMid: payload.sdp_mid ?? payload.sdpMid,
      sdpMLineIndex: payload.sdp_mline_index ?? payload.sdpMLineIndex,
      usernameFragment: payload.username_fragment ?? payload.usernameFragment,
    });
  }

  toggleMic() {
    const mediaState = this.state.localParticipant?.media;
    if (!mediaState) return;

    const nextEnabled = !mediaState.micEnabled;
    this.localStream
      ?.getAudioTracks()
      .forEach((t) => (t.enabled = nextEnabled));

    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: { ...mediaState, micEnabled: nextEnabled },
    });

    this.send({
      type: "media_state",
      payload: { kind: "audio", enabled: nextEnabled },
    });
  }

  toggleCam() {
    const mediaState = this.state.localParticipant?.media;
    if (!mediaState) return;

    const nextEnabled = !mediaState.camEnabled;
    this.localStream
      ?.getVideoTracks()
      .forEach((t) => (t.enabled = nextEnabled));

    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: { ...mediaState, camEnabled: nextEnabled },
    });

    this.send({
      type: "media_state",
      payload: { kind: "video", enabled: nextEnabled },
    });
  }

  async startScreenShare() {
    try {
      if (this.state.presenterId && this.state.presenterId !== this.myId) {
        throw new Error("Another user is already sharing their screen.");
      }

      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });
      this.isScreenSharing = true;

      const screenTrack = this.screenStream.getVideoTracks()[0];
      Object.defineProperty(screenTrack, "contentHint", {
        value: "detail",
      });

      if (this.pubPC) {
        this.screenSender = this.pubPC.addTrack(screenTrack, this.screenStream);
        await this.createPublisherOffer();
      }

      this.state.updateLocalParticipant({
        media: {
          isScreenSharing: true,
          screenStream: this.screenStream,
          screenTrack,
        },
      });

      this.state.setPresenterId(this.myId);

      screenTrack.onended = () => {
        this.stopScreenShare();
      };

      this.send({
        type: "screen_share_start",
        payload: {
          sender: this.myId,
          room_id: this.room.id,
          stream_id: this.screenStream.id.replace(/[{}]/g, ""),
        },
      });

      return this.screenStream;
    } catch (err: any) {
      this.emitError(
        "SCREEN_SHARE_FAILED",
        err?.message || "Failed screen share",
        err,
        true,
      );
      this.isScreenSharing = false;
      this.screenStream = null;
      throw err;
    }
  }

  async stopScreenShare() {
    if (!this.screenStream) return;

    this.screenStream.getTracks().forEach((t) => t.stop());

    if (this.pubPC && this.screenSender) {
      try {
        this.pubPC.removeTrack(this.screenSender);
      } catch (e) {
        console.warn("[Publisher] Could not remove track from PC:", e);
      }
      this.screenSender = null;
      await this.createPublisherOffer();
    }

    this.screenStream = null;
    this.isScreenSharing = false;

    this.state.updateLocalParticipant({
      media: {
        isScreenSharing: false,
        screenStream: null,
        screenTrack: undefined,
      },
    });

    if (this.state.presenterId === this.myId) {
      this.state.setPresenterId(null);
    }

    this.send({
      type: "screen_share_stop",
      payload: {
        sender: this.myId,
        room_id: this.room.id,
      },
    });
  }

  sendChatMessage(payload: ChatInput) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.room.id)
      return;

    const isPrivate = !!payload?.target;
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

    this.send({
      type: "chat_message",
      payload: {
        message: payload.message.trim(),
        user_id: this.myId,
        sender_name: senderName,
        room_id: this.room.id,
        target: isPrivate ? (payload.target ?? null) : null,
        reply_to: payload.reply_to ?? null,
        client_ts: Date.now(),
      },
    });
  }

  private scheduleReconnect() {
    if (!this.room.id) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(async () => {
      try {
        await this.connect(this.room.id!, this.participantName);
        this.reconnectAttempts = 0;
      } catch {
        this.reconnectAttempts++;
        this.scheduleReconnect();
      }
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: "ping", payload: { client_ts: Date.now() } });
      }
    }, 20000);
  }

  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private reset() {
    window.clearTimeout(this.reconnectTimer);

    if (this.publisherOfferTimeout) {
      clearTimeout(this.publisherOfferTimeout);
      this.publisherOfferTimeout = null;
    }

    this.pubPC?.close();
    this.subPC?.close();
    this.pubPC = null;
    this.subPC = null;
    this.pendingTracks.clear();
    this.publisherOfferQueue = [];
    this.publisherNegotiating = false;
    this.subscriberOfferQueue = [];
    this.subscriberNegotiating = false;
    this.iceRestartAttempts.clear();
    this.state.resetRemoteState();
  }

  disconnect() {
    this.intentionalDisconnect = true;
    window.clearTimeout(this.reconnectTimer);

    if (this.publisherOfferTimeout) {
      clearTimeout(this.publisherOfferTimeout);
      this.publisherOfferTimeout = null;
    }

    this.stopScreenShare();

    this.pubPC?.close();
    this.subPC?.close();
    this.pubPC = null;
    this.subPC = null;

    this.stopHeartbeat();

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({
        type: "leave",
        payload: {
          room_id: this.room.id,
          user_id: this.myId,
          sender_name: this.state.localParticipant?.name,
        },
      });

      setTimeout(() => {
        this.ws?.close(1000, "Leaving meeting");
        this.ws = null;
      }, 50);
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }

    this.room.id = null;
    this.state.localParticipant = null;
    this.state.notify("localParticipant");
    this.state.participants.clear();
    this.state.notify("participants");
    this.events.onMeetingLeft?.();
    this.state.clearChat();
    this.state.setPresenterId(null);
  }

  private async restartPublisherIce() {
    if (!this.pubPC) return;

    const key = "pub_ice_restart";
    const attempts = this.iceRestartAttempts.get(key) || 0;

    if (attempts >= this.maxIceRestartAttempts) {
      this.iceRestartAttempts.delete(key);
      return;
    }

    try {
      this.iceRestartAttempts.set(key, attempts + 1);
      this.pubPC.restartIce();
      await this.createPublisherOffer();
    } catch (err) {
      console.error("[Publisher] ICE restart failed:", err);
    }
  }

  private async restartSubscriberIce() {
    if (!this.subPC) return;

    const key = "sub_ice_restart";
    const attempts = this.iceRestartAttempts.get(key) || 0;

    if (attempts >= this.maxIceRestartAttempts) {
      this.iceRestartAttempts.delete(key);
      return;
    }

    try {
      this.iceRestartAttempts.set(key, attempts + 1);
      this.subPC.restartIce();
    } catch (err) {
      console.error("[Subscriber] ICE restart failed:", err);
    }
  }

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
}
