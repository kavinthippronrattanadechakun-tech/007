export function manualDeliveryText(
  mail: string,
  password: string,
  notes: string,
) {
  return [
    mail.trim() ? `Mail: ${mail.trim()}` : "",
    password ? `Password: ${password}` : "",
    notes.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}
