import { ChtApi, CouchDoc, UserInfo } from '../lib/cht-api';
import { Graveyard, GRAVEYARD_LINEAGE, GRAVEYARD_PLACE_ID } from '../lib/graveyard';

export type UnassignedFacilityResult = {
  username: string;
  remaining: string[];
  // true when the user was left with no facilities and buried in the graveyard rather than
  // written with an empty list (which CHT rejects)
  buried?: boolean;
  error?: string;
};

export type SetUserFacilitiesResult = {
  username: string;
  facilityIds: string[];
  // true when the target user was previously buried in the graveyard and was exhumed.
  exhumed?: boolean;
  unassigned: UnassignedFacilityResult[];
};

type DisplacedUser = { username: string; placeIds: string[]; contactId?: string };

// Sets a CHT user's facilities to exactly `facilityIds` (keyed on username)
export class SetUserFacilities {
  public static async setFacilities(
    username: string,
    facilityIds: string[],
    chtApi: ChtApi,
  ): Promise<SetUserFacilitiesResult> {
    // Capture who currently holds these facilities *before* reassigning, so the target user
    // (once assigned) isn't caught in the unassignment sweep.
    const displaced = await this.getOtherUsersAt(facilityIds, username, chtApi);

    // If the target user is currently buried in the graveyard, exhume their contact back out to a
    // real facility before reassigning
    const exhumed = await this.exhumeUser(username, facilityIds, chtApi);

    // Assign the requested facilities to the target user. This replaces their facility list.
    await chtApi.updateUser({ username, place: facilityIds });

    // Strip the reassigned facilities from every other user that held them.
    const unassigned = await this.stripFacilitiesFrom(displaced, facilityIds, chtApi);

    return { username, facilityIds, unassigned, ...(exhumed ? { exhumed: true } : {}) };
  }

  // Removes `facilityIds` from every user *other than* excludeUsername
  public static async unassignFacilitiesFromOthers(
    facilityIds: string[],
    excludeUsername: string,
    chtApi: ChtApi,
  ): Promise<UnassignedFacilityResult[]> {
    const displaced = await this.getOtherUsersAt(facilityIds, excludeUsername, chtApi);
    return this.stripFacilitiesFrom(displaced, facilityIds, chtApi);
  }

  // If the target user is currently buried in the graveyard, moves their primary contact out to
  // the first newly-assigned facility (so it no longer lives in the graveyard). Returns true if
  // the user was buried. A no-op (returns false) for users that aren't buried or don't exist.
  private static async exhumeUser(
    username: string,
    facilityIds: string[],
    chtApi: ChtApi,
  ): Promise<boolean> {
    const target = await chtApi.getUserInfo(username);
    if (!target || !Graveyard.isBuried(normalizePlaceIds(target.place))) {
      return false;
    }

    if (target.contactId) {
      const lineage = await chtApi.buildPlaceLineage(facilityIds[0]);
      await chtApi.reparentContact(target.contactId, lineage);
    }
    return true;
  }

  // Replaces each displaced user's facility list with whatever remains after removing facilityIds.
  // Each user is attempted independently: one user's update failing is recorded as an `error` on
  // that entry and does not prevent the others from being attempted.
  private static async stripFacilitiesFrom(
    displaced: DisplacedUser[],
    facilityIds: string[],
    chtApi: ChtApi,
  ): Promise<UnassignedFacilityResult[]> {
    const reassigned = new Set(facilityIds);
    const unassigned: UnassignedFacilityResult[] = [];
    for (const user of displaced) {
      const remaining = user.placeIds.filter(id => !reassigned.has(id));
      try {
        if (remaining.length === 0) {
          await this.buryUser(user, chtApi);
          unassigned.push({ username: user.username, remaining, buried: true });
        } else {
          await chtApi.updateUser({ username: user.username, place: remaining });
          unassigned.push({ username: user.username, remaining });
        }
      } catch (e: any) {
        const error = e.response?.data?.error?.message ?? e.message ?? String(e);
        console.error(`Failed to unassign facilities from ${user.username}: ${error}`);
        unassigned.push({ username: user.username, remaining, error });
      }
    }
    return unassigned;
  }

  // Buries a displaced user who would otherwise be left with no facilities: moves their primary
  // contact into the graveyard (so it no longer sits under a facility now owned by someone else)
  private static async buryUser(user: DisplacedUser, chtApi: ChtApi): Promise<void> {
    await Graveyard.ensureExists(chtApi);
    if (user.contactId) {
      await chtApi.reparentContact(user.contactId, GRAVEYARD_LINEAGE);
    }
    await chtApi.updateUser({ username: user.username, place: [GRAVEYARD_PLACE_ID] });
  }

  private static async getOtherUsersAt(
    facilityIds: string[],
    excludeUsername: string,
    chtApi: ChtApi,
  ): Promise<DisplacedUser[]> {
    const byUsername = new Map<string, DisplacedUser>();
    for (const facilityId of facilityIds) {
      const usersAtPlace = await chtApi.getUsersAtPlace(facilityId);
      for (const user of usersAtPlace) {
        // getUsersAtPlace returns each user's full facility list, so the first sighting of a
        // user captures everything we need; skip the target and any user already seen.
        if (user.username === excludeUsername || byUsername.has(user.username)) {
          continue;
        }
        byUsername.set(user.username, {
          username: user.username,
          placeIds: normalizePlaceIds(user.place),
          contactId: user.contactId,
        });
      }
    }
    return [...byUsername.values()];
  }
}

// UserInfo.place comes back from the CHT API in several shapes (CouchDoc[] | CouchDoc |
// string[] | string); normalize it to a flat list of place ids.
function normalizePlaceIds(place: UserInfo['place']): string[] {
  const places = Array.isArray(place) ? place : [place];
  return places
    .map(p => (typeof p === 'string' ? p : (p as CouchDoc)?._id))
    .filter(Boolean) as string[];
}
