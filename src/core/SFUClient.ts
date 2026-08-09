/**
 * DefComm Enterprise SFU Client (TypeScript Version)
 *
 * Client for the Rust SFU signaling protocol.
 *
 * Media architecture
 * ------------------
 * Publisher RTCPeerConnection:
 *   browser camera/mic -> SFU
 *
 * Subscriber RTCPeerConnection:
 *   SFU published tracks -> browser
 *
 * The client never infers track ownership from a browser MediaStreamTrack.
 * Remote ownership comes from the SFU TrackInfo, keyed by the SFU-generated
 * track id that is also used as the remote TrackLocalStaticRTP id.
 */

interface TrackInfo {
  track_id: string;
  participant_id: string;
  kind: "audio" | "video";
  [key: string]: any;
}

interface ParticipantInfo {
  participant_id: string;
  user_metadata?: {
    name?: string;
    [key: string]: any;
  };
  display_name?: string;
  [key: string]: any;
}

interface SFUClientOptions {
  apiBase?: string;
  wsBase?: string;
  onParticipantJoined?: (participant: ParticipantInfo) => void;
  onParticipantLeft?: (participant: string | ParticipantInfo) => void;
  onTrackPublished?: (track: TrackInfo) => void;
  onTrackUnpublished?: (track: TrackInfo) => void;
  onRemoteTrack?: (
    track: MediaStreamTrack,
    stream: MediaStream,
    metadata: TrackInfo,
  ) => void;
  onConnected?: (payload: any) => void;
  onDisconnected?: () => void;
  onError?: (error: any) => void;
  autoSubscribe?: boolean;
}

export class SFUClient {
  private apiBase: string;
  private wsBase: string;
  private ws: WebSocket | null = null;
  private publisher: RTCPeerConnection | null = null;
  private subscriber: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private videoSender: RTCRtpSender | null = null;
  private audioSender: RTCRtpSender | null = null;
  private iceServers: RTCIceServer[] = [];
  private requestId = 0;
  private publisherRevision = 0;
  private currentParticipantId: string | null = null;
  private session: string | null = null;
  private room: string | null = null;

  // Pending ICE candidates
  private pendingIce: Record<string, RTCIceCandidateInit[]> = {
    publisher: [],
    subscriber: [],
  };

  // Subscriber offer handling
  private subscriberNegotiating = false;
  private offerQueue: any[] = [];
  private subscriptionQueue: string[] = [];
  private subscriptionRunning = false;
  private _subscriptionResolve: (() => void) | null = null;

  // Track management
  private subscribedTracks = new Set<string>();
  private trackMetadata = new Map<string, TrackInfo>();
  private participants = new Map<string, ParticipantInfo>();
  private remoteStreams = new Map<string, MediaStream>();

  // Event handlers
  private onParticipantJoined: (p: ParticipantInfo) => void;
  private onParticipantLeft: (p: string | ParticipantInfo) => void;
  private onTrackPublished: (t: TrackInfo) => void;
  private onTrackUnpublished: (t: TrackInfo) => void;
  private onRemoteTrack: (
    t: MediaStreamTrack,
    s: MediaStream,
    m: TrackInfo,
  ) => void;
  private onConnected: (p: any) => void;
  private onDisconnected: () => void;
  private onError: (e: any) => void;
  private autoSubscribe: boolean;
  private subscriberStatsTimer: any;

  constructor(options: SFUClientOptions = {}) {
    this.apiBase = options.apiBase || "https://api.example.com/api";
    this.wsBase = options.wsBase || "wss://api.example.com/ws";

    this.onParticipantJoined = options.onParticipantJoined || (() => {});
    this.onParticipantLeft = options.onParticipantLeft || (() => {});
    this.onTrackPublished = options.onTrackPublished || (() => {});
    this.onTrackUnpublished = options.onTrackUnpublished || (() => {});
    this.onRemoteTrack = options.onRemoteTrack || (() => {});
    this.onConnected = options.onConnected || (() => {});
    this.onDisconnected = options.onDisconnected || (() => {});
    this.onError = options.onError || console.error;
    this.autoSubscribe = options.autoSubscribe !== false;
  }

  private nextRequestId(): string {
    return (++this.requestId).toString();
  }

  private async request(url: string, options: RequestInit = {}) {
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
      },
      ...options,
    });

    if (!res.ok) {
      let body: any = {};
      try {
        body = await res.json();
      } catch {
        /* empty */
      }
      throw new Error(body.message || res.statusText);
    }

    return res.json();
  }

  async getToken(
    roomCode: string,
    options: { displayName?: string; avatarUrl?: string } = {},
  ) {
    const userId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `user_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;

    const data = await this.request(`${this.apiBase}/token`, {
      method: "POST",
      body: JSON.stringify({
        room_code: roomCode.trim(),
        user_id: userId,
        display_name: options.displayName,
        avatar_url: options.avatarUrl,
      }),
    });

    this.session = data?.token;
    this.room = roomCode.trim();

    return this.connect(data?.token, options);
  }

  private async connect(token: string, options: any = {}) {
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(
        `${this.wsBase}?access_token=${encodeURIComponent(token)}`,
      );

      this.ws.onopen = () => {
        this.send({
          type: "join",
          payload: {
            token,
            room_code: this.room,
            resume_token: null,
            display_name: options.displayName,
            avatar_url: options.avatarUrl,
          },
        });
      };

      this.ws.onerror = (event) => {
        this.onError(event);
        reject(event);
      };

      this.ws.onclose = () => {
        this.cleanup();
        this.onDisconnected();
      };

      this.ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          await this.handleServerMessage(message, resolve);
        } catch (error) {
          this.onError(error);
        }
      };
    });
  }

  private async handleServerMessage(
    message: any,
    resolveJoin?: (value: any) => void,
  ) {
    switch (message.type) {
      case "joined": {
        const payload = message.payload || {};
        this.iceServers = payload.ice_servers || [];
        this.currentParticipantId = payload.participant_id;

        for (const participant of payload.participants || []) {
          this.participants.set(participant.participant_id, participant);
        }

        for (const track of payload.tracks || []) {
          this.trackMetadata.set(track.track_id, track);
        }

        await this.initializePeerConnections();
        this.onConnected(payload);

        for (const participant of payload.participants || []) {
          if (participant.participant_id !== this.currentParticipantId) {
            this.onParticipantJoined(participant);
          }
        }

        if (this.autoSubscribe) {
          const trackIds = (payload.tracks || [])
            .filter(
              (track: any) =>
                track.participant_id !== this.currentParticipantId,
            )
            .map((track: any) => track.track_id);

          if (trackIds.length > 0) {
            await this.subscribeMultiple(trackIds);
          }
        }

        resolveJoin?.(payload);
        break;
      }

      case "publish_answer": {
        if (!this.publisher) {
          throw new Error(
            "publish_answer received before publisher PeerConnection",
          );
        }

        await this.publisher.setRemoteDescription({
          type: "answer",
          sdp: message.payload.sdp,
        });

        await this.flushPendingIce("publisher");
        break;
      }

      case "subscribe_offer": {
        this.offerQueue.push({
          type: "subscribe_offer",
          payload: message.payload,
        });

        if (!this.subscriberNegotiating) {
          await this.processOfferQueue();
        }
        break;
      }

      case "ice_candidate":
        await this.handleIce(message.payload);
        break;

      case "participant_joined": {
        const participant = message.payload?.participant;
        const participantId =
          participant?.participant_id || message.payload?.participant_id;

        if (!participantId || participantId === this.currentParticipantId)
          break;

        if (participant) {
          this.participants.set(participantId, participant);
        }
        this.onParticipantJoined(participant);
        break;
      }

      case "participant_left": {
        const participantId = message.payload.participant_id;
        this.participants.delete(participantId);
        this.removeRemoteParticipant(participantId);
        this.onParticipantLeft(participantId);
        break;
      }

      case "track_published": {
        const track = message.payload.track;
        if (track.participant_id === this.currentParticipantId) break;

        this.trackMetadata.set(track.track_id, track);
        this.onTrackPublished(track);

        if (this.autoSubscribe) {
          await this.subscribe(track.track_id);
        }
        break;
      }

      case "track_unpublished": {
        const trackId = message.payload.track_id;
        const track = this.trackMetadata.get(trackId);

        this.trackMetadata.delete(trackId);
        this.subscribedTracks.delete(trackId);
        this.onTrackUnpublished(track || ({ track_id: trackId } as any));
        break;
      }
    }
  }

  private async initializePeerConnections() {
    const config = {
      iceServers: this.iceServers,
    };

    this.publisher = new RTCPeerConnection(config);
    this.subscriber = new RTCPeerConnection(config);

    this.publisher.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendCandidate("publisher", event.candidate);
      }
    };

    this.subscriber.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendCandidate("subscriber", event.candidate);
      }
    };

    this.subscriber.ontrack = (event) => {
      const stream = event.streams?.[0] || null;
      const metadata = this.resolveRemoteTrackMetadata(event.track, stream);

      if (!metadata?.participant_id) {
        this.onError(
          new Error(
            `Remote ${event.track.kind} track ${event.track.id} has no participant mapping`,
          ),
        );
        return;
      }

      const participantId = metadata.participant_id;
      let remoteStream = this.remoteStreams.get(participantId);

      if (!remoteStream) {
        remoteStream = new MediaStream();
        this.remoteStreams.set(participantId, remoteStream);
      }

      // Replace stale tracks of same kind
      for (const existing of remoteStream.getTracks()) {
        if (
          existing.kind === event.track.kind &&
          existing.id !== event.track.id
        ) {
          remoteStream.removeTrack(existing);
          existing.stop();
        }
      }

      if (
        !remoteStream.getTracks().some((track) => track.id === event.track.id)
      ) {
        remoteStream.addTrack(event.track);
      }

      event.track.onended = () => {
        if (
          remoteStream.getTracks().some((track) => track.id === event.track.id)
        ) {
          remoteStream.removeTrack(event.track);
        }
      };

      this.onRemoteTrack(event.track, remoteStream, metadata);
    };

    // Start stats monitoring
    this.subscriberStatsTimer = setInterval(async () => {
      if (!this.subscriber || this.subscriber.connectionState === "closed") {
        return;
      }

      try {
        const stats = await this.subscriber.getStats();
        stats.forEach((report: any) => {
          if (
            report.type === "inbound-rtp" &&
            (report.kind === "video" || report.mediaType === "video")
          ) {
            console.debug("Subscriber inbound video stats", {
              packetsReceived: report.packetsReceived,
              framesDecoded: report.framesDecoded,
              frameWidth: report.frameWidth,
              frameHeight: report.frameHeight,
            });
          }
        });
      } catch (error) {
        console.debug("Stats unavailable", error);
      }
    }, 2000);
  }

  private normalizeRemoteTrackId(browserTrackId: string): string {
    return browserTrackId?.startsWith("track-")
      ? browserTrackId.slice("track-".length)
      : browserTrackId;
  }

  private resolveRemoteTrackMetadata(
    track: MediaStreamTrack,
    stream: MediaStream | null,
  ): TrackInfo | null {
    const sfuTrackId = this.normalizeRemoteTrackId(track.id);
    const metadata = this.trackMetadata.get(sfuTrackId);

    if (metadata) {
      return metadata;
    }

    if (stream?.id && this.participants.has(stream.id)) {
      const candidate = [...this.trackMetadata.values()].find(
        (entry) => entry.participant_id === stream.id,
      );
      if (candidate) {
        return candidate;
      }
    }

    return null;
  }

  private sendCandidate(peer: string, candidate: RTCIceCandidate) {
    this.send({
      type: "ice_candidate",
      payload: {
        peer,
        candidate: candidate.candidate,
        sdp_mid: candidate.sdpMid,
        sdp_mline_index: candidate.sdpMLineIndex,
        username_fragment: candidate.usernameFragment,
      },
    });
  }

  private async handleIce(payload: any) {
    const peer = payload.peer === "publisher" ? "publisher" : "subscriber";
    const pc = peer === "publisher" ? this.publisher : this.subscriber;

    if (!pc) {
      this.pendingIce[peer].push(payload);
      return;
    }

    const candidate = {
      candidate: payload.candidate,
      sdpMid: payload.sdp_mid ?? null,
      sdpMLineIndex: payload.sdp_mline_index ?? null,
      usernameFragment: payload.username_fragment ?? null,
    };

    if (!pc.remoteDescription) {
      this.pendingIce[peer].push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      this.onError(
        new Error(`Failed to add ${peer} ICE candidate: ${String(error)}`),
      );
    }
  }

  private async flushPendingIce(peer: string) {
    const pc = peer === "publisher" ? this.publisher : this.subscriber;

    if (!pc || !pc.remoteDescription) {
      return;
    }

    const queue = this.pendingIce[peer];

    while (queue.length > 0) {
      const candidate = queue.shift();
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        this.onError(
          new Error(
            `Failed to add queued ${peer} ICE candidate: ${String(error)}`,
          ),
        );
      }
    }
  }

  private async processOfferQueue() {
    while (this.offerQueue.length > 0) {
      if (this.subscriberNegotiating) {
        return;
      }

      this.subscriberNegotiating = true;
      const offer = this.offerQueue.shift();

      try {
        await this.subscriber!.setRemoteDescription({
          type: "offer",
          sdp: offer.payload.sdp,
        });

        await this.flushPendingIce("subscriber");

        const answer = await this.subscriber!.createAnswer();
        await this.subscriber!.setLocalDescription(answer);

        this.send({
          type: "subscribe_answer",
          payload: {
            revision: offer.payload.revision,
            sdp: answer.sdp,
          },
        });

        if (this._subscriptionResolve) {
          this._subscriptionResolve();
          this._subscriptionResolve = null;
        }
      } catch (error) {
        this.onError(
          new Error(`Failed to process subscriber offer: ${String(error)}`),
        );

        if (this._subscriptionResolve) {
          this._subscriptionResolve();
          this._subscriptionResolve = null;
        }
      } finally {
        this.subscriberNegotiating = false;
      }
    }
  }

  private async subscribe(trackId: string) {
    if (!trackId || this.subscribedTracks.has(trackId)) {
      return;
    }

    this.subscribedTracks.add(trackId);
    this.subscriptionQueue.push(trackId);

    if (!this.subscriptionRunning) {
      await this.processSubscriptionQueue();
    }
  }

  private async subscribeMultiple(trackIds: string[]) {
    const uniqueIds = [
      ...new Set(
        (trackIds || []).filter((id) => id && !this.subscribedTracks.has(id)),
      ),
    ];

    if (!uniqueIds.length) {
      return;
    }

    uniqueIds.forEach((id) => this.subscribedTracks.add(id));

    return new Promise<void>((resolve, reject) => {
      this._subscriptionResolve = resolve;

      this.send({
        type: "subscribe",
        payload: {
          track_ids: uniqueIds,
        },
      });

      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this._subscriptionResolve = null;
        reject(new Error("Cannot subscribe before signaling is connected"));
      }
    });
  }

  private async processSubscriptionQueue() {
    this.subscriptionRunning = true;

    try {
      while (this.subscriptionQueue.length > 0) {
        const trackId = this.subscriptionQueue.shift();

        await new Promise<void>((resolve, reject) => {
          this._subscriptionResolve = resolve;

          this.send({
            type: "subscribe",
            payload: {
              track_ids: [trackId],
            },
          });

          if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this._subscriptionResolve = null;
            reject(new Error("Cannot subscribe before signaling is connected"));
          }
        });
      }
    } finally {
      this.subscriptionRunning = false;
    }
  }

  async publish({ audio = true, video = true } = {}) {
    if (!this.publisher) {
      throw new Error("Publisher PeerConnection is not initialized");
    }

    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio,
      video,
    });

    const videoTracks = this.localStream.getVideoTracks();

    if (video && videoTracks.length === 0) {
      throw new Error("Camera was requested but no video track was returned");
    }

    if (videoTracks.length > 0) {
      const cameraTrack = videoTracks[0];
      if (!cameraTrack.enabled) cameraTrack.enabled = true;
    }

    for (const track of this.localStream.getTracks()) {
      const sender = await this.publisher.addTrack(track, this.localStream);

      if (track.kind === "audio") {
        this.audioSender = sender;
      } else if (track.kind === "video") {
        this.videoSender = sender;
      }
    }

    const offer = await this.publisher.createOffer();
    await this.publisher.setLocalDescription(offer);

    this.send({
      type: "publish_offer",
      payload: {
        revision: ++this.publisherRevision,
        sdp: offer.sdp,
      },
    });

    return this.localStream;
  }

  async shareScreen() {
    if (!this.publisher) {
      throw new Error("Publisher PeerConnection is not initialized");
    }

    this.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });

    const screenTrack = this.screenStream.getVideoTracks()[0];

    if (this.videoSender) {
      await this.videoSender.replaceTrack(screenTrack);
    } else {
      this.videoSender = await this.publisher.addTrack(
        screenTrack,
        this.screenStream,
      );

      const offer = await this.publisher.createOffer();
      await this.publisher.setLocalDescription(offer);

      this.send({
        type: "publish_offer",
        payload: {
          revision: ++this.publisherRevision,
          sdp: offer.sdp,
        },
      });
    }

    screenTrack.onended = async () => {
      const cameraTrack = this.localStream?.getVideoTracks()?.[0];

      if (cameraTrack && this.videoSender) {
        try {
          await this.videoSender.replaceTrack(cameraTrack);
        } catch (error) {
          this.onError(error);
        }
      }

      if (this.screenStream) {
        this.screenStream.getTracks().forEach((track) => track.stop());
        this.screenStream = null;
      }
    };

    return this.screenStream;
  }

  muteAudio(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  muteVideo(muted: boolean) {
    this.localStream?.getVideoTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  private removeRemoteParticipant(participantId: string) {
    const stream = this.remoteStreams.get(participantId);

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      this.remoteStreams.delete(participantId);
    }

    for (const [trackId, metadata] of this.trackMetadata) {
      if (metadata.participant_id === participantId) {
        this.trackMetadata.delete(trackId);
        this.subscribedTracks.delete(trackId);
      }
    }
  }

  async leave() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({
        type: "leave",
      });
    }

    this.cleanup();
  }

  private send(message: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.ws.send(
      JSON.stringify({
        request_id: this.nextRequestId(),
        ...message,
      }),
    );

    return true;
  }

  private cleanup() {
    if (this.subscriberStatsTimer) {
      clearInterval(this.subscriberStatsTimer);
      this.subscriberStatsTimer = null;
    }

    this.localStream?.getTracks().forEach((track) => track.stop());
    this.screenStream?.getTracks().forEach((track) => track.stop());

    if (this.publisher) {
      this.publisher.close();
      this.publisher = null;
    }

    if (this.subscriber) {
      this.subscriber.close();
      this.subscriber = null;
    }

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.close();
        }
      } catch {
        /* ignore close errors */
      }
      this.ws = null;
    }

    this.localStream = null;
    this.screenStream = null;
    this.videoSender = null;
    this.audioSender = null;

    this.pendingIce = { publisher: [], subscriber: [] };
    this.publisherRevision = 0;
    this.offerQueue = [];
    this.subscribedTracks.clear();
    this.subscriptionQueue = [];
    this.subscriptionRunning = false;
    this._subscriptionResolve = null;

    this.trackMetadata.clear();
    this.participants.clear();

    for (const stream of this.remoteStreams.values()) {
      stream.getTracks().forEach((track) => track.stop());
    }

    this.remoteStreams.clear();
  }
}
