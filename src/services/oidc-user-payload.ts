import { sanitizeOidcUsername } from './username';

// The minimum payload to create an offline, multi-place OIDC (SSO) user in CHT. Such a user
// authenticates via the identity provider, so no password/token_login is set (CHT forbids
// combining those with oidc_username).
//
// - `place` is the array of facility ids (CHT maps it to facility_id[]). Assigning more than one
//   requires the user's roles to carry the `can_have_multiple_places` permission.
// - `contact` is required: CHT requires a contact for offline roles.
export class OidcUserPayload {
  public readonly username: string;
  public readonly oidc_username: string;
  public readonly roles: string[];
  public readonly place: string[];
  public readonly contact: string;

  constructor(oidcUsername: string, roles: string[], facilityIds: string[], contactId: string) {
    this.oidc_username = oidcUsername;
    this.roles = roles;
    this.place = facilityIds;
    this.contact = contactId;
    this.username = sanitizeOidcUsername(oidcUsername);
  }
}
