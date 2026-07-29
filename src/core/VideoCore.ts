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
  private publisherOfferTimeout: any = null;

  private subscriberNegotiating = false;
  private subscriberOfferQueue: any[] = [];

  private iceServers: RTCIceServer[] = [];
  private lastPong = Date.now();
  private intentionalDisconnect = false;
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

  private iceRestartAttempts = new Map<string, number>();
  private maxIceRestartAttempts = 3;

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
        console.warn(
          "[VideoSDKCore] Camera is locked by another browser/app. Falling back to Audio-Only.",
        );

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
          console.warn(
            "[VideoSDKCore] Audio acquisition failed. Falling back to View-Only stream.",
          );
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

    this.pubPC = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.iceTransportPolicy,
    });

    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      try {
        this.pubPC.addTrack(audioTrack, this.localStream);
      } catch (e) {
        console.error("[Publisher] Failed to add audio track:", e);
      }
    }

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      try {
        this.pubPC.addTrack(videoTrack, this.localStream);
      } catch (e) {
        console.error("[Publisher] Failed to add video track:", e);
      }
    }

    this.pubPC.onicecandidate = (e) => {
      if (e.candidate) {
        if (!e.candidate.sdpMid) {
          console.debug(
            "[Publisher] Skipping ICE candidate with no sdpMid",
            e.candidate.candidate,
          );
          return;
        }

        this.send({
          type: "PUB_ICE",
          payload: JSON.stringify(e.candidate),
          user_id: this.myId,
        });
      }
    };

    this.pubPC.onconnectionstatechange = () => {
      console.log(
        "[Publisher] Connection state changed:",
        this.pubPC?.connectionState,
      );

      if (this.pubPC?.connectionState === "failed") {
        console.warn("[Publisher] Connection failed, attempting ICE restart");
        this.restartPublisherIce();
      }
    };

    this.pubPC.oniceconnectionstatechange = () => {
      console.log(
        "[Publisher] ICE connection state changed:",
        this.pubPC?.iceConnectionState,
      );
    };
  }

  private setupSubscriberPC() {
    this.subPC = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.iceTransportPolicy,
    });

    this.subPC.onicecandidate = (e) => {
      if (e.candidate && e.candidate.sdpMid) {
        this.send({
          type: "SUB_ICE",
          payload: JSON.stringify(e.candidate),
          user_id: this.myId,
        });
      }
    };

    // ✅ Track management: Keep streams per publisher
    const publisherStreams = new Map<string, MediaStream>();

    this.subPC.ontrack = (event) => {
      const mid = event.transceiver.mid;
      const kind = event.track.kind;

      console.log(
        `[ontrack] 🎯 mid=${mid}, kind=${kind}, trackId=${event.track.id}`,
      );

      if (!mid) {
        console.warn(`[ontrack] ❌ No mid in transceiver`);
        return;
      }

      const descriptor = this.pendingTracks.get(mid);
      if (!descriptor) {
        console.warn(
          `[ontrack] ❌ No descriptor for mid=${mid}, pending: ${Array.from(
            this.pendingTracks.keys(),
          )}`,
        );
        return;
      }

      console.log(
        `[ontrack] ✅ Found: publisher=${descriptor.publisher_id}, source=${descriptor.source}`,
      );

      this.pendingTracks.delete(mid);

      const publisherId = descriptor.publisher_id;

      // ✅ CRITICAL: Maintain ONE stream per publisher with ALL their tracks
      let stream = publisherStreams.get(publisherId);
      if (!stream) {
        // Use the stream from ontrack if available, otherwise create new
        stream = event.streams[0] || new MediaStream();
        publisherStreams.set(publisherId, stream);
        console.log(
          `[ontrack] 📊 Created new stream for publisher ${publisherId}: ${stream.id}`,
        );
      }

      // ✅ Add the track to the stream if not already there
      if (!stream.getTracks().find((t) => t.id === event.track.id)) {
        stream.addTrack(event.track);
        console.log(
          `[ontrack] ➕ Added ${kind} track (${event.track.id}) to stream ${stream.id}`,
        );
      } else {
        console.log(`[ontrack] ℹ️ Track already in stream, skipping add`);
      }

      // ✅ IMPORTANT: Verify participant exists
      if (!this.state.participants.has(publisherId)) {
        console.error(
          `[ontrack] ❌ Participant ${publisherId} NOT in state!`,
          `Available: ${Array.from(this.state.participants.keys())}`,
        );
        return;
      }

      // ✅ Log stream composition
      console.log(`[ontrack] 📡 Stream ${stream.id} now has:`, {
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length,
        allTracks: stream.getTracks().map((t) => t.kind),
      });

      // ✅ Always update with the full stream
      const mediaUpdate: any = { stream };

      // Also track individual track references for debugging
      if (kind === "audio") {
        mediaUpdate.audioTrack = event.track;
      } else if (kind === "video") {
        mediaUpdate.cameraTrack = event.track;
      }

      console.log(`[ontrack] 🔄 Updating participant ${publisherId} media`);

      this.state.updateParticipantMedia(publisherId, mediaUpdate);

      console.log(
        `[ontrack] ✅ Updated participant media, stream now has ${stream.getTracks().length} tracks`,
      );
    };

    this.subPC.onconnectionstatechange = () => {
      console.log(
        "[Subscriber] Connection state:",
        this.subPC?.connectionState,
      );
      if (this.subPC?.connectionState === "failed") {
        console.warn("[Subscriber] Connection failed, attempting ICE restart");
        // Call your restart logic
      }
    };

    this.subPC.oniceconnectionstatechange = () => {
      console.log(
        "[Subscriber] ICE connection state:",
        this.subPC?.iceConnectionState,
      );
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
          type: "JOIN",
          room_id: roomId,
          user_id: this.myId,
          sender_name: name,
          camera_stream_id: this.localStream?.id.replace(/[{}]/g, ""),
          audio_muted: !micEnabled,
          video_muted: !camEnabled,
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
    if (msg.sender === this.myId) return;

    switch (msg.type) {
      case "PONG":
        this.lastPong = Date.now();
        break;

      case "JOINED": {
        if (msg.iceServers) {
          this.iceServers = msg.iceServers;
        }
        this.room.name = msg.room_name;

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
            type: "MEDIA_STATE",
            kind: "audio",
            enabled: !!media.micEnabled,
          });

          this.send({
            type: "MEDIA_STATE",
            kind: "video",
            enabled: !!media.camEnabled,
          });
        }

        this.startHeartbeat();
        this.joinResolver?.();
        this.joinResolver = undefined;
        this.joinRejecter = undefined;
        break;
      }

      case "PUB_ANSWER": {
        if (this.pubPC) {
          //  Clear timeout when answer arrives
          if (this.publisherOfferTimeout) {
            clearTimeout(this.publisherOfferTimeout);
            this.publisherOfferTimeout = null;
          }

          await this.pubPC.setRemoteDescription({
            type: "answer",
            sdp: msg.payload,
          });
          this.publisherNegotiating = false;

          // Drain offer queue
          if (this.publisherOfferQueue.length > 0) {
            this.publisherOfferQueue.shift();
            await this.createPublisherOffer();
          }
        }
        break;
      }

      case "SUB_OFFER": {
        if (!this.subPC) break;

        if (msg.tracks && Array.isArray(msg.tracks)) {
          for (const trackDescriptor of msg.tracks) {
            if (
              trackDescriptor.mid &&
              !this.pendingTracks.has(trackDescriptor.mid)
            ) {
              this.pendingTracks.set(trackDescriptor.mid, trackDescriptor);
            }
          }
        }

        if (this.subscriberNegotiating) {
          this.subscriberOfferQueue.push(msg);
        } else {
          await this.handleSubscriberOffer(msg);
        }
        break;
      }

      case "PUB_ICE": {
        if (this.pubPC && msg.payload) {
          await this.pubPC
            .addIceCandidate(JSON.parse(msg.payload))
            .catch((err) =>
              console.warn("[Publisher] Failed to add ICE candidate:", err),
            );
        }
        break;
      }

      case "SUB_ICE": {
        if (this.subPC && msg.payload) {
          await this.subPC
            .addIceCandidate(JSON.parse(msg.payload))
            .catch((err) =>
              console.warn("[Subscriber] Failed to add ICE candidate:", err),
            );
        }
        break;
      }

      case "EXISTING_USERS": {
        if (msg.presenterId) {
          this.state.setPresenterId(msg.presenterId);
        }

        for (const p of msg.participants || []) {
          if (!p?.id || p.id === this.myId) continue;
          const structuredParticipant: Participant = {
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            isPresenter: p.isPresenter,
            media: {
              stream: null,
              screenStream: undefined,
              micEnabled: p.micEnabled ?? true,
              camEnabled: p.camEnabled ?? true,
              isScreenSharing: p.isScreenSharing ?? false,
              remoteScreenStreamId: p.remoteScreenStreamId || undefined,
              cameraStreamId: p.cameraId || undefined,
            },
          };
          this.state.addParticipant(structuredParticipant);
          this.events.onUserJoined?.(structuredParticipant);
        }
        break;
      }

      case "USER_JOINED": {
        const p = msg.participant;
        if (!p?.id || p.id === this.myId) return;
        this.state.addParticipant(p);
        this.events.onUserJoined?.(p);
        break;
      }

      case "USER_LEFT": {
        const peerId = msg.participant.id;
        // Clean up any un-handled pending tracks from this user
        for (const [mid, descriptor] of this.pendingTracks.entries()) {
          if (descriptor.publisher_id === peerId) {
            this.pendingTracks.delete(mid);
          }
        }
        this.state.removeParticipant(peerId);
        this.events.onUserLeft?.(peerId);
        break;
      }

      case "MEDIA_STATE_CHANGE": {
        const peerId = msg.peerId;
        const { kind, enabled } = msg;

        if (kind === "audio") {
          this.state.updateParticipantMedia(peerId, { micEnabled: enabled });
          this.events.onMicToggled?.(peerId, enabled);
        } else if (kind === "video") {
          this.state.updateParticipantMedia(peerId, { camEnabled: enabled });
          this.events.onCamToggled?.(peerId, enabled);
        }
        break;
      }

      case "SCREEN_SHARE_START": {
        const peerId = msg.peerId;
        this.state.updateParticipantMedia(peerId, {
          isScreenSharing: true,
          remoteScreenStreamId: msg.stream_id,
          cameraStreamId: msg?.camera_stream_id,
        });

        if (!this.state.presenterId) {
          this.state.setPresenterId(peerId);
        }
        break;
      }

      case "SCREEN_SHARE_STOP": {
        const peerId = msg.peerId;
        this.state.updateParticipantMedia(peerId, { isScreenSharing: false });
        if (this.state.presenterId === peerId) {
          this.state.setPresenterId(null);
        }
        this.events.onScreenShareStopped?.(peerId);
        break;
      }

      case "CHAT_MESSAGE": {
        const newMsg = msg.data;
        if (newMsg.sender_id === this.myId) break;
        this.state.addChatMessage({
          id: newMsg.id,
          text: newMsg.message,
          sender_id: newMsg.sender_id,
          sender_name: newMsg.sender_name,
          timestamp: new Date(newMsg.timestamp).getTime(),
          target: newMsg.target,
        });
        this.events.onChatMessage?.(msg);
        break;
      }

      case "JOIN_PENDING": {
        const req = msg.request;
        this.isWaitingForApproval = true;
        this.pendingRequestId = req.request_id;
        this.events.onEntryRequested?.({
          requestId: req.request_id,
          userId: req.user_id,
          name: req.name,
        });
        break;
      }

      case "JOIN_APPROVED": {
        this.isWaitingForApproval = false;
        this.pendingRequestId = null;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.send({
            type: "JOIN",
            room_id: this.room.id,
            user_id: this.myId,
            sender_name: this.participantName,
          });
        }
        break;
      }

      case "JOIN_REJECTED": {
        this.isWaitingForApproval = false;
        this.pendingRequestId = null;
        this.events.onEntryResponded?.({
          participantId: msg.user_id,
          decision: "rejected",
        });
        break;
      }

      case "ERROR": {
        const fatal = msg?.fatal === true;
        this.emitError(
          "WS_ERROR",
          msg?.message || "Unknown error",
          msg,
          !fatal,
        );
        if (fatal) this.disconnect();
        return;
      }
    }
  }

  private async handleSubscriberOffer(msg: any) {
    if (!this.subPC) return;

    try {
      this.subscriberNegotiating = true;

      await this.subPC.setRemoteDescription({
        type: "offer",
        sdp: msg.payload,
      });

      const answer = await this.subPC.createAnswer();
      await this.subPC.setLocalDescription(answer);

      this.send({
        type: "SUB_ANSWER",
        payload: answer.sdp,
        user_id: this.myId,
      });
    } catch (err) {
      console.error("[SUB_OFFER_ERROR]", err);
    } finally {
      this.subscriberNegotiating = false;

      const next = this.subscriberOfferQueue.shift();
      if (next) {
        await this.handleSubscriberOffer(next);
      }
    }
  }

  //  Add timeout for publisher offer
  private async createPublisherOffer() {
    if (!this.pubPC) return;

    if (this.pubPC.signalingState !== "stable" || this.publisherNegotiating) {
      this.publisherOfferQueue.push(true);
      return;
    }

    try {
      this.publisherNegotiating = true;
      const offer = await this.pubPC.createOffer();
      await this.pubPC.setLocalDescription(offer);

      this.send({
        type: "PUB_OFFER",
        payload: offer.sdp,
        user_id: this.myId,
        room_id: this.room.id,
      });

      // Set timeout for answer
      this.publisherOfferTimeout = setTimeout(() => {
        if (this.publisherNegotiating) {
          console.warn(
            "[Publisher] PUB_ANSWER timeout (5s), resetting negotiation",
          );
          this.publisherNegotiating = false;

          // Retry if there are queued offers
          if (this.publisherOfferQueue.length > 0) {
            this.publisherOfferQueue.shift();
            this.createPublisherOffer();
          }
        }
      }, 5000); // 5 second timeout
    } catch (err) {
      this.publisherNegotiating = false;
      console.error("[SFU Publisher Offer Error]", err);
    }
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

    this.send({ type: "MEDIA_STATE", kind: "audio", enabled: nextEnabled });
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

    this.send({ type: "MEDIA_STATE", kind: "video", enabled: nextEnabled });
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
        type: "SCREEN_SHARE_START",
        sender: this.myId,
        room_id: this.room.id,
        stream_id: this.screenStream.id.replace(/[{}]/g, ""),
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
      type: "SCREEN_SHARE_STOP",
      sender: this.myId,
      room_id: this.room.id,
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
      type: "CHAT_MESSAGE",
      message: payload.message.trim(),
      user_id: this.myId,
      sender_name: senderName,
      room_id: this.room.id,
      target: isPrivate ? (payload.target ?? null) : null,
      reply_to: payload.reply_to ?? null,
      client_ts: Date.now(),
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
        this.send({ type: "PING", client_ts: Date.now() });
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

    //  Clear offer timeout
    if (this.publisherOfferTimeout) {
      clearTimeout(this.publisherOfferTimeout);
      this.publisherOfferTimeout = null;
    }

    this.pubPC?.close();
    this.subPC?.close();
    this.pubPC = null;
    this.subPC = null;
    this.pendingTracks.clear();
    this.subscriberOfferQueue = [];
    this.subscriberNegotiating = false;
    this.publisherOfferQueue = [];
    this.publisherNegotiating = false;
    this.iceRestartAttempts.clear();
    this.state.resetRemoteState();
  }

  private resetPeerState() {
    this.pubPC?.close();
    this.subPC?.close();

    this.pubPC = null;
    this.subPC = null;

    this.pendingTracks.clear();
  }
  disconnect() {
    this.intentionalDisconnect = true;
    window.clearTimeout(this.reconnectTimer);

    //  Clear offer timeout
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
        type: "LEAVE",
        room_id: this.room.id,
        user_id: this.myId,
        sender_name: this.state.localParticipant?.name,
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

  // Improved publisher ICE restart with timeout and retry limit
  private async restartPublisherIce() {
    if (!this.pubPC) return;

    const key = "pub_ice_restart";
    const attempts = this.iceRestartAttempts.get(key) || 0;

    if (attempts >= this.maxIceRestartAttempts) {
      console.error("[Publisher] Max ICE restart attempts reached, giving up");
      this.iceRestartAttempts.delete(key);
      return;
    }

    try {
      console.log(
        `[Publisher] Restarting ICE (attempt ${attempts + 1}/${this.maxIceRestartAttempts})`,
      );
      this.iceRestartAttempts.set(key, attempts + 1);

      this.pubPC.restartIce();
      await this.createPublisherOffer();
    } catch (err) {
      console.error("[Publisher] ICE restart failed:", err);
    }
  }

  // Subscriber ICE restart (was missing)
  private async restartSubscriberIce() {
    if (!this.subPC) return;

    const key = "sub_ice_restart";
    const attempts = this.iceRestartAttempts.get(key) || 0;

    if (attempts >= this.maxIceRestartAttempts) {
      console.error("[Subscriber] Max ICE restart attempts reached, giving up");
      this.iceRestartAttempts.delete(key);
      return;
    }

    try {
      console.log(
        `[Subscriber] Restarting ICE (attempt ${attempts + 1}/${this.maxIceRestartAttempts})`,
      );
      this.iceRestartAttempts.set(key, attempts + 1);

      this.subPC.restartIce();
      // Subscriber doesn't need to create offer - server will send new offer
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

  private send(msg: any) {
    this.ws?.send(JSON.stringify(msg));
  }

  approveJoinRequest(requestId: string) {
    this.send({ type: "JOIN_APPROVE", request_id: requestId });
  }

  rejectJoinRequest(requestId: string) {
    this.send({ type: "JOIN_REJECT", request_id: requestId });
  }

  getMeeting(): { id: string | null; name: string | null } {
    return this.room;
  }
}
