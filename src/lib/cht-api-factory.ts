import * as semver from "semver";
import { ChtApi } from "./cht-api";
import ChtSession from "./cht-session";
import { ChtApi_4_7 } from "./cht-api-4-7";

export abstract class ChtApiFactory {
  public static create(session: ChtSession): ChtApi {
    if (semver.gte(session.chtCoreVersion, '4.7.0')) {
      return new ChtApi_4_7(session);
    }

    return new ChtApi(session);
  }
}
