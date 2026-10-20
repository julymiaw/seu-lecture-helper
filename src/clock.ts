// xtdqsj is second-resolution server time; RTT/2 is an estimate, not a guarantee.
export interface ClockSample {
  serverTime:number;
  receivedAt:number; // performance.now(), scoped to this page
  rttMs:number;
  offset:number; // diagnostic wall-clock offset at receipt
}
export const MAX_CLOCK_RTT_MS=2000;
export function serverNow(sample?:ClockSample,monotonic=performance.now()) {
  return sample ? sample.serverTime+sample.rttMs/2+monotonic-sample.receivedAt : Date.now();
}
