import { expect } from 'chai';
import { Liquid } from 'liquidjs';

const SEX_OPTIONS = { m: 'Male', f: 'Female' };
const LANGUAGE_OPTIONS = { en: 'English', lg: 'Luganda', sw: 'Swahili' };

describe('liquid components/property_display', () => {
  const liquid = new Liquid({ extname: '.liquid', root: 'src/liquid' });

  const render = (property: object, value: any) => liquid.renderFile('components/property_display', { property, value });

  describe('select_one', () => {
    const property = { type: 'select_one', parameter: SEX_OPTIONS };

    it('displays the label for the stored key', async () => {
      expect(await render(property, 'f')).to.eq('Female');
    });

    it('falls back to the stored value when no option matches', async () => {
      expect(await render(property, 'x')).to.eq('x');
    });

    it('renders nothing for an empty value', async () => {
      expect(await render(property, '')).to.eq('');
      expect(await render(property, undefined)).to.eq('');
    });
  });

  describe('select_multiple', () => {
    const property = { type: 'select_multiple', parameter: LANGUAGE_OPTIONS };

    it('displays a single label', async () => {
      expect(await render(property, 'sw')).to.eq('Swahili');
    });

    it('joins multiple labels with a comma and no stray whitespace', async () => {
      expect(await render(property, 'en lg sw')).to.eq('English, Luganda, Swahili');
    });

    it('falls back to the stored value only for keys with no matching option', async () => {
      expect(await render(property, 'en xx')).to.eq('English, xx');
    });
  });

  it('renders non-select values unchanged', async () => {
    expect(await render({ type: 'string' }, 'Jane Doe')).to.eq('Jane Doe');
  });
});

describe('liquid components/list_cell', () => {
  const liquid = new Liquid({ extname: '.liquid', root: 'src/liquid' });

  it('displays select labels instead of stored keys', async () => {
    const html = await liquid.renderFile('components/list_cell', {
      propertyName: 'contact_languages',
      property: { type: 'select_multiple', property_name: 'languages', parameter: LANGUAGE_OPTIONS },
      values: { languages: 'en lg' },
      place: { validationErrors: {} },
    });

    expect(html).to.contain('English, Luganda');
    expect(html).to.not.contain('en lg');
  });
});
