/**
 * DefComm SFU client.
 *
 * Signaling is authoritative for admission/session state.
 * WebRTC peer connections are transport state and are recreated only after a
 * successful join/resume. A transient WebSocket close therefore does NOT
 * destroy the local MediaStream or immediately declare the participant gone.
 */

export type SFUConnectionState =
  | "idle"
  | "connecting"
  | "joining"
  | "waiting_approval"
  | "connected"
  | "reconnecting"
  | "leaving"
  | "disconnected";

export interface TrackInfo {
  track_id: string;
  participant_id: string;
  kind: "audio" | "video";
  source?: "camera" | "screen" | "audio" | string;
  [key: string]: any;
}

export interface ParticipantInfo {
  participant_id: string;
  user_metadata?: { name?: string; [key: string]: any };
  display_name?: string;
  [key: string]: any;
}

export interface JoinPendingInfo {
  request_id: string;
  room_code?: string;
  message?: string;
}

interface SFUClientOptions {
  apiBase?: string;
  wsBase?: string;
  userId?: string;
  onStateChange?: (state: SFUConnectionState) => void;
  onParticipantJoined?: (participant: ParticipantInfo) => void;
  onParticipantLeft?: (participant: string | ParticipantInfo) => void;
  onParticipantPresence?: (participantId: string, presence: string) => void;
  onTrackPublished?: (track: TrackInfo) => void;
  onTrackUnpublished?: (track: TrackInfo) => void;
  onRemoteTrack?: (
    track: MediaStreamTrack,
    stream: MediaStream,
    metadata: TrackInfo,
  ) => void;
  onConnected?: (payload: any, resumed: boolean) => void;
  onDisconnected?: () => void;
  onReconnecting?: (attempt: number) => void;
  onJoinPending?: (info: JoinPendingInfo) => void;
  onJoinApproved?: (requestId: string) => void;
  onJoinRejected?: (requestId: string, reason?: string) => void;
  onJoinRequested?: (request: any) => void;
  onScreenShareStarted?: (participantId: string, track?: TrackInfo) => void;
  onScreenShareStopped?: (participantId: string, trackId?: string) => void;
  onTrackStateChanged?: (track: TrackInfo) => void;
  onRecordingStarted?: (recording: { recording_id: string; started_at: string }) => void;
  onRecordingStopped?: (recording: { recording_id: string; stopped_at: string }) => void;
  onError?: (error: any) => void;
  autoSubscribe?: boolean;
}

type PeerName = "publisher" | "subscriber";
type JoinWaiter = {
  resolve: (value: any) => void;
  reject: (error: any) => void;
};

export class SFUClient {
  private apiBase: string;
  private wsBase: string;
  private userId: string;

  private ws: WebSocket | null = null;
  private publisher: RTCPeerConnection | null = null;
  private subscriber: RTCPeerConnection | null = null;

  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private videoSender: RTCRtpSender | null = null;
  private audioSender: RTCRtpSender | null = null;
  private screenSender: RTCRtpSender | null = null;

  private iceServers: RTCIceServer[] = [];
  private requestId = 0;
  private publisherRevision = 0;
  private currentParticipantId: string | null = null;
  private token: string | null = null;
  private room: string | null = null;
  private resumeToken: string | null = null;
  private pendingJoinRequestId: string | null = null;
  private joinOptions: {
    displayName?: string;
    avatarUrl?: string;
  } = {};

  private state: SFUConnectionState = "idle";
  private intentionalClose = false;
  private leaveAcknowledged = false;
  private joiningWithResume = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private maxReconnectAttempts = 8;
  private reconnectBaseMs = 750;
  private joinWaiter: JoinWaiter | null = null;

  private pendingIce: Record<PeerName, RTCIceCandidateInit[]> = {
    publisher: [],
    subscriber: [],
  };

  private subscriberNegotiating = false;
  private offerQueue: any[] = [];
  private subscriptionQueue: string[] = [];
  private subscriptionRunning = false;
  private subscriptionWaiters: Array<{
    resolve: () => void;
    reject: (error: any) => void;
  }> = [];

  private subscribedTracks = new Set<string>();
  private trackMetadata = new Map<string, TrackInfo>();
  private participants = new Map<string, ParticipantInfo>();
  private remoteStreams = new Map<string, MediaStream>();
  private trackToParticipant = new Map<string, string>();
  private trackToSource = new Map<string, string>();
  private localTrackIds = new Map<"audio" | "camera" | "screen", string>();

  private subscriberStatsTimer: ReturnType<typeof setInterval> | null = null;

  private onStateChange: (state: SFUConnectionState) => void;
  private onParticipantJoined: (p: ParticipantInfo) => void;
  private onParticipantLeft: (p: string | ParticipantInfo) => void;
  private onParticipantPresence: (id: string, presence: string) => void;
  private onTrackPublished: (t: TrackInfo) => void;
  private onTrackUnpublished: (t: TrackInfo) => void;
  private onRemoteTrack: (
    t: MediaStreamTrack,
    s: MediaStream,
    m: TrackInfo,
  ) => void;
  private onConnected: (p: any, resumed: boolean) => void;
  private onDisconnected: () => void;
  private onReconnecting: (attempt: number) => void;
  private onJoinPending: (info: JoinPendingInfo) => void;
  private onJoinApproved: (requestId: string) => void;
  private onJoinRejected: (requestId: string, reason?: string) => void;
  private onJoinRequested: (request: any) => void;
  private onScreenShareStarted: (participantId: string, track?: TrackInfo) => void;
  private onScreenShareStopped: (participantId: string, trackId?: string) => void;
  private onTrackStateChanged: (track: TrackInfo) => void;
  private onRecordingStarted: (recording: { recording_id: string; started_at: string }) => void;
  private onRecordingStopped: (recording: { recording_id: string; stopped_at: string }) => void;
  private onError: (e: any) => void;
  private autoSubscribe: boolean;

  constructor(options: SFUClientOptions = {}) {
    this.apiBase = options.apiBase || "https://api.example.com/api";
    this.wsBase = options.wsBase || "wss://api.example.com/ws";
    this.userId = options.userId || this.createId();

    this.onStateChange = options.onStateChange || (() => {});
    this.onParticipantJoined = options.onParticipantJoined || (() => {});
    this.onParticipantLeft = options.onParticipantLeft || (() => {});
    this.onParticipantPresence = options.onParticipantPresence || (() => {});
    this.onTrackPublished = options.onTrackPublished || (() => {});
    this.onTrackUnpublished = options.onTrackUnpublished || (() => {});
    this.onRemoteTrack = options.onRemoteTrack || (() => {});
    this.onConnected = options.onConnected || (() => {});
    this.onDisconnected = options.onDisconnected || (() => {});
    this.onReconnecting = options.onReconnecting || (() => {});
    this.onJoinPending = options.onJoinPending || (() => {});
    this.onJoinApproved = options.onJoinApproved || (() => {});
    this.onJoinRejected = options.onJoinRejected || (() => {});
    this.onJoinRequested = options.onJoinRequested || (() => {});
    this.onScreenShareStarted = options.onScreenShareStarted || (() => {});
    this.onScreenShareStopped = options.onScreenShareStopped || (() => {});
    this.onTrackStateChanged = options.onTrackStateChanged || (() => {});
    this.onRecordingStarted = options.onRecordingStarted || (() => {});
    this.onRecordingStopped = options.onRecordingStopped || (() => {});
    this.onError = options.onError || console.error;
    this.autoSubscribe = options.autoSubscribe !== false;
  }

  private createId(): string {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `id_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  }

  private resumeStorageKey(roomCode: string) {
    return `defcomm:sfu:resume:${roomCode}`;
  }

  private loadResumeToken(roomCode: string): string | null {
    try {
      return localStorage.getItem(this.resumeStorageKey(roomCode));
    } catch {
      return null;
    }
  }

  private saveResumeToken(roomCode: string, token: string) {
    try {
      localStorage.setItem(this.resumeStorageKey(roomCode), token);
    } catch {
      // Storage can be unavailable in private/SSR environments.
    }
  }

  private clearResumeToken(roomCode: string | null) {
    if (!roomCode) return;
    try {
      localStorage.removeItem(this.resumeStorageKey(roomCode));
    } catch {
      // ignore
    }
  }

  private setState(next: SFUConnectionState) {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange(next);
  }

  getConnectionState(): SFUConnectionState {
    return this.state;
  }

  getParticipantId(): string | null {
    return this.currentParticipantId;
  }

  getResumeToken(): string | null {
    return this.resumeToken;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getScreenStream(): MediaStream | null {
    return this.screenStream;
  }

  setLocalStream(stream: MediaStream | null) {
    this.localStream = stream;
  }

  private nextRequestId(): string {
    return (++this.requestId).toString();
  }

  private async request(url: string, options: RequestInit = {}) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });

    if (!res.ok) {
      let body: any = {};
      try {
        body = await res.json();
      } catch {
        // ignore non-json error bodies
      }
      throw new Error(body.message || res.statusText);
    }

    return res.json();
  }

  async createRoom(input: {
    name: string;
    description?: string;
    capacity?: number;
    is_private?: boolean;
  }) {
    return this.request(`${this.apiBase}/rooms`, {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        description: input.description ?? "",
        capacity: input.capacity ?? 20,
        is_private: input.is_private ?? false,
      }),
    });
  }

  async getRoom(roomCode: string) {
    return this.request(`${this.apiBase}/rooms/${encodeURIComponent(roomCode)}`);
  }

  async deleteRoom(roomCode: string) {
    return this.request(`${this.apiBase}/rooms/${encodeURIComponent(roomCode)}`, {
      method: "DELETE",
    });
  }

  async getToken(
    roomCode: string,
    options: {
      displayName?: string;
      avatarUrl?: string;
      userId?: string;
    } = {},
  ) {
    const nextRoom = roomCode.trim();
    if (this.room && this.room !== nextRoom) {
      this.resumeToken = null;
    }

    this.room = nextRoom;
    this.joinOptions = {
      displayName: options.displayName,
      avatarUrl: options.avatarUrl,
    };
    if (options.userId) this.userId = options.userId;
    if (!this.resumeToken) {
      this.resumeToken = this.loadResumeToken(this.room);
    }

    const data = await this.request(`${this.apiBase}/token`, {
      method: "POST",
      body: JSON.stringify({
        room_code: this.room,
        user_id: this.userId,
        display_name: options.displayName,
        avatar_url: options.avatarUrl,
      }),
    });

    this.token = data?.token;
    if (!this.token) throw new Error("Token endpoint returned no token");

    return this.connect(this.token, this.joinOptions);
  }

  private async refreshAccessToken() {
    if (!this.room) throw new Error("Cannot refresh token without a room");

    const data = await this.request(`${this.apiBase}/token`, {
      method: "POST",
      body: JSON.stringify({
        room_code: this.room,
        user_id: this.userId,
        display_name: this.joinOptions.displayName,
        avatar_url: this.joinOptions.avatarUrl,
      }),
    });

    if (!data?.token) throw new Error("Token refresh returned no token");
    this.token = data.token;
    return this.token;
  }

  private connect(token: string, options: any = {}) {
    this.token = token;
    this.intentionalClose = false;
    this.setState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    return new Promise<void>((resolve, reject) => {
      this.joinWaiter = { resolve, reject };
      this.openWebSocket(options);
    });
  }

  private openWebSocket(options: any = {}) {
    if (!this.token || !this.room) {
      const error = new Error("Cannot connect without token and room");
      this.failJoin(error);
      return;
    }

    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        // ignore
      }
    }

    const ws = new WebSocket(
      `${this.wsBase}?access_token=${encodeURIComponent(this.token)}`,
    );
    this.ws = ws;

    ws.onopen = () => {
      this.setState("joining");
      this.joiningWithResume = Boolean(this.resumeToken);

      const joinPayload: any = {
        token: this.token,
        room_code: this.room,
        resume_token: this.resumeToken,
        display_name: options.displayName,
        avatar_url: options.avatarUrl,
      };

      // After approval the Rust server requires the original pending request id.
      if (this.pendingJoinRequestId) {
        this.send({
          type: "join",
          request_id: this.pendingJoinRequestId,
          payload: joinPayload,
        });
      } else {
        this.send({ type: "join", payload: joinPayload });
      }
    };

    ws.onerror = (event) => {
      this.onError(event);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;

      if (this.intentionalClose || this.state === "leaving") {
        this.setState("disconnected");
        this.onDisconnected();
        return;
      }

      // Keep MediaStreams and logical participant state alive.
      this.setState("reconnecting");
      this.onDisconnected();
      this.scheduleReconnect();
    };

    ws.onmessage = async (event) => {
      if (this.ws !== ws) return;
      try {
        const message = JSON.parse(event.data);
        await this.handleServerMessage(message);
      } catch (error) {
        this.onError(error);
      }
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.intentionalClose) return;
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.setState("disconnected");
      this.failJoin(new Error("SFU reconnect attempts exhausted"));
      return;
    }

    this.reconnectAttempt += 1;
    const delay = Math.min(
      15000,
      this.reconnectBaseMs * Math.pow(2, this.reconnectAttempt - 1),
    );

    this.onReconnecting(this.reconnectAttempt);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.refreshAccessToken();
        this.openWebSocket(this.joinOptions);
      } catch (error) {
        this.onError(error);
        this.scheduleReconnect();
      }
    }, delay);
  }

  private failJoin(error: any) {
    if (this.joinWaiter) {
      const waiter = this.joinWaiter;
      this.joinWaiter = null;
      waiter.reject(error);
    }
  }

  private resolveJoin(value: any) {
    if (!this.joinWaiter) return;
    const waiter = this.joinWaiter;
    this.joinWaiter = null;
    waiter.resolve(value);
  }

  private async handleServerMessage(message: any) {
    const type = message?.type;
    const payload = message?.payload || {};

    switch (type) {
      case "joined": {
        await this.handleJoined(payload);
        break;
      }

      case "left": {
        this.leaveAcknowledged = true;
        break;
      }

      case "join_pending": {
        const requestId = payload.request_id || message.request_id;
        if (!requestId) throw new Error("join_pending has no request_id");

        this.pendingJoinRequestId = requestId;
        this.setState("waiting_approval");
        this.onJoinPending({
          request_id: requestId,
          room_code: payload.room_code || this.room || undefined,
          message: payload.message,
        });
        break;
      }

      case "join_approved": {
        const requestId = payload.request_id || message.request_id;
        if (!requestId) break;
        this.pendingJoinRequestId = requestId;
        this.onJoinApproved(requestId);

        // Approval is a direct signal to the waiting session. Continue the join
        // with the same request id; the Rust Room layer performs the admission.
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.setState("joining");
          this.send({
            type: "join",
            request_id: requestId,
            payload: {
              token: this.token,
              room_code: this.room,
              resume_token: this.resumeToken,
              display_name: this.joinOptions.displayName,
              avatar_url: this.joinOptions.avatarUrl,
            },
          });
        }
        break;
      }

      case "join_rejected": {
        const requestId = payload.request_id || message.request_id;
        const reason = payload.reason;
        this.onJoinRejected(requestId, reason);
        this.pendingJoinRequestId = null;
        this.intentionalClose = true;
        this.failJoin(new Error(reason || "Join request rejected"));
        break;
      }

      case "join_requested":
      case "join_request": {
        this.onJoinRequested(payload.request || payload);
        break;
      }

      case "publish_answer": {
        if (!this.publisher) break;
        await this.publisher.setRemoteDescription({
          type: "answer",
          sdp: payload.sdp,
        });
        await this.flushPendingIce("publisher");
        break;
      }

      case "subscribe_offer": {
        this.offerQueue.push(payload);
        if (!this.subscriberNegotiating) await this.processOfferQueue();
        break;
      }

      case "ice_candidate":
      case "publisher_ice_candidate":
      case "subscriber_ice_candidate": {
        const candidatePayload = {
          ...payload,
          peer:
            payload.peer ||
            (type === "publisher_ice_candidate" ? "publisher" : "subscriber"),
        };
        await this.handleIce(candidatePayload);
        break;
      }

      case "participant_joined": {
        const participant = payload.participant || payload;
        const participantId =
          participant?.participant_id || payload.participant_id;
        if (!participantId || participantId === this.currentParticipantId) break;

        if (participant) this.participants.set(participantId, participant);
        this.onParticipantJoined(participant);
        break;
      }

      case "participant_left": {
        const participantId = payload.participant_id;
        if (!participantId) break;
        this.participants.delete(participantId);
        this.removeRemoteParticipant(participantId);
        this.onParticipantLeft(participantId);
        break;
      }

      case "participant_presence":
      case "participant_presence_changed": {
        const participantId = payload.participant_id;
        const presence = payload.presence;
        if (participantId && presence) {
          this.onParticipantPresence(participantId, String(presence));
        }
        break;
      }

      case "track_published": {
        const track: TrackInfo = payload.track || payload;
        if (!track?.track_id) break;
        this.rememberTrack(track);

        if (track.participant_id === this.currentParticipantId) {
          if (track.source === "audio") {
            this.localTrackIds.set("audio", track.track_id);
            const muted = !(this.localStream?.getAudioTracks()[0]?.enabled ?? true);
            this.send({ type: "track_state", payload: { track_id: track.track_id, muted } });
          }
          if (track.source === "camera") {
            this.localTrackIds.set("camera", track.track_id);
            const muted = !(this.localStream?.getVideoTracks()[0]?.enabled ?? true);
            this.send({ type: "track_state", payload: { track_id: track.track_id, muted } });
          }
          if (track.source === "screen") this.localTrackIds.set("screen", track.track_id);
          break;
        }

        this.onTrackPublished(track);
        if (this.autoSubscribe) await this.subscribe(track.track_id);
        break;
      }

      case "track_unpublished": {
        const trackId = payload.track_id || payload.track?.track_id;
        if (!trackId) break;
        const track =
          this.trackMetadata.get(trackId) ||
          ({
            track_id: trackId,
            participant_id: this.trackToParticipant.get(trackId) || "",
            source: this.trackToSource.get(trackId),
            kind: "video",
          } as TrackInfo);

        this.trackMetadata.delete(trackId);
        this.subscribedTracks.delete(trackId);
        this.trackToParticipant.delete(trackId);
        this.trackToSource.delete(trackId);

        for (const [source, localId] of this.localTrackIds) {
          if (localId === trackId) this.localTrackIds.delete(source);
        }

        if (track.participant_id === this.currentParticipantId) break;
        this.onTrackUnpublished(track);
        break;
      }

      case "track_state_changed": {
        const trackId = payload.track_id || payload.track?.track_id;
        if (!trackId) break;

        const existing = this.trackMetadata.get(trackId);
        const track: TrackInfo = {
          ...(existing || {}),
          ...(payload.track || {}),
          track_id: trackId,
          participant_id:
            payload.participant_id ||
            existing?.participant_id ||
            payload.track?.participant_id,
          kind:
            payload.kind ||
            payload.track?.kind ||
            existing?.kind ||
            "video",
          source:
            payload.source ||
            payload.track?.source ||
            existing?.source,
          muted: Boolean(payload.muted),
        };

        if (!track.participant_id) break;
        this.rememberTrack(track);
        this.onTrackStateChanged(track);
        break;
      }

      case "subscription_updated": {
        // Authoritative acknowledgement of the current subscriber set.
        break;
      }

      case "recording_started": {
        this.onRecordingStarted({
          recording_id: payload.recording_id,
          started_at: payload.started_at,
        });
        break;
      }

      case "recording_stopped": {
        this.onRecordingStopped({
          recording_id: payload.recording_id,
          stopped_at: payload.stopped_at,
        });
        break;
      }

      case "reconnecting": {
        this.setState("reconnecting");
        break;
      }

      case "screen_share_started": {
        const participantId = payload.participant_id;
        const track = payload.track as TrackInfo | undefined;
        if (track) this.rememberTrack(track);
        if (participantId) this.onScreenShareStarted(participantId, track);
        break;
      }

      case "screen_share_stopped": {
        const participantId = payload.participant_id;
        const stream = participantId ? this.remoteStreams.get(participantId) : null;
        const trackId = payload.track_id;

        if (stream) {
          for (const track of stream.getVideoTracks()) {
            const source = this.trackToSource.get(this.normalizeRemoteTrackId(track.id));
            if (!trackId || this.normalizeRemoteTrackId(track.id) === String(trackId) || source === "screen") {
              stream.removeTrack(track);
              track.stop();
            }
          }
        }

        this.onScreenShareStopped(participantId, trackId);
        break;
      }

      case "error": {
        const error = new Error(payload.message || "SFU signaling error");
        this.onError(error);
        if (this.state === "joining" || this.state === "waiting_approval") {
          this.failJoin(error);
        }
        break;
      }

      default:
        // Unknown messages must not tear down the signaling state machine.
        console.debug("[SFU] Ignoring unknown server message", message);
    }
  }

  private rememberTrack(track: TrackInfo) {
    this.trackMetadata.set(track.track_id, track);
    this.trackToParticipant.set(track.track_id, track.participant_id);
    if (track.source) this.trackToSource.set(track.track_id, track.source);
  }

  private async handleJoined(payload: any) {
    const resumed = this.joiningWithResume;
    this.joiningWithResume = false;

    this.iceServers = payload.ice_servers || this.iceServers || [];
    this.currentParticipantId = payload.participant_id;
    this.resumeToken = payload.resume_token || payload.resumeToken || this.resumeToken;
    if (this.room && this.resumeToken) {
      this.saveResumeToken(this.room, this.resumeToken);
    }
    this.pendingJoinRequestId = null;
    this.reconnectAttempt = 0;

    this.participants.clear();
    this.trackMetadata.clear();
    this.trackToParticipant.clear();
    this.trackToSource.clear();
    this.localTrackIds.clear();

    for (const participant of payload.participants || []) {
      if (participant?.participant_id) {
        this.participants.set(participant.participant_id, participant);
      }
    }

    for (const track of payload.tracks || []) {
      if (track?.track_id) this.rememberTrack(track);
    }

    await this.initializePeerConnections();
    this.setState("connected");
    this.onConnected(payload, resumed);

    for (const participant of this.participants.values()) {
      if (participant.participant_id !== this.currentParticipantId) {
        this.onParticipantJoined(participant);
      }
    }

    // A reconnect/resume needs a fresh publisher negotiation and subscription
    // reconciliation because the WebSocket transport was replaced.
    if (this.localStream) {
      await this.publishExistingTracks();
    }

    if (this.autoSubscribe) {
      const trackIds = [...this.trackMetadata.values()]
        .filter((track) => track.participant_id !== this.currentParticipantId)
        .map((track) => track.track_id);
      if (trackIds.length) await this.subscribeMultiple(trackIds);
    }

    this.resolveJoin(payload);
  }

  private async initializePeerConnections() {
    this.closePeerConnectionsOnly();
    this.publisherRevision = 0;

    const config: RTCConfiguration = { iceServers: this.iceServers };
    this.publisher = new RTCPeerConnection(config);
    this.subscriber = new RTCPeerConnection(config);

    this.publisher.onicecandidate = (event) => {
      if (event.candidate) this.sendCandidate("publisher", event.candidate);
    };

    this.subscriber.onicecandidate = (event) => {
      if (event.candidate) this.sendCandidate("subscriber", event.candidate);
    };

    this.publisher.onconnectionstatechange = () => {
      const state = this.publisher?.connectionState;
      if (state === "failed") {
        this.onError(new Error("Publisher PeerConnection failed"));
      }
    };

    this.subscriber.onconnectionstatechange = () => {
      const state = this.subscriber?.connectionState;
      if (state === "failed") {
        this.onError(new Error("Subscriber PeerConnection failed"));
      }
    };

    this.subscriber.ontrack = (event) => {
      void this.handleRemoteTrack(event);
    };

    if (!this.subscriberStatsTimer) {
      this.subscriberStatsTimer = setInterval(() => {
        void this.logSubscriberVideoStats();
      }, 3000);
    }
  }

  private async handleRemoteTrack(event: RTCTrackEvent) {
    const stream = event.streams?.[0] || null;
    const metadata = this.resolveRemoteTrackMetadata(event.track, stream);

    if (!metadata?.participant_id) {
      this.onError(
        new Error(
          `Remote ${event.track.kind} track ${event.track.id} has no SFU participant mapping`,
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

    // Camera/audio use one participant stream. Screen tracks are kept separate.
    const source = metadata.source || this.trackToSource.get(metadata.track_id);
    if (source === "screen") {
      for (const existing of remoteStream.getVideoTracks()) {
        if (existing.id !== event.track.id && this.trackToSource.get(existing.id) === "screen") {
          remoteStream.removeTrack(existing);
          existing.stop();
        }
      }
    } else {
      for (const existing of remoteStream.getTracks()) {
        if (existing.kind === event.track.kind && existing.id !== event.track.id) {
          remoteStream.removeTrack(existing);
          existing.stop();
        }
      }
    }

    if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) {
      remoteStream.addTrack(event.track);
    }

    event.track.onended = () => {
      try {
        remoteStream?.removeTrack(event.track);
      } catch {
        // ignore
      }
    };

    if (source === "screen") {
      this.onScreenShareStarted(participantId, metadata);
    }

    this.onRemoteTrack(event.track, remoteStream, metadata);
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
    const exact = this.trackMetadata.get(sfuTrackId);
    if (exact) return exact;

    const byTrackId = this.trackMetadata.get(track.id);
    if (byTrackId) return byTrackId;

    // Some WebRTC stacks expose a browser-generated receiver track id. The
    // SFU metadata still gives us the authoritative ownership mapping.
    const matching = [...this.trackMetadata.values()].find(
      (entry) => entry.kind === track.kind,
    );
    if (matching) return matching;

    if (stream?.id) {
      const participant = this.participants.get(stream.id);
      if (participant) {
        return (
          [...this.trackMetadata.values()].find(
            (entry) => entry.participant_id === participant.participant_id && entry.kind === track.kind,
          ) || null
        );
      }
    }

    return null;
  }

  private sendCandidate(peer: PeerName, candidate: RTCIceCandidate) {
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
    const peer: PeerName = payload.peer === "publisher" ? "publisher" : "subscriber";
    const pc = peer === "publisher" ? this.publisher : this.subscriber;

    const candidate: RTCIceCandidateInit = {
      candidate: payload.candidate,
      sdpMid: payload.sdp_mid ?? payload.sdpMid ?? null,
      sdpMLineIndex: payload.sdp_mline_index ?? payload.sdpMLineIndex ?? null,
      usernameFragment: payload.username_fragment ?? payload.usernameFragment ?? null,
    };

    if (!pc || !pc.remoteDescription) {
      this.pendingIce[peer].push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      this.onError(new Error(`Failed to add ${peer} ICE candidate: ${String(error)}`));
    }
  }

  private async flushPendingIce(peer: PeerName) {
    const pc = peer === "publisher" ? this.publisher : this.subscriber;
    if (!pc || !pc.remoteDescription) return;

    const queue = this.pendingIce[peer];
    while (queue.length) {
      const candidate = queue.shift()!;
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        this.onError(new Error(`Failed to add queued ${peer} ICE candidate: ${String(error)}`));
      }
    }
  }

  private async processOfferQueue() {
    if (!this.subscriber) return;

    while (this.offerQueue.length) {
      if (this.subscriberNegotiating) return;
      this.subscriberNegotiating = true;
      const offer = this.offerQueue.shift();

      try {
        await this.subscriber.setRemoteDescription({
          type: "offer",
          sdp: offer.sdp,
        });
        await this.flushPendingIce("subscriber");

        const answer = await this.subscriber.createAnswer();
        await this.subscriber.setLocalDescription(answer);

        this.send({
          type: "subscribe_answer",
          payload: {
            revision: offer.revision,
            sdp: answer.sdp,
          },
        });

        const waiters = this.subscriptionWaiters.splice(0);
        waiters.forEach((w) => w.resolve());
      } catch (error) {
        const waiters = this.subscriptionWaiters.splice(0);
        waiters.forEach((w) => w.reject(error));
        this.onError(new Error(`Failed to process subscriber offer: ${String(error)}`));
      } finally {
        this.subscriberNegotiating = false;
      }
    }
  }

  private async subscribe(trackId: string) {
    if (!trackId || this.subscribedTracks.has(trackId)) return;
    this.subscribedTracks.add(trackId);
    this.subscriptionQueue.push(trackId);
    if (!this.subscriptionRunning) await this.processSubscriptionQueue();
  }

  private async subscribeMultiple(trackIds: string[]) {
    const uniqueIds = [...new Set(trackIds.filter(Boolean))].filter(
      (id) => !this.subscribedTracks.has(id),
    );
    if (!uniqueIds.length || !this.isSocketOpen()) return;

    uniqueIds.forEach((id) => this.subscribedTracks.add(id));
    return new Promise<void>((resolve, reject) => {
      this.subscriptionWaiters.push({ resolve, reject });
      this.send({
        type: "subscribe",
        payload: { track_ids: uniqueIds },
      });
    });
  }

  private async processSubscriptionQueue() {
    this.subscriptionRunning = true;
    try {
      while (this.subscriptionQueue.length) {
        const trackId = this.subscriptionQueue.shift()!;
        if (!this.isSocketOpen()) {
          this.subscribedTracks.delete(trackId);
          continue;
        }

        await new Promise<void>((resolve, reject) => {
          this.subscriptionWaiters.push({ resolve, reject });
          this.send({
            type: "subscribe",
            payload: { track_ids: [trackId] },
          });
        });
      }
    } finally {
      this.subscriptionRunning = false;
    }
  }

  async publish({ audio = true, video = true } = {}) {
    if (!this.publisher) throw new Error("Publisher PeerConnection is not initialized");

    if (!this.localStream) {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio, video });
    }

    await this.publishExistingTracks(audio, video);
    return this.localStream;
  }

  private async publishExistingTracks(audio = true, video = true) {
    if (!this.publisher || !this.localStream) return;

    // Recreated publisher PCs start with no senders. Never duplicate senders on
    // the same PC.
    this.audioSender = null;
    this.videoSender = null;

    for (const track of this.localStream.getTracks()) {
      if (track.kind === "audio" && !audio) continue;
      if (track.kind === "video" && !video) continue;

      const sender = this.publisher.addTrack(track, this.localStream);
      if (track.kind === "audio") this.audioSender = sender;
      if (track.kind === "video") this.videoSender = sender;
    }

    if (this.screenStream?.getVideoTracks()[0]) {
      const screenTrack = this.screenStream.getVideoTracks()[0];
      this.screenSender = this.publisher.addTrack(screenTrack, this.screenStream);
    }

    if (!this.publisher.getSenders().length) return;

    const offer = await this.publisher.createOffer();
    await this.publisher.setLocalDescription(offer);

    this.send({
      type: "publish_offer",
      payload: {
        revision: ++this.publisherRevision,
        sdp: offer.sdp,
      },
    });

    if (this.screenStream?.getVideoTracks()[0]) {
      this.send({ type: "start_screen_share" });
    }
  }

  async shareScreen() {
    if (!this.publisher) throw new Error("Publisher PeerConnection is not initialized");
    if (this.screenStream) return this.screenStream;

    this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = this.screenStream.getVideoTracks()[0];
    if (!screenTrack) throw new Error("Screen share returned no video track");

    this.screenSender = this.publisher.addTrack(screenTrack, this.screenStream);

    const offer = await this.publisher.createOffer();
    await this.publisher.setLocalDescription(offer);
    this.send({
      type: "publish_offer",
      payload: {
        revision: ++this.publisherRevision,
        sdp: offer.sdp,
      },
    });

    this.send({ type: "start_screen_share" });

    screenTrack.onended = () => {
      void this.stopScreenShare();
    };

    return this.screenStream;
  }

  async stopScreenShare() {
    if (!this.screenStream) return;

    const screenTrack = this.screenStream.getVideoTracks()[0];
    if (screenTrack) screenTrack.onended = null;

    if (this.screenSender && this.publisher) {
      try {
        this.publisher.removeTrack(this.screenSender);
      } catch {
        // ignore a sender already detached by the browser
      }
      this.screenSender = null;

      // Removing the sender changes the publisher SDP and must be negotiated.
      try {
        const offer = await this.publisher.createOffer();
        await this.publisher.setLocalDescription(offer);
        this.send({
          type: "publish_offer",
          payload: {
            revision: ++this.publisherRevision,
            sdp: offer.sdp,
          },
        });

        this.send({ type: "stop_screen_share" });
      } catch (error) {
        this.onError(error);
      }
    }

    this.screenStream.getTracks().forEach((track) => track.stop());
    this.screenStream = null;
  }

  muteAudio(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });

    const trackId = this.localTrackIds.get("audio");
    if (trackId) {
      this.send({
        type: "track_state",
        payload: {
          track_id: trackId,
          muted,
        },
      });
    }
  }

  muteVideo(muted: boolean) {
    this.localStream?.getVideoTracks().forEach((track) => {
      track.enabled = !muted;
    });

    const trackId = this.localTrackIds.get("camera");
    if (trackId) {
      this.send({
        type: "track_state",
        payload: {
          track_id: trackId,
          muted,
        },
      });
    }
  }

  async startRecording() {
    if (!this.send({ type: "start_recording" })) {
      throw new Error("SFU signaling is not connected");
    }
  }

  async stopRecording() {
    if (!this.send({ type: "stop_recording" })) {
      throw new Error("SFU signaling is not connected");
    }
  }

  async getRecordingStatus() {
    if (!this.room || !this.token) {
      throw new Error("SFU client is not connected");
    }

    return this.request(
      `${this.apiBase}/rooms/${encodeURIComponent(this.room)}/recording`,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      },
    );
  }

  async approveJoinRequest(requestId: string) {
    if (!requestId) throw new Error("requestId is required");
    if (!this.send({ type: "approve_join", payload: { request_id: requestId } })) {
      throw new Error("SFU signaling is not connected");
    }
  }

  async rejectJoinRequest(requestId: string, reason?: string) {
    if (!requestId) throw new Error("requestId is required");
    if (!this.send({ type: "reject_join", payload: { request_id: requestId, reason } })) {
      throw new Error("SFU signaling is not connected");
    }
  }

  private isSocketOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(message: any) {
    if (!this.isSocketOpen()) return false;
    this.ws!.send(
      JSON.stringify({
        request_id: this.nextRequestId(),
        ...message,
      }),
    );
    return true;
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
        this.trackToParticipant.delete(trackId);
        this.trackToSource.delete(trackId);
      }
    }
  }

  async leave() {
    this.intentionalClose = true;
    this.setState("leaving");

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const roomCode = this.room;
    const ws = this.ws;
    this.leaveAcknowledged = false;

    if (ws?.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        // The normal onmessage path remains authoritative. We only wait for
        // the server's `left` acknowledgement through a short polling window.
        const timeout = setTimeout(finish, 1200);

        const check = () => {
          if (this.leaveAcknowledged || this.ws !== ws) {
            clearTimeout(timeout);
            finish();
            return;
          }
          if (ws.readyState !== WebSocket.OPEN) {
            clearTimeout(timeout);
            finish();
            return;
          }
          setTimeout(check, 25);
        };

        ws.addEventListener("close", () => {
          clearTimeout(timeout);
          finish();
        }, { once: true });

        this.send({ type: "leave" });
        check();
      });

      try {
        ws.close(1000, "client_leave");
      } catch {
        // ignore
      }
    }

    this.clearResumeToken(roomCode);
    this.cleanupAll();
    this.setState("disconnected");
  }

  private closePeerConnectionsOnly() {
    if (this.publisher) {
      try { this.publisher.close(); } catch { /* ignore */ }
      this.publisher = null;
    }
    if (this.subscriber) {
      try { this.subscriber.close(); } catch { /* ignore */ }
      this.subscriber = null;
    }
    this.videoSender = null;
    this.audioSender = null;
    this.screenSender = null;
    this.pendingIce = { publisher: [], subscriber: [] };
    this.offerQueue = [];
    this.subscriberNegotiating = false;
    this.subscriptionQueue = [];
    this.subscriptionRunning = false;
    this.subscriptionWaiters.splice(0).forEach((w) => w.reject(new Error("PeerConnection recreated")));
    this.subscribedTracks.clear();
  }

  private cleanupAll() {
    if (this.subscriberStatsTimer) {
      clearInterval(this.subscriberStatsTimer);
      this.subscriberStatsTimer = null;
    }

    this.closePeerConnectionsOnly();

    this.localStream?.getTracks().forEach((track) => track.stop());
    this.screenStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.screenStream = null;

    for (const stream of this.remoteStreams.values()) {
      stream.getTracks().forEach((track) => track.stop());
    }
    this.remoteStreams.clear();

    this.trackMetadata.clear();
    this.trackToParticipant.clear();
    this.trackToSource.clear();
    this.localTrackIds.clear();
    this.participants.clear();
    this.currentParticipantId = null;
    this.resumeToken = null;
    this.pendingJoinRequestId = null;
    this.token = null;
    this.room = null;

    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  private async logSubscriberVideoStats() {
    if (!this.subscriber || this.subscriber.connectionState === "closed") return;
    try {
      const stats = await this.subscriber.getStats();
      stats.forEach((report: any) => {
        if (
          report.type === "inbound-rtp" &&
          (report.kind === "video" || report.mediaType === "video")
        ) {
          console.debug("[SFU] subscriber video", {
            packetsReceived: report.packetsReceived,
            packetsLost: report.packetsLost,
            framesDecoded: report.framesDecoded,
            frameWidth: report.frameWidth,
            frameHeight: report.frameHeight,
          });
        }
      });
    } catch {
      // stats are diagnostic only
    }
  }
}
