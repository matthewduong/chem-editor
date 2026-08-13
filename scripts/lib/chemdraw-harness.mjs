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
  const containerCounts = new Map();
  const preservedPageChildren = new Map();
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
    // Containers are counted separately from objectCounts, which only admits `editable` types.
    // Without this a <group> that is dropped on import changes nothing in the summary.
    for (const preservedChild of page.preservedPageChildren ?? []) {
      incrementCounter(preservedPageChildren, preservedChild.tagName);
    }
    for (const object of page.objects ?? []) {
      if (object.type === 'group') {
        incrementCounter(containerCounts, `group:${object.childIds?.length ?? 0}`);
      } else if (object.type === 'fragment') {
        incrementCounter(
          containerCounts,
          `fragment:${object.nodeIds?.length ?? 0}n/${object.bondIds?.length ?? 0}b`,
        );
      }
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
    containerCounts: normalizeCounter(containerCounts),
    preservedPageChildren: normalizeCounter(preservedPageChildren),
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

/**
 * Censuses the elements and attributes present in a CDXML string.
 *
 * The model-level summary cannot see import loss: it is built from documents that have already
 * been through the importer, so a construct the importer drops is missing from both sides of the
 * comparison and reads as agreement. Counting the markup itself is what makes "we never read this"
 * visible.
 */
export function buildCdxmlElementSummary(xml) {
  // Supplied by scripts/lib/dom-globals.mjs under node --test, and by the runner otherwise.
  const parsed = new globalThis.DOMParser().parseFromString(xml, 'application/xml');
  const elements = new Map();
  const attributes = new Map();
  // Counted alongside the census so a drop can be explained rather than merely reported.
  const superseded = new Map();
  const insideNickname = new Map();

  const walk = (element, insideAtom, insideExpansion) => {
    const tag = element.tagName.toLowerCase();
    incrementCounter(elements, tag);
    if (element.getAttribute?.('SupersededBy')) incrementCounter(superseded, tag);
    // A <fragment> hanging off an <n> is that atom's expanded nickname; it and everything in it
    // collapse into the atom's label. An atom's own <t> label sits directly under the <n> and is
    // deliberately excluded, so a genuine loss of atom labels cannot hide in this category.
    const nested = insideExpansion || (insideAtom && tag === 'fragment');
    if (nested) incrementCounter(insideNickname, tag);
    for (const attribute of element.attributes ?? []) {
      incrementCounter(attributes, attribute.name);
    }
    for (const child of element.children ?? []) walk(child, insideAtom || tag === 'n', nested);
  };

  const root = parsed.documentElement;
  if (root && root.tagName !== 'parsererror') walk(root, false, false);
  return {
    elements: normalizeCounter(elements),
    attributes: normalizeCounter(attributes),
    superseded: normalizeCounter(superseded),
    insideNickname: normalizeCounter(insideNickname),
  };
}

/**
 * Drops we know the reason for, so the triage can show only the ones we do not.
 *
 * Each rule returns how many of a tag's disappearances are accounted for. A drop is `expected` only
 * when the rule covers all of it; anything beyond what the rule explains stays `unexplained`, so a
 * real regression hiding behind a known-benign category still surfaces.
 */
const EXPECTED_DROP_RULES = {
  graphic: {
    reason: "superseded by another object; ChemDraw's legacy duplicate of an <arrow>",
    covered: (summary) => summary.superseded?.graphic ?? 0,
  },
  chemicalproperty: {
    reason: 'regenerated by ChemDraw from structure; preserving it makes ChemDraw reject the file',
    covered: (summary) => summary.elements?.chemicalproperty ?? 0,
  },
  n: {
    reason: 'inside a nickname <fragment>, collapsed into the atom label',
    covered: (summary) => summary.insideNickname?.n ?? 0,
  },
  b: {
    reason: 'inside a nickname <fragment>, collapsed into the atom label',
    covered: (summary) => summary.insideNickname?.b ?? 0,
  },
  fragment: {
    reason: 'a nickname expansion hanging off an <n>, collapsed into the atom label',
    covered: (summary) => summary.insideNickname?.fragment ?? 0,
  },
  t: {
    reason: 'a label on an atom of an expanded nickname, collapsed into the parent atom label',
    covered: (summary) => summary.insideNickname?.t ?? 0,
  },
  s: {
    reason: 'a styled run inside an expanded nickname, collapsed into the parent atom label',
    covered: (summary) => summary.insideNickname?.s ?? 0,
  },
};

/**
 * What our own CDXML fails to carry over from a source file.
 *
 * `dropped` is the actionable half -- markup the source had and ours does not. `added` is reported
 * too because our writer emits ChemEditor-private attributes by design, and an unexpected entry
 * there is worth seeing.
 *
 * Element drops are split into `unexplained` and `expected`. Most of what a literal census calls
 * loss is deliberate: a real file carries one superseded <graphic> per <arrow>, and every nickname
 * carries an expanded <fragment> of nodes and bonds that we collapse into a label. Reporting those
 * as loss buries the drops that matter.
 */
export function diffCdxmlElementSummaries(sourceSummary, exportedSummary) {
  const compare = (before, after) => {
    const dropped = {};
    const added = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const from = before[key] ?? 0;
      const to = after[key] ?? 0;
      if (to < from) dropped[key] = { from, to };
      else if (to > from) added[key] = { from, to };
    }
    return { dropped, added };
  };

  const elements = compare(sourceSummary.elements, exportedSummary.elements);
  const attributes = compare(sourceSummary.attributes, exportedSummary.attributes);

  const unexplained = {};
  const expected = {};
  for (const [tag, change] of Object.entries(elements.dropped)) {
    const rule = EXPECTED_DROP_RULES[tag];
    const lost = change.from - change.to;
    const covered = rule ? Math.min(lost, rule.covered(sourceSummary)) : 0;
    if (covered > 0) expected[tag] = { ...change, covered, reason: rule.reason };
    if (covered < lost) unexplained[tag] = { ...change, unexplained: lost - covered };
  }

  return {
    elements: { ...elements, unexplained, expected },
    attributes,
    droppedElementCount: Object.keys(unexplained).length,
    droppedAttributeCount: Object.keys(attributes.dropped).length,
  };
}

export function formatCompatibilityDiff(beforeSummary, afterSummary) {
  const lines = diffObjects(beforeSummary, afterSummary);
  return lines.length > 0 ? lines.join('\n') : 'No differences.';
}

/**
 * Summary sections that are recorded but do not fail a case.
 *
 * Preserved page children are raw XML we carry through without modelling. ChemDraw rebuilds
 * derived reaction metadata from structure when it opens a file, so one handed to it unchanged
 * comes back regrouped: a source with 3 <scheme> elements and 8 <step> children, exported element
 * for element, returns as 6 and 9. That is ChemDraw normalising its own bookkeeping rather than
 * our output being unstable, and it is the same reasoning that already keeps <chemicalproperty>
 * out of our export. Modelling schemes and steps properly is what would make it gate.
 */
const REPORT_ONLY_SUMMARY_SECTIONS = ['preservedPageChildren'];

/** The gating comparison: {@link formatCompatibilityDiff} minus the report-only sections. */
export function formatCompatibilityDrift(beforeSummary, afterSummary) {
  const gating = (summary) => {
    if (!summary) return summary;
    const copy = { ...summary };
    for (const section of REPORT_ONLY_SUMMARY_SECTIONS) delete copy[section];
    return copy;
  };
  return formatCompatibilityDiff(gating(beforeSummary), gating(afterSummary));
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
