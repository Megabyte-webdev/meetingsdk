import { useMeetingContext } from "./MeetingProvider";

export const useMeeting = () => {
  const { core, state } = useMeetingContext();

  return {
    join: core.connect.bind(core),
    startLocalStream: core.initLocal.bind(core),
    leave: core.disconnect.bind(core),

    meetingId: (core as any).roomId,

    localParticipant: state.localParticipant,
  };
};
