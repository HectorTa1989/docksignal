import { Composition } from "remotion";
import { Demo } from "./Demo";
import { buildTimeline, FPS } from "./timeline";

const timeline = buildTimeline();

export const Root: React.FC = () => (
  <Composition id="DockSignalDemo" component={Demo} durationInFrames={timeline.duration} fps={FPS} width={1920} height={1080} defaultProps={{}} />
);
