import { expect } from 'chai';
import { Liquid } from 'liquidjs';

import { Config } from '../../src/config';
import { mockPlace, mockSimpleContactType } from '../mocks';

describe('liquid place/create_form', () => {
  const liquid = new Liquid({ extname: '.liquid', root: 'src/liquid', dynamicPartials: true });

  const renderEdit = (formDataOverride?: any) => {
    const contactType = mockSimpleContactType('string');
    contactType.replacement_property.required = true;
    const place = mockPlace(contactType, formDataOverride);
    return liquid.renderFile('place/create_form', {
      op: 'edit',
      place,
      contactType,
      hierarchy: Config.getHierarchyWithReplacement(contactType, 'desc'),
      data: place.asFormData('hierarchy_'),
      errors: {},
      externalSources: [],
    });
  };

  it('edit of a non-replacement place does not render the replacement field', async () => {
    const html = await renderEdit();
    expect(html).to.not.contain('name="hierarchy_replacement"');
    expect(html).to.contain('name="hierarchy_PARENT"');
  });

  it('edit of a replacement place renders the replacement field', async () => {
    const html = await renderEdit({ hierarchy_replacement: 'outgoing' });
    expect(html).to.contain('name="hierarchy_replacement"');
  });
});

describe('liquid components/contact_type_select', () => {
  const liquid = new Liquid({ extname: '.liquid', root: 'src/liquid', dynamicPartials: true });

  const selectedOptions = async (type: string, parameter: object, value: any): Promise<string[]> => {
    const html = await liquid.renderFile('components/contact_type_select', {
      prop_name: 'contact_prop',
      prop: { type, parameter },
      data: { contact_prop: value },
    });
    return [...html.matchAll(/<option\s+value="([^"]+)"\s+selected/g)].map(match => match[1]);
  };

  it('select_one does not select an option whose value is a substring of the selected value', async () => {
    expect(await selectedOptions('select_one', { female: 'Female', male: 'Male' }, 'female')).to.deep.eq(['female']);
    expect(await selectedOptions('select_one', { male: 'Male', female: 'Female' }, 'female')).to.deep.eq(['female']);
    expect(await selectedOptions('select_one', { female: 'Female', male: 'Male' }, 'male')).to.deep.eq(['male']);
  });

  it('select_one selects nothing when value is empty or unknown', async () => {
    expect(await selectedOptions('select_one', { female: 'Female', male: 'Male' }, undefined)).to.deep.eq([]);
    expect(await selectedOptions('select_one', { female: 'Female', male: 'Male' }, 'Female')).to.deep.eq([]);
  });

  it('select_multiple selects whole values from a space-delimited string', async () => {
    const parameter = { chocolate: 'Chocolate', dark_chocolate: 'Dark Chocolate', strawberry: 'Strawberry' };
    expect(await selectedOptions('select_multiple', parameter, 'dark_chocolate strawberry')).to.deep.eq(['dark_chocolate', 'strawberry']);
    expect(await selectedOptions('select_multiple', parameter, 'chocolate')).to.deep.eq(['chocolate']);
  });

  it('select_multiple selects values from an array (re-posted form)', async () => {
    const parameter = { chocolate: 'Chocolate', dark_chocolate: 'Dark Chocolate', strawberry: 'Strawberry' };
    expect(await selectedOptions('select_multiple', parameter, ['dark_chocolate', 'strawberry'])).to.deep.eq(['dark_chocolate', 'strawberry']);
  });
});
