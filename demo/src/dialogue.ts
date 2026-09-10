/**
 * Scripted calls for the walkthrough. `say` is what the synthetic voice speaks (spelled for
 * the TTS engine); `text` is the transcript turn the simulated CALL-E snapshot returns, so
 * the transcript DockSignal shows after the call matches what the viewer heard.
 *
 * Voices are Kokoro-82M presets: af_heart for the CALL-E assistant, am_michael for the
 * driver, bf_emma for the receiving desk.
 */

export type Speaker = "bot" | "user";
export type CallKey = "driver" | "dock" | "followup";

export interface Line {
  who: Speaker;
  say: string;
  text: string;
  /** Silence before this line, in seconds. */
  gap?: number;
}

export interface CallScript {
  key: CallKey;
  contactVoice: string;
  contactLabel: string;
  role: "driver" | "receiving_dock";
  lines: Line[];
}

export const BOT_VOICE = "af_heart";

export const CALLS: Record<CallKey, CallScript> = {
  driver: {
    key: "driver",
    contactVoice: "am_michael",
    contactLabel: "Driver on SHP-88214",
    role: "driver",
    lines: [
      {
        who: "bot",
        say: "Hi, I'm an AI assistant calling for Northwind Freight Operations, about shipment S H P, eight eight two one four. Is this the driver?",
        text: "Hi, I'm an AI assistant calling for Northwind Freight Operations, about shipment SHP-88214. Is this the driver?",
      },
      { who: "user", say: "Yeah, that's me.", text: "Yeah, that's me.", gap: 0.45 },
      { who: "bot", say: "Where is the truck right now?", text: "Where is the truck right now?" },
      { who: "user", say: "Stuck at Tuas Checkpoint. Customs pulled us for an inspection.", text: "Stuck at Tuas Checkpoint. Customs pulled us for an inspection.", gap: 0.5 },
      { who: "bot", say: "What exact time will you reach Dock seven?", text: "What exact time will you reach Dock 7?" },
      { who: "user", say: "Four forty, earliest. I'll call the dock once we're through.", text: "Four forty, earliest. I'll call the dock once we're through.", gap: 0.55 },
      { who: "bot", say: "Thanks. Four forty p.m. I'll let the operations team know.", text: "Thanks. 4:40 p.m. I'll let the operations team know." },
      { who: "user", say: "Cheers.", text: "Cheers.", gap: 0.3 },
    ],
  },
  dock: {
    key: "dock",
    contactVoice: "bf_emma",
    contactLabel: "Receiving desk, Dock 7",
    role: "receiving_dock",
    lines: [
      {
        who: "bot",
        say: "Hi, I'm an AI assistant calling for Northwind Freight Operations, about shipment S H P, eight eight two one four, booked into Dock seven. Is this receiving?",
        text: "Hi, I'm an AI assistant calling for Northwind Freight Operations, about shipment SHP-88214, booked into Dock 7. Is this receiving?",
      },
      { who: "user", say: "Yes, receiving desk.", text: "Yes, receiving desk.", gap: 0.45 },
      { who: "bot", say: "The truck is running late. What's the latest time you can still accept it today?", text: "The truck is running late. What's the latest time you can still accept it today?" },
      { who: "user", say: "Four o'clock. After that, the crew moves to outbound.", text: "Four o'clock. After that, the crew moves to outbound.", gap: 0.5 },
      { who: "bot", say: "And after four?", text: "And after four?" },
      { who: "user", say: "Only with an exception from the shift manager.", text: "Only with an exception from the shift manager.", gap: 0.45 },
      { who: "bot", say: "Understood. I can't change the booking on this call. An operator will follow up.", text: "Understood. I can't change the booking on this call. An operator will follow up." },
      { who: "user", say: "Okay, bye.", text: "Okay, bye.", gap: 0.3 },
    ],
  },
  followup: {
    key: "followup",
    contactVoice: "bf_emma",
    contactLabel: "Receiving desk, Dock 7",
    role: "receiving_dock",
    lines: [
      {
        who: "bot",
        say: "Hi, it's the AI assistant for Northwind Freight Operations again, calling with approval from Dana Lim. The driver now expects to arrive at four forty. Can you accept the load as an exception?",
        text: "Hi, it's the AI assistant for Northwind Freight Operations again, calling with approval from Dana Lim. The driver now expects to arrive at 4:40. Can you accept the load as an exception?",
      },
      { who: "user", say: "One moment, let me ask my shift manager.", text: "One moment, let me ask my shift manager.", gap: 0.45 },
      { who: "user", say: "Okay. We can take it until five, but through Dock three.", text: "Okay. We can take it until five, but through Dock 3.", gap: 1.7 },
      { who: "bot", say: "Arrival by five p.m. at Dock three. Any fees or conditions?", text: "Arrival by 5 p.m. at Dock 3. Any fees or conditions?" },
      { who: "user", say: "No fee. The driver checks in with gate security.", text: "No fee. The driver checks in with gate security.", gap: 0.45 },
      { who: "bot", say: "Thank you. I'll record that for the operator to confirm.", text: "Thank you. I'll record that for the operator to confirm." },
      { who: "user", say: "See you then.", text: "See you then.", gap: 0.3 },
    ],
  },
};

/** Structured results the simulated CALL-E returns. Every value is grounded in the lines above. */
export const RESULTS = {
  driver: {
    contact_role: "driver",
    reached: "yes",
    shipment_recognized: "yes",
    current_status: "Held at Tuas Checkpoint for a customs inspection",
    revised_eta: "16:40",
    can_accept: "unknown",
    blocker: "Customs inspection at Tuas Checkpoint",
    next_action: "Will call the dock once through customs",
    certainty: "high",
  },
  dock: {
    contact_role: "receiving_dock",
    reached: "yes",
    shipment_recognized: "yes",
    current_status: "Receiving at Dock 7 until 16:00, then the crew moves to outbound",
    revised_eta: "16:00",
    can_accept: "conditional",
    blocker: "No receiving after 16:00 without a shift manager exception",
    next_action: "Shift manager must approve any exception",
    certainty: "high",
  },
  followup: {
    contact_role: "receiving_dock",
    reached: "yes",
    shipment_recognized: "yes",
    current_status: "Shift manager approved a late arrival",
    revised_eta: "17:00",
    can_accept: "conditional",
    blocker: "Deliver through Dock 3; driver checks in with gate security",
    next_action: "Dock 3 expects the truck by 17:00",
    certainty: "high",
  },
} as const;

export const SUMMARIES: Record<CallKey, { summary: string; evidence: string[]; confidence: { score: number; label: string } }> = {
  driver: {
    summary: "The driver is held at Tuas Checkpoint for a customs inspection and expects to reach the dock at 4:40 p.m.",
    evidence: ['Driver: "Stuck at Tuas Checkpoint. Customs pulled us for an inspection."', 'Driver: "Four forty, earliest."'],
    confidence: { score: 0.93, label: "high" },
  },
  dock: {
    summary: "Receiving at Dock 7 closes at 4:00 p.m.; a later arrival needs an exception from the shift manager.",
    evidence: ['Receiving desk: "Four o\'clock. After that, the crew moves to outbound."', 'Receiving desk: "Only with an exception from the shift manager."'],
    confidence: { score: 0.9, label: "high" },
  },
  followup: {
    summary: "The shift manager accepts the load until 5:00 p.m. through Dock 3, with no fee; the driver must check in with gate security.",
    evidence: ['Receiving desk: "We can take it until five, but through Dock 3."', 'Receiving desk: "No fee. The driver checks in with gate security."'],
    confidence: { score: 0.91, label: "high" },
  },
};
