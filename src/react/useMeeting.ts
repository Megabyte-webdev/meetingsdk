import { useMeetingContext } from "./MeetingProvider";

export const useMeeting = () => {
  const { core, state } = useMeetingContext();

  return {
    join: core.connect.bind(core),
    startLocalStream: core.initLocal.bind(core),
    leave: core.disconnect.bind(core),

    meetingId: (core as any).roomId,

    localParticipant: state.localParticipant,
    usePubSub(type: "SECURE_CHAT") {
      if (type !== "SECURE_CHAT")
        throw new Error("Only 'SECURE_CHAT' pubsub is supported for now");

      return {
        messages: state.chatMessages,
        publish: core.sendChatMessage.bind(core),
      };
    },
  };
};
