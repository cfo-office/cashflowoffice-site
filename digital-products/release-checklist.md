# Excel Digital Product Release Checklist

Use this checklist before publishing or uploading any Cash Flow Office spreadsheet product bundle.

## 1. Source Workbook Control

- Confirm editable source workbooks are stored only in `digital-products/excel-source/`.
- Confirm source workbook filenames match the intended product names and versions.
- Confirm no temporary Excel files are present, including files beginning with `~$`.
- Confirm workbook changes were made intentionally and reviewed by the product owner.
- Confirm no QC notes, working drafts, or internal instructions are embedded in customer-facing sheets.

## 2. Workbook Manual Review

- Open each workbook in Excel.
- Confirm all visible tabs are expected for the customer release.
- Confirm formulas calculate without visible errors such as `#REF!`, `#VALUE!`, `#DIV/0!`, or `#NAME?`.
- Confirm workbook protection, unlocked input cells, and locked formula cells match the intended customer workflow.
- Confirm sample data, placeholder text, and instructions are appropriate for customer delivery.
- Confirm print areas, page orientation, and page breaks are acceptable where printed use is expected.
- Confirm external links, macros, Power Query connections, and data connections are absent unless intentionally included.
- Confirm workbook metadata does not contain private author notes or internal comments.

## 3. QC Report Review

- Confirm QC reports are stored only in `digital-products/qc-reports/`.
- Confirm QC reports reference the actual current filenames.
- Confirm any known limitations or remaining manual review items are documented.
- Confirm no QC report files are included in the release ZIP.

## 4. Automated Workbook Audit

- [x] Audit script created.
- [x] Audit script run.
- [x] JSON audit report generated.
- [x] Markdown audit report generated.
- [x] Formula cells scanned.
- [x] Protection scanned.
- [x] Data validation scanned.
- [x] Conditional formatting scanned.
- [x] Hidden sheets scanned.
- [x] External links scanned.
- [x] Manual scenario testing still required.

## 5. Release Package Build

- Confirm the customer-facing ZIP is stored only in `digital-products/release/`.
- Confirm the release ZIP includes only customer-facing Excel files.
- Confirm the release ZIP does not include source notes, QC reports, hidden files, `.DS_Store`, development files, or nested folders.
- Confirm the release ZIP opens successfully on a clean machine.
- Confirm each workbook can be opened directly after extracting the ZIP.

## 6. Final Repository Check

- Run `git status`.
- Confirm changed files are expected.
- Confirm Excel workbook content was not changed by release packaging unless intentionally reviewed.
- Confirm the checklist, QC audit, and release ZIP are ready to commit when approved.
- Do not commit or publish until the product owner approves the release package.
