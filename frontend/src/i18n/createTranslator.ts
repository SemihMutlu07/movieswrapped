import { catalogs, type MessageKey } from './catalogs';
import type { Locale } from './locales';
import { formatMessage, selectPlural, type MessageValues, type PluralForms } from './interpolate';

export type Translator = {
  locale: Locale;
  t: (key: MessageKey, values?: MessageValues) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  plural: (count: number, forms: PluralForms, values?: MessageValues) => string;
};

export function createTranslator(locale: Locale): Translator {
  return {
    locale,
    t: (key, values) => formatMessage(catalogs[locale][key], values),
    formatNumber: (value, options) => new Intl.NumberFormat(locale, options).format(value),
    plural: (count, forms, values) => selectPlural(locale, count, forms, values),
  };
}
