function incrementCounter(counter, key) {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

const FAILURE_CLASSIFICATION_BY_STAGE = {
  launch: 'launch',
  version: 'launch',
  'open-document': 'open',
  'wait-for-document-count': 'open',
  'save-cdxml': 'save-cdxml',
  'save-pdf': 'save-pdf',
  'close-document': 'close',
  'count-documents': 'session-state',
  'close-documents': 'session-state',
  'ensure-clean-state': 'session-state',
  quit: 'session-state',
  'xml-parse': 'xml-parse',
  'semantic-drift': 'semantic-drift',
};

function getObjectCapability(object) {
  if (object?.preservation?.capability) return object.preservation.capability;
  if (
    object?.type === 'graphic' ||
    object?.type === 'bracket' ||
    object?.type === 'embedded-object' ||
    object?.type === 'table' ||
    object?.type === 'group'
  ) {
    return 'round-trip-only';
  }
  return 'editable';
}

function normalizeCounter(counter) {
  return Object.fromEntries(
    [...counter.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function getPlainText(textBlock) {
  if (!textBlock?.runs) return '';
  return textBlock.runs.map((run) => run?.text ?? '').join('');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function diffObjects(before, after, currentPath = '') {
  if (!isPlainObject(before) || !isPlainObject(after)) {
    return JSON.stringify(before) === JSON.stringify(after)
      ? []
      : [`${currentPath || 'value'}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`];
  }

  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const lines = [];
  for (const key of keys) {
    const nextPath = currentPath ? `${currentPath}.${key}` : key;
    if (!(key in before)) {
      lines.push(`${nextPath}: <missing> -> ${JSON.stringify(after[key])}`);
      continue;
    }
    if (!(key in after)) {
      lines.push(`${nextPath}: ${JSON.stringify(before[key])} -> <missing>`);
      continue;
    }
    lines.push(...diffObjects(before[key], after[key], nextPath));
  }
  return lines;
}

export function buildCompatibilitySummary(document) {
  const objectCounts = new Map();
  const nodeElements = new Map();
  const nodeAliases = new Map();
  const nodeTexts = new Map();
  const bondKinds = new Map();
  const arrowKinds = new Map();
  const textContents = new Map();
  const graphicKinds = new Map();
  const objectTags = new Map();
  const embeddedKinds = new Map();
  const tableKinds = new Map();

  for (const page of document?.pages ?? []) {
    for (const object of page.objects ?? []) {
      const capability = getObjectCapability(object);
      if (capability === 'editable') {
        incrementCounter(objectCounts, object.type);
      }
      if (capability === 'render-only') continue;
      for (const tag of object.objectTags ?? []) {
        incrementCounter(objectTags, tag.name || 'objecttag');
      }

      if (object.type === 'node') {
        if (object.element) incrementCounter(nodeElements, object.element);
        if (object.alias) incrementCounter(nodeAliases, object.alias);
        const plainText = getPlainText(object.text);
        if (plainText) incrementCounter(nodeTexts, plainText);
        continue;
      }

      if (object.type === 'bond') {
        const key = [
          `order:${object.order ?? 1}`,
          `display:${object.display ?? 'solid'}`,
          `secondary:${object.secondaryDisplay ?? 'none'}`,
          `mode:${object.doubleBondMode ?? 'auto'}`,
          `aromatic:${object.aromatic ? 'yes' : 'no'}`,
        ].join('|');
        incrementCounter(bondKinds, key);
        continue;
      }

      if (object.type === 'arrow') {
        const key = [
          `type:${object.arrowType}`,
          `above:${getPlainText(object.textAbove) ? 'yes' : 'no'}`,
          `below:${getPlainText(object.textBelow) ? 'yes' : 'no'}`,
        ].join('|');
        incrementCounter(arrowKinds, key);
        const textAbove = getPlainText(object.textAbove);
        const textBelow = getPlainText(object.textBelow);
        if (textAbove) incrementCounter(textContents, `arrow-above:${textAbove}`);
        if (textBelow) incrementCounter(textContents, `arrow-below:${textBelow}`);
        continue;
      }

      if (object.type === 'text') {
        const plainText = getPlainText(object.text);
        if (plainText) incrementCounter(textContents, `text:${plainText}`);
        continue;
      }

      if (object.type === 'graphic' || object.type === 'bracket') {
        const key =
          object.type === 'bracket'
            ? `bracket:${object.bracketType ?? 'generic'}`
            : [
                `type:${object.graphicType}`,
                `stroke:${object.style?.color ?? 'default'}`,
                `fill:${object.style?.fillColor ?? 'none'}`,
              ].join('|');
        incrementCounter(graphicKinds, key);
        continue;
      }

      if (object.type === 'embedded-object') {
        incrementCounter(embeddedKinds, object.payloadKind ?? 'unknown');
        continue;
      }

      if (object.type === 'table') {
        const rowCount = object.cells.length;
        const mergeSignature = object.cells
          .map((cell) => {
            const width = Math.round((cell.boundsInParent.right - cell.boundsInParent.left) * 100);
            const height = Math.round((cell.boundsInParent.bottom - cell.boundsInParent.top) * 100);
            return `${width}x${height}`;
          })
          .sort()
          .join(',');
        incrementCounter(tableKinds, `cells:${rowCount}|signature:${mergeSignature}`);
      }
    }
  }

  return {
    pageCount: document?.pages?.length ?? 0,
    objectCounts: normalizeCounter(objectCounts),
    nodeElements: normalizeCounter(nodeElements),
    nodeAliases: normalizeCounter(nodeAliases),
    nodeTexts: normalizeCounter(nodeTexts),
    bondKinds: normalizeCounter(bondKinds),
    arrowKinds: normalizeCounter(arrowKinds),
    textContents: normalizeCounter(textContents),
    graphicKinds: normalizeCounter(graphicKinds),
    objectTags: normalizeCounter(objectTags),
    embeddedKinds: normalizeCounter(embeddedKinds),
    tableKinds: normalizeCounter(tableKinds),
  };
}

export function formatCompatibilityDiff(beforeSummary, afterSummary) {
  const lines = diffObjects(beforeSummary, afterSummary);
  return lines.length > 0 ? lines.join('\n') : 'No differences.';
}

export function sanitizeCaseId(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export function classifyFailure(error) {
  const stage = typeof error?.stage === 'string' ? error.stage : '';
  if (stage && FAILURE_CLASSIFICATION_BY_STAGE[stage]) {
    return FAILURE_CLASSIFICATION_BY_STAGE[stage];
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/xmllint rejected output/i.test(message)) return 'xml-parse';
  if (/compatibility summary drift detected/i.test(message)) return 'semantic-drift';
  if (/expected ChemDraw to have 0 open documents/i.test(message)) return 'session-state';
  if (/ChemDraw session was not clean/i.test(message)) return 'session-state';

  return 'session-state';
}

export async function runCaseWithRetry({ runAttempt, recoverSession, maxAttempts = 2 }) {
  const failures = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return {
        ok: true,
        attempt,
        value: await runAttempt(attempt),
        failures,
      };
    } catch (error) {
      failures.push({ attempt, error });
      if (attempt >= maxAttempts) {
        return {
          ok: false,
          failures,
        };
      }
      await recoverSession(error, attempt);
    }
  }

  return {
    ok: false,
    failures,
  };
}
