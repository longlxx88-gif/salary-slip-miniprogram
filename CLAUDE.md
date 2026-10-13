# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this project.

A native WeChat Mini Program (WXML/WXSS/JS) with one WeChat Cloud function. It photographs a payslip, runs OCR on it, and keeps a monthly salary ledger. There is no package manager setup at the project root, no linter, and no tests.

## Commands

There is no CLI build. Develop, preview and upload in WeChat DevTools (微信开发者工具) by importing this directory.
- Deploy the cloud function: in DevTools, right-click `cloudfunctions/ocr` and choose "上传并部署：云端安装依赖". Its only dependency is `wx-server-sdk`.
- Cloud env ID: `cloud1-d0grza2b4af76d2b4`, hardcoded in `app.js`. The function must be named exactly `ocr`.
- Set these environment variables on the cloud function. Azure is preferred; Tencent is the fallback:
  - Azure: `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_DOCUMENT_INTELLIGENCE_KEY`, and optionally `AZURE_DOCUMENT_INTELLIGENCE_API_VERSION` (default `2024-11-30`)
  - Tencent: `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, and optionally `TENCENT_REGION` (default `ap-guangzhou`)
- Production only has the Tencent variables configured (every stored `ocr_results` doc is `tencent-table`/`tencent-general`).
- Create the cloud DB collections `ocr_results` and `salary_backups`, and set the function timeout to about 30s.
- A second cloud function, `backup`, reads and writes `salary_backups` (`action: 'get' | 'save'`). Deploy it the same way.
- If no keys are configured, or the cloud call fails, both the function and the frontend fall back to built-in mock OCR data. You can therefore exercise the review/save/stats flow without credentials.

## Architecture

**Data flow:** `scan` → `ocr` cloud function → `review` → local storage → `home`/`stats`

1. `pages/scan/scan.js` compresses the image only when it is over 4MB (a canvas loop over decreasing size/quality plans). It uploads to cloud storage under `ocr-temp/`, gets a temp URL and calls `ocr` with `imageUrl`. If the upload fails, it falls back to `imageBase64` (capped at about 380KB). The temp cloud file is deleted afterwards.
2. `cloudfunctions/ocr/index.js`:
   - **Azure path:** used when Azure is configured and an `imageUrl` is present. It calls `prebuilt-layout` and polls `operation-location`.
   - **Tencent path:** otherwise it calls `RecognizeTableAccurateOCR` with hand-rolled TC3-HMAC-SHA256 signing.
   - **Normalized output:** both providers are converted to a common `tableCells`/`items` shape: `text, x, y, width, height, row, col, rowSpan, colSpan, confidences`. Confidences are on a 0–100 scale; Azure's 0–1 values are multiplied by 100.
   - **Storage and large results:** the full result is written to `ocr_results` with `ownerOpenId`. If the result has more than 50 cells or is over 40KB, the function returns only a summary with `truncated: true` and a `recordId`. The frontend then calls `ocr` again with `{action: 'getResult', recordId}`. That call checks the caller's openid.
3. Hand-off between pages goes through `getApp().globalData.pendingReview` (`{replaceId, imagePath, ocrResult | manual}`), not URL params. `review` also accepts `?id=` to edit an existing record and `?manual=1` for blank entry.
4. `pages/review/review.js` calls `salary.buildDraft()`, lets the user correct values, and blocks saving while there are unconfirmed low-confidence items or the month doesn't match `YYYY-MM`. On save it:
   - rebuilds the template from the items,
   - resolves duplicate months (overwrite, or bump to the next free month),
   - copies the image into `wx.env.USER_DATA_PATH`,
   - then calls `storage.upsertRecord`.

**`utils/salary.js`** holds all the domain logic and is the file most changes will touch:
- **Fixed field order:** `SALARY_TEMPLATE_ORDER` defines the canonical field names and their order in four groups: `income`, `deduct`, `total`, `annual`. `getOrderedTemplate()` always merges user templates onto this base. The field names are specific to the actual payslip format (Chinese/English/Thai, from a Thai industrial-estate employer).
- **Pairing amounts with labels:** `pairBlocks` uses table row/column pairing (`pairTableBlocks`) when cells carry `row`/`col`. This covers multi-line cells, mixed label+amount cells, and labels in the same row to the left. If there is no row/column data, it falls back to y-coordinate proximity.
- **Fixed field set:** recognized names are fuzzy-matched against the template. **Unmatched names are dropped**, so to add a new field, add it to `SALARY_TEMPLATE_ORDER` or the template.
- **Noise filtering:** `isIgnored` and `ignoredKeywords` filter out headers, bank, address and company noise. `normalizeAmountText` fixes OCR character confusions (O→0, l/I→1, S→5, B→8).
- **Filling and checking values:** `deriveMissingFormulaItems` fills one blank value from the others: social insurance/tax from the deduction total, and net/deduction total from gross. `validateItems` checks that gross − deductions = net, within 0.02.

**Companies.** A "format" is a company. Users can add companies in the UI: 我的 → 模板管理, handled by `pages/template` (the list) and `pages/format` (the editor).
- **Built-ins:** `thai` and `cn` are built in. Only their name, currency, symbol and colour can be overridden.
- **Custom companies:** stored in `salary_formats_v1` as `{overrides, customs}` and synced as `snapshot.formats`. They always use the list engine (`cnSlip`), configured by `formats.engineConfig(id)`: key fields, enabled checks, and the scan mode (`photo` = table OCR, `screenshots` = `mode: 'cn'` plus optional watermark removal, `manual`).
- **Templates:** each company's template is stored in `salary_template_v1_<id>`.
- **Pages:** the home page is a wallet of company cards, and `pages/card` is the per-company monthly detail page.

**Payslip formats (`utils/formats.js`).** Two formats are supported. Each month normally has one record of each.
- `thai`: the Thai company payslip. It is photographed, uses one image and the table OCR, and is paid in THB. All logic described above applies to it. Records saved before the format field existed have no `format`; they are read as `thai` and never rewritten for that reason.
- `cn`: the domestic company payslip. It is entered as several screenshots of the "我的薪资" app pages and is paid in CNY. The scan page calls `ocr` with `mode: 'general'`, which uses Tencent `GeneralAccurateOCR` and returns `lines` with `polygon`. Table OCR fails on these pages because of the diagonal `LY514857` watermark.
- `utils/cnSlip.js` handles `cn`:
  - **Filtering:** it drops lines tilted more than 10° (the watermark).
  - **Pairing:** it pairs each Chinese label with the value on the same row by center-y. A value must look like `-?\d+\.\d{2}`, which also excludes watermark digits.
  - **Matching:** labels are matched against `CN_TEMPLATE_ORDER` **exactly** after normalization. There is no substring fuzzy matching, because names like 病假工时H and 病假工资 collide.
  - **Merging:** it merges pages, with duplicate pages deduplicated and conflicts flagged.
  - **Deriving:** when exactly one income or deduction value is missing, it back-fills it and marks it pending.
  - **Validation:** income sum = 应发工资合计, and 应发 − deductions = 实发工资合计. The `tax` group adds a third check: 应发 + 合并扣税额 = 计税应发工资合计. 合并扣税额 is cash already received; it is taxed but not deducted from net pay. The `info` group (attendance, hours, reference amounts) is excluded from the money checks.
- `salary.js` functions take an optional `format` and dispatch to `cnSlip` for `cn`. With no format they keep the original Thai behaviour, so Thai output must stay byte-identical.

**`utils/storage.js`** is a thin wrapper over `wx.*StorageSync` with versioned keys:
- `salary_template_v1` holds the Thai template and `salary_template_v1_cn` the domestic one.
- `salary_records_v1`, `salary_settings_v1`, `salary_last_format_v1` and `salary_sync_v1` hold the rest.
- A record is `{id, month, format, items: {fieldName: amount}, imagePath, imagePaths?, createdAt, updatedAt}`.
- `upsertRecord` keeps **one record per month per format**.

**Cloud backup (`utils/backup.js`, cloud function `backup`).** Each user has one doc in `salary_backups`: `{ownerOpenId, snapshot: {records, settings, template, templates: {cn}}, updatedAt}`. `template`/`records`/`settings` is the original shape, so keep it compatible.
- **Restore:** on launch, if local records are empty, the app restores from the cloud before allowing any auto-backup. This lets a user reinstall without losing data.
- **Backup:** writes to records, templates or settings trigger a debounced, serialized save.
- **Server safety:** the server refuses to overwrite a non-empty cloud snapshot with empty records unless `allowEmpty` is set, and it replaces the snapshot with `_.set()`.
- **Images:** they are uploaded to cloud storage under `salary-slips/` when `cloudImageBackup` is on, and the record stores the `cloud://` fileID.

## Conventions and gotchas

- Code is ES6 CommonJS (`require`/`module.exports`), uses wx callback APIs wrapped in Promises, and has no semicolons. UI strings and comments are in Chinese.
- The mock OCR sample is duplicated in `cloudfunctions/ocr/index.js` (`mockResult`) and `pages/scan/scan.js` (`openMockReview`). Keep the two in sync.
- Tencent table OCR: do **not** add `EnableCoord`, `EnableWordPolygon`, `ConfigID` or `IsWords`. They are not valid parameters for this API. Never return the Excel `Data` base64 to the client.
- OCR keys must stay in cloud function env vars, never in frontend code.
- The original frontend source of the released version was lost. This repo is the rebuild; `cloudfunctions/backup` was downloaded from the cloud. Never deploy over production without testing the reinstall → auto-restore path.
- Charts in `pages/stats` use raw Canvas, not ECharts.
