import { ChtApi, UserInfo } from './cht-api';

type UserApiFormat = {
  username: string;
  place?: string[];
};

export class DisableUsers {
  public static async disableUsersAt(placeId: string, chtApi: ChtApi): Promise<string[]> {
    const affectedUsers = await this.getAffectedUsers(placeId, chtApi);
    if (affectedUsers.length === 0) {
      console.log('No users found needing an update.');
      return [];
    }

    await this.updateAffectedUsers(affectedUsers, chtApi);

    return affectedUsers.map(user => user.username);
  }

  private static async getAffectedUsers(facilityId: string, chtApi: ChtApi): Promise<UserApiFormat[]> {
    const knownUserDocs: { [key: string]: UserApiFormat } = {};
    const fetchedUserInfos = await chtApi.getUsersAtPlace(facilityId);
    for (const fetchedUserInfo of fetchedUserInfos) {
      const userPayload = knownUserDocs[fetchedUserInfo.username] || this.toPostApiFormat(fetchedUserInfo);
      this.removeUserFromPlace(userPayload, facilityId);
      knownUserDocs[userPayload.username] = userPayload;
    }

    return Object.values(knownUserDocs);
  }

  private static toPostApiFormat(apiResponse: UserInfo): UserApiFormat {
    const places = Array.isArray(apiResponse.place) ? apiResponse.place : [apiResponse.place];
    const placeIds: string[] = places.map(place => {
      if (typeof place === 'string') {
        return place;
      }

      return place?._id;
    }).filter(Boolean) as string[];

    return {
      username: apiResponse.username,
      place: placeIds,
    };
  }

  private static async updateAffectedUsers(userDocs: UserApiFormat[], chtApi: ChtApi) {
    for (const userDoc of userDocs) {
      const places = userDoc.place && !Array.isArray(userDoc.place) ? [userDoc.place] : userDoc.place;
      const shouldDisable = !userDoc.place || places?.length === 0;
      if (shouldDisable) {
        console.log(`Disabling ${userDoc.username}`);
        await chtApi.disableUser(userDoc.username);
      } else {
        console.log(`Updating ${userDoc.username}`);
        await chtApi.updateUser(userDoc);
      }
    }
  }

  private static removeUserFromPlace(userDoc: UserApiFormat, placeId: string) {
    if (Array.isArray(userDoc.place)) {
      userDoc.place = userDoc.place.filter(place => place !== placeId);
    } else {
      delete userDoc.place;
    }
  }
}
