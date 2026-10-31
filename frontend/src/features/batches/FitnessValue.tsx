import { demoDeviation, formatFitness, fullFitness } from "./status";

/**
 * A stored fitness score (4 decimals; the exact value is in the tooltip). For the demo objective it reads
 * "mean GC deviation = X (lower is better)", with the stored (maximized) score in smaller text; the score
 * itself is never changed.
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
  if (deviation === undefined)
    return (
      <span className="font-mono tabular-nums" title={fullFitness(score)}>
        {formatFitness(score)}
      </span>
    );
  return (
    <span className="inline-flex flex-col font-mono tabular-nums" title={`score ${fullFitness(score)}`}>
      <span className="break-words">
        mean GC deviation = {formatFitness(deviation)} <span className="font-sans font-normal text-muted">(lower is better)</span>
      </span>
      <span className="text-xs font-normal text-subtle">score {formatFitness(score)}</span>
    </span>
  );
}
