export type MessageValues = Record<string, string | number>;

/** Replace `{name}` placeholders in catalog strings. */
export function formatMessage(template: string, values?: MessageValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}

export type PluralForms = {
  one: string;
  other: string;
};

/** Pick singular/plural catalog fragment using Intl.PluralRules. */
export function selectPlural(
  locale: string,
  count: number,
  forms: PluralForms,
  values?: MessageValues,
): string {
  const category = new Intl.PluralRules(locale).select(count);
  const template = category === 'one' ? forms.one : forms.other;
  return formatMessage(template, { count, ...values });
}
