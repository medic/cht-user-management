// Kenya eCHIS, for community health units: names end in " Community Health Unit". The name is typed
// without it (the type's name property strips it), and added back here.
//
// See copy-unit-facility.mjs for how hooks are run.

/** @type {(draft: Record<string, any>) => Promise<void>} */
export async function mutate(draft) {
  // during replacement the name is optional
  if (draft.name) {
    draft.name += ' Community Health Unit';
  }
}
