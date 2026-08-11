/**
 * A recording stand-in for CanvasRenderingContext2D.
 *
 * The scene modules draw straight onto a 2D context, which makes their output invisible to tests
 * and impossible to diff. This records every call and property assignment as a JSON-serializable
 * op stream, so a scene's drawing output can be committed as a golden and compared exactly.
 *
 * Unknown members throw rather than being silently ignored. That is the point: when a module
 * starts using a context feature the recorder does not model, the suite must fail loudly instead
 * of dropping the call and quietly weakening every golden.
 */

/** Methods the scene modules actually call. Keep in sync by running the suite, not by guessing. */
const METHODS = new Set([
  'arc',
  'arcTo',
  'beginPath',
  'clearRect',
  'closePath',
  'drawImage',
  'ellipse',
  'fill',
  'fillRect',
  'fillText',
  'lineTo',
  'moveTo',
  'quadraticCurveTo',
  'restore',
  'rotate',
  'save',
  'scale',
  'setLineDash',
  'setTransform',
  'stroke',
  'strokeRect',
  'translate',
]);

/** Style properties the scene modules assign. */
const PROPERTIES = new Set([
  'fillStyle',
  'font',
  'globalAlpha',
  'lineCap',
  'lineJoin',
  'lineWidth',
  'shadowBlur',
  'shadowColor',
  'shadowOffsetX',
  'shadowOffsetY',
  'strokeStyle',
  'textAlign',
  'textBaseline',
]);

const PRECISION = 1e4;

/**
 * Rounds floats so goldens do not churn on last-bit differences between platforms.
 * Integers and non-numbers pass through untouched.
 */
function normalizeValue(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    const rounded = Math.round(value * PRECISION) / PRECISION;
    // Collapse -0 to 0 so sign-of-zero never shows up as a diff.
    return Object.is(rounded, -0) ? 0 : rounded;
  }
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === 'object') {
    // Images and gradients are not serializable; record an identifying tag instead.
    const width = typeof value.width === 'number' ? value.width : null;
    const height = typeof value.height === 'number' ? value.height : null;
    return { __object: value.constructor?.name ?? 'Object', width, height };
  }
  return value;
}

export function createRecordingContext() {
  const ops = [];

  const target = {
    __ops: ops,
    /**
     * Measurement is deliberately absent from the allowlist: the scene modules measure through
     * the shared text-metrics path, not through the context. If that ever changes, this throws.
     */
  };

  for (const name of METHODS) {
    target[name] = (...args) => {
      ops.push({ op: 'call', name, args: args.map(normalizeValue) });
    };
  }

  const propertyValues = {};

  return new Proxy(target, {
    get(obj, prop) {
      if (typeof prop === 'symbol') return obj[prop];
      if (prop === '__ops') return ops;
      if (METHODS.has(prop)) return obj[prop];
      if (PROPERTIES.has(prop)) return propertyValues[prop];
      throw new Error(
        `RecordingContext: unmodelled read of ctx.${prop}. Add it to METHODS or PROPERTIES in ` +
          `scripts/lib/recording-canvas.mjs and re-record the affected goldens.`,
      );
    },
    set(obj, prop, value) {
      if (typeof prop === 'symbol') {
        obj[prop] = value;
        return true;
      }
      if (!PROPERTIES.has(prop)) {
        throw new Error(
          `RecordingContext: unmodelled write to ctx.${prop}. Add it to PROPERTIES in ` +
            `scripts/lib/recording-canvas.mjs and re-record the affected goldens.`,
        );
      }
      propertyValues[prop] = value;
      ops.push({ op: 'set', prop, value: normalizeValue(value) });
      return true;
    },
  });
}

/**
 * Drops property assignments that do not change the current value.
 *
 * Per-call styling re-sets the same stroke properties for every primitive, so a faithful
 * recording is dominated by no-op writes. Normalizing them away keeps golden diffs readable and
 * lets a refactor that merely reorders redundant sets compare equal.
 */
export function normalizeOps(ops) {
  const current = new Map();
  const out = [];
  // save/restore checkpoints: a restore invalidates what we think the current style is.
  const stack = [];
  for (const entry of ops) {
    if (entry.op === 'set') {
      const serialized = JSON.stringify(entry.value);
      if (current.get(entry.prop) === serialized) continue;
      current.set(entry.prop, serialized);
      out.push(entry);
      continue;
    }
    if (entry.name === 'save') stack.push(new Map(current));
    if (entry.name === 'restore') {
      const restored = stack.pop();
      current.clear();
      if (restored) for (const [key, value] of restored) current.set(key, value);
    }
    out.push(entry);
  }
  return out;
}
