import { demoDeviation, formatFitness } from "./status";

/**
 * A stored fitness score. For the demo objective it reads "mean GC deviation = X (lower is better)",
 * with the stored (maximized) score in smaller text; the score itself is never changed.
 */
export function FitnessValue({
  fitness,
  score,
  components,
}: {
  fitness: string | null | undefined;
  score: number | undefined;
  components?: Record<string, unknown> | null;
}) {
  const deviation = demoDeviation(fitness, score, components);
  if (deviation === undefined) return <>{formatFitness(score)}</>;
  return (
    <span className="inline-flex flex-col">
      <span>
        mean GC deviation = {formatFitness(deviation)} <span className="font-normal">(lower is better)</span>
      </span>
      <span className="text-xs font-normal text-slate-500">score {formatFitness(score)}</span>
    </span>
  );
}
