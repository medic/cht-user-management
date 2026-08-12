import { Config } from '../config';

/**
 * `true` claims the place for the external system, a string claims it and links back to the record
 * in that system, and `null` releases it
 */
export type ExternalIdentityClaim = string | boolean | null;

export default class ExternalIdentity {
  /**
   * The attribute a claim is written to, when the partner configures one (eg. chis-ke's
   * `chw_registry_link`)
   */
  public static attributeName(): string | undefined {
    return Config.getExternalIdentityOwnershipAttribute();
  }

  public static fromFormData(formData: any): ExternalIdentityClaim | undefined {
    const attributeName = ExternalIdentity.attributeName();
    if (!formData || !attributeName || !(attributeName in formData)) {
      return undefined;
    }

    const supplied = formData[attributeName];
    if (supplied === null || supplied === false) {
      return null;
    }

    if (supplied === true || (typeof supplied === 'string' && supplied.trim().length > 0)) {
      return supplied;
    }

    throw new Error(
      `"${attributeName}" must be true, a reference to the external record, or null to release`
    );
  }

  public static pickFrom(formData: any): { [attribute: string]: unknown } {
    const attributeName = ExternalIdentity.attributeName();
    if (!formData || !attributeName || !(attributeName in formData)) {
      return {};
    }

    return { [attributeName]: formData[attributeName] };
  }

  /**
   * The attribute as it belongs on a place being created or replaced. A release is nothing to write
   * - there is no prior ownership on a new place - so only a claim produces an attribute.
   */
  public static asPlaceAttribute(claim: ExternalIdentityClaim | undefined): { [attribute: string]: string | boolean } {
    const attributeName = ExternalIdentity.attributeName();
    if (!attributeName || claim === undefined || claim === null) {
      return {};
    }

    return { [attributeName]: claim };
  }
}
