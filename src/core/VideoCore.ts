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

export class VideoSDKCore {
  private ws: WebSocket | null = null;
  private pubPC: RTCPeerConnection | null = null;
  private subPC: RTCPeerConnection | null = null;

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

  // ---------------- MEDIA SETUP ----------------
  async initLocal(video: HTMLVideoElement, name: string) {
    this.participantName = name;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
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

  async joinMeeting(config: MeetingConfig) {
    const { roomId, name, audioMuted = false, videoMuted = false } = config;
    if (!roomId || !name) {
      throw new Error("roomId and name are required to join meeting");
    }
    this.participantName = name;

    if (!this.localStream) {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
    }

    this.localStream.getAudioTracks().forEach((t) => (t.enabled = !audioMuted));
    this.localStream.getVideoTracks().forEach((t) => (t.enabled = !videoMuted));

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
    await this.connect(roomId, name);
  }

  // ---------------- SFU PEER CONNECTION CREATION ----------------
  private setupPublisherPC() {
    if (!this.localStream) return;

    this.pubPC = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.iceTransportPolicy,
    });

    // Add local tracks to Publisher PC
    this.localStream.getTracks().forEach((track) => {
      this.pubPC?.addTrack(track, this.localStream!);
    });

    this.pubPC.onicecandidate = (e) => {
      if (e.candidate) {
        this.send({
          type: "PUB_ICE",
          payload: JSON.stringify(e.candidate),
          user_id: this.myId,
        });
      }
    };

    this.pubPC.onconnectionstatechange = () => {
      console.log(`[SFU Publisher PC State]`, this.pubPC?.connectionState);
      if (this.pubPC?.connectionState === "failed") {
        this.restartPublisherIce();
      }
    };
  }

  private setupSubscriberPC() {
    this.subPC = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.iceTransportPolicy,
    });

    this.subPC.onicecandidate = (e) => {
      if (e.candidate) {
        this.send({
          type: "SUB_ICE",
          payload: JSON.stringify(e.candidate),
          user_id: this.myId,
        });
      }
    };

    this.subPC.ontrack = (event) => {
      const incomingStream = event.streams[0] || new MediaStream([event.track]);
      const streamId = incomingStream.id.replace(/[{}]/g, "");

      // Find participant that owns this stream ID
      let matchedParticipant: Participant | undefined;
      for (const p of this.state.participants.values()) {
        if (
          p.media?.cameraStreamId === streamId ||
          p.media?.remoteScreenStreamId === streamId
        ) {
          matchedParticipant = p;
          break;
        }
      }

      if (!matchedParticipant) {
        console.warn(
          `[SFU ontrack] Dynamic track received for stream ${streamId}`,
        );
        return;
      }

      const pId = matchedParticipant.id;
      const isScreen =
        streamId === matchedParticipant.media?.remoteScreenStreamId;

      if (isScreen) {
        this.state.updateParticipantMedia(pId, {
          screenStream: incomingStream,
          screenTrack: event.track,
          isScreenSharing: true,
        });

        if (!this.state.presenterId) {
          this.state.setPresenterId(pId);
        }

        this.events.onScreenShareStarted?.(pId, incomingStream);
      } else {
        this.state.updateParticipantMedia(pId, {
          stream: incomingStream,
          cameraTrack: incomingStream.getVideoTracks()[0],
          audioTrack: incomingStream.getAudioTracks()[0],
        });
        this.events.onTrack?.(incomingStream, pId);
      }
    };

    this.subPC.onconnectionstatechange = () => {
      console.log(`[SFU Subscriber PC State]`, this.subPC?.connectionState);
    };
  }

  // ---------------- WEBSOCKET CONNECTION & SIGNALING ----------------
  async connect(roomId: string, name: string) {
    this.room.id = roomId;
    this.reset();

    return new Promise<void>((resolve, reject) => {
      this.joinResolver = resolve;
      this.joinRejecter = reject;
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log("WebSocket connected to SFU, sending JOIN...");
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

        // Initialize Publisher and Subscriber PeerConnections with SFU
        this.setupPublisherPC();
        this.setupSubscriberPC();

        // Create initial Publisher Offer to send client streams to SFU
        await this.createPublisherOffer();

        this.startHeartbeat();
        this.joinResolver?.();
        this.joinResolver = undefined;
        this.joinRejecter = undefined;
        break;
      }

      case "PUB_ANSWER": {
        if (this.pubPC) {
          await this.pubPC.setRemoteDescription({
            type: "answer",
            sdp: msg.payload,
          });
        }
        break;
      }

      case "SUB_OFFER": {
        if (this.subPC) {
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
        }
        break;
      }

      case "PUB_ICE": {
        if (this.pubPC && msg.payload) {
          await this.pubPC
            .addIceCandidate(JSON.parse(msg.payload))
            .catch(console.warn);
        }
        break;
      }

      case "SUB_ICE": {
        if (this.subPC && msg.payload) {
          await this.subPC
            .addIceCandidate(JSON.parse(msg.payload))
            .catch(console.warn);
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

  // ---------------- PUBLISHER RENEGOTIATION ----------------
  private async createPublisherOffer() {
    if (!this.pubPC) return;

    try {
      const offer = await this.pubPC.createOffer();
      await this.pubPC.setLocalDescription(offer);

      this.send({
        type: "PUB_OFFER",
        payload: offer.sdp,
        user_id: this.myId,
        room_id: this.room.id,
      });
    } catch (err) {
      console.error("[SFU Publisher Offer Error]", err);
    }
  }

  // ---------------- MEDIA TOGGLES ----------------
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

  // ---------------- SCREEN SHARING (SFU) ----------------
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

      // Add Screen track directly to SFU Publisher PC
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
        camera_id: this.localStream?.id.replace(/[{}]/g, ""),
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

  stopScreenShare() {
    if (!this.screenStream) return;

    this.screenStream.getTracks().forEach((t) => t.stop());

    if (this.pubPC && this.screenSender) {
      try {
        this.pubPC.removeTrack(this.screenSender);
        this.createPublisherOffer();
      } catch (e) {
        console.warn("Failed removing screen sender", e);
      }
      this.screenSender = null;
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

  // ---------------- CHAT & RECONNECT ----------------
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
    this.pubPC?.close();
    this.subPC?.close();
    this.pubPC = null;
    this.subPC = null;
    this.state.resetRemoteState();
  }

  disconnect() {
    this.intentionalDisconnect = true;

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

  private async restartPublisherIce() {
    if (!this.pubPC) return;
    try {
      this.pubPC.restartIce();
      await this.createPublisherOffer();
    } catch (err) {
      console.error("[Publisher ICE Restart Failed]", err);
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
