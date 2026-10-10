/**
 * Shown on every view that displays fitness values. See docs/PLAN.md section 0:
 * computed fitness is a computational proxy, never evidence of folding or stability.
 */
export function ProxyDisclaimer() {
  return (
    <div role="note" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <strong className="font-semibold">Computational proxy — not experimentally validated.</strong>{" "}
      Fitness scores come from replaceable, documented functions. They do not predict DNA folding, yield, or
      stability. Imported experimental measurements are shown separately with their provenance.
    </div>
  );
}
