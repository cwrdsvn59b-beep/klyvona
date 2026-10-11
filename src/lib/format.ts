export function formatIls(amount: number): string {
  if (amount === 0) return "ללא עלות";
  return `${new Intl.NumberFormat("he-IL").format(amount)} ₪`;
}

export function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
