import { SDK_CONFIG } from "../config/ws";
import {
  ChatInput,
  ChatMessage,
  Events,
  MeetingConfig,
  SDKError,
} from "../types/meeting";
import { MeetingState } from "./MeetingState";

export class VideoSDKCore {
  private ws: WebSocket | null = null;
  private peers: Record<string, RTCPeerConnection> = {};
  private initiators = new Set<string>();
  private lastPong = Date.now();
  private iceServers: RTCIceServer[] = [];
  private intentionalDisconnect = false;

  private myId: string;
  private room: { id: string | null; name: string | null } = {
    id: null,
    name: null,
  };
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private isScreenSharing = false;

  // Transceiver-based tracking: maps peerId -> { cameraTransceiver, screenTransceiver, screenMid }
  private peerTransceivers: Record<
    string,
    {
      cameraTransceiver: RTCRtpTransceiver;
      screenTransceiver: RTCRtpTransceiver;
      screenMid: string | null; // set after negotiation completes
    }
  > = {};

  private pingInterval: any = null;
  private pendingIceCandidates: Record<string, RTCIceCandidateInit[]> = {};
  private pendingOffers: Record<string, string> = {};
  private reconnectAttempts = 0;
  private reconnectTimer?: number;
  private participantName = "";
  public readonly state: MeetingState;
  private joinResolver?: () => void;
  private joinRejecter?: (e: any) => void;

  // Track if we're in the waiting room (pending approval)
  private isWaitingForApproval = false;
  private pendingRequestId: string | null = null;

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
    private url: string = SDK_CONFIG.wsUrl,
  ) {
    this.state = new MeetingState();
    this.events = events;
    this.url = url;

    this.myId = localStorage.getItem("vsdk_id") || crypto.randomUUID();

    localStorage.setItem("vsdk_id", this.myId);
  }

  // STREAM
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

      // Verify tracks are actually live BEFORE connecting
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

  // CONNECT
  async connect(roomId: string, name: string) {
    this.room.id = roomId;

    this.reset();

    return new Promise<void>((resolve, reject) => {
      this.joinResolver = resolve;
      this.joinRejecter = reject;
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log("WebSocket connected, sending JOIN...");
        this.send({
          type: "JOIN",
          room_id: roomId,
          user_id: this.myId,
          sender_name: name,
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

        if (this.intentionalDisconnect) {
          return; // do NOT reconnect
        }

        if (e.code === 1000 || e.code === 1001) {
          return;
        }

        // Don't auto-reconnect if waiting for approval (user must reconnect after approval)
        if (this.isWaitingForApproval) {
          console.log("Waiting for approval, not auto-reconnecting");
          return;
        }

        this.scheduleReconnect();
      };

      this.ws.onmessage = async (e) => {
        await this.handle(JSON.parse(e.data));
      };
    });
  }

  async joinMeeting(config: MeetingConfig) {
    const { roomId, name, audioMuted = false, videoMuted = false } = config;

    if (!roomId || !name) {
      throw new Error("roomId and name are required to join meeting");
    }

    this.participantName = name;

    // Reuse existing stream if initLocal already configured it
    if (!this.localStream) {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
    }

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

    await this.connect(roomId, name);
  }

  getMeeting(): { id: string | null; name: string | null } {
    return this.room;
  }

  toggleMic() {
    const mediaState = this.state.localParticipant?.media;
    if (!mediaState) return;

    const nextEnabled = !mediaState.micEnabled;

    this.localStream
      ?.getAudioTracks()
      .forEach((t) => (t.enabled = nextEnabled));

    // Update state layer
    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: {
        ...mediaState,
        micEnabled: nextEnabled,
      },
    });

    // Notify peers
    this.send({
      type: "MEDIA_STATE",
      kind: "audio",
      enabled: nextEnabled,
    });
  }

  toggleCam() {
    const mediaState = this.state.localParticipant?.media;
    if (!mediaState) return;

    const nextEnabled = !mediaState.camEnabled;

    this.localStream
      ?.getVideoTracks()
      .forEach((t) => (t.enabled = nextEnabled));

    // Update state layer
    this.state.updateLocalParticipant({
      id: this.myId,
      name: this.participantName,
      media: {
        ...mediaState,
        camEnabled: nextEnabled,
      },
    });

    // Notify peers
    this.send({
      type: "MEDIA_STATE",
      kind: "video",
      enabled: nextEnabled,
    });
  }

  private scheduleReconnect() {
    if (!this.room.id) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    clearTimeout(this.reconnectTimer);

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
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      this.send({
        type: "PING",
        client_ts: Date.now(),
      });
    }, 20000); // every 20s
  }

  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // RESET
  private reset() {
    Object.values(this.peers).forEach((pc) => pc.close());

    this.peers = {};
    this.peerTransceivers = {};
    this.initiators.clear();
    this.pendingIceCandidates = {};

    this.state.resetRemoteState();
  }

  private async handleJoinApproved(msg: any) {
    console.log("JOIN_APPROVED received, sending new JOIN...");

    this.events.onEntryResponded?.({
      participantId: msg.user_id,
      decision: "approved",
    });

    this.isWaitingForApproval = false;
    this.pendingRequestId = null;

    // Send JOIN again on SAME socket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({
        type: "JOIN",
        room_id: this.room.id,
        user_id: this.myId,
        sender_name: this.participantName,
      });
      console.log("Sent new JOIN after approval");
    }
  }

  private async handle(msg: any) {
    if (msg.sender === this.myId) return;

    switch (msg.type) {
      case "PONG":
        this.lastPong = Date.now();
        break;

      case "OFFER":
        console.log("[Offer] Received from", msg.sender, {
          sdp: msg.payload.substring(0, 200),
        });
        await this.handleOffer(msg.payload, msg.sender);
        break;

      case "ANSWER": {
        const pc = this.peers[msg.sender];
        console.log("[Answer] Received from", msg.sender, {
          signalingState: pc?.signalingState,
          iceConnectionState: pc?.iceConnectionState,
          connectionState: pc?.connectionState,
        });

        if (!pc) return;

        if (pc.signalingState !== "have-local-offer") {
          console.warn(
            `[Signaling] Unexpected ANSWER in state "${pc.signalingState}", ignoring`,
          );
          return;
        }

        try {
          await pc.setRemoteDescription({
            type: "answer",
            sdp: msg.payload,
          });

          // Capture screenMid after remote description is set
          this.captureScreenMid(msg.sender);

          await this.flushIce(msg.sender, pc);
        } catch (err) {
          console.error("[Signaling] Failed to apply answer:", err);
          this.emitError(
            "ANSWER_FAILED",
            `Failed to apply answer from ${msg.sender}`,
            err,
            true,
          );
        }
        break;
      }

      case "ICE": {
        const candidate = JSON.parse(msg.payload);

        let pc = this.peers[msg.sender];

        if (!pc) {
          this.pendingIceCandidates[msg.sender] ??= [];
          this.pendingIceCandidates[msg.sender].push(candidate);
          break;
        }

        if (!pc.remoteDescription) {
          this.pendingIceCandidates[msg.sender] ??= [];
          this.pendingIceCandidates[msg.sender].push(candidate);
          break;
        }

        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          console.warn("ICE error:", err);
        }

        break;
      }

      case "EXISTING_USERS":
        if (msg.presenterId) {
          this.state.setPresenterId(msg.presenterId);
          this.events.onScreenShareStarted?.(msg.presenterId, null!);
        }

        for (const p of msg.participants || []) {
          if (!p?.id || p.id === this.myId) continue;
          this.state.addParticipant(p);
          this.events.onUserJoined?.(p);

          if (p.isScreenSharing && p.remoteScreenStreamId) {
            console.log(
              `[Existing Users] ${p.name} is sharing screen (stream: ${p.remoteScreenStreamId})`,
            );

            this.state.setPresenterId(p.id);
            this.state.updateParticipantMedia(p.id, {
              isScreenSharing: true,
              remoteScreenStreamId: p.remoteScreenStreamId,
            });
            console.log(
              `[EXISTING_USERS] Pre-seeded screen state for ${p.id}, waiting for ontrack`,
            );
          }

          if (this.shouldInitiate(p.id)) {
            await this.createOffer(p.id);
          }
        }
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

        // Process any OFFERs that arrived before JOINED
        if (Object.keys(this.pendingOffers).length > 0) {
          console.log(
            "Processing",
            Object.keys(this.pendingOffers).length,
            "pending offers",
          );
          for (const [peerId, sdp] of Object.entries(this.pendingOffers)) {
            console.log("Handling queued offer from", peerId);
            await this.handleOffer(sdp, peerId);
          }
          this.pendingOffers = {};
        }
        this.startHeartbeat();
        this.joinResolver?.();
        this.joinResolver = undefined;
        this.joinRejecter = undefined;
        break;
      }

      case "USER_JOINED": {
        const p = msg.participant;

        if (!p?.id || p.id === this.myId) return;

        this.state.addParticipant(p);
        this.events.onUserJoined?.(p);

        if (this.shouldInitiate(p.id)) {
          await this.createOffer(p.id);
        }

        break;
      }

      case "JOIN_PENDING": {
        const req = msg.request;

        console.log("JOIN_PENDING - waiting for host approval");
        this.isWaitingForApproval = true;
        this.pendingRequestId = req.request_id;

        this.events.onEntryRequested?.({
          requestId: req.request_id,
          userId: req.user_id,
          name: req.name,
        });

        break;
      }

      case "JOIN_REQUEST": {
        const req = msg.request;

        console.log("JOIN_REQUEST - show to host for approval");

        this.events.onEntryRequested?.({
          requestId: req.id,
          userId: req.user_id,
          name: req.name,
        });

        break;
      }

      case "JOIN_APPROVED": {
        await this.handleJoinApproved(msg);
        break;
      }

      case "JOIN_REJECTED": {
        const decision = "rejected";

        console.log("JOIN_REJECTED - user not allowed to join");
        this.isWaitingForApproval = false;
        this.pendingRequestId = null;

        this.events.onEntryResponded?.({
          participantId: msg.user_id,
          decision,
        });

        break;
      }

      case "USER_LEFT":
        const peerId = msg.participant.id;
        this.closePeer(peerId);

        this.state.removeParticipant(peerId);

        this.events.onUserLeft?.(peerId);

        break;

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

      case "SCREEN_SHARE_START": {
        const peerId = msg.peerId;

        this.state.updateParticipantMedia(peerId, {
          isScreenSharing: true,
          remoteScreenStreamId: msg.stream_id,
        });

        if (!this.state.presenterId) {
          this.state.setPresenterId(peerId);
        }

        // Screen stream will arrive via ontrack on the screen transceiver
        this.events.onScreenShareStarted?.(peerId, null!);
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

      case "ERROR": {
        const fatal = msg?.fatal === true;

        this.emitError(
          "WS_ERROR",
          msg?.message || "Unknown error",
          msg,
          !fatal,
        );

        if (fatal) {
          this.disconnect();
        }

        return;
      }
    }
  }

  // PEER
  /**
   * Create a peer connection with pre-established transceiver layout:
   * - Audio transceiver (sendrecv)
   * - Camera video transceiver (sendrecv)
   * - Screen video transceiver (initially recvonly, becomes sendrecv when sharing)
   *
   * This fixed layout ensures late joiners get the screen transceiver m-line
   * negotiated from the very first offer, even if no one is sharing yet.
   */
  private async createPeer(id: string) {
    if (!this.localStream) throw new Error("No local stream");
    if (!this.iceServers || this.iceServers.length === 0) {
      throw new Error(
        "ICE Servers not configured. Backend must provide iceServers on JOIN.",
      );
    }

    console.log(
      "Creating peer connection for",
      id,
      "with tracks:",
      this.localStream.getTracks().map((t) => ({
        kind: t.kind,
        enabled: t.enabled,
        state: t.readyState,
      })),
    );

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    // ===== AUDIO TRANSCEIVER =====
    const audioTransceiver = pc.addTransceiver("audio", {
      direction: "sendrecv",
    });
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      await audioTransceiver.sender.replaceTrack(audioTrack);
    }

    // ===== CAMERA VIDEO TRANSCEIVER =====
    const cameraTransceiver = pc.addTransceiver("video", {
      direction: "sendrecv",
    });
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      await cameraTransceiver.sender.replaceTrack(videoTrack);
    }

    // ===== SCREEN VIDEO TRANSCEIVER (initially recvonly) =====
    // This will be present in the SDP even if we're not currently sharing.
    // When we start sharing, we flip direction to "sendrecv" and replaceTrack.
    const screenTransceiver = pc.addTransceiver("video", {
      direction: this.isScreenSharing ? "sendrecv" : "recvonly",
    });

    if (this.isScreenSharing && this.screenStream) {
      const screenTrack = this.screenStream.getVideoTracks()[0];
      if (screenTrack) {
        await screenTransceiver.sender.replaceTrack(screenTrack);
      }
    }

    // Store transceiver info for later use
    this.peerTransceivers[id] = {
      cameraTransceiver,
      screenTransceiver,
      screenMid: null, // will be populated after negotiation
    };

    // ===== TRACK HANDLER =====
    pc.ontrack = (event) => {
      const transceiver = event.transceiver;
      const isScreenTrack =
        transceiver.mid === this.peerTransceivers[id]?.screenMid;

      console.log(
        `[ontrack] ${id}: kind=${event.track.kind}, mid=${transceiver.mid}, isScreen=${isScreenTrack}`,
      );

      const incomingStream =
        event.streams?.[0] || new MediaStream([event.track]);

      // Handle track unmuting
      if (event.track.muted) {
        event.track.onunmute = () => {
          console.log(`[ontrack] ${event.track.kind} track unmuted for ${id}`);
        };
      }

      if (isScreenTrack) {
        // Screen share stream
        const videoTrack =
          event.track.kind === "video"
            ? event.track
            : incomingStream.getVideoTracks()[0];

        this.state.updateParticipantMedia(id, {
          screenStream: incomingStream,
          screenTrack: videoTrack,
          isScreenSharing: true,
        });

        if (!this.state.presenterId) {
          this.state.setPresenterId(id);
        }

        this.events.onScreenShareStarted?.(id, incomingStream);
      } else {
        // Camera/normal stream
        this.state.updateParticipantMedia(id, {
          stream: incomingStream,
          cameraTrack: incomingStream.getVideoTracks()[0],
          audioTrack: incomingStream.getAudioTracks()[0],
        });
        this.events.onTrack?.(incomingStream, id);
      }
    };

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      this.send({
        type: "ICE",
        payload: JSON.stringify(e.candidate),
        sender: this.myId,
        target: id,
      });
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[ICE Connection] ${id}: ${pc.iceConnectionState}`);
    };

    pc.onconnectionstatechange = () => {
      console.log(`[Connection] ${id}: ${pc.connectionState}`);
      if (pc.connectionState === "failed") {
        try {
          pc.restartIce();
        } catch (e) {
          console.warn("Failed to restart ICE:", e);
        }
      }
    };

    return pc;
  }

  /**
   * Capture the screen transceiver's MID after SDP negotiation completes.
   * The MID is assigned during negotiation and is stable for the life of the connection.
   */
  private captureScreenMid(peerId: string) {
    const pc = this.peers[peerId];
    if (!pc) return;

    const transceivers = pc.getTransceivers();
    const screenTransceiver = this.peerTransceivers[peerId]?.screenTransceiver;

    if (!screenTransceiver) return;

    // Find the actual mid from the negotiated transceiver
    const negotiatedTransceiver = transceivers.find(
      (t) => t === screenTransceiver,
    );

    if (negotiatedTransceiver?.mid) {
      this.peerTransceivers[peerId].screenMid = negotiatedTransceiver.mid;
      console.log(
        `[Negotiation] Captured screenMid for ${peerId}: ${negotiatedTransceiver.mid}`,
      );
    }
  }

  // OFFER
  private async createOffer(id: string, isRenegotiation = false) {
    if (!isRenegotiation && !this.shouldInitiate(id)) {
      console.debug(
        `[Offer] ${id} should initiate (${id} > ${this.myId}), skipping`,
      );
      return;
    }

    if (!isRenegotiation && this.initiators.has(id)) {
      console.debug(
        `[Offer] Already initiating with ${id}, skipping duplicate`,
      );
      return;
    }

    if (!isRenegotiation) {
      this.initiators.add(id);
    }

    if (!this.peers[id]) {
      this.peers[id] = await this.createPeer(id);
    }

    const pc = this.peers[id];

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Capture screenMid after local description is set
      this.captureScreenMid(id);

      this.send({
        type: "OFFER",
        payload: offer.sdp,
        sender: this.myId,
        target: id,
      });

      console.debug(`[Offer] Sent to ${id}`);
    } catch (err) {
      console.error(`[Offer] Failed for ${id}:`, err);
      this.emitError(
        "OFFER_CREATION_FAILED",
        `Failed to create offer for ${id}`,
        err,
        true,
      );
    }
  }

  private shouldInitiate(peerId: string): boolean {
    // Lexicographic comparison: lower ID initiates
    return this.myId < peerId;
  }

  // ANSWER
  private async handleOffer(sdp: string, id: string) {
    if (!this.iceServers || this.iceServers.length === 0) {
      console.warn("[Offer] Waiting for iceServers, queuing offer from", id);
      this.pendingOffers[id] = sdp;
      return;
    }

    if (!this.peers[id]) {
      this.peers[id] = await this.createPeer(id);
    }

    const pc = this.peers[id];

    try {
      // GLARE RECOVERY: Both peers sent OFFERs simultaneously
      if (pc.signalingState === "have-local-offer") {
        if (this.shouldInitiate(id)) {
          // WE WIN: Keep our offer, reject theirs
          console.warn(
            `[Glare] Both sent OFFERs, we win (${this.myId} < ${id}), keeping our OFFER`,
          );
          return; // Ignore their offer, wait for their ANSWER
        } else {
          // THEY WIN: Roll back and accept their offer
          console.warn(
            `[Glare] Both sent OFFERs, they win (${id} < ${this.myId}), rolling back`,
          );
          pc.close();
          delete this.peers[id];
          delete this.peerTransceivers[id];
          this.initiators.delete(id);

          // Create fresh peer connection to answer their offer
          this.peers[id] = await this.createPeer(id);
        }
      }

      // Only set remote description if we're in a valid state
      if (
        this.peers[id].signalingState !== "stable" &&
        this.peers[id].signalingState !== "have-local-offer"
      ) {
        console.warn(
          `[Signaling] Cannot accept OFFER in state "${this.peers[id].signalingState}"`,
        );
        return;
      }

      await this.peers[id].setRemoteDescription({
        type: "offer",
        sdp,
      });

      // Capture screenMid after remote description is set
      this.captureScreenMid(id);

      const pending = this.pendingIceCandidates[id] || [];

      for (const candidate of pending) {
        try {
          await this.peers[id].addIceCandidate(candidate);
        } catch (err) {
          console.warn("[ICE] Failed to add candidate:", err);
        }
      }

      delete this.pendingIceCandidates[id];

      const answer = await this.peers[id].createAnswer();

      await this.peers[id].setLocalDescription(answer);
      await this.flushIce(id, this.peers[id]);

      this.send({
        type: "ANSWER",
        payload: answer.sdp,
        sender: this.myId,
        target: id,
      });

      console.debug(`[Answer] Sent to ${id}`);
    } catch (err) {
      console.error(`[Signaling] Failed to handle OFFER from ${id}:`, err);
      this.emitError(
        "OFFER_HANDLING_FAILED",
        `Failed to handle offer from ${id}`,
        err,
        true,
      );
    }
  }

  // CLEANUP
  private closePeer(id: string) {
    const pc = this.peers[id];

    if (!pc) return;

    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;

    pc.close();

    delete this.peers[id];
    delete this.peerTransceivers[id];

    this.initiators.delete(id);

    this.state.removeParticipant(id);
  }

  // SCREEN SHARE (TRANSCEIVER-BASED)
  /**
   * Start screen sharing using replaceTrack on the pre-established screen transceiver.
   * No need to add/remove tracks, no renegotiation needed (transceiver already in SDP).
   * Just swap the track and update direction if needed.
   */
  async startScreenShare() {
    try {
      if (this.state.presenterId && this.state.presenterId !== this.myId) {
        throw new Error("Another user is already sharing their screen.");
      }
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Screen sharing not supported on this device");
      }

      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
      });

      const screenTrack = this.screenStream.getVideoTracks()[0];
      if (!screenTrack) {
        throw new Error("No video track in screen stream");
      }

      this.isScreenSharing = true;

      this.state.updateLocalParticipant({
        media: {
          isScreenSharing: true,
          screenStream: this.screenStream,
          screenTrack: screenTrack,
        },
      });

      this.state.setPresenterId(this.myId);

      // Handle user clicking browser's "Stop Sharing" button
      screenTrack.onended = () => {
        console.log("[Screen Share] User stopped via browser button");
        this.stopScreenShare();
      };

      // Update all existing peer connections: use replaceTrack on screen transceiver
      for (const [peerId, pc] of Object.entries(this.peers)) {
        const txInfo = this.peerTransceivers[peerId];
        if (!txInfo) {
          console.warn(
            `[Screen Share] No transceiver info for ${peerId}, skipping`,
          );
          continue;
        }

        try {
          // Replace the track on the screen transceiver sender
          await txInfo.screenTransceiver.sender.replaceTrack(screenTrack);

          // Flip direction from recvonly to sendrecv if needed
          if (txInfo.screenTransceiver.currentDirection === "recvonly") {
            txInfo.screenTransceiver.direction = "sendrecv";
            console.log(
              `[Screen Share] Flipped ${peerId} screen transceiver to sendrecv`,
            );

            // Trigger renegotiation for the direction change
            await this.createOffer(peerId, true);
          }
        } catch (err) {
          console.error(
            `[Screen Share] Failed to update transceiver for ${peerId}:`,
            err,
          );
        }
      }

      this.send({
        type: "SCREEN_SHARE_START",
        sender: this.myId,
        room_id: this.room.id,
        stream_id: this.screenStream.id.replace(/[{}]/g, ""),
      });

      console.log("[Screen Share] Started successfully");
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

  async stopScreenShare() {
    if (!this.screenStream) return;

    console.log("[Screen Share] Stopping...");

    // Stop all tracks in the screen stream
    this.screenStream.getTracks().forEach((t) => t.stop());

    // Update all peer connections: clear track and flip direction back to recvonly
    for (const [peerId, pc] of Object.entries(this.peers)) {
      const txInfo = this.peerTransceivers[peerId];
      if (!txInfo) continue;

      try {
        // Clear the screen transceiver track
        await txInfo.screenTransceiver.sender.replaceTrack(null);

        // Flip direction back to recvonly
        if (txInfo.screenTransceiver.currentDirection === "sendrecv") {
          txInfo.screenTransceiver.direction = "recvonly";
          console.log(
            `[Screen Share] Flipped ${peerId} screen transceiver to recvonly`,
          );

          // Trigger renegotiation for the direction change
          await this.createOffer(peerId, true);
        }
      } catch (err) {
        console.error(
          `[Screen Share] Failed to clear transceiver for ${peerId}:`,
          err,
        );
      }
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

    console.log("[Screen Share] Stopped");
  }

  // CHAT
  sendChatMessage(payload: ChatInput) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("WS not connected");
      return;
    }

    if (!this.room.id) {
      console.warn("No roomId set");
      return;
    }

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

    // optimistic UI update
    this.state.addChatMessage(msg);

    // send protocol payload (clean + consistent)
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

  // DISCONNECT
  disconnect() {
    this.intentionalDisconnect = true;

    this.stopScreenShare();

    Object.values(this.peers).forEach((pc) => pc.close());
    this.peers = {};
    this.peerTransceivers = {};
    this.initiators.clear();

    this.stopHeartbeat();

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({
        type: "LEAVE",
        room_id: this.room.id,
        user_id: this.myId,
        sender_name: this.state.localParticipant?.name,
      });

      // Allow the LEAVE frame to be flushed.
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

  private async flushIce(id: string, pc: RTCPeerConnection) {
    const pending = this.pendingIceCandidates[id];
    if (!pending?.length) return;

    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (e) {
        console.warn("ICE flush error", e);
      }
    }

    delete this.pendingIceCandidates[id];
  }

  private send(msg: any) {
    this.ws?.send(JSON.stringify(msg));
  }

  approveJoinRequest(requestId: string) {
    this.send({
      type: "JOIN_APPROVE",
      request_id: requestId,
    });
  }

  rejectJoinRequest(requestId: string) {
    this.send({
      type: "JOIN_REJECT",
      request_id: requestId,
    });
  }
}
