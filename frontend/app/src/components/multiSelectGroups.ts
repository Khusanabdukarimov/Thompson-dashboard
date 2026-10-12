/**
 * Grouping for MultiSelect. Pure functions, no imports, so they can be tested
 * without a DOM.
 */
export type SelectOption = { value: string; label: string; group?: string };
export type OptionGroup = { name: string; items: SelectOption[] };

/** Label for options that carry no group once at least one other option does. */
export const OTHER_GROUP = "Boshqa";

/**
 * Splits options into groups, in order of first appearance (the caller decides
 * the order by sorting the options). Returns null when no option has a group —
 * the picker then renders its plain flat list.
 */
export function groupOptions(options: SelectOption[]): OptionGroup[] | null {
  if (!options.some(o => o.group)) return null;
  const groups = new Map<string, SelectOption[]>();
  for (const o of options) {
    const name = o.group || OTHER_GROUP;
    const items = groups.get(name);
    if (items) items.push(o); else groups.set(name, [o]);
  }
  return [...groups].map(([name, items]) => ({ name, items }));
}

/** How much of a group is ticked: drives the header checkbox. */
export function groupState(values: string[], items: SelectOption[]): "all" | "some" | "none" {
  const n = items.filter(o => values.includes(o.value)).length;
  return n === 0 ? "none" : n === items.length ? "all" : "some";
}

/** Header click: a fully ticked group is cleared, anything else is completed. Other groups are untouched. */
export function toggleGroup(values: string[], items: SelectOption[]): string[] {
  const inGroup = new Set(items.map(o => o.value));
  if (groupState(values, items) === "all") return values.filter(v => !inGroup.has(v));
  return [...new Set([...values, ...inGroup])];
}
