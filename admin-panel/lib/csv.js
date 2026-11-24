/** Build and download a CSV file in the browser. */
function cell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function downloadCsv(filename, sections) {
  const lines = [];
  sections.forEach((section, i) => {
    if (i) lines.push('');
    if (section.title) lines.push(cell(section.title));
    lines.push(section.columns.map(cell).join(','));
    section.rows.forEach((row) => lines.push(row.map(cell).join(',')));
  });
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
