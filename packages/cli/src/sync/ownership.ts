// Ownership semantics (D42) — shared by the sync engine, not each adapter.
//
// A target's `owns:` list names the fields it owns after bootstrap:
//   - on CREATE, owned fields are seeded from the portable defaults (bootstrap);
//   - on UPDATE, owned fields are NEVER written — the target's value wins.
// Fields not listed in `owns` are always synced from the repo — git wins.

export interface OwnershipPlan<T extends Record<string, unknown>> {
  /** Fields to send when creating the remote entity (portable defaults included). */
  createFields: T;
  /** Fields to send when updating an existing remote entity (owned fields stripped). */
  updateFields: Partial<T>;
}

export function planOwnedFields<T extends Record<string, unknown>>(
  portableFields: T,
  owns: string[] | undefined,
): OwnershipPlan<T> {
  const owned = new Set(owns ?? []);
  const updateFields: Partial<T> = {};
  for (const [key, value] of Object.entries(portableFields)) {
    if (!owned.has(key)) {
      (updateFields as Record<string, unknown>)[key] = value;
    }
  }
  return { createFields: portableFields, updateFields };
}

export function isOwned(field: string, owns: string[] | undefined): boolean {
  return (owns ?? []).includes(field);
}
