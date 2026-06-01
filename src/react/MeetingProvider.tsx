import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { MeetingState } from "../core/MeetingState";
import { VideoSDKCore } from "../core/VideoCore";

type MeetingContextType = {
  core: VideoSDKCore;
  state: MeetingState;
};

const MeetingContext = createContext<MeetingContextType | null>(null);

export const MeetingProvider = ({
  core,
  children,
}: {
  core: VideoSDKCore;
  children: React.ReactNode;
}) => {
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = core["state"].subscribe(() => {
      setTick((t) => t + 1);
    });

    return unsub;
  }, [core]);

  const value = useMemo(
    () => ({
      core,
      state: core["state"],
    }),
    [core],
  );

  return (
    <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>
  );
};

export const useMeetingContext = () => {
  const ctx = useContext(MeetingContext);
  if (!ctx) throw new Error("MeetingProvider is missing");
  return ctx;
};
