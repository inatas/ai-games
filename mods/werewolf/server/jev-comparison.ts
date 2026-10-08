type Event = { event_type: string; details: unknown };

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Derived on read, because the shadow response can arrive before the model commits. */
export function compareJevSelect(events: Event[]) {
  const shadow = events.find(event => event.event_type === 'model.shadow.jev.finished.v1');
  if (!shadow) return null;
  const shadowDetails = object(shadow?.details) ? shadow.details : {};
  const judged = events.find(event => event.event_type === 'model.call.judged.v1' &&
    object(event.details) && event.details.gameCommitted === true);
  const judgedDetails = object(judged?.details) ? judged.details : null;
  const finished = judgedDetails && events.find(event => event.event_type === 'model.call.finished.v1' &&
    object(event.details) && event.details.attempt === judgedDetails.attempt);
  const finishedDetails = object(finished?.details) ? finished.details : null;
  let modelSelected: string | null = null;
  if (typeof finishedDetails?.rawText === 'string') {
    try {
      const proposal: unknown = JSON.parse(finishedDetails.rawText);
      if (object(proposal) && typeof proposal.selected === 'string') modelSelected = proposal.selected;
    } catch { /* A committed choice must still be shown only when its raw output can be read. */ }
  }
  const jevChoice = typeof shadowDetails.choice === 'string' ? shadowDetails.choice : null;
  const jevSampledSelected = typeof shadowDetails.sampledSelected === 'string' ? shadowDetails.sampledSelected : null;
  const probabilities = object(shadowDetails.probabilities) ? shadowDetails.probabilities : null;
  const probability = modelSelected && probabilities ? probabilities[modelSelected] : null;
  const modelStatus = judged ? 'committed' : events.some(event =>
    (event.event_type === 'model.call.judged.v1' && object(event.details) && event.details.gameCommitted === false) ||
    event.event_type === 'model.call.failed.v1') ? 'not-committed' : 'pending';
  return {
    modelStatus, modelSelected,
    jevChoice, jevSampledSelected,
    modelChoiceProbability: typeof probability === 'number' && Number.isFinite(probability) ? probability : null,
    matchesJevChoice: modelSelected && jevChoice ? modelSelected === jevChoice : null,
    matchesJevSample: modelSelected && jevSampledSelected ? modelSelected === jevSampledSelected : null,
  };
}
