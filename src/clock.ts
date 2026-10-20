// xtdqsj is second-resolution server time; RTT/2 is an estimate, not a guarantee.
export interface ClockSample {
  serverTime:number;
  receivedAt:number; // local receipt time, used only for diagnostics
  rttMs:number;
  offset:number; // estimated server time minus local time
}
