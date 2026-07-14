import { expect } from 'chai';

import { Config } from '../../src/config';
import { RemotePlacePropertyValue } from '../../src/property-value';
import { isNameMatch, nameMatchScore } from '../../src/lib/name-match';

describe('lib/name-match.ts', () => {
  // Verdict behavior: given the name as stored in eCHIS and the search string,
  // assert whether they are treated as the same person. umt decides the verdict
  // on its own — there is no caller-supplied threshold.
  const cases: { search: string; echis: string; match: boolean }[] = [
    { search: 'John Kamau Otieno',           echis: 'John Otieno',                    match: true },
    { search: 'John Otieno',                 echis: 'John Kamau Otieno',              match: true },
    { search: 'John Otieno',                 echis: 'Otieno John',                    match: true },
    { search: 'Christine Wanyaga Muchiri',   echis: 'Christine Muchiri Wanyaga Area', match: true },
    { search: 'CHARLES Barkasau BARGASAU',   echis: 'CHARLES BARGASAU Area',          match: true },
    { search: 'MARGARET CHEMOIWO JEPSERGON', echis: 'MARGARET JEPSERGON Area',        match: true },
    { search: 'Benjamin Kiarie Muiruri',     echis: "Benjamin Kiarie's Community Health Volunteer Area", match: true },
    { search: "James Ng'ang'a Kamau",        echis: "James Ng'ang'a's Community Health Volunteer Area",  match: true },
    { search: "James Ng'sang Kamau",         echis: "James Ng'sang's Community Health Volunteer Area",   match: true },
    { search: 'John Otieno',                 echis: 'John Omondi',                    match: false },
    { search: 'John',                        echis: 'John Otieno',                    match: false },
  ];

  for (const { search, echis, match } of cases) {
    it(`${match ? 'matches' : 'rejects'}: "${search}" vs eCHIS "${echis}"`, () => {
      expect(isNameMatch(search, asMatchedInKenya(echis))).to.equal(match);
    });
  }

  it('is order-independent (score is symmetric)', () => {
    expect(nameMatchScore('John Otieno', 'Otieno John')).to.equal(0);
  });

  it('ignores accents and case', () => {
    expect(isNameMatch('joão', 'JOAO')).to.equal(true);
  });
});

const areaType = Config.getContactType('d_community_health_volunteer_area');
const placeNameProperty = Config.getHierarchyWithReplacement(areaType)[0];
const asMatchedInKenya = (echisName: string) => new RemotePlacePropertyValue(echisName, placeNameProperty).formatted;

