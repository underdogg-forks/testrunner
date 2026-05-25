function summarizeBehavioralFlow(events = []) {
  let hasNavigate = false;
  let hasAction = false;
  let hasStateTransition = false;
  let hasOutcome = false;
  let hasStateAssertion = false;

  for (const event of events) {
    if (!event) continue;
    if (event.type === 'route') hasNavigate = true;
    if (event.type === 'click' || event.type === 'formData') hasAction = true;
    if (event.type === 'network' || event.type === 'formData') hasStateTransition = true;
  }

  return { hasNavigate, hasAction, hasStateTransition, hasOutcome, hasStateAssertion };
}

function enforceCheckpoint(flow, context) {
  const missing = [];
  if (!flow.hasNavigate) missing.push('navigate');
  if (!flow.hasAction) missing.push('action');
  if (!flow.hasStateTransition) missing.push('state_transition');
  if (!flow.hasOutcome) missing.push('outcome_assertion');
  if (!flow.hasStateAssertion) missing.push('state_assertion');
  if (missing.length > 0) {
    throw new Error(`[behavioral-checkpoint] ${context} missing: ${missing.join(', ')}`);
  }
}

module.exports = { summarizeBehavioralFlow, enforceCheckpoint };
