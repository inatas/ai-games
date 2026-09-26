export interface NetworkRetryOptions {
  maxAttempts: number;
  delaysMs: readonly number[];
  jitterMs: number;
  minRemainingMs: number;
  commitReserveMs: number;
  key: string;
  gate: NetworkRetryGate;
}

type Circuit = {
  failures: number[];
  openUntil: number;
  probeInFlight: boolean;
  activeRetries: number;
};

/** Process-local protection shared by every Harness using the same provider profile. */
export class NetworkRetryGate {
  private circuits = new Map<string, Circuit>();

  constructor(private options: {
    maxConcurrentRetries: number;
    failureWindowMs: number;
    failureThreshold: number;
    openMs: number;
  }) {}

  private circuit(key: string): Circuit {
    let circuit = this.circuits.get(key);
    if (!circuit) {
      circuit = { failures: [], openUntil: 0, probeInFlight: false, activeRetries: 0 };
      this.circuits.set(key, circuit);
    }
    return circuit;
  }

  acquire(key: string, retry: boolean, now: number): (() => void) | null {
    const circuit = this.circuit(key);
    if (circuit.openUntil > now || circuit.probeInFlight ||
        (retry && circuit.activeRetries >= this.options.maxConcurrentRetries)) return null;
    const probe = circuit.openUntil !== 0;
    if (probe) circuit.probeInFlight = true;
    if (retry) circuit.activeRetries++;
    return () => {
      if (probe) circuit.probeInFlight = false;
      if (retry) circuit.activeRetries--;
    };
  }

  networkFailure(key: string, now: number): void {
    const circuit = this.circuit(key);
    circuit.failures = circuit.failures.filter(at => now - at < this.options.failureWindowMs);
    circuit.failures.push(now);
    if (circuit.openUntil !== 0 || circuit.failures.length >= this.options.failureThreshold) {
      circuit.openUntil = now + this.options.openMs;
    }
  }

  success(key: string): void {
    const circuit = this.circuit(key);
    circuit.failures = [];
    circuit.openUntil = 0;
  }
}
