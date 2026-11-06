import { expect } from 'chai';
import { Liquid } from 'liquidjs';

const PAYLOAD = '"><img src=x onerror=alert(1)>';

describe('liquid templates escape reflected user input', () => {
  const liquid = new Liquid({ extname: '.liquid', root: 'src/liquid', dynamicPartials: true });

  it('search_external_source escapes the error message', async () => {
    const html = await liquid.renderFile('place/search_external_source', {
      contactType: { name: 'c_community_health_unit' },
      hierarchy: [],
      source: undefined,
      error: `Unkown external source ${PAYLOAD}`,
      data: {},
    });

    expect(html).to.not.contain('<img src=x');
    expect(html).to.contain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('search_external_source escapes reflected search params', async () => {
    const html = await liquid.renderFile('place/search_external_source', {
      contactType: {
        name: 'c_community_health_unit',
        place_properties: [
          { type: 'string', property_name: 'name', friendly_name: 'Name', external_mapping: { 'source-a': { is_filter: true } } },
        ],
      },
      hierarchy: [
        { level: 1, property_name: 'district', friendly_name: 'District', external_mapping: { 'source-a': { is_filter: true } } },
      ],
      source: { id: 'source-a' },
      data: { place_name: PAYLOAD, hierarchy_district: PAYLOAD, hierarchy_district_id: PAYLOAD },
    });

    expect(html).to.not.contain('<img src=x');
    expect(html).to.contain('value="&#34;&gt;&lt;img src=x onerror=alert(1)&gt;"');
  });

  it('contact_type_dob escapes the value', async () => {
    const html = await liquid.renderFile('components/contact_type_dob', {
      prop_name: 'contact_dob',
      data: { contact_dob: PAYLOAD },
      prop: { property_name: 'dob' },
    });

    expect(html).to.not.contain('<img src=x');
  });

  it('manage_hierarchy_warning escapes the values', async () => {
    const html = await liquid.renderFile('components/manage_hierarchy_warning', {
      op: 'move',
      sourceHierarchy: [{ property_name: 'district', friendly_name: 'District' }],
      destinationHierarchy: [{ property_name: 'district', friendly_name: 'District' }],
      data: { source_district: PAYLOAD, destination_district: PAYLOAD },
      warningInfo: {},
    });

    expect(html).to.contain('&lt;img src=x');

    expect(html).to.not.contain('<img src=x');
  });
});
