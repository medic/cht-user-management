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
