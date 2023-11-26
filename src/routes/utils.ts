import { ContactType, ContactProperty } from "../lib/config";

/*
 *to avoid collisions in place and person keys we prepend the type of property to the doc_name
 */
export const getFormProperties = (
  contactType: ContactType
): {
  placeProps: ContactProperty[];
  contactProps: ContactProperty[];
} => {
  const placeFormProperties = contactType.place_properties.map((prop) => {
    return { ...prop, doc_name: "place_" + prop.doc_name };
  });
  const contactFormProperties = contactType.contact_properties.map((prop) => {
    return { ...prop, doc_name: "person_" + prop.doc_name };
  });
  return {
    placeProps: placeFormProperties,
    contactProps: contactFormProperties,
  };
};
