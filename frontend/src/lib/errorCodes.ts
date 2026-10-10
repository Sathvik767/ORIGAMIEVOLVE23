/** Human-readable descriptions of validation codes. Keep in sync with docs/input-formats.md. */
export const ISSUE_DESCRIPTIONS: Record<string, string> = {
  E_ALPHABET: "Sequence contains characters other than A, C, G, T (or N when allowed)",
  E_COLUMN_COUNT: "Row has a different number of columns than the header",
  E_CONFLICTING_VALUE: "A design-level value differs between rows of the same design",
  E_COORD_OUT_OF_RANGE: "Staple coordinates fall outside the scaffold length",
  E_CSV: "Malformed CSV (e.g. unbalanced quotes)",
  E_DESIGN_LIMIT: "Too many designs in one file",
  E_DESIGN_TOO_LARGE: "A single design exceeds the size limit",
  E_DUPLICATE_COLUMN: "Header repeats a column name",
  E_DUPLICATE_DESIGN: "design_id repeats (CSV rows for a design must be contiguous)",
  E_DUPLICATE_STRAND: "Strand id repeats within a design",
  E_EMPTY: "File is empty",
  E_ENCODING: "Text is not valid UTF-8",
  E_INTEGER: "helix/start/end must be whole numbers",
  E_INTERNAL: "Unexpected server error during ingestion",
  E_JSON: "Invalid JSON",
  E_LENGTH: "Sequence longer than the configured limit",
  E_LIMIT: "A configured limit was exceeded",
  E_LINE_TOO_LONG: "NDJSON line exceeds the size limit",
  E_MISSING_COLUMN: "Required CSV column is missing",
  E_MULTIPLE_SCAFFOLDS: "More than one scaffold strand in a design",
  E_NO_STAPLES: "Design has no staple strands",
  E_NO_VALID_DESIGNS: "No valid designs were found",
  E_NUMBER: "Measurement value is not numeric",
  E_RANGE: "Negative coordinate, or start greater than end",
  E_REQUIRED: "Required value is empty",
  E_ROW_LIMIT: "Too many rows in one file",
  E_SCHEMA: "Record does not match the expected structure",
  E_STRAND_TYPE: "strand_type must be scaffold, staple or staple_variant",
  E_TOO_MANY_ERRORS: "Too many errors; ingestion stopped",
  E_UNKNOWN_CANDIDATE_GROUP: "staple_variant refers to a staple id that does not exist",
  W_NO_SCAFFOLD: "Design has no scaffold; coordinate checks were skipped",
};

export function describeIssue(code: string): string {
  return ISSUE_DESCRIPTIONS[code] ?? code;
}
