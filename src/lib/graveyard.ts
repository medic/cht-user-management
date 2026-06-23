import { ChtApi } from './cht-api';

// A parking place for users who would otherwise be left with no facilities. CHT rejects an empty
// facility list for offline users ("Invalid facilities list"), and disabling a user loses their
// password / SSO link, so a displaced user is buried here instead and can be reassigned later.
//
// It is intentionally a top-level place (no parent) of an unconfigured type, so it sits outside
// every real reporting hierarchy. It is written directly as a CouchDB doc rather than created via
// POST /api/v1/places, which bypasses CHT's place-hierarchy validation
export const GRAVEYARD_PLACE_ID = 'umt-facility-graveyard';

// The graveyard has no parent, so its lineage is statically known — burying a contact never needs
// to read the graveyard doc to derive it.
export const GRAVEYARD_LINEAGE = { _id: GRAVEYARD_PLACE_ID };

const GRAVEYARD_PLACE_DOC = {
  _id: GRAVEYARD_PLACE_ID,
  type: GRAVEYARD_PLACE_ID,
  name: 'Facility Graveyard',
};

export class Graveyard {
  public static isBuried(placeIds: string[]): boolean {
    return placeIds.includes(GRAVEYARD_PLACE_ID);
  }

  // Idempotently ensures the graveyard place doc exists on the instance. Safe to call repeatedly.
  public static async ensureExists(chtApi: ChtApi): Promise<void> {
    if (await docExists(GRAVEYARD_PLACE_ID, chtApi)) {
      return;
    }
    await chtApi.setDoc(GRAVEYARD_PLACE_ID, GRAVEYARD_PLACE_DOC);
  }
}

async function docExists(id: string, chtApi: ChtApi): Promise<boolean> {
  try {
    await chtApi.getDoc(id);
    return true;
  } catch (e: any) {
    if (e.response?.status === 404) {
      return false;
    }
    throw e;
  }
}
