/** Insertion-ordered LRU, bounded by count or by an explicitly measured byte budget. */
export class LruCache<T> {
  private entries = new Map<string, { value: T; size: number }>();
  private used = 0;
  constructor(
    readonly budget = 50,
    private measure: (value: T) => number = () => 1,
  ) {}
  get bytes() {
    return this.used;
  }
  get size() {
    return this.entries.size;
  }
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  delete(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.used -= entry.size;
    this.entries.delete(key);
  }
  set(key: string, value: T) {
    this.delete(key);
    const size = this.measure(value);
    if (!Number.isFinite(size) || size < 0 || size > this.budget) return;
    while (this.used + size > this.budget && this.entries.size)
      this.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, size });
    this.used += size;
  }
}
