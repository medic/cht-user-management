import { ChtApi, CouchDoc, UserInfo } from '../lib/cht-api';

// An unconfigured role: CHT does not validate role names against app-settings, and a role that maps
// to no configured permissions effectively revokes all access. Unlike deleting/disabling the user,
// this keeps their account, password and SSO (oidc) link intact for later reassignment.
const DISABLED_ROLE = 'disabled';

export type UnassignedFacilityResult = {
  username: string;
  remaining: string[];
  // true when the user was left with no facilities and was instead disabled (role set to
  // `disabled`) rather than written with an empty list (which CHT rejects).
  disabled?: boolean;
  error?: string;
};

export type SetUserFacilitiesResult = {
  username: string;
  facilityIds: string[];
  unassigned: UnassignedFacilityResult[];
};

type DisplacedUser = { username: string; placeIds: string[] };

// Sets a CHT user's facilities to exactly `facilityIds` (keyed on username)
export class SetUserFacilities {
  public static async setFacilities(
    username: string,
    facilityIds: string[],
    chtApi: ChtApi,
    roles?: string[],
  ): Promise<SetUserFacilitiesResult> {
    // Capture who currently holds these facilities *before* reassigning, so the target user
    // (once assigned) isn't caught in the unassignment sweep.
    const displaced = await this.getOtherUsersAt(facilityIds, username, chtApi);

    // Assign the requested facilities to the target user. This replaces their facility list.
    const update: UserInfo = { username, place: facilityIds };
    if (roles?.length && facilityIds.length > 0) {
      update.roles = roles;
    }
    await chtApi.updateUser(update);

    // Strip the reassigned facilities from every other user that held them.
    const unassigned = await this.stripFacilitiesFrom(displaced, facilityIds, chtApi);

    return { username, facilityIds, unassigned };
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

  // Replaces each displaced user's facility list with whatever remains after removing facilityIds.
  // A user left with nothing is disabled instead of written with an empty list. Each user is
  // attempted independently: one user's update failing is recorded as an `error` on that entry and
  // does not prevent the others from being attempted.
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
          await this.disableUser(user, chtApi);
          unassigned.push({ username: user.username, remaining, disabled: true });
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

  // Disables a displaced user who would otherwise be left with no facilities: strips all permissions
  // by assigning the unconfigured `disabled` role, and reduces their facility list to a single
  // facility (CHT requires a stored user to have at least one).
  private static async disableUser(user: DisplacedUser, chtApi: ChtApi): Promise<void> {
    await chtApi.updateUser({
      username: user.username,
      roles: [DISABLED_ROLE],
      place: [user.placeIds[0]],
    });
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
