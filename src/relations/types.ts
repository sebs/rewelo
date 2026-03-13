import { ValidationError } from "../validation/strings.js";

export interface RelationType {
  forward: string;
  inverse: string;
  symmetric: boolean;
}

const RELATION_TYPES: RelationType[] = [
  // Dependency
  { forward: "blocks", inverse: "is-blocked-by", symmetric: false },
  { forward: "depends-on", inverse: "is-depended-on-by", symmetric: false },

  // Logical / Semantic
  { forward: "relates-to", inverse: "relates-to", symmetric: true },
  { forward: "duplicates", inverse: "is-duplicated-by", symmetric: false },
  { forward: "supersedes", inverse: "is-superseded-by", symmetric: false },

  // Temporal / Sequencing
  { forward: "precedes", inverse: "follows", symmetric: false },

  // Scope / Verification
  { forward: "tests", inverse: "is-tested-by", symmetric: false },
  { forward: "implements", inverse: "is-implemented-by", symmetric: false },
  { forward: "addresses", inverse: "is-addressed-by", symmetric: false },

  // Effort / Scope
  { forward: "splits-into", inverse: "is-split-from", symmetric: false },

  // Knowledge / Reference
  { forward: "informs", inverse: "is-informed-by", symmetric: false },
  { forward: "see-also", inverse: "see-also", symmetric: true },
];

const BY_FORWARD = new Map<string, RelationType>();
const BY_INVERSE = new Map<string, RelationType>();

for (const rt of RELATION_TYPES) {
  BY_FORWARD.set(rt.forward, rt);
  BY_INVERSE.set(rt.inverse, rt);
}

export function getRelationType(name: string): RelationType {
  const rt = BY_FORWARD.get(name);
  if (rt) return rt;
  throw new ValidationError(
    `Unknown relation type "${name}". Valid types: ${RELATION_TYPES.map((r) => r.forward).join(", ")}`
  );
}

export function isValidRelationType(name: string): boolean {
  return BY_FORWARD.has(name) || BY_INVERSE.has(name);
}

export function getInverse(forwardType: string): string {
  const rt = getRelationType(forwardType);
  return rt.inverse;
}

export function isSymmetric(forwardType: string): boolean {
  const rt = getRelationType(forwardType);
  return rt.symmetric;
}

export function allRelationTypes(): RelationType[] {
  return [...RELATION_TYPES];
}

export function symmetricTypeNames(): string[] {
  return RELATION_TYPES.filter((rt) => rt.symmetric).map((rt) => rt.forward);
}
