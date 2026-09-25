import { ValidationError } from "../errors.js";

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

/** Relation types are matched like tag names: trimmed and lowercase */
export function normalizeRelationType(name: string): string {
  return name.trim().toLowerCase();
}

export function getRelationType(name: string): RelationType {
  const rt = BY_FORWARD.get(normalizeRelationType(name));
  if (rt) return rt;
  throw new ValidationError(
    `Unknown relation type "${name}". Valid types: ${RELATION_TYPES.map((r) => r.forward).join(", ")}`
  );
}

/**
 * Asymmetric relations are stored as a forward row plus an inverse row, and
 * per-ticket listings show the inverse name ("B is-blocked-by A"). Accept
 * those names as input too by mapping them to the forward relation.
 */
export function canonicalRelation(
  sourceId: number,
  targetId: number,
  name: string
): { sourceId: number; targetId: number; type: string } {
  name = normalizeRelationType(name);
  if (BY_FORWARD.has(name)) return { sourceId, targetId, type: name };
  const rt = BY_INVERSE.get(name);
  if (rt) return { sourceId: targetId, targetId: sourceId, type: rt.forward };
  getRelationType(name); // throws with the list of valid types
  throw new Error("unreachable");
}

/**
 * The (source, target) a relation is stored under: a symmetric one with the
 * lower ticket id first, so (A, B) and (B, A) are the same relation.
 */
export function storedPair(sourceId: number, targetId: number, rt: RelationType): [number, number] {
  return rt.symmetric && sourceId > targetId ? [targetId, sourceId] : [sourceId, targetId];
}

export function forwardTypeNames(): string[] {
  return RELATION_TYPES.map((rt) => rt.forward);
}

export function isValidRelationType(name: string): boolean {
  name = normalizeRelationType(name);
  return BY_FORWARD.has(name) || BY_INVERSE.has(name);
}

export function allRelationTypes(): RelationType[] {
  return [...RELATION_TYPES];
}

export function symmetricTypeNames(): string[] {
  return RELATION_TYPES.filter((rt) => rt.symmetric).map((rt) => rt.forward);
}
